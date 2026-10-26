// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * @spec_ref spec-lore-done-closes-a-commitless-task-through-an-audited-no  AC-ND-1..7, AC-ND-9, AC-ND-10
 * @task task-red-tests-landing-from-git-facts-and-the-one-time-back-fill (TDD-Role: red)
 *
 * RED tests for plan-no-change-landing-for-commitless-tasks-356: `lore done` decides "landed" from git facts through one
 * predicate (`landingOf`), never from a record only `lore integrate` writes. BR-1423, BR-1291, BR-159, BR-1179, BR-1245, BR-208.
 *
 * Fixture: one REAL git repo per case (mkdtemp, `git init -b main`, linked worktrees under `.claude/wt/`) plus a throwaway
 * corpus (`lore init`) in the same directory; the real CLI (`bun run src/index.ts`) is spawned against it. Never the repo's own
 * `.lore/`, never the repo's own refs.
 *
 * Contract this file pins for the implementation task (spec step 1, 3, 7):
 *   - a branch claim stores `extra.claim.start_head` (the claim's base) and `extra.claim.end_tip` (branch HEAD at every capture
 *     on the branch and at release; newest wins);
 *   - `lore done` writes `extra.landing = { kind: "no-change" | "commits", start_head, tip, integration_head, measured_at }`;
 *   - refusals carry `[floor: not-landed]` + a reason token (`tip-not-on-main`, `uncommitted-work`, `unmeasurable`) or
 *     `[floor: attested-pass]` / `[floor: missing-oracle-file]`; a no-branch claim on an anchored task exits 4 `work-needs-branch`.
 *
 * Direct SQLite access exists in this file for two jobs the CLI cannot do: (1) read `extra`/`versions` back exactly as stored,
 * (2) seed a legacy shape (`end_tip` absent / pointing at a pruned object) that the capture path now always repairs.
 *
 * Coverage: HAPPY (ND-1, ND-2 landed leg, ND-10 case A), NEGATIVE (ND-2/3/4 refusals), BOUNDARY (ND-1 flag absent, ND-3 re-claim),
 * ERROR (ND-4 gone branch / missing object), STATE (ND-5 one landing write), REGRESSION (ND-6 #329, ND-9 #304).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { Database } from "bun:sqlite";
import { join } from "path";
import { tmpdir } from "os";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../../helpers/clean-tree-repo.js";
import { installShippedGuard } from "../support/main-guard-repo.js";
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

/** Starts `lore` without waiting: two of these started back to back genuinely overlap (AC-ND-5). */
function startLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", INDEX_TS, ...args], { cwd, env: loreEnv(), stdout: "pipe", stderr: "pipe" });
  return (async () => {
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode, text: `${stdout}\n${stderr}` };
  })();
}

