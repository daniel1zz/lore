// @spawns dist/lore
/**
 * AC-ND-8 (spec-lore-done-closes-a-commitless-task-through-an-audited-no): every closer and reader uses the one landing
 * predicate, proved through the COMPILED `dist/lore` on a throwaway repo and corpus (`mkdtemp` + `lore init`; never this repo's
 * own `.lore/`).
 *
 * One task claims a branch, records a clean captured pass, is released, and its branch and worktree vanish (the unchanged-work
 * shape). Then, all through the binary:
 *   - `lore_done` over the tool protocol (`dist/lore --mcp-server`, a real MCP client) archives it (exactly `archived`);
 *   - `lore get` prints `Landing: no-change`;
 *   - `lore set <plan> --status archived` (plan close) of the plan whose ONLY task has that landing exits 0;
 *   - the plan's milestone-review input adds no commit range for the task: the review fingerprint's landed-commit part is `none`
 *     and assess's recorded ranges are empty, both computed from the document the binary stored.
 * A second task, whose branch really carries a commit that reached main, is the control: its landing is `commits`, it prints
 * `Landing: commits <tip>`, and it DOES count (a reader that ignored the kind would pass the first half only).
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
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../helpers/clean-tree-repo.js";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { installShippedGuard } from "../integration/support/main-guard-repo.js";
import { latestLandingCommit } from "../../src/service/milestone-review.js";
import { collectRecordedRanges } from "../../src/service/task-commit-range.js";

const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const DIST_LORE = join(PROJECT_ROOT, "dist", "lore");
const ACTOR = "agent:landing-compiled-e2e";
/** The run the agent integration vouches for on tool-protocol writes (normally set by its pre-tool hook). */
const MCP_SESSION = "a77e57e1-aaaa-bbbb-cccc-333333333333";
const MCP_RUN = `cc:${MCP_SESSION}`;

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

function lore(args: string[]): Run {
  const proc = Bun.spawnSync([DIST_LORE, ...args], { cwd: dir, env: loreEnv() });
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
  const task = slugOf(mustLore(["create", "task", "--title", title, "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai", ...(declareEmptyScope ? ["--ac-scope", ""] : [])]));
  mkdirSync(join(dir, ".claude", "wt"), { recursive: true });
  git(["worktree", "add", "-q", "-b", branch, worktreeOf(branch), "main"]);
  git(["config", "user.email", "fixture@example.invalid"], worktreeOf(branch));
  git(["config", "user.name", "fixture"], worktreeOf(branch));
  mustLore(["claim", task, "--worktree", branch]);
  const wt = worktreeOf(branch);
  const proc = Bun.spawnSync(
    [DIST_LORE, "evidence", task, "--oracle", "test", "--command", "echo 'Ran 3 tests'", "--result", "pass", "--capture"],
    { cwd: wt, env: loreEnv() },
  );
  if ((proc.exitCode ?? -1) !== 0) throw new Error(`capture failed: ${proc.stdout.toString()}${proc.stderr.toString()}`);
  return { task, wt };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const transport = new StdioClientTransport({ command: DIST_LORE, args: ["--mcp-server"], cwd: dir, env: loreEnv(), stderr: "pipe" });
  const client = new Client({ name: "landing-compiled-e2e", version: "0.0.0" });
  await client.connect(transport);
  try {
    const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
    return { isError: result.isError === true, text: result.content.map((part) => part.text ?? "").join("\n") };
  } finally {
    await client.close();
  }
}

let plan = "";
let noChangeTask = "";
let commitsTask = "";
let integrateOutput = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-landing-compiled-"));
  makeCleanTreeRepo(dir);
  mustLore(["init"]);
  mustLore(["run", "register", "--harness", "claude-code", "--session", MCP_SESSION, "--harness-pid", String(process.pid)]);
  appendFileSync(join(dir, ".git", "info", "exclude"), ".claude/\n");
  patchLoreConfig(
    dir,
    ["workflow:", "  gates:", '    "plan-close":', "      enabled: false", "  review:", "    judgment_required_types: []", "  integrate:", '    floor_command: "true"', ""].join("\n"),
  );
  const prd = slugOf(mustLore(["create", "prd", "--title", "Landing PRD", "--content", "root", "--no-ai"]));
  plan = slugOf(mustLore(["create", "plan", "--title", "Landing Plan", "--parent", prd, "--content", "x", "--no-ai"]));
  mustLore(["set", plan, "--status", "approved"]);

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

  // the unchanged work: released, branch and worktree gone
  const unchanged = claimWithPass(plan, "Unchanged work", "nd8-nochange", true);
  noChangeTask = unchanged.task;
  mustLore(["release", noChangeTask]);
  git(["worktree", "remove", "--force", unchanged.wt]);
  git(["branch", "-D", "nd8-nochange"]);
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

  it("AC-ND-8 lore_done over the tool protocol archives the no-change task, and lore get shows `Landing: no-change`", async () => {
    const result = await callTool("lore_done", { harness_run: MCP_RUN, id_or_slug: noChangeTask, declare_no_new_tests: "read-only" });

    expect(result.isError, result.text).toBe(false);
    const doc = docOf(noChangeTask);
    expect(doc.status).toBe("archived"); // exact: a deprecated task would be a false green
    expect((doc.extra["landing"] as Record<string, unknown>)["kind"]).toBe("no-change");
    expect(mustLore(["get", noChangeTask])).toContain("Landing: no-change");
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
    expect([...collectRecordedRanges([{ slug: noChange.slug, extra: noChange.extra }]).keys()]).toEqual([]);
    expect([...collectRecordedRanges([{ slug: commits.slug, extra: commits.extra }]).keys()]).toEqual([commits.slug]);
    expect(latestLandingCommit([noChange, commits])).toBe(latestLandingCommit([commits]));
  }, 300_000);
});
