// @spawns packages/lore/src/index.ts
// @spawns-external git builds the throwaway repository and its linked worktrees
// @reads assets/project/reference-transaction
/**
 * @spec_ref spec-lore-done-closes-a-commitless-task-through-an-audited-no  AC-ND-2, AC-ND-4, AC-ND-9, AC-ND-10 (the git-facts part that survives the done contract)
 *
 * `lore done` decides "landed" from git facts through one predicate (`landingOf`), never from a record only `lore integrate` writes.
 * BR-1423, BR-1291, BR-159, BR-1179, BR-1245, BR-208.
 *
 * Under the done contract (plan-stage-1-of-the-done-contract-approve-time-contract-kinds) a CODE task is approved with a stored contract,
 * claimed on a branch and landed by `lore integrate`; the commitless-work route of the old AC-ND set is gone from code tasks:
 *   - the `no-change` landing a code task earned by releasing, deleting its branch and passing a read-only run is RETIRED (AC-ND-1,
 *     AC-ND-5, AC-ND-10 case A, AC-ND-9 corpus-only half): commitless work is a check or corpus task closed by `lore finish` at main's head
 *     (AC-DCS1-19, AC-DCS1-21; `landing-from-git-facts-compiled.bun.test.ts` runs that route through the binary);
 *   - the evidence-binding cases of AC-ND-3 (a pass on a dirty tree / an unreachable head / before the latest claim does not count) are
 *     replaced by the evidence rule of AC-DCS1-27, which binds a pass to the tree it ran on (`done-contract-done-floors-compiled`);
 *   - the oracle-file reads of AC-ND-6 are replaced by AC-DCS1-30 (`cli/verify-missing-oracle-file`);
 *   - the no-branch claim half of AC-ND-9 (`work-needs-branch`) is still owned by AC-DCS1-14 (a check or corpus task is never claimed and
 *     is finished with `lore finish`; the refusal also names `lore start`); this file keeps the detached-HEAD half (`worktree-without-branch`).
 * What stays, with the same predicate and the same refusal tokens: unlanded work refuses `[floor: not-landed]` with a reason token
 * (`tip-not-on-main`, `uncommitted-work`, `unmeasurable`), by whatever route main later reaches the commit; the capture-time tip decides
 * after the harness removes the branch; a worktree on a detached HEAD cannot be claimed.
 *
 * Fixture: one REAL git repo per case (mkdtemp, `git init -b main`, linked worktrees under `.claude/wt/`) plus a throwaway
 * corpus (`lore init`) in the same directory; the real CLI (`bun run src/index.ts`) is spawned against it. Never the repo's own
 * `.lore/`, never the repo's own refs.
 *
 * Direct SQLite access exists in this file for one job the CLI cannot do: seed a legacy shape (`end_tip` absent / pointing at a pruned
 * object) that the capture path now always repairs.
 *
 * Coverage: NEGATIVE (ND-2/4/10 refusals), BOUNDARY (ND-1 flag absent, ND-9 detached then branch), ERROR (ND-4 gone branch / missing object),
 * STATE (ND-4 nothing written), REGRESSION (ND-2 by-any-route, ND-10 deleted branch).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { Database } from "bun:sqlite";
import { join } from "path";
import { tmpdir } from "os";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../../helpers/clean-tree-repo.js";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** stdout + stderr — refusals go to stderr, plain output to stdout. */
  readonly text: string;
}

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const ACTOR = "agent:landing-from-git-facts-test";
const NOT_A_SHA = "0123456789abcdef0123456789abcdef01234567";

function loreEnv(): Record<string, string | undefined> {
  return { ...process.env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDECODE: "1", LORE_ACTOR: ACTOR };
}

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], { cwd, env: loreEnv() });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  return { stdout, stderr, exitCode: proc.exitCode ?? 1, text: `${stdout}\n${stderr}` };
}

