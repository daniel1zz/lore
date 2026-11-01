// @spawns packages/lore/src/index.ts
// @spawns-external git builds the throwaway repository and its linked worktrees
/**
 * Done-contract model (this file's tasks are `code` tasks approved with a contract, landed by a landing record): the retired
 * no-change landing and the no-branch claim are gone, so each case claims on a branch and lands it (`support/land-task.ts`). A
 * landed task is judged by its landing record, so a tipless legacy claim only blocks while the fresh claim's branch is unlanded.
 */
/**
 * @spec_ref spec-claims-released-before-tips-were-recorded-are-classified  AC-UC-1 (a)-(f)
 * @task task-classify-released-pre-356-claims-without-a-tip-as (TDD-Role: red then green)
 *
 * Issue #473: a task whose old claim branch was removed before #356 recorded branch tips stays `unmeasurable` forever.
 * Migration 040 marks each RELEASED branch claim holding neither `start_head` nor `end_tip` as unrecoverable (one
 * `claim-unrecoverable` audit entry each, no git read); landing then judges only the measurable claims and checks the
 * branch ref of each unrecoverable one. BR-1423, BR-1291.
 *
 * Fixture: one REAL git repo per case (mkdtemp, `git init -b main`) plus a throwaway corpus (`lore init`); the real CLI
 * (`bun run src/index.ts`) is spawned against it. Never the repo's own `.lore/`. A pre-#356 claim cannot be made by the
 * current CLI (a branch claim always records a start), so its claim audit row is INSERTED with the store's own chaining
 * helpers and the schema is set back to 39 so `lore migrate schema` runs migration 040 over it.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { Database } from "bun:sqlite";
import { join } from "path";
import { tmpdir } from "os";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../../helpers/clean-tree-repo.js";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { landTask, recordContractPasses, type TaskWorld } from "../support/land-task.js";
import { landWithoutIntegrate } from "../../helpers/done-contract-land.js";
import { auditBindings, INSERT_AUDIT_SQL, SELECT_AUDIT_HEAD_SQL } from "../../../src/store/migrations/migration-028.js";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** stdout + stderr: refusals go to stderr, plain output to stdout. */
  readonly text: string;
}

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const ACTOR = "agent:landing-unrecoverable-claims-test";
const LEGACY_AT = "2026-01-01T00:00:00.000Z";

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
  if (result.exitCode !== 0) throw new Error(`fixture step \`lore ${args.join(" ")}\` exited ${result.exitCode}: ${result.text}`);
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

/**
 * An approved task: `corpus` (commitless work, finished by `lore finish` at main's head) unless `kind` says `code` (it has a branch).
 * A code task's red run is waived: it is not this file's subject.
 */
function createTask(root: string, title: string, parent: string, kind: "corpus" | "code" = "corpus", approved = true): string {
  taskCounter += 1;
  const task = parseSlug(
    mustRun(["create", "task", "--kind", kind, "--title", `${title} ${taskCounter}`, "--parent", parent, "--plan-id", parent, "--content", "x", "--no-ai", "--ac-scope", ""], root),
  );
  // reason: approve compiles the contract at a commit of the repository, so a corpus outside any repository stays a draft
  if (approved) mustRun(kind === "code" ? ["approve", task, "--red-waiver", "the red run is not the subject of this test"] : ["approve", task], root);
  return task;
}

/**
 * Takes the approved CODE task through a real claim on its own branch, one commit, the landing record and a runner pass for every
 * contract oracle, so `lore done` reaches the landing judgement over the claims (the legacy ones included).
 */
async function claimAndLand(task: string, branch: string, stage: "claimed" | "landed" = "landed"): Promise<void> {
  mkdirSync(join(dir, ".claude", "wt"), { recursive: true });
  await landTask(world(), {
    slug: task,
    branch,
    worktree: join(dir, ".claude", "wt", branch),
    claimValue: "branch",
    session: "uc",
    approve: false,
    land: stage === "landed",
  });
}

function world(): TaskWorld {
  return { dir, git: (args) => git([...args], dir), lore: (args) => runLore([...args], dir) };
}

