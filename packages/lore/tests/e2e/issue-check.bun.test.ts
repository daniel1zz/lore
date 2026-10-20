// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
// @reads scripts/check-unclaimed-oracle.ts
// @reads assets/project/lore-config-template.yaml
// @reads assets/governance/write-spec-rule.md
/**
 * `lore status --check-issues` (D5, spec-issue-closure-loop-computed-
 * resolution-agent-reachable) — the deterministic, report-only detector that
 * flags a stale open report (computed resolution `open`, older than
 * `feedback.stale_after_days`, D5b). Its former shape (a) "unclosed escalation"
 * was RETIRED by spec-archiving-the-work-that-resolves-a-defect-report-closes
 * D6 — a computed-`fixed` report is never flagged. Spawns the COMPILED `dist/lore` binary
 * (Bun.spawnSync) against THROWAWAY corpora (mkdtemp + `lore init`) — NEVER
 * the repo's own `.lore/` corpus (project CLAUDE.md hard rule).
 *
 * `assertFreshBinary` fails loud before any test runs if `dist/lore` is
 * missing or older than the newest `.ts` source under `packages/{lore,core}/
 * src` (root CLAUDE.md's "stale compiled binary" false-oracle vector) —
 * requires `bun run build` to have run first.
 *
 * ── Known upstream gap this suite works around (NOT this task's anchors) ──
 * P1 (issue-resolution.ts, task-p1-resolves-link-type-computed-resolution)
 * added `"resolves"` to `@lore/core`'s `linkTypeSchema` and to
 * `CorpusService.link`'s D1b write-time validation, but the SQLite
 * `links.link_type` CHECK constraint was NEVER widened to accept it (unlike
 * migration-004, which correctly widened it for `"governs"`) — verified
 * empirically: `INSERT INTO links (..., link_type, ...) VALUES (..., "resolves",
 * ...)` against a freshly-`lore init`-ed corpus throws `SQLiteError: CHECK
 * constraint failed`. P1's own test suite (`tests/unit/service/
 * issue-resolution.test.ts`) only exercises `InMemoryStore` (no CHECK
 * constraint), so this gap was invisible to it. A `resolves` link is
 * therefore currently NON-FUNCTIONAL against any real SQLite/Turso-backed
 * corpus. `packages/lore/src/store/migrations/` is OUTSIDE this task's file
 * anchors (a shared, high-blast-radius directory another session may be
 * concurrently touching) — this suite works around it by widening ONLY its
 * OWN throwaway corpora's on-disk `links` table (mirrors migration-004's
 * exact table-recreate SQL verbatim, `widenLinksTableForResolves` below) and
 * inserting the `resolves` row via raw `bun:sqlite` SQL (also sidesteps a
 * SECOND, independent gap: `commands/link.ts`'s own local `VALID_LINK_TYPES`
 * array — a stale CLI-side duplicate of `linkTypeSchema` — has never been
 * taught about `"resolves"` either, so `lore link --type resolves` would
 * exit 2 before ever reaching `CorpusService.link`). Neither gap is touched
 * by (or blocks) `computeIssueCheck`/`resolveStaleAfterDays`, the actual code
 * under test here — this workaround exists purely to construct a REAL,
 * SQLite-persisted `resolves` edge as a test fixture. Both gaps should be
 * tracked as follow-up P1-repair work; reported in this task's completion
 * summary.
 *
 * Six-dimension coverage:
 *   HAPPY:      a fresh issue task with no `resolves` edge and no explicit
 *               terminal state → `--check-issues` reports `consistent`, exit 0
 *   NEGATIVE:   a task whose `extra.issue_report` is malformed (a string, not
 *               an object) is excluded from `checked` entirely — never
 *               crashes; a well-shaped `issue_report` missing `reported_at`
 *               computes `open` but is never flagged stale (degrades safely)
 *   BOUNDARY:   age exactly AT `feedback.stale_after_days` → flagged; age one
 *               day under → NOT flagged (INCLUSIVE boundary, mirrors
 *               `staleness.ts`'s documented `age_days === min_age_days`
 *               precedent)
 *   RETIRED:    a `resolves` edge whose source doc is `archived` while the
 *               issue task itself is still `draft` is NO LONGER flagged
 *               (exit 0, D6); archiving the issue task leaves it unflagged;
 *               byte-comparison of every issue doc's raw `docs` row before
 *               and after a `--check-issues` run proves it mutates nothing
 *   REGRESSION: plain `lore status --json` (no `--check-issues`) never
 *               computes or emits an `issues` key at all — opt-in only
 *
 * @spec_ref spec-issue-closure-loop-computed-resolution-agent-reachable §D5,
 *   §D5b; task-p2-lore-status-check-issues-detector-stale-after-days;
 *   AC-ICL-6.
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { citeSpecViaAsyncCli, asyncLoreRunnerFor } from "../helpers/cli-live-rule.js";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { loosenOverrideClasses } from "../integration/fixtures/autonomy-override-helpers.js";

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up),
// mirrors tests/e2e/bootstrap-injection-compiled.bun.test.ts's own REPO_ROOT derivation.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns the COMPILED `dist/lore` binary — `cwd`/`HOME` both pointed at the throwaway corpus dir, `CLAUDECODE=1` resolves the "agent" caller surface (SPEC-024) so AI defaults off. */
async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1", EDITOR: "true" },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