/** A fixture step that must have worked: a refusal here is a broken fixture, reported with the CLI's own words. */
function succeeded(result: RunResult): RunResult {
  if (result.exitCode !== 0) throw new Error(`fixture step exited ${result.exitCode}: ${result.text}`);
  return result;
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

function landingOf(slug: string, cwd: string): Record<string, unknown> | undefined {
  return docOf(slug, cwd).extra["landing"] as Record<string, unknown> | undefined;
}

let dir: string;
let planSlug: string;
let taskCounter = 0;

function relaxPlanGates(root: string): void {
  patchLoreConfig(
    root,
    ["workflow:", "  gates:", '    "plan-close":', "      enabled: false", "  review:", "    judgment_required_types: []", "  integrate:", '    floor_command: "true"', ""].join("\n"),
  );
}

function createTask(title: string, extra: string[] = []): string {
  taskCounter += 1;
  return parseSlug(
    mustRun(
      ["create", "task", "--title", `${title} ${taskCounter}`, "--parent", planSlug, "--plan-id", planSlug, "--content", "x", "--no-ai", ...extra],
      dir,
    ),
  );
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

/** Creates a task and claims it on a fresh worktree/branch. Returns the task and the branch's start head. */
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

/** A runner-attested pass (`--capture` spawns the command and attests its exit code), run from `cwd`. */
function capturePass(task: string, cwd: string, extra: string[] = [], command = "echo 'Ran 3 tests'"): RunResult {
  return runLore(["evidence", task, "--oracle", "test", "--command", command, "--result", "pass", "--capture", ...extra], cwd);
}

/** What a harness does at the end of an unchanged or abandoned run: the worktree and branch vanish. No `lore release`. */
function harnessRemoves(branch: string): void {
  git(["worktree", "remove", "--force", wtPath(branch)], dir);
  git(["branch", "-D", branch], dir);
}

function withDb<T>(fn: (db: Database) => T, readonly = true): T {
  const db = new Database(join(dir, ".lore", "lore.db"), readonly ? { readonly: true } : undefined);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Rewrites one field of the stored claim (legacy seeding only; see the header). `undefined` removes the key. */
function seedClaimField(slug: string, key: string, value: string | undefined): void {
  withDb((db) => {
    const row = db.query("SELECT extra FROM docs WHERE slug = ?").get(slug) as { extra: string } | null;
    if (row === null) throw new Error(`no doc ${slug}`);
    const extra = JSON.parse(row.extra) as { claim?: Record<string, unknown> };
    if (extra.claim === undefined) throw new Error(`${slug} has no stored claim to seed`);
    if (value === undefined) delete extra.claim[key];
    else extra.claim[key] = value;
    db.query("UPDATE docs SET extra = ? WHERE slug = ?").run(JSON.stringify(extra), slug);
  }, false);
}

/** Per-version history of one doc: how many times `extra.landing` changed and how many versions carry status archived. */
function versionTrail(slug: string): { landingWrites: number; archivedVersions: number } {
  return withDb((db) => {
    const rows = db
      .query("SELECT v.extra AS extra, v.status AS status FROM versions v JOIN docs d ON d.id = v.doc_id WHERE d.slug = ? ORDER BY v.version")
      .all(slug) as Array<{ extra: string; status: string }>;
    let landingWrites = 0;
    let archivedVersions = 0;
    let previous: string | undefined;
    for (const row of rows) {
      const landing = JSON.stringify((JSON.parse(row.extra) as { landing?: unknown }).landing ?? null);
      if (landing !== "null" && landing !== previous) landingWrites += 1;
      previous = landing;
      if (row.status === "archived") archivedVersions += 1;
    }
    return { landingWrites, archivedVersions };
  });
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

describe("AC-ND-1 — a task that changed nothing is archived as landed, kind no-change", () => {
  it("AC-ND-1 archives a released, branch-deleted, clean-pass task: status exactly archived, landing.kind no-change, `Landing: no-change` shown", () => {
    const { task, wt, start } = claimOnBranch("nd1-readonly", ["--ac-scope", ""]);
    succeeded(capturePass(task, wt));
    mustRun(["release", task], dir);
    expect(docOf(task, dir).extra["claim"]).toBeUndefined();
    harnessRemoves("nd1-readonly");

    const done = runLore(["done", task, "--declare-no-new-tests", "read-only"], dir);

    expect(done.exitCode).toBe(0);
    expect(docOf(task, dir).status).toBe("archived"); // exact status: a deprecated task would be a false green
    const landing = landingOf(task, dir);
    expect(landing?.["kind"]).toBe("no-change");
    expect(landing?.["start_head"]).toBe(start);
    expect(landing?.["tip"]).toBe(start);
    expect(mustRun(["get", task], dir)).toContain("Landing: no-change");
  }, 300_000);

  it("AC-ND-1 has no --declare-no-change flag: the command exits 2", () => {
    const { task } = claimOnBranch("nd1-noflag", ["--ac-scope", ""]);

    const refused = runLore(["done", task, "--declare-no-change"], dir);

    expect(refused.exitCode).toBe(2);
    expect(docOf(task, dir).status).not.toBe("archived");
  }, 300_000);
});

describe("AC-ND-2 — landing follows reachability from main, by any route", () => {
  it("AC-ND-2 refuses a branch with one commit not on main (tip-not-on-main), then archives kind commits once main reaches that commit via another branch", () => {
    const { task, wt } = claimOnBranch("nd2-feature");
    const tip = commitIn(wt, "feature.txt");
    succeeded(capturePass(task, wt));

    const refused = runLore(["done", task], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");
    expect(refused.text).toContain("nd2-feature");
    expect(refused.text).toContain("tip-not-on-main");
    expect(docOf(task, dir).status).not.toBe("archived");

    git(["branch", "other-route", tip], dir); // the same commit, reaching main through a different branch
    git(["merge", "-q", "--ff-only", "other-route"], dir);
    const landed = runLore(["done", task], dir);

    expect(landed.exitCode).toBe(0);
    expect(docOf(task, dir).status).toBe("archived");
    expect(landingOf(task, dir)?.["kind"]).toBe("commits");
    expect(landingOf(task, dir)?.["tip"]).toBe(tip);
  }, 300_000);

  it("AC-ND-2 judges a released, deleted branch by its recorded end_tip, never by the last evidence head", () => {
    const { task, wt, start } = claimOnBranch("nd2-post-evidence");
    succeeded(capturePass(task, wt)); // evidence head = start
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

describe("AC-ND-3 — only clean passes at landed commits after the latest claim count", () => {
  it("AC-ND-3 a pass captured on a dirty claimed worktree does not count", () => {
    const { task, wt } = claimOnBranch("nd3-dirty");
    succeeded(capturePass(task, wt, [], "touch dirtied-by-the-run.txt && echo 'Ran 3 tests'"));

    const refused = runLore(["done", task], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: attested-pass]");
    expect(docOf(task, dir).status).not.toBe("archived");
  }, 300_000);

  it("AC-ND-3 a pass at a head that is not reachable from main does not count", () => {
    const { task, wt, start } = claimOnBranch("nd3-orphan-head");
    commitIn(wt, "orphaned.txt");
    succeeded(capturePass(task, wt)); // clean pass at a commit...
    git(["reset", "-q", "--hard", start], wt); // ...which the branch then drops: tip = start, the pass head is on no branch

    const refused = runLore(["done", task], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: attested-pass]");
    expect(docOf(task, dir).status).not.toBe("archived");
  }, 300_000);

  it("AC-ND-3 a clean pass at a main commit recorded BEFORE the latest re-claim does not count", () => {
    const first = claimOnBranch("nd3-reclaim-a");
    succeeded(capturePass(first.task, first.wt)); // clean, at main's head
    mustRun(["release", first.task], dir);
    const second = addWorktree("nd3-reclaim-b");
    mustRun(["claim", first.task, "--worktree", "nd3-reclaim-b"], dir); // the latest claim: later than the pass
    expect(second).toContain("nd3-reclaim-b");

    const refused = runLore(["done", first.task], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: attested-pass]");
    expect(docOf(first.task, dir).status).not.toBe("archived");
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
    succeeded(capturePass(task, wt));
    writeFileSync(join(wt, "README.md"), "edited after the pass\n"); // a tracked file
    const before = docOf(task, dir);

    const refused = runLore(["done", task], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");
    expect(refused.text).toContain("uncommitted-work");
    expectNothingWritten(task, before);
  }, 300_000);

  it("AC-ND-4 a gone branch with no recorded end_tip is unmeasurable, naming release and re-claim on a branch", () => {
    const { task, wt } = claimOnBranch("nd4-no-tip");
    succeeded(capturePass(task, wt));
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
    const { task, wt } = claimOnBranch("nd4-missing-object");
    succeeded(capturePass(task, wt));
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

describe("AC-ND-5 — concurrent closers write one landing", () => {
  it("AC-ND-5 two lore done processes started together both exit 0; one landing write, one archive walk", async () => {
    const { task, wt } = claimOnBranch("nd5-two-done", ["--ac-scope", ""]);
    succeeded(capturePass(task, wt));

    const [a, b] = await Promise.all([
      startLore(["done", task, "--declare-no-new-tests", "read-only"], dir),
      startLore(["done", task, "--declare-no-new-tests", "read-only"], dir),
    ]);

    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);
    expect(docOf(task, dir).status).toBe("archived");
    expect(landingOf(task, dir)?.["kind"]).toBe("no-change");
    const trail = versionTrail(task);
    expect(trail.landingWrites).toBe(1);
    expect(trail.archivedVersions).toBe(1);
  }, 300_000);

  it("AC-ND-5 lore done racing lore integrate leaves one landing with the same kind, start_head and tip", async () => {
    installShippedGuard(dir, join(dir, ".git", "guard-hooks")); // integrate refuses to run without the guard (BR-1273)
    const { task, wt, start } = claimOnBranch("nd5-race", ["--ac-scope", ""]);
    succeeded(capturePass(task, wt));

    const [done, integrate] = await Promise.all([
      startLore(["done", task, "--declare-no-new-tests", "read-only"], dir),
      startLore(["integrate", "nd5-race", "--session", "nd5-session"], dir),
    ]);

    expect([0, 4]).toContain(integrate.exitCode); // integrate may land first or find the work already archived
    expect(done.exitCode).toBe(0);
    expect(docOf(task, dir).status).toBe("archived");
    const landing = landingOf(task, dir);
    expect(landing?.["kind"]).toBe("no-change"); // measured_at / integration_head legitimately differ and are not compared
    expect(landing?.["start_head"]).toBe(start);
    expect(landing?.["tip"]).toBe(start);
    expect(versionTrail(task).landingWrites).toBe(1);
  }, 300_000);
});

describe("AC-ND-6 — oracle files are read from main, not a stale checkout (#329)", () => {
  const OWN_FILE = "tests/own-ac.test.ts";

  function specWithCriterion(acId: string, command: string): { spec: string; plan: string } {
    const spec = parseSlug(mustRun(["create", "spec", "--title", `Oracle Spec ${acId}`, "--content", "## Overview\nx", "--no-ai"], dir));
    mustRun(["ac", "add", spec, acId, "--statement", "A criterion.", "--mode", "script", "--oracle", "test", "--command", command, "--allow-missing-path", "red-first: the file arrives with the work"], dir);
    // an approved spec needs a cited business rule, which is not what this case tests: switch the upstream-approved claim gate off for this describe only
    patchLoreConfig(dir, ["workflow:", "  gates:", '    "task-claim":', "      enabled: false", ""].join("\n"));
    const plan = parseSlug(mustRun(["create", "plan", "--title", `Oracle Plan ${acId}`, "--parent", spec, "--content", "x", "--no-ai"], dir));
    return { spec, plan };
  }

  it("AC-ND-6 integrate of a branch that adds its own AC test file archives the task in the same run; the tip is then an ancestor of main", () => {
    installShippedGuard(dir, join(dir, ".git", "guard-hooks"));
    const { plan } = specWithCriterion("AC-OWN-1", `bun test ${OWN_FILE}`);
    const task = parseSlug(
      mustRun(["create", "task", "--title", "Own file task", "--parent", plan, "--plan-id", plan, "--ac-scope", "AC-OWN-1", "--content", "x", "--no-ai"], dir),
    );
    const wt = addWorktree("nd6-own-file");
    mustRun(["claim", task, "--worktree", "nd6-own-file"], dir);
    const redRun = "echo '1 fail' && echo 'Ran 3 tests across 1 files' && false";
    succeeded(runLore(["evidence", task, "--oracle", "test", "--command", redRun, "--result", "expected-fail", "--ac", "AC-OWN-1", "--capture"], wt));
    mkdirSync(join(wt, "tests"), { recursive: true });
    const tip = commitIn(wt, OWN_FILE, 'import { expect, test } from "bun:test";\ntest("own", () => { expect(1).toBe(1); });\n');
    succeeded(capturePass(task, wt, ["--ac", "AC-OWN-1"]));

    const integrate = runLore(["integrate", "nd6-own-file", "--session", "nd6-session"], dir);

    expect(integrate.exitCode).toBe(0);
    expect(integrate.text).not.toContain("missing-oracle-file");
    expect(docOf(task, dir).status).toBe("archived"); // same run: no separate `lore done`
    expect(() => git(["merge-base", "--is-ancestor", tip, "main"], dir)).not.toThrow(); // merge commit keeps the tip in main's history
  }, 300_000);

  it("AC-ND-6 a criterion naming a file absent from main still refuses [floor: missing-oracle-file]", () => {
    const { plan } = specWithCriterion("AC-GHOST-1", "bun test tests/ghost.test.ts");
    const task = parseSlug(
      mustRun(["create", "task", "--title", "Ghost task", "--parent", plan, "--plan-id", plan, "--ac-scope", "AC-GHOST-1", "--content", "x", "--no-ai"], dir),
    );
    succeeded(capturePass(task, dir, ["--ac", "AC-GHOST-1"]));

    const refused = runLore(["done", task, "--declare-no-new-tests", "fixture: the floor under test is the oracle file"], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: missing-oracle-file]");
    expect(refused.text).toContain("tests/ghost.test.ts");
    expect(existsSync(join(dir, "tests", "ghost.test.ts"))).toBe(false);
    expect(docOf(task, dir).status).not.toBe("archived");
  }, 300_000);
});

describe("AC-ND-9 — no-branch claims: work that changes files needs its branch; corpus-only work is proven at main's head (#304)", () => {
  it("AC-ND-9 claiming an anchored task without --worktree exits 4 work-needs-branch and writes no claim", () => {
    const task = createTask("Anchored", ["--anchor", "src/feature.ts"]);
    const before = docOf(task, dir);

    const refused = runLore(["claim", task], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("work-needs-branch");
    expect(docOf(task, dir).extra["claim"]).toBeUndefined();
    expect(docOf(task, dir).version).toBe(before.version);
  }, 300_000);

  it("AC-ND-9 claiming on a detached-HEAD worktree exits 4 worktree-without-branch and writes no claim; a branch worktree still claims", () => {
    const task = createTask("Detached", ["--anchor", "src/feature.ts"]);
    const wt = addWorktree("nd9-detached");
    git(["checkout", "-q", "--detach"], wt);
    const before = docOf(task, dir);

    const refused = runLore(["claim", task, "--worktree", wt], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("worktree-without-branch");
    expect(refused.text).toContain("without --worktree");
    expect(docOf(task, dir).extra["claim"]).toBeUndefined();
    expect(docOf(task, dir).version).toBe(before.version);

    git(["checkout", "-q", "nd9-detached"], wt);
    const claimed = runLore(["claim", task, "--worktree", wt], dir);
    expect(claimed.exitCode).toBe(0);
    expect(docOf(task, dir).extra["claim"]).toBeDefined();
  }, 300_000);

  it("AC-ND-9 a corpus-only task passes at main's head despite an unrelated dirty shared checkout, and lore done archives it as no-change", () => {
    const task = createTask("Corpus only", ["--ac-scope", ""]);
    mustRun(["claim", task], dir);
    writeFileSync(join(dir, "unrelated-scratch.txt"), "someone else's edit\n"); // another file in the shared checkout, uncommitted
    const mainHead = git(["rev-parse", "main"], dir);

    succeeded(capturePass(task, dir));
    const done = runLore(["done", task, "--declare-no-new-tests", "corpus-only"], dir);

    expect(done.exitCode).toBe(0);
    expect(docOf(task, dir).status).toBe("archived");
    expect(landingOf(task, dir)?.["kind"]).toBe("no-change");
    expect(git(["rev-parse", "main"], dir)).toBe(mainHead);
  }, 300_000);

  it("AC-ND-9 a no-branch pass whose head_sha differs from main's head at capture does not count: exit 4 [floor: attested-pass]", () => {
    const task = createTask("Off main", ["--ac-scope", ""]);
    mustRun(["claim", task], dir);
    git(["checkout", "-q", "-b", "side-checkout"], dir);
    commitIn(dir, "side.txt"); // the shared checkout's head is no longer main's head

    succeeded(capturePass(task, dir));
    const refused = runLore(["done", task, "--declare-no-new-tests", "corpus-only"], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: attested-pass]");
    expect(docOf(task, dir).status).not.toBe("archived");
  }, 300_000);
});

describe("AC-ND-10 — the capture-time tip decides after the harness removes the branch (no lore release, no run-end hook)", () => {
  it("AC-ND-10 a task whose clean pass was captured at start_head, worktree and branch deleted with no release, archives as no-change", () => {
    const { task, wt, start } = claimOnBranch("nd10-unchanged", ["--ac-scope", ""]);
    succeeded(capturePass(task, wt));
    harnessRemoves("nd10-unchanged");
    expect(docOf(task, dir).extra["claim"]).toBeDefined(); // still claimed: nothing released it

    const done = runLore(["done", task, "--declare-no-new-tests", "read-only"], dir);

    expect(done.exitCode).toBe(0);
    expect(docOf(task, dir).status).toBe("archived");
    expect(landingOf(task, dir)?.["kind"]).toBe("no-change");
    expect(landingOf(task, dir)?.["tip"]).toBe(start);
  }, 300_000);

  it("AC-ND-10 a task that committed once and then captured a pass, branch deleted with no release, refuses [floor: not-landed] tip-not-on-main", () => {
    const { task, wt } = claimOnBranch("nd10-committed");
    commitIn(wt, "work.txt");
    succeeded(capturePass(task, wt)); // recorded tip = that commit, not on main
    harnessRemoves("nd10-committed");

    const refused = runLore(["done", task], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");
    expect(refused.text).toContain("tip-not-on-main");
    expect(docOf(task, dir).status).not.toBe("archived");
  }, 300_000);
});