/** The rest of {@link claimAndLand} for a task left `claimed`: one commit on its branch, the landing record, a pass for every oracle. */
async function landClaimed(task: string, branch: string): Promise<void> {
  const wt = join(dir, ".claude", "wt", branch);
  git(["config", "user.email", "fixture@example.invalid"], wt);
  git(["config", "user.name", "fixture"], wt);
  writeFileSync(join(wt, `${branch}.txt`), `${branch}\n`);
  git(["add", "-A"], wt);
  git(["commit", "-q", "-m", `own commit ${branch}`], wt);
  await landWithoutIntegrate({ dir, git: (args) => git([...args], dir) }, branch);
  await recordContractPasses(world(), task, "uc");
}

/** A PRD and an approved plan in `root`, returning the plan's slug. */
function createPlan(root: string): string {
  const prd = parseSlug(mustRun(["create", "prd", "--title", "Unrecoverable PRD", "--content", "root", "--no-ai"], root));
  const plan = parseSlug(mustRun(["create", "plan", "--title", "Unrecoverable Plan", "--parent", prd, "--content", "x", "--no-ai"], root));
  mustRun(["set", plan, "--status", "approved"], root);
  return plan;
}

/** A runner pass of every oracle of a CODE task's stored contract, taken inside its worktree. */
function captureContractPasses(task: string, cwd: string): void {
  const view = JSON.parse(mustRun(["get", task, "--json"], dir)) as { data: { doc: { extra: { done_contract: { oracles: { id: string; command: string }[] } } } } };
  for (const oracle of view.data.doc.extra.done_contract.oracles) {
    mustRun(["evidence", task, "--oracle", "test", "--command", oracle.command, "--result", "pass", "--capture"], cwd);
  }
}