interface JsonEnvelope<T> {
  ok: boolean;
  data: T;
}

interface CreatedDoc {
  id: string;
  slug: string;
}

function parseJson<T>(stdout: string): T {
  return (JSON.parse(stdout) as JsonEnvelope<T>).data;
}

async function initCorpus(tmpDir: string): Promise<void> {
  const result = await runLore(["init"], tmpDir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
  // AU-T7: `approve --override-no-judgment` is decided; this suite's subject is not the override, so the class is
  // loosened the documented way (a human-tty governance decision on a throwaway corpus), never by a bypass in product code.
  await loosenOverrideClasses(tmpDir, ["override-judgment"]);
}

/**
 * Disables the four gate checkpoints that would otherwise reject this
 * suite's placeholder fixture content — mirrors `cli-drift.bun.test.ts`'s
 * `disableAllGates` helper exactly (a freshly-`lore init`-ed corpus's
 * `config.yaml` already carries a REQUIRED top-level `project:` key, so this
 * APPENDS rather than overwrites it).
 */
function disableAllGates(dir: string): void {
  patchLoreConfig(
    dir,
    [
      "workflow:",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "    plan-promote:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      "",
    ].join("\n"),
  );
}

/** Appends `feedback.stale_after_days` (D5b) — a DIFFERENT top-level YAML key than `disableAllGates`'s `workflow:`, so both may be appended to the same file without collision. */
function configureStaleAfterDays(dir: string, days: number): void {
  patchLoreConfig(dir, ["feedback:", `  stale_after_days: ${days}`, ""].join("\n"));
}

async function createPrd(tmpDir: string): Promise<CreatedDoc> {
  const result = await runLore(
    ["create", "prd", "--title", "Issue Check Fixture Root PRD", "--no-ai", "--content", "## Overview\n\nBody.", "--json"],
    tmpDir,
  );
  if (result.exitCode !== 0) throw new Error(`create prd failed: ${result.stderr}`);
  return parseJson<CreatedDoc>(result.stdout);
}

async function createPlan(tmpDir: string, prdSlug: string, title: string): Promise<CreatedDoc> {
  const result = await runLore(
    ["create", "plan", "--title", title, "--parent", prdSlug, "--no-ai", "--content", "Plan body.", "--json"],
    tmpDir,
  );
  if (result.exitCode !== 0) throw new Error(`create plan "${title}" failed: ${result.stderr}`);
  return parseJson<CreatedDoc>(result.stdout);
}

async function createTask(tmpDir: string, planSlug: string, title: string): Promise<CreatedDoc> {
  const result = await runLore(
    ["create", "task", "--title", title, "--plan-id", planSlug, "--no-ai", "--content", "Task body.", "--json"],
    tmpDir,
  );
  if (result.exitCode !== 0) throw new Error(`create task "${title}" failed: ${result.stderr}`);
  return parseJson<CreatedDoc>(result.stdout);
}

async function createSpec(tmpDir: string, prdSlug: string, title: string): Promise<CreatedDoc> {
  const result = await runLore(
    [
      "create",
      "spec",
      "--title",
      title,
      "--kind",
      "feature",
      "--no-ai",
      "--content",
      "## Overview\n\nBody.",
      "--json",
    ],
    tmpDir,
  );
  if (result.exitCode !== 0) throw new Error(`create spec "${title}" failed: ${result.stderr}`);
  return parseJson<CreatedDoc>(result.stdout);
}

async function setStatus(tmpDir: string, slug: string, status: string): Promise<void> {
  const result = await runLore(["set", slug, "--status", status], tmpDir);
  if (result.exitCode !== 0) throw new Error(`set --status ${status} on ${slug} failed: ${result.stderr}`);
}

/** Walks a doc from `draft` all the way to `archived` via the fast-track edge (draft -> approved -> active -> archived) — valid for spec/plan/adr per VALID_TRANSITIONS. */
async function archiveViaFastTrack(tmpDir: string, slug: string): Promise<void> {
  // BR-1007: a spec is approved only when a criterion cites a live rule; the fixing spec gets one.
  const lore = asyncLoreRunnerFor(runLore, tmpDir);
  await lore(["ac", "add", slug, "AC-FT-1", "--statement", "the fixing spec behaviour responds in < 200ms", "--mode", "human"]);
  await citeSpecViaAsyncCli(lore, tmpDir, undefined, slug, "AC-FT-1");
  // #65: `set --status approved` now runs the approve checks (BR-1071); this fixture has no judgment, so it takes the audited escape.
  const approved = await runLore(["approve", slug, "--override-no-judgment"], tmpDir);
  if (approved.exitCode !== 0) throw new Error(`approve ${slug} failed: ${approved.stderr}`);
  await setStatus(tmpDir, slug, "active");
  await setStatus(tmpDir, slug, "archived");
}

function dbPath(tmpDir: string): string {
  return join(tmpDir, ".lore", "lore.db");
}

/**
 * TEST-ONLY workaround for the P1 gap documented in this file's header —
 * widens JUST this throwaway corpus's on-disk `links.link_type` CHECK
 * constraint to also accept `"resolves"`, via the identical table-recreate
 * pattern `migration-004.ts` uses for `"governs"` (SQLite has no `ALTER
 * TABLE ... DROP/ADD CONSTRAINT`). Deliberately does NOT touch `PRAGMA
 * user_version` — this is not a real migration, just an in-place schema
 * widening of one disposable corpus, so the real migration runner's version
 * bookkeeping is left completely alone.
 */
function widenLinksTableForResolves(tmpDir: string): void {
  const db = new Database(dbPath(tmpDir));
  try {
    db.exec(`
      BEGIN IMMEDIATE;
      DROP TABLE IF EXISTS links_new;
      CREATE TABLE links_new (
        from_id     TEXT NOT NULL REFERENCES docs(id),
        to_id       TEXT NOT NULL REFERENCES docs(id),
        link_type   TEXT NOT NULL CHECK(link_type IN ('parent','implements','informs','supersedes','relates-to','blocks','governs','resolves')),
        created_at  TEXT NOT NULL,
        created_by  TEXT NOT NULL,
        PRIMARY KEY (from_id, to_id, link_type)
      );
      INSERT INTO links_new (from_id, to_id, link_type, created_at, created_by)
        SELECT from_id, to_id, link_type, created_at, created_by FROM links;
      DROP TABLE links;
      ALTER TABLE links_new RENAME TO links;
      CREATE INDEX idx_links_from ON links(from_id);
      CREATE INDEX idx_links_to   ON links(to_id);
      CREATE INDEX idx_links_type ON links(link_type);
      COMMIT;
    `);
  } finally {
    db.close();
  }
}

/** Raw `resolves` edge insert (bypasses `lore link`'s stale CLI whitelist — see file header). */
function insertResolvesLink(tmpDir: string, fromId: string, toId: string, createdAt: string): void {
  const db = new Database(dbPath(tmpDir));
  try {
    db.query(
      "INSERT INTO links (from_id, to_id, link_type, created_at, created_by) VALUES (?, ?, 'resolves', ?, ?)",
    ).run(fromId, toId, createdAt, "issue-check-fixture");
  } finally {
    db.close();
  }
}

/**
 * Merges `patch` into a task's stored `extra` JSON column directly (no CLI
 * verb writes arbitrary `extra.issue_report` — SPEC-072's `report-issue`
 * flow is the only production writer, and it requires a configured upstream
 * corpus; this is a synthetic fixture, not that flow).
 */
function mergeExtra(tmpDir: string, id: string, patch: Record<string, unknown>): void {
  const db = new Database(dbPath(tmpDir));
  try {
    const row = db.query("SELECT extra FROM docs WHERE id = ?").get(id) as { extra: string } | undefined;
    if (row === undefined) throw new Error(`mergeExtra: doc ${id} not found`);
    const existing = JSON.parse(row.extra) as Record<string, unknown>;
    const merged = { ...existing, ...patch };
    db.query("UPDATE docs SET extra = ? WHERE id = ?").run(JSON.stringify(merged), id);
  } finally {
    db.close();
  }
}

/** Full raw `docs` row for one doc id — the "byte comparison" oracle's unit (AC-ICL-6's "mutates nothing" proof). */
function snapshotDocRow(tmpDir: string, id: string): unknown {
  const db = new Database(dbPath(tmpDir));
  try {
    return db.query("SELECT * FROM docs WHERE id = ?").get(id);
  } finally {
    db.close();
  }
}

interface StaleOpenJson {
  id: string;
  slug: string;
  title: string;
  reported_at: string;
  age_days: number;
}

interface IssueCheckJson {
  checked: number;
  consistent: boolean;
  stale_open: StaleOpenJson[];
}

async function checkIssues(tmpDir: string): Promise<{ result: RunResult; data: IssueCheckJson | undefined }> {
  const result = await runLore(["status", "--check-issues", "--json"], tmpDir);
  if (result.exitCode !== 0 && result.exitCode !== 3) {
    // Any exit other than 0 (consistent) or 3 (flagged) is a genuine failure — surface it loud.
    throw new Error(`status --check-issues failed unexpectedly: ${result.stderr}`);
  }
  const envelope = JSON.parse(result.stdout) as JsonEnvelope<Record<string, unknown>>;
  return { result, data: envelope.data["issues"] as IssueCheckJson | undefined };
}

function daysAgoIso(days: number, extraMs = 0): string {
  return new Date(Date.now() - days * 86_400_000 - extraMs).toISOString();
}

const tmpDirsToClean: string[] = [];

async function makeCorpus(prefix: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), `lore-issue-check-${prefix}-`));
  tmpDirsToClean.push(dir);
  await initCorpus(dir);
  disableAllGates(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirsToClean) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

