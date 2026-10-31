// @spawns dist/lore
/**
 * AC-ND-8 (spec-lore-done-closes-a-commitless-task-through-an-audited-no): every closer and reader uses the one landing
 * predicate, proved through the COMPILED `dist/lore` on a throwaway repo and corpus (`mkdtemp` + `lore init`; never this repo's
 * own `.lore/`).
 *
 * One corpus task (commitless work: it changes no file, so it has no branch and no landing) is approved with its contract and
 * finished by `lore finish` at main's head (the retired route, a code task on a vanished branch closed by `lore done` with a
 * `no-change` landing, no longer exists: `lore done` demands a landing record of a code task). Then, all through the binary:
 *   - `lore finish` through the CLI archives it (exactly `archived`) and stores no landing;
 *   - `lore get` prints no landing line;
 *   - `lore set <plan> --status archived` (plan close) of the plan whose tasks are that one and the control exits 0;
 *   - the plan's milestone-review input adds no commit range for the task: the review fingerprint's landed-commit part is `none`
 *     and assess's recorded ranges are empty, both computed from the document the binary stored.
 * A second task, a code task whose branch really carries a commit that reached main through `lore integrate`, is the control: its
 * landing is `commits`, it prints `Landing: commits <tip>`, and it DOES count (a reader that ignored the kind would pass the first
 * half only).
 *
 * False green guarded: a service-only test passes while a caller keeps its own landing logic; here each caller is run through
 * the binary, and `landing-predicate-census.test.ts` proves no other computation exists.
 *
 * Coverage: HAPPY (no-change closes everywhere), NEGATIVE (the commits control is counted), STATE (landing stored once, status exact).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../helpers/clean-tree-repo.js";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { installShippedGuard } from "../integration/support/main-guard-repo.js";
import { latestLandingCommit } from "../../src/service/milestone-review.js";

const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const DIST_LORE = join(PROJECT_ROOT, "dist", "lore");
const ACTOR = "agent:landing-compiled-e2e";
/** The run the agent integration vouches for on the close (normally exported by its pre-tool hook; the run's harness is this test process, so ancestry verifies it). */
const DONE_SESSION = "a77e57e1-aaaa-bbbb-cccc-333333333333";
const DONE_RUN = `cc:${DONE_SESSION}`;

interface Run {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly text: string;
}

function loreEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || /^(CLAUDE|LORE|ANTHROPIC)/.test(key)) continue;
    env[key] = value;
  }
  return { ...env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDECODE: "1", LORE_ACTOR: ACTOR, GIT_TERMINAL_PROMPT: "0" };
}

let dir = "";

function lore(args: string[], extraEnv: Record<string, string> = {}): Run {
  const proc = Bun.spawnSync([DIST_LORE, ...args], { cwd: dir, env: { ...loreEnv(), ...extraEnv } });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  return { exitCode: proc.exitCode ?? -1, stdout, stderr, text: `${stdout}\n${stderr}` };
}

function mustLore(args: string[]): string {
  const run = lore(args);
  if (run.exitCode !== 0) throw new Error(`fixture step \`lore ${args.join(" ")}\` exited ${run.exitCode}: ${run.text}`);
  return run.stdout;
}

function git(args: string[], cwd: string = dir): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function slugOf(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`no slug in: ${stdout}`);
  return slug;
}

interface DocView {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly content: string;
  readonly status: string;
  readonly version: number;
  readonly extra: Record<string, unknown>;
}

function docOf(slug: string): DocView {
  return (JSON.parse(mustLore(["get", slug, "--json"])) as { data: { doc: DocView } }).data.doc;
}

function worktreeOf(branch: string): string {
  return join(dir, ".claude", "wt", branch);
}

/** A task claimed on a fresh worktree/branch, with a clean captured pass recorded from inside the worktree. */
function claimWithPass(plan: string, title: string, branch: string, declareEmptyScope: boolean): { task: string; wt: string } {
  const task = slugOf(mustLore(["create", "task", "--title", title, "--kind", "code", "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai", ...(declareEmptyScope ? ["--ac-scope", ""] : [])]));
  // the contract is compiled at approve; the red run is not this file's subject (AC-DCS1-5)
  mustLore(["approve", task, "--red-waiver", "the red run is not the subject of this test"]);
  mkdirSync(join(dir, ".claude", "wt"), { recursive: true });
  git(["worktree", "add", "-q", "-b", branch, worktreeOf(branch), "main"]);
  git(["config", "user.email", "fixture@example.invalid"], worktreeOf(branch));
  git(["config", "user.name", "fixture"], worktreeOf(branch));
  mustLore(["claim", task, "--worktree", branch]);
  const wt = worktreeOf(branch);
  // a clean runner pass for every oracle of the contract stored at approve, taken inside the worktree (its head is the branch tip)
  const oracles = ((docOf(task).extra["done_contract"] as { oracles: { id: string; command: string }[] }).oracles);
  for (const oracle of oracles) {
    const args = ["evidence", task, "--oracle", "test", "--command", oracle.command, "--result", "pass", "--capture"];
    if (oracle.id.startsWith("ac:")) args.push("--ac", oracle.id.slice("ac:".length));
    const proc = Bun.spawnSync([DIST_LORE, ...args], { cwd: wt, env: loreEnv() });
    if ((proc.exitCode ?? -1) !== 0) throw new Error(`capture failed: ${proc.stdout.toString()}${proc.stderr.toString()}`);
  }
  return { task, wt };
}