function withDb<T>(root: string, fn: (db: Database) => T): T {
  const db = new Database(join(root, ".lore", "lore.db"));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/**
 * Inserts the audit rows of a claim made before #356: it names a branch, carries NO `start_head`, and (unless `endTip`
 * is given) its release recorded no `end_tip`. Chained through the store's own helpers so the audit chain stays valid.
 */
function seedLegacyClaim(root: string, slug: string, branch: string, at: string, endTip?: string): void {
  withDb(root, (db) => {
    const doc = db.query("SELECT id FROM docs WHERE slug = ?").get(slug) as { id: string } | null;
    if (doc === null) throw new Error(`no doc ${slug}`);
    const append = (action: string, timestamp: string, details: Record<string, unknown>): void => {
      const head = db.query(SELECT_AUDIT_HEAD_SQL).get() as { entry_hash: string | null } | null;
      const entry = { timestamp, actor: "agent:legacy", session_id: "legacy", action, doc_id: doc.id, details };
      db.prepare(INSERT_AUDIT_SQL).run(...auditBindings(entry, head?.entry_hash ?? ""));
    };
    append("claim", at, { by: "agent:legacy", worktree: branch, branch });
    append("release", at, { by: "agent:legacy", ...(endTip !== undefined ? { end_tip: endTip } : {}) });
  });
}

/** What a store opened below the migration sees: schema 39, so the next `lore migrate schema` applies migration 040. */
function rewindToSchema39(root: string): void {
  withDb(root, (db) => db.exec("PRAGMA user_version = 39;"));
}

function unrecoverableRows(root: string, slug: string): Array<Record<string, unknown>> {
  return withDb(root, (db) =>
    (db.query("SELECT a.details AS details FROM audit a JOIN docs d ON d.id = a.doc_id WHERE a.action = 'claim-unrecoverable' AND d.slug = ? ORDER BY a.id").all(slug) as Array<{
      details: string;
    }>).map((row) => JSON.parse(row.details) as Record<string, unknown>),
  );
}

function schemaVersionOf(root: string): number {
  return withDb(root, (db) => (db.query("PRAGMA user_version").get() as { user_version: number }).user_version);
}

function migrate(root: string): RunResult {
  return runLore(["migrate", "schema"], root);
}

/** A commit with main's tree on top of main's head that no branch of main contains yet. */
function commitOffMain(): string {
  return git(["commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "unlanded legacy work"], dir);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-landing-unrecoverable-"));
  makeCleanTreeRepo(dir);
  mustRun(["init"], dir);
  appendFileSync(join(dir, ".git", "info", "exclude"), ".claude/\n");
  relaxPlanGates(dir);
  planSlug = createPlan(dir);
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("AC-UC-1 (a) a released tipless branch claim is classified once and landing judges the measurable claim", () => {
  it("AC-UC-1 (a) refuses unmeasurable before migration 040, then closes exit 0 listing the unrecoverable claim with its count", async () => {
    const task = createTask(dir, "Legacy then fresh", planSlug, "code");
    seedLegacyClaim(dir, task, "legacy-gone", LEGACY_AT);
    await claimAndLand(task, "uc-a", "claimed"); // fresh claim on a branch; its work lands after the migration
    const aWt = join(dir, ".claude", "wt", "uc-a");
    git(["config", "user.email", "fixture@example.invalid"], aWt);
    git(["config", "user.name", "fixture"], aWt);
    writeFileSync(join(aWt, "uc-a-early.txt"), "early\n");
    git(["add", "-A"], aWt);
    git(["commit", "-q", "-m", "early work"], aWt); // a commit not on main: the landing judgement is reached
    captureContractPasses(task, aWt); // a clean pass at the branch head

    const refused = runLore(["done", task], dir);
    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");
    // the unlanded branch of the fresh claim refuses first, and the tipless legacy claim is one of the claims the refusal names
    expect(refused.text).toContain("legacy-gone");
    expect(refused.text).toContain("tip-not-on-main");

    rewindToSchema39(dir);
    const migrated = migrate(dir);
    expect(migrated.exitCode, migrated.text).toBe(0);
    const marked = unrecoverableRows(dir, task);
    expect(marked).toHaveLength(1);
    expect(marked[0]?.["branch"]).toBe("legacy-gone");
    expect(marked[0]?.["reason"]).toBe("released before tips were recorded");
    expect(marked[0]?.["marked_by"]).toBe("migration-040");
    const shown = JSON.parse(mustRun(["get", task, "--json"], dir)) as { data: { unrecoverable_claims?: Array<{ branch: string; reason: string }> } };
    expect(shown.data.unrecoverable_claims).toEqual([expect.objectContaining({ branch: "legacy-gone", reason: "released before tips were recorded" })]);
    const shownText = mustRun(["get", task], dir);
    expect(shownText).toContain("Unrecoverable claims: 1");
    expect(shownText).toContain("legacy-gone");
    expect(shownText).toContain("released before tips were recorded");

    await landClaimed(task, "uc-a");
    const done = runLore(["done", task], dir);

    expect(done.exitCode, done.text).toBe(0);
    expect(done.stdout).toContain("unrecoverable claims: 1 (legacy-gone)");
    const view = JSON.parse(mustRun(["get", task, "--json"], dir)) as { data: { doc: { status: string; extra: { landing?: { kind?: string } } } } };
    expect(view.data.doc.status).toBe("archived");
    expect(view.data.doc.extra.landing?.kind).toBe("commits"); // the fresh claim's branch carried a commit and was landed
  }, 300_000);
});

describe("AC-UC-1 (b) a claim made under the current schema is never marked", () => {
  it("AC-UC-1 (b) a claim with start_head whose branch is gone with no tip stays unmeasurable after migration 040", () => {
    const task = createTask(dir, "Current schema claim", planSlug, "code");
    mkdirSync(join(dir, ".claude", "wt"), { recursive: true });
    const wt = join(dir, ".claude", "wt", "uc-b");
    git(["worktree", "add", "-q", "-b", "uc-b", wt, "main"], dir);
    mustRun(["claim", task, "--worktree", "uc-b"], dir);
    captureContractPasses(task, wt);
    git(["worktree", "remove", "--force", wt], dir);
    git(["branch", "-D", "uc-b"], dir);
    withDb(dir, (db) => {
      const row = db.query("SELECT extra FROM docs WHERE slug = ?").get(task) as { extra: string };
      const extra = JSON.parse(row.extra) as { claim: Record<string, unknown> };
      delete extra.claim["end_tip"]; // a claim that never recorded a tip
      db.query("UPDATE docs SET extra = ? WHERE slug = ?").run(JSON.stringify(extra), task);
    });

    rewindToSchema39(dir);
    expect(migrate(dir).exitCode).toBe(0);
    const refused = runLore(["done", task], dir);

    expect(unrecoverableRows(dir, task)).toHaveLength(0);
    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");
    expect(refused.text).toContain("unmeasurable");
  }, 300_000);
});

describe("AC-UC-1 (c) migration 040 is idempotent", () => {
  it("AC-UC-1 (c) two runs write exactly one audit entry per unrecoverable claim and the second changes nothing", () => {
    const task = createTask(dir, "Two legacy claims", planSlug);
    seedLegacyClaim(dir, task, "legacy-a", LEGACY_AT);
    seedLegacyClaim(dir, task, "legacy-b", "2026-01-02T00:00:00.000Z");
    seedLegacyClaim(dir, task, "legacy-with-tip", "2026-01-03T00:00:00.000Z", "a".repeat(40)); // has an end_tip: never selected

    rewindToSchema39(dir);
    expect(migrate(dir).exitCode).toBe(0);
    expect(unrecoverableRows(dir, task).map((row) => row["branch"])).toEqual(["legacy-a", "legacy-b"]);
    const auditAfterFirst = withDb(dir, (db) => (db.query("SELECT COUNT(*) AS n FROM audit").get() as { n: number }).n);

    rewindToSchema39(dir);
    expect(migrate(dir).exitCode).toBe(0);

    expect(unrecoverableRows(dir, task)).toHaveLength(2);
    expect(schemaVersionOf(dir)).toBeGreaterThanOrEqual(40);
    const auditAfterSecond = withDb(dir, (db) => (db.query("SELECT COUNT(*) AS n FROM audit").get() as { n: number }).n);
    // reason: `lore migrate schema` itself may append its own run row; the claim-unrecoverable rows are what must not grow.
    expect(auditAfterSecond - auditAfterFirst).toBeLessThanOrEqual(1);
  }, 300_000);
});

describe("AC-UC-1 (d) a task whose only claim is unrecoverable has no measurable claim", () => {
  it("AC-UC-1 (d) lore done exits 4 [floor: not-landed] no-measurable-claim", () => {
    const task = createTask(dir, "Only legacy claim", planSlug, "code");
    seedLegacyClaim(dir, task, "legacy-only", LEGACY_AT); // the task holds no other claim
    rewindToSchema39(dir);
    expect(migrate(dir).exitCode).toBe(0);

    const refused = runLore(["done", task], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");
    expect(refused.text).toContain("no-measurable-claim");
  }, 300_000);
});

describe("AC-UC-1 (e) migration 040 reads no git", () => {
  it("AC-UC-1 (e) applies on a corpus outside any git repository, marks the claim, and a following lore list exits 0", () => {
    const bare = mkdtempSync(join(tmpdir(), "lore-unrecoverable-nogit-"));
    try {
      mustRun(["init"], bare);
      relaxPlanGates(bare);
      const task = createTask(bare, "No repository", createPlan(bare), "corpus", false);
      seedLegacyClaim(bare, task, "legacy-gone", LEGACY_AT);
      rewindToSchema39(bare);

      const migrated = migrate(bare);

      expect(migrated.exitCode, migrated.text).toBe(0);
      expect(unrecoverableRows(bare, task)).toHaveLength(1);
      expect(runLore(["list"], bare).exitCode).toBe(0);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  }, 300_000);
});

describe("AC-UC-1 (f) an unrecoverable claim whose branch ref still holds unlanded work refuses", () => {
  it("AC-UC-1 (f) exits 4 unrecoverable-claim-branch-unlanded naming the branch, then 0 once the tip is merged into main", async () => {
    const task = createTask(dir, "Legacy branch still alive", planSlug, "code");
    seedLegacyClaim(dir, task, "legacy-live", LEGACY_AT);
    git(["branch", "legacy-live", commitOffMain()], dir);
    await claimAndLand(task, "uc-f"); // the fresh claim's branch is landed with every contract oracle passed
    rewindToSchema39(dir);
    expect(migrate(dir).exitCode).toBe(0);

    const refused = runLore(["done", task], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");
    expect(refused.text).toContain("unrecoverable-claim-branch-unlanded");
    expect(refused.text).toContain("legacy-live");

    // main reaches the legacy tip by a merge commit (main already moved when the fresh claim landed); the tree is unchanged, so every
    // recorded pass still names the landed tree
    git(["merge", "-q", "--no-edit", "legacy-live"], dir);
    // reason: the shared checkout is a detached view of main; the shipped guard is not installed in this fixture, so the ref moves directly
    git(["update-ref", "refs/heads/main", git(["rev-parse", "HEAD"], dir)], dir);
    const landed = runLore(["done", task], dir);

    expect(landed.exitCode, landed.text).toBe(0);
    expect(landed.stdout).toContain("unrecoverable claims: 1 (legacy-live)");
  }, 300_000);
});