// ─── Corpus A: escalation lifecycle (HAPPY / ERROR / STATE) + mutates-nothing ──

describe("AC-ICL-6 (amended by D6 of spec-archiving-the-work-that-resolves-a-defect-report-closes): a computed-fixed report is never flagged", async () => {
  const tmpDir = await makeCorpus("escalation");
  const prd = await createPrd(tmpDir);
  const plan = await createPlan(tmpDir, prd.slug, "Escalation Fixture Plan");
  const issueTask = await createTask(tmpDir, plan.slug, "Filed report: escalation fixture");
  const fixingSpec = await createSpec(tmpDir, prd.slug, "ZzzEscalationFixingSpec");

  mergeExtra(tmpDir, issueTask.id, {
    issue_report: {
      reporter_project: "consumer-a",
      reporter_actor: "agent:consumer",
      lore_version: "0.0.0-test",
      expected: "exit 0",
      actual: "exit 1",
      reported_at: new Date().toISOString(),
      possible_duplicates: [],
    },
  });

  it("AC-ICL-6: HAPPY — no resolves edge, no explicit terminal state → consistent, exit 0", async () => {
    const { result, data } = await checkIssues(tmpDir);
    expect(result.exitCode).toBe(0);
    expect(data).toBeDefined();
    expect(data!.consistent).toBe(true);
    expect(data!.checked).toBe(1);
    expect(data!.stale_open).toEqual([]);
  });

  it("AC-ICL-6: HAPPY — fixing spec reaching archived with NO resolves edge yet still reports consistent", async () => {
    widenLinksTableForResolves(tmpDir);
    await archiveViaFastTrack(tmpDir, fixingSpec.slug);

    const { result, data } = await checkIssues(tmpDir);
    expect(result.exitCode).toBe(0);
    expect(data!.consistent).toBe(true);
  });

  it("AC-ICL-6 (D6): a resolves edge from the now-archived spec computes fixed while the issue task is still draft → NOT flagged, exit 0", async () => {
    insertResolvesLink(tmpDir, fixingSpec.id, issueTask.id, new Date().toISOString());

    const { result, data } = await checkIssues(tmpDir);
    expect(result.exitCode).toBe(0);
    expect(data!.consistent).toBe(true);
    expect(data!.stale_open).toEqual([]);
  });

  it("AC-ICL-6: mutates nothing — every issue doc's raw docs row is byte-identical before and after a --check-issues run", async () => {
    const before = snapshotDocRow(tmpDir, issueTask.id);
    const result = await runLore(["status", "--check-issues"], tmpDir);
    expect(result.exitCode).toBe(0);
    const after = snapshotDocRow(tmpDir, issueTask.id);
    expect(after).toEqual(before);
  });

  it("AC-ICL-6: STATE — archiving the issue task itself leaves the verdict unchanged (still consistent)", async () => {
    await setStatus(tmpDir, issueTask.slug, "archived"); // task type: draft -> archived is a valid direct edge

    const { result, data } = await checkIssues(tmpDir);
    expect(result.exitCode).toBe(0);
    expect(data!.consistent).toBe(true);
  });
});

