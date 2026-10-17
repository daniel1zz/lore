// @spawns packages/lore/src/index.ts
/**
 * Real-CLI-subprocess integration test for the SPEC-056 phase-execution-model CLI
 * surfaces (task-skill-implement-cli-mcp-surfaces-checklist-ref-evidence).
 *
 * UPDATE (merge-integration fix, T11×T12 app.ts contention resolution — not a new
 * lore-tracked task): `migration-006.ts` has SINCE LANDED and widens the `docs.type`
 * CHECK constraint to accept `'phase'` (`CHECK(type IN (...,'phase'))`, wired into
 * both `sqlite-store.ts::runMigrations` and `turso-store.ts::initSchema`) — the
 * SQLite-layer blocker described below is RESOLVED. `PhaseMigrationService`
 * (`service/phase-migration-service.ts`, D6a's raw `store.insert` bypass) can now
 * write a real `type: "phase"` row against a live `SQLiteStore`.
 *
 * The real-SQLite phase-write path in THIS file is still not trivially enable-able,
 * however: `commands/create.ts`'s `VALID_TYPES` deliberately excludes `"phase"` from
 * `lore create` (by design — D6a: phase docs are migration-created only, there is no
 * `phase-create` checkpoint to gate a direct-create path against), and no CLI
 * subcommand yet drives `PhaseMigrationService.migrateTasks` (the `migrate phases`
 * action in `commands/migrate.ts` is the UNRELATED SPEC-023 legacy singular-phase
 * sweep, `PhaseService.migratePhases`). Producing a live phase row for this
 * subprocess-CLI suite therefore needs new CLI wiring, which is outside this
 * merge-fix's scope — that wiring (and this file's real-corpus enablement) belongs to
 * the next phase-migration CLI task (T13).
 *
 * ORIGINAL FINDING (discovered while authoring this file — kept for context): the
 * `docs` table's SQLite CHECK constraint (`migration-001.ts`:
 * `CHECK(type IN ('prd','spec','adr','plan','knowledge','task'))`) had NOT been
 * widened to accept `'phase'` — a raw `store.insert()` of a `type: "phase"` doc
 * against a REAL `SQLiteStore` failed loud with a `SQLITE_CONSTRAINT_CHECK` error
 * (verified empirically: `CHECK constraint failed: type IN (...)`). Widening a CHECK
 * constraint has no SQLite `ALTER` syntax (migration-004.ts's own header documents
 * the table-recreate dance this requires), and `docs` is FTS5-content-linked via
 * `docs_fts(content=docs, content_rowid=rowid)` — a naive recreate would desync the
 * FTS rowid mapping, needing an explicit `INSERT INTO docs_fts(docs_fts)
 * VALUES('rebuild')` afterward. `migration-006.ts` is exactly this migration.
 *
 * Consequence for THIS file's scope: every test below exercises what genuinely IS
 * provable against a REAL (SQLite-backed, `lore init`-bootstrapped) corpus today —
 * resolution/error paths that don't require a live phase ROW to exist (DOC_NOT_FOUND,
 * wrong-type rejection using an EXISTING plan doc as the "wrong type" target) — PLUS
 * proof that `lore gate phase-claim` is now a REAL registered subcommand returning a
 * genuine verdict (not citty's "unknown command" usage error, which is what it
 * produced before this task). The FULL claim → checklist → evidence → status "done"
 * loop (this task's own Integration AC) is exhaustively proven instead against
 * `InMemoryStore` (which has no SQL CHECK-constraint layer at all) in
 * `mcp-tools-phase.test.ts` (service-level, via the MCP adapter) and
 * `phase-status-flow.test.ts` (pure scorecard assembly) — both call the EXACT SAME
 * `PhaseWorkflowService`/`PhaseChecklistService`/`buildPhaseStatusPayload` the CLI
 * adapter (`commands/phase.ts`, thin pipes only, per this module's own architecture
 * convention) calls, so business-logic coverage is NOT weakened by this file's
 * narrower real-corpus scope — only the "does SQLite accept a live phase row" concern
 * is left for T10 to close.
 *
 * Coverage:
 *   HAPPY:      `lore gate phase-claim` against an existing (wrong-type) doc returns
 *               a real VALIDATION_ERROR verdict — proves real dispatch, not
 *               "unknown command"
 *   NEGATIVE:   n/a (see BOUNDARY/ERROR below — this file is resolution-path-only)
 *   BOUNDARY:   `lore evidence`/`lore claim` against a wrong-type (plan) target stay
 *               byte-identical to pre-SPEC-056 "Expected a task document" (REGRESSION)
 *               — the retry-dispatch only fires on a genuine `value: "phase"`
 *               rejection, never a generic wrong-type one
 *   ERROR:      `lore phase status` / `lore feed phase-start` / `lore gate
 *               phase-claim` against a non-existent id all exit 3 (DOC_NOT_FOUND)
 *   STATE:      n/a (see mcp-tools-phase.test.ts for the claim/checklist/evidence
 *               state-machine round trip)
 *   REGRESSION: `lore feed phase-start` with no `<phase>` positional → exit 2
 *               (argument error, not a crash)
 *
 * @spec_ref spec-spec-056-phase-execution-model-phase-doc-type-computed-comp
 *   task-skill-implement-cli-mcp-surfaces-checklist-ref-evidence
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { FEED_PHASE_START_MISSING_TARGET } from "../../../src/adapters/cli/cli-refusal-messages.js";

// ─── Path setup ───────────────────────────────────────────────────────────────

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` — mirrors task-workflow.test.ts's identical helper. */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `lore-phase-wf-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });

  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
});

function createPlan(title: string): string {
  const r = runLore(["create", "plan", "--title", title, "--no-ai", "--content", "body"], tmpDir);
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract plan slug from: ${r.stdout}`);
  return slug;
}