function mustRun(args: string[], cwd: string): string {
  const result = runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`fixture step \`lore ${args.join(" ")}\` exited ${result.exitCode}: ${result.text}`);
  }
  return result.stdout;
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function parseSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from create output: ${stdout}`);
  return slug;
}

interface DocView {
  readonly status: string;
  readonly version: number;
  readonly extra: Record<string, unknown>;
}

function docOf(slug: string, cwd: string): DocView {
  const payload = JSON.parse(mustRun(["get", slug, "--json"], cwd)) as { data: { doc: DocView } };
  return payload.data.doc;
}

let dir: string;
let planSlug: string;
let taskCounter = 0;

function relaxPlanGates(root: string): void {
  patchLoreConfig(
    root,
    [
      "workflow:", "  gates:", '    "plan-close":', "      enabled: false", "  review:", "    judgment_required_types: []", "  integrate:", '    floor_command: "true"',
      // approve compiles each task's contract from these commands (a code task needs all three)
      "  done_contract:", '    install: "echo install-ok"', '    typecheck: "echo typecheck-ok"', '    test_file: "echo Ran 1 tests in {file}"', "",
    ].join("\n"),
  );
}

/** An approved code task (the red run is waived: it is not this file's subject). */
function createTask(title: string, extra: string[] = []): string {
  taskCounter += 1;
  const task = parseSlug(
    mustRun(
      ["create", "task", "--kind", "code", "--title", `${title} ${taskCounter}`, "--parent", planSlug, "--plan-id", planSlug, "--content", "x", "--no-ai", ...extra],
      dir,
    ),
  );
  mustRun(["approve", task, "--red-waiver", "the red run is not the subject of this test"], dir);
  return task;
}

function wtPath(branch: string): string {
  return join(dir, ".claude", "wt", branch);
}

/** A linked worktree + branch cut from main's head, as the dispatch protocol makes one. */
function addWorktree(branch: string): string {
  mkdirSync(join(dir, ".claude", "wt"), { recursive: true });
  git(["worktree", "add", "-q", "-b", branch, wtPath(branch), "main"], dir);
  git(["config", "user.email", "fixture@example.invalid"], wtPath(branch));
  git(["config", "user.name", "fixture"], wtPath(branch));
  return wtPath(branch);
}

/** Creates an approved code task and claims it on a fresh worktree/branch. Returns the task and the branch's start head. */
function claimOnBranch(branch: string, extra: string[] = []): { task: string; wt: string; start: string } {
  const task = createTask(`Task on ${branch}`, extra);
  const wt = addWorktree(branch);
  const start = git(["rev-parse", "HEAD"], wt);
  mustRun(["claim", task, "--worktree", branch], dir);
  return { task, wt, start };
}

function commitIn(wt: string, file: string, body = "work\n"): string {
  writeFileSync(join(wt, file), body);
  git(["add", file], wt);
  git(["commit", "-q", "-m", `work ${file}`], wt);
  return git(["rev-parse", "HEAD"], wt);
}

/** A runner-attested pass of every oracle of the stored contract, captured from `cwd` (the capture records the branch tip). */
function capturePasses(task: string, cwd: string): void {
  const oracles = (docOf(task, dir).extra["done_contract"] as { oracles: { id: string; command: string }[] }).oracles;
  for (const oracle of oracles) {
    const args = ["evidence", task, "--oracle", "test", "--command", oracle.command, "--result", "pass", "--capture"];
    if (oracle.id.startsWith("ac:")) args.push("--ac", oracle.id.slice("ac:".length));
    const result = runLore(args, cwd);
    if (result.exitCode !== 0) throw new Error(`capture of ${oracle.id} exited ${result.exitCode}: ${result.text}`);
  }
}

/** What a harness does at the end of an unchanged or abandoned run: the worktree and branch vanish. No `lore release`. */
function harnessRemoves(branch: string): void {
  git(["worktree", "remove", "--force", wtPath(branch)], dir);
  git(["branch", "-D", branch], dir);
}

/** Rewrites one field of the stored claim (legacy seeding only; see the header). `undefined` removes the key. */
function seedClaimField(slug: string, key: string, value: string | undefined): void {
  const db = new Database(join(dir, ".lore", "lore.db"));
  try {
    const row = db.query("SELECT extra FROM docs WHERE slug = ?").get(slug) as { extra: string } | null;
    if (row === null) throw new Error(`no doc ${slug}`);
    const extra = JSON.parse(row.extra) as { claim?: Record<string, unknown> };
    if (extra.claim === undefined) throw new Error(`${slug} has no stored claim to seed`);
    if (value === undefined) delete extra.claim[key];
    else extra.claim[key] = value;
    db.query("UPDATE docs SET extra = ? WHERE slug = ?").run(JSON.stringify(extra), slug);
  } finally {
    db.close();
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-landing-git-facts-"));
  makeCleanTreeRepo(dir);
  mustRun(["init"], dir);
  appendFileSync(join(dir, ".git", "info", "exclude"), ".claude/\n");
  relaxPlanGates(dir);
  const prd = parseSlug(mustRun(["create", "prd", "--title", "Landing PRD", "--content", "root", "--no-ai"], dir));
  planSlug = parseSlug(mustRun(["create", "plan", "--title", "Landing Plan", "--parent", prd, "--content", "x", "--no-ai"], dir));
  mustRun(["set", planSlug, "--status", "approved"], dir);
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("AC-ND-1 — there is no commitless-landing flag on lore done, and an unlanded code task is not closed by a released, deleted branch", () => {
  it("AC-ND-1 has no --declare-no-change flag: the command exits 2", () => {
    const { task } = claimOnBranch("nd1-noflag", ["--ac-scope", ""]);

    const refused = runLore(["done", task, "--declare-no-change"], dir);

    expect(refused.exitCode).toBe(2);
    expect(docOf(task, dir).status).not.toBe("archived");
  }, 300_000);

  it("AC-ND-1 (retired no-change landing) a code task released with its branch deleted and nothing landed is refused [floor: not-landed], never archived as no-change", () => {
    const { task, wt } = claimOnBranch("nd1-readonly", ["--ac-scope", ""]);
    capturePasses(task, wt);
    mustRun(["release", task], dir);
    harnessRemoves("nd1-readonly");

    const refused = runLore(["done", task], dir);

    // the row taken at the branch has no landed commit to be compared with: the evidence rule (AC-DCS1-27) refuses it as unmeasurable
    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");
    expect(refused.text).toContain("no landing record");
    expect(docOf(task, dir).status).not.toBe("archived");
    expect(docOf(task, dir).extra["landing"]).toBeUndefined();
  }, 300_000);
});

describe("AC-ND-2 — landing follows reachability from main", () => {
  it("AC-ND-2 refuses a branch with one commit not on main (tip-not-on-main), and a git merge by another route is not a landing record", () => {
    const { task, wt } = claimOnBranch("nd2-feature");
    const tip = commitIn(wt, "feature.txt");
    capturePasses(task, wt);

    const refused = runLore(["done", task], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");
    expect(refused.text).toContain("nd2-feature");
    expect(refused.text).toContain("tip-not-on-main");
    expect(docOf(task, dir).status).not.toBe("archived");

    git(["branch", "other-route", tip], dir); // the same commit, reaching main through a different branch
    git(["merge", "-q", "--ff-only", "other-route"], dir);
    const again = runLore(["done", task], dir);

    // reachability alone no longer closes a code task: only `lore integrate` records the landing a contract is judged against
    expect(again.exitCode).toBe(4);
    expect(again.text).toContain("[floor: not-landed]");
    expect(again.text).toContain("no landing record");
    expect(docOf(task, dir).status).not.toBe("archived");
  }, 300_000);

  it("AC-ND-2 judges a released, deleted branch by its recorded end_tip, never by the last evidence head", () => {
    const { task, wt, start } = claimOnBranch("nd2-post-evidence");
    capturePasses(task, wt); // evidence head = start
    const afterEvidence = commitIn(wt, "late.txt"); // the commit that came AFTER the last evidence
    mustRun(["release", task], dir); // records end_tip = afterEvidence
    harnessRemoves("nd2-post-evidence");
    expect(afterEvidence).not.toBe(start);

    const refused = runLore(["done", task], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");
    expect(refused.text).toContain("tip-not-on-main");
    expect(docOf(task, dir).status).not.toBe("archived");
  }, 300_000);
});

describe("AC-ND-4 — unlanded or unreadable work refuses and writes nothing", () => {
  function expectNothingWritten(task: string, before: DocView): void {
    const after = docOf(task, dir);
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version);
    expect(after.extra["landing"]).toBeUndefined();
  }

  it("AC-ND-4 an existing claimed worktree with an uncommitted tracked change refuses [floor: not-landed] uncommitted-work", () => {
    const { task, wt } = claimOnBranch("nd4-uncommitted");
    writeFileSync(join(wt, "README.md"), "edited after the claim\n"); // a tracked file
    const before = docOf(task, dir);

    const refused = runLore(["done", task], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");
    expect(refused.text).toContain("uncommitted-work");
    expectNothingWritten(task, before);
  }, 300_000);

  it("AC-ND-4 a gone branch with no recorded end_tip is unmeasurable, naming release and re-claim on a branch", () => {
    const { task } = claimOnBranch("nd4-no-tip");
    harnessRemoves("nd4-no-tip");
    seedClaimField(task, "end_tip", undefined); // the state of a claim that never recorded a tip
    const before = docOf(task, dir);

    const refused = runLore(["done", task], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");
    expect(refused.text).toContain("unmeasurable");
    expect(refused.text).toContain("release");
    expect(refused.text).toContain("branch");
    expectNothingWritten(task, before);
  }, 300_000);

  it("AC-ND-4 a recorded tip whose object is missing from the repository is unmeasurable", () => {
    const { task } = claimOnBranch("nd4-missing-object");
    harnessRemoves("nd4-missing-object");
    seedClaimField(task, "end_tip", NOT_A_SHA);
    const before = docOf(task, dir);

    const refused = runLore(["done", task], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");
    expect(refused.text).toContain("unmeasurable");
    expectNothingWritten(task, before);
  }, 300_000);
});

describe("AC-ND-9 — a claim on a worktree needs a branch (#304)", () => {
  it("AC-ND-9 claiming on a detached-HEAD worktree exits 4 worktree-without-branch and writes no claim; a branch worktree still claims", () => {
    const task = createTask("Detached", ["--anchor", "src/feature.ts"]);
    const wt = addWorktree("nd9-detached");
    git(["checkout", "-q", "--detach"], wt);
    const before = docOf(task, dir);

    const refused = runLore(["claim", task, "--worktree", wt], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("worktree-without-branch");
    expect(refused.text).toContain("A check or corpus task is never claimed");
    expect(refused.text).toContain("lore finish");
    expect(refused.text).not.toContain("without --worktree");
    expect(docOf(task, dir).extra["claim"]).toBeUndefined();
    expect(docOf(task, dir).version).toBe(before.version);

    git(["checkout", "-q", "nd9-detached"], wt);
    const claimed = runLore(["claim", task, "--worktree", wt], dir);
    expect(claimed.exitCode).toBe(0);
    expect(docOf(task, dir).extra["claim"]).toBeDefined();
  }, 300_000);
});

describe("AC-ND-10 — the capture-time tip decides after the harness removes the branch (no lore release, no run-end hook)", () => {
  it("AC-ND-10 a task that committed once and then captured passes, branch deleted with no release, refuses [floor: not-landed] tip-not-on-main", () => {
    const { task, wt } = claimOnBranch("nd10-committed");
    commitIn(wt, "work.txt");
    capturePasses(task, wt); // recorded tip = that commit, not on main
    harnessRemoves("nd10-committed");

    const refused = runLore(["done", task], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");
    expect(refused.text).toContain("tip-not-on-main");
    expect(docOf(task, dir).status).not.toBe("archived");
  }, 300_000);
});