// ─── Corpus B: stale-open-report boundary (BOUNDARY) ─────────────────────────

describe("AC-ICL-6: stale open report boundary (feedback.stale_after_days)", async () => {
  const STALE_AFTER_DAYS = 3;
  const tmpDir = await makeCorpus("staleness");
  configureStaleAfterDays(tmpDir, STALE_AFTER_DAYS);

  const prd = await createPrd(tmpDir);
  const plan = await createPlan(tmpDir, prd.slug, "Staleness Fixture Plan");
  const atBoundary = await createTask(tmpDir, plan.slug, "Filed report: exactly at boundary");
  const underBoundary = await createTask(tmpDir, plan.slug, "Filed report: one day under boundary");

  // Exactly STALE_AFTER_DAYS days old.
  const atBoundaryReportedAt = daysAgoIso(STALE_AFTER_DAYS);
  // STALE_AFTER_DAYS days minus 60s — comfortably floors to (STALE_AFTER_DAYS - 1) days
  // old regardless of the few hundred ms of real spawn/test overhead between fixture
  // setup and the actual `Date.now()` read inside the spawned binary.
  const underBoundaryReportedAt = daysAgoIso(STALE_AFTER_DAYS, -60_000);

  mergeExtra(tmpDir, atBoundary.id, {
    issue_report: {
      reporter_project: "consumer-a",
      reporter_actor: "agent:consumer",
      lore_version: "0.0.0-test",
      expected: "exit 0",
      actual: "exit 1",
      reported_at: atBoundaryReportedAt,
      possible_duplicates: [],
    },
  });
  mergeExtra(tmpDir, underBoundary.id, {
    issue_report: {
      reporter_project: "consumer-a",
      reporter_actor: "agent:consumer",
      lore_version: "0.0.0-test",
      expected: "exit 0",
      actual: "exit 1",
      reported_at: underBoundaryReportedAt,
      possible_duplicates: [],
    },
  });

  it("AC-ICL-6: BOUNDARY — age exactly AT stale_after_days is flagged stale (INCLUSIVE boundary)", async () => {
    const { result, data } = await checkIssues(tmpDir);
    expect(result.exitCode).toBe(3);
    expect(data!.checked).toBe(2);
    const staleSlugs = data!.stale_open.map((row) => row.slug).sort();
    expect(staleSlugs).toEqual([atBoundary.slug]);
    const flagged = data!.stale_open.find((row) => row.slug === atBoundary.slug)!;
    expect(flagged.age_days).toBe(STALE_AFTER_DAYS);
    expect(flagged.reported_at).toBe(atBoundaryReportedAt);
  });

  it("AC-ICL-6: BOUNDARY — age one day under stale_after_days is NOT flagged", async () => {
    const { data } = await checkIssues(tmpDir);
    expect(data!.stale_open.some((row) => row.slug === underBoundary.slug)).toBe(false);
  });
});