function createTask(planSlug: string, title: string): string {
  const r = runLore(
    ["create", "task", "--title", title, "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "body"],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`create task failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract task slug from: ${r.stdout}`);
  return slug;
}

// ─── `lore migrate tasks-to-phases` — real corpus sweep (T13 CLI wiring) ───

describe("SPEC-056 CLI `lore migrate tasks-to-phases` — real corpus sweep", () => {
  it("HAPPY: --dry-run reports the sweep without writing; a real run then creates the phase doc; a second run is a no-op (idempotent)", () => {
    const planSlug = createPlan("Migrate Sweep Plan");
    const taskSlug = createTask(planSlug, "Solo Task For Migration");

    // --dry-run: reports the would-be sweep, writes nothing.
    const dryRun = runLore(["migrate", "tasks-to-phases", "--dry-run", "--json"], tmpDir);
    expect(dryRun.exitCode).toBe(0);
    const dryReport = JSON.parse(dryRun.stdout).data;
    expect(dryReport.dry_run).toBe(true);
    expect(dryReport.phases_created).toBe(1);
    expect(dryReport.tasks_archived).toBe(1);

    // Dry-run must not have written anything — no phase doc exists yet.
    const listBeforeReal = runLore(["list", "--type", "phase", "--json"], tmpDir);
    expect(listBeforeReal.exitCode).toBe(0);
    expect(JSON.parse(listBeforeReal.stdout).data.total).toBe(0);

    // Real run: performs the sweep.
    const realRun = runLore(["migrate", "tasks-to-phases", "--json"], tmpDir);
    expect(realRun.exitCode).toBe(0);
    const realReport = JSON.parse(realRun.stdout).data;
    expect(realReport.dry_run).toBe(false);
    expect(realReport.phases_created).toBe(1);
    expect(realReport.tasks_archived).toBe(1);

    // A real `type: "phase"` row now exists in the live SQLite corpus.
    const listAfterReal = runLore(["list", "--type", "phase", "--json"], tmpDir);
    expect(listAfterReal.exitCode).toBe(0);
    const afterData = JSON.parse(listAfterReal.stdout).data;
    expect(afterData.total).toBe(1);
    expect(afterData.docs[0].title).toBe("Solo Task For Migration");

    // The source task is archived and no longer resolvable as a fresh task.
    const taskGet = runLore(["get", taskSlug, "--json"], tmpDir);
    expect(taskGet.exitCode).toBe(0);
    expect(JSON.parse(taskGet.stdout).data.doc.status).toBe("archived");

    // STATE: a second run performs zero new writes (idempotency marker #1).
    const secondRun = runLore(["migrate", "tasks-to-phases", "--json"], tmpDir);
    expect(secondRun.exitCode).toBe(0);
    const secondReport = JSON.parse(secondRun.stdout).data;
    expect(secondReport.phases_created).toBe(0);
    expect(secondReport.tasks_archived).toBe(0);
    expect(secondReport.evidence_merged).toBe(0);
  });

  it("REGRESSION: `lore migrate bogus-action` still exits 2 (unknown-action guard unaffected by the new branch)", () => {
    const result = runLore(["migrate", "bogus-action"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown migration action");
  });
});

// ─── ERROR: resolution failures (no live phase row required) ──────────────

describe("SPEC-056 CLI phase surfaces — ERROR (non-existent target)", () => {
  it("lore phase status <nonexistent> → exit 3 (DOC_NOT_FOUND)", () => {
    const result = runLore(["phase", "status", "phase-does-not-exist"], tmpDir);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("not found");
  });

  it("lore gate phase-claim --phase <nonexistent> → exit 3 (DOC_NOT_FOUND)", () => {
    const result = runLore(["gate", "phase-claim", "--phase", "phase-does-not-exist"], tmpDir);
    expect(result.exitCode).toBe(3);
  });

  it("lore feed phase-start <nonexistent> → exit 3 (DOC_NOT_FOUND)", () => {
    const result = runLore(["feed", "phase-start", "phase-does-not-exist"], tmpDir);
    expect(result.exitCode).toBe(3);
  });
});

// ─── REGRESSION: missing positional argument ───────────────────────────────

describe("SPEC-056 CLI phase surfaces — REGRESSION (argument errors)", () => {
  it("lore feed phase-start with no <phase> positional → exit 2, not a crash", () => {
    const result = runLore(["feed", "phase-start"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(FEED_PHASE_START_MISSING_TARGET);
  });
});

// ─── HAPPY + BOUNDARY: real dispatch against an existing wrong-type doc ────

describe("SPEC-056 CLI phase surfaces — dispatch against an existing wrong-type doc", () => {
  it("HAPPY: lore gate phase-claim against a PLAN doc returns a real verdict, not 'unknown command'", () => {
    const planSlug = createPlan("Gate Verdict Plan");

    const result = runLore(["gate", "phase-claim", "--phase", planSlug], tmpDir);
    // reason: a citty "unknown command"/usage error would exit differently and never
    // mention the doc-type validation message below — this proves the phase-claim
    // subcommand is genuinely registered and dispatched, not silently absorbed.
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("Expected a phase document");
    expect(result.stderr).toContain("'plan'");
  });

  it("BOUNDARY/REGRESSION: lore evidence against a PLAN doc stays 'Expected a task document' (never retries into phase dispatch)", () => {
    const planSlug = createPlan("Evidence Regression Plan");

    // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
    // predicate-to-its-own) — with "test" the D5 raise would refuse this call
    // BEFORE the target-type dispatch this test means to exercise ever runs
    // (VALIDATION_ERROR on output_tail, not on type). "manual" satisfies the
    // raised guard so the call proceeds to resolveTask, which is what
    // actually produces "Expected a task document" here.
    const result = runLore(
      ["evidence", planSlug, "--oracle", "manual", "--command", "x", "--result", "pass", "--output-tail", "ok"],
      tmpDir,
    );
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("Expected a task document");
    expect(result.stderr).not.toContain("Expected a phase document");
  });

  it("BOUNDARY/REGRESSION: lore claim against a PLAN doc stays 'Expected a task document' (never retries into phase dispatch)", () => {
    const planSlug = createPlan("Claim Regression Plan");

    const result = runLore(["claim", planSlug], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("Expected a task document");
  });

  it("BOUNDARY/REGRESSION: lore release against a PLAN doc stays 'Expected a task document' (never retries into phase dispatch)", () => {
    const planSlug = createPlan("Release Regression Plan");

    const result = runLore(["release", planSlug], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("Expected a task document");
  });
});