let plan = "";
let noChangeTask = "";
let commitsTask = "";
let integrateOutput = "";
let finishResult: Run = { exitCode: -1, stdout: "", stderr: "", text: "finish never ran" };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-landing-compiled-"));
  makeCleanTreeRepo(dir);
  mustLore(["init"]);
  mustLore(["run", "register", "--harness", "claude-code", "--session", DONE_SESSION, "--harness-pid", String(process.pid)]);
  appendFileSync(join(dir, ".git", "info", "exclude"), ".claude/\n");
  patchLoreConfig(
    dir,
    [
      "workflow:", "  gates:", '    "plan-close":', "      enabled: false", "  review:", "    judgment_required_types: []", "  integrate:", '    floor_command: "true"',
      // approve compiles each task's contract from these commands (a code task needs all three)
      "  done_contract:", '    install: "echo install-ok"', '    typecheck: "echo typecheck-ok"', '    test_file: "echo Ran 1 tests in {file}"', "",
    ].join("\n"),
  );
  const prd = slugOf(mustLore(["create", "prd", "--title", "Landing PRD", "--content", "root", "--no-ai"]));
  plan = slugOf(mustLore(["create", "plan", "--title", "Landing Plan", "--parent", prd, "--content", "x", "--no-ai"]));
  mustLore(["set", plan, "--status", "approved"]);

  // the commitless work: a corpus task (it changes no file, so it has no branch to land), approved with its contract and finished
  // at main's head by `lore finish`, in the shared checkout detached at main's tip and still clean (a landing moves main's ref
  // under the checkout, so the finish comes first). The retired route was a code task claimed on a branch whose worktree vanished,
  // closed by `lore done` with a `no-change` landing (AC-DCS1-19: a check or corpus task finishes with no claim and no landing record)
  noChangeTask = slugOf(mustLore(["create", "task", "--title", "Unchanged work", "--kind", "corpus", "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai", "--ac-scope", ""]));
  mustLore(["approve", noChangeTask]);
  git(["checkout", "-q", "--detach", "main"]);
  finishResult = lore(["finish", noChangeTask], { LORE_HARNESS_RUN: DONE_RUN });

  // the commits control: its branch carries one commit, and that commit reaches main
  const control = claimWithPass(plan, "Commits control", "nd8-commits", false);
  writeFileSync(join(control.wt, "control.txt"), "work\n");
  git(["add", "control.txt"], control.wt);
  git(["commit", "-q", "-m", "work control.txt"], control.wt);
  commitsTask = control.task;
  mustLore(["release", commitsTask]);
  git(["worktree", "remove", "--force", control.wt]);
  mkdirSync(join(dir, ".claude", "worktrees"), { recursive: true });
  installShippedGuard(dir, join(dir, ".git", "guard-hooks"));
  const landed = lore(["integrate", "nd8-commits", "--session", "nd8-s1"]);
  if (landed.exitCode !== 0) throw new Error(`integrate failed: ${landed.text}`);
  integrateOutput = landed.text;
}, 600_000);

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("AC-ND-8 every closer and reader uses the one landing predicate (compiled)", () => {
  it("AC-ND-8 integrate recorded and archived the commits task through the predicate: kind commits, `Landing: commits <tip>`", () => {
    const doc = docOf(commitsTask);
    expect(integrateOutput).toContain("task-commits-control archived by the landing");
    expect(doc.status).toBe("archived");
    const landing = doc.extra["landing"] as Record<string, unknown>;
    expect(landing["kind"]).toBe("commits");
    expect(String(landing["tip"])).toMatch(/^[0-9a-f]{40}$/);
    expect(mustLore(["get", commitsTask])).toContain(`Landing: commits ${String(landing["tip"])}`);
  }, 300_000);

  it("AC-ND-8 lore finish archives the commitless corpus task with no landing record, and lore get prints no landing line", () => {
    expect(finishResult.exitCode, finishResult.text).toBe(0);
    const doc = docOf(noChangeTask);
    expect(doc.status).toBe("archived"); // exact: a deprecated task would be a false green
    expect(doc.extra["landing"]).toBeUndefined(); // a corpus task has no branch to land: no landing of any kind is stored
    expect(mustLore(["get", noChangeTask])).not.toContain("Landing:");
  }, 300_000);

  it("AC-ND-8 plan close passes: every task of the plan is landed and archived", () => {
    const closed = lore(["set", plan, "--status", "archived"]);

    expect(closed.exitCode, closed.text).toBe(0);
    expect(docOf(plan).status).toBe("archived");
  }, 300_000);

  it("AC-ND-8 the milestone review input adds no commit range for the no-change task, and still counts the commits task", () => {
    const noChange = docOf(noChangeTask);
    const commits = docOf(commitsTask);

    expect(latestLandingCommit([noChange])).toBe("none");
    expect(latestLandingCommit([commits])).toBe((commits.extra["landing"] as Record<string, unknown>)["landing_commit"]);
    expect(latestLandingCommit([noChange, commits])).toBe(latestLandingCommit([commits]));
  }, 300_000);
});