// ─── Corpus C: malformed extra + default stale_after_days (NEGATIVE) ─────────

describe("AC-ICL-6: malformed extra.issue_report + default feedback.stale_after_days (no override)", async () => {
  const tmpDir = await makeCorpus("malformed");
  // Deliberately NO configureStaleAfterDays call — proves the schema default (14) engages.

  const prd = await createPrd(tmpDir);
  const plan = await createPlan(tmpDir, prd.slug, "Malformed Fixture Plan");
  const malformed = await createTask(tmpDir, plan.slug, "Not actually an issue report");
  const missingReportedAt = await createTask(tmpDir, plan.slug, "Issue report missing reported_at");
  const recentUnderDefault = await createTask(tmpDir, plan.slug, "Recent report under the 14-day default");

  // NEGATIVE: extra.issue_report is a STRING, not an object — hasIssueReport must
  // reject this shape entirely (the doc is not even counted as an issue task).
  mergeExtra(tmpDir, malformed.id, { issue_report: "not-an-object" });

  // NEGATIVE: a well-shaped (object) issue_report missing reported_at — computed
  // resolution is still "open", but readReportedAt degrades to undefined rather
  // than crashing, so this doc is never flagged stale.
  mergeExtra(tmpDir, missingReportedAt.id, {
    issue_report: {
      reporter_project: "consumer-a",
      reporter_actor: "agent:consumer",
      lore_version: "0.0.0-test",
      expected: "exit 0",
      actual: "exit 1",
      possible_duplicates: [],
      // reported_at deliberately omitted
    },
  });

  // 1 day old, well under the 14-day schema default — proves the default actually
  // engages (an absent `feedback` config section does not silently disable staleness
  // detection, nor does it silently flag everything as stale).
  mergeExtra(tmpDir, recentUnderDefault.id, {
    issue_report: {
      reporter_project: "consumer-a",
      reporter_actor: "agent:consumer",
      lore_version: "0.0.0-test",
      expected: "exit 0",
      actual: "exit 1",
      reported_at: daysAgoIso(1),
      possible_duplicates: [],
    },
  });

  it("AC-ICL-6: NEGATIVE — malformed extra.issue_report (string) is excluded from checked entirely, no crash", async () => {
    const { result, data } = await checkIssues(tmpDir);
    expect(result.exitCode).toBe(0);
    expect(data).toBeDefined();
    // Only the 2 well-shaped issue tasks count — the malformed one is invisible.
    expect(data!.checked).toBe(2);
  });

  it("AC-ICL-6: NEGATIVE — issue_report missing reported_at is never flagged stale (defensive degrade)", async () => {
    const { data } = await checkIssues(tmpDir);
    expect(data!.stale_open.some((row) => row.slug === missingReportedAt.slug)).toBe(false);
  });

  it("AC-ICL-6: default feedback.stale_after_days (14) engages when unconfigured — a 1-day-old report is not flagged", async () => {
    const { result, data } = await checkIssues(tmpDir);
    expect(result.exitCode).toBe(0);
    expect(data!.consistent).toBe(true);
    expect(data!.stale_open).toEqual([]);
  });
});

// ─── Corpus D: plain `lore status` never computes/exposes issues (REGRESSION) ─

describe("AC-ICL-6: plain `lore status` is unaffected (opt-in only)", async () => {
  const tmpDir = await makeCorpus("regression");
  const prd = await createPrd(tmpDir);
  const plan = await createPlan(tmpDir, prd.slug, "Regression Fixture Plan");
  const issueTask = await createTask(tmpDir, plan.slug, "Filed report: would be stale if checked");

  // 999 days old — would obviously be flagged stale under ANY reasonable
  // stale_after_days if `--check-issues` were reached, proving its absence from
  // plain `lore status` is not a coincidence of a young fixture.
  mergeExtra(tmpDir, issueTask.id, {
    issue_report: {
      reporter_project: "consumer-a",
      reporter_actor: "agent:consumer",
      lore_version: "0.0.0-test",
      expected: "exit 0",
      actual: "exit 1",
      reported_at: daysAgoIso(999),
      possible_duplicates: [],
    },
  });

  it("AC-ICL-6: REGRESSION — plain `lore status --json` carries no `issues` key at all", async () => {
    const result = await runLore(["status", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout) as JsonEnvelope<Record<string, unknown>>;
    expect(envelope.data["issues"]).toBeUndefined();
  });
});
