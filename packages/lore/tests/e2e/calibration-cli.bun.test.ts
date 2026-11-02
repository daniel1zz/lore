// @spawns packages/lore/src/index.ts
/**
 * @spec_ref SPEC-035 §4
 *
 * End-to-end CLI tests for `lore calibration --stats` (SPEC-035 §4) — subprocess-level
 * black-box verification, mirroring cli.bun.test.ts's runLore/makeTempDir harness. New
 * file (not appended to cli.bun.test.ts) to avoid a concurrent-edit conflict with another
 * task touching that file.
 *
 * Seeding strategy: `calibration_records` rows are seeded by opening the SAME sqlite
 * file directly via `new SQLiteStore(dbPath)` right after `lore init` and BEFORE spawning
 * the CLI subprocess — SPEC-035's tech-spec documents `insertCalibrationRecord` as a real
 * production write path (JudgmentService.recordCalibration calls it directly), so a direct
 * store write is an accepted, intentional seeding mechanism, not a test-only fiction. The
 * store is closed before spawning `lore` to avoid file-lock contention.
 *
 * NOTE (deviation from dispatch instructions): `calibration_records.judgment_id` and
 * `.doc_id` DO carry real `FOREIGN KEY ... REFERENCES` constraints against `review_judgments(id)`
 * / `docs(id)` (migration-003.ts), and SQLiteStore enables FK enforcement — inserting a
 * calibration record with an arbitrary unmatched id fails with STORE_ERROR/SQLITE_CONSTRAINT_
 * FOREIGNKEY. Verified empirically while writing this test. Each seeded calibration record is
 * therefore backed by a real `docs` row and a real `review_judgments` row, inserted via the
 * same `store.insert()` / `store.insertJudgment()` seams (still a direct-store seed, still
 * bypassing CorpusService/JudgmentService's business-rule layer — just satisfying the DB's
 * own referential-integrity constraint underneath it).
 *
 * Six-dimension coverage:
 *   HAPPY:      `--stats` on an empty corpus prints "No calibration records found."; on a
 *               seeded corpus `--json` reports the correct n/agreement_rate per doc_type
 *   NEGATIVE:   omitting `--stats` exits 2 with non-empty stderr
 *   BOUNDARY:   N/A beyond the empty-vs-populated cases above (covered under HAPPY)
 *   ERROR:      N/A — DB-level failures require controlled storage mocking (out of scope
 *               for a black-box subprocess test)
 *   STATE:      the pre-existing approve/reject flow is NOT broken by the new calibration
 *               hook wiring when there is nothing to calibrate against (no judgment exists)
 *   REGRESSION: approve/reject on a doc with no judgment still exits 0 and the doc's status
 *               actually transitions — guards against the calibration hook silently
 *               swallowing the exit code or throwing out of the command
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import type { CalibrationOutcome, CalibrationRecord, DocRecord, DocType, ReviewJudgment } from "@lore/core";
import { actedStore } from "../live-invocation.js";
import { templatedFieldsArgs } from "../helpers/templated-create.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface JsonEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface CalibrationStatsRow {
  doc_type: string;
  prompt_version: string;
  n: number;
  agreement_rate: number;
  wilson_lower_bound: number;
  window_limit: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

const FAKE_EDITOR_DIR = join(tmpdir(), "lore-e2e-calibration-fake-editor");
mkdirSync(FAKE_EDITOR_DIR, { recursive: true });
const FAKE_EDITOR_PATH = join(FAKE_EDITOR_DIR, "editor.sh");
Bun.write(FAKE_EDITOR_PATH, "#!/bin/sh\nprintf 'test content' > \"$1\"\n");
await Bun.$`chmod 755 ${FAKE_EDITOR_PATH}`.quiet();

/** Run `bun run src/index.ts ...args` in `cwd`. HOME is isolated to `cwd`. */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: FAKE_EDITOR_PATH },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/** Parse stdout as a JSON envelope, throwing with context on failure. */
function parseJson<T = unknown>(result: RunResult): JsonEnvelope<T> {
  try {
    return JSON.parse(result.stdout) as JsonEnvelope<T>;
  } catch {
    throw new Error(
      `Expected JSON in stdout but got:\n${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
}

function makeTempDir(label: string): string {
  const dir = join(tmpdir(), `lore-e2e-calibration-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

let _counter = 0;
function nextUlidLike(): string {
  _counter += 1;
  return `01CALIBTEST${String(_counter).padStart(14, "0")}`;
}

function makeDocRecord(overrides: Partial<DocRecord> = {}): DocRecord {
  const id = nextUlidLike();
  return {
    id,
    slug: `spec-seed-${id}`,
    type: "spec",
    role: "spec",
    title: "Seed Doc",
    status: "approved",
    priority: "medium",
    content: "seed content",
    parent_id: null,
    created_at: "2026-07-06T00:00:00.000Z",
    updated_at: "2026-07-06T00:00:00.000Z",
    created_by: "agent:test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  };
}

function makeJudgmentRecord(docId: string, overrides: Partial<ReviewJudgment> = {}): ReviewJudgment {
  const id = nextUlidLike();
  return {
    id,
    doc_id: docId,
    doc_version: 1,
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "seed judgment" }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: [],
    judge: { provider: "test-provider", model: "test-provider", prompt_version: "v1" },
    created_at: "2026-07-06T00:00:00.000Z",
    created_by: "ai:test-provider:test-provider:v1",
    ...overrides,
  };
}

interface CalibrationSeedEntry {
  doc_type: DocType;
  human_outcome: CalibrationOutcome;
  actor: string;
  delta_reasons?: string[];
}

/**
 * Seed one full {doc, judgment, calibration_record} chain per entry directly into the
 * sqlite file at `<tmpDir>/.lore/lore.db` — the FK constraints on calibration_records
 * (judgment_id -> review_judgments.id, doc_id -> docs.id) require real backing rows
 * (see the file-header NOTE). Store is closed before returning to avoid file-lock
 * contention with the CLI subprocess spawned afterward.
 */
async function seedCalibrationScenario(tmpDir: string, entries: CalibrationSeedEntry[]): Promise<void> {
  const dbPath = join(tmpDir, ".lore", "lore.db");
  const store = actedStore(new SQLiteStore(dbPath));
  try {
    for (const entry of entries) {
      const doc = makeDocRecord({ type: entry.doc_type });
      const docResult = await store.insert(doc);
      if (!docResult.ok) throw new Error(`seed doc failed: ${JSON.stringify(docResult.error)}`);

      const judgment = makeJudgmentRecord(doc.id);
      const judgmentResult = await store.insertJudgment(judgment);
      if (!judgmentResult.ok) throw new Error(`seed judgment failed: ${JSON.stringify(judgmentResult.error)}`);

      const record: CalibrationRecord = {
        id: nextUlidLike(),
        judgment_id: judgment.id,
        doc_id: doc.id,
        doc_type: entry.doc_type,
        human_outcome: entry.human_outcome,
        delta_reasons: entry.delta_reasons ?? [],
        actor: entry.actor,
        created_at: "2026-07-06T00:00:00.000Z",
      };
      const calibrationResult = await store.insertCalibrationRecord(record);
      if (!calibrationResult.ok) throw new Error(`seed calibration failed: ${JSON.stringify(calibrationResult.error)}`);
    }
  } finally {
    store.close();
  }
}

// ─── Scenario 1: --stats on an empty corpus ──────────────────────────────────

describe("Scenario 1: lore calibration --stats (empty corpus)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("empty");
    runLore(["init"], tmpDir);
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("HAPPY: prints 'No calibration records found.' and exits 0", () => {
    const result = runLore(["calibration", "--stats"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No calibration records found.");
  });

  it("HAPPY: --json on an empty corpus returns an empty stats array, still exit 0", () => {
    const result = runLore(["calibration", "--stats", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const json = parseJson<{ stats: CalibrationStatsRow[] }>(result);
    expect(json.ok).toBe(true);
    expect(json.data!.stats).toEqual([]);
  });
});

// ─── Scenario 2: --stats on a seeded corpus ──────────────────────────────────

describe("Scenario 2: lore calibration --stats (seeded corpus)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = makeTempDir("seeded");
    runLore(["init"], tmpDir);

    // 3 "spec" calibration records: 2 confirmed, 1 overridden -> agreement_rate = 2/3.
    // 1 "task" calibration record: overridden -> agreement_rate = 0.
    await seedCalibrationScenario(tmpDir, [
      { doc_type: "spec", human_outcome: "confirmed", actor: "alice" },
      { doc_type: "spec", human_outcome: "confirmed", actor: "bob" },
      { doc_type: "spec", human_outcome: "overridden", actor: "alice", delta_reasons: ["missed a broken link"] },
      { doc_type: "task", human_outcome: "overridden", actor: "carol", delta_reasons: ["wrong verdict"] },
    ]);
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("HAPPY: --json reports n/agreement_rate matching the seeded mix for doc_type 'spec'", () => {
    const result = runLore(["calibration", "--stats", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const json = parseJson<{ stats: CalibrationStatsRow[] }>(result);
    expect(json.ok).toBe(true);

    const specStats = json.data!.stats.find((s) => s.doc_type === "spec");
    expect(specStats).toBeDefined();
    expect(specStats!.n).toBe(3);
    // 2 confirmed / 3 total ≈ 0.667 — cross-checked independently of the source's own math.
    expect(specStats!.agreement_rate).toBeCloseTo(2 / 3, 3);
    expect(specStats!.window_limit).toBe(200);

    const taskStats = json.data!.stats.find((s) => s.doc_type === "task");
    expect(taskStats).toBeDefined();
    expect(taskStats!.n).toBe(1);
    expect(taskStats!.agreement_rate).toBe(0);
  });

  it("HAPPY: --doc-type spec filters to only the spec group", () => {
    const result = runLore(["calibration", "--stats", "--doc-type", "spec", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const json = parseJson<{ stats: CalibrationStatsRow[] }>(result);
    expect(json.data!.stats).toHaveLength(1);
    expect(json.data!.stats[0]!.doc_type).toBe("spec");
    expect(json.data!.stats[0]!.n).toBe(3);
  });

  it("HAPPY: human-readable table output contains doc type rows and headers", () => {
    const result = runLore(["calibration", "--stats"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Doc Type");
    expect(result.stdout).toContain("Agreement Rate");
    expect(result.stdout).toContain("spec");
    expect(result.stdout).toContain("task");
  });
});

// ─── Scenario 3: missing --stats flag ────────────────────────────────────────

describe("Scenario 3: lore calibration (no --stats flag)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("noflag");
    runLore(["init"], tmpDir);
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("NEGATIVE: exits 2 with non-empty stderr when --stats is omitted", () => {
    const result = runLore(["calibration"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.stderr).toContain("--stats");
  });
});

// ─── Scenario 4: approve/reject regression — calibration hook does not break the flow ──

describe("Scenario 4: approve/reject still work when there is no judgment to calibrate against", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("approve-reject-regression");
    runLore(["init"], tmpDir);
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("REGRESSION: approve on a doc with no AI judgment still exits 0 and transitions to 'approved'", () => {
    const createResult = runLore(
      ["create", "prd", "--title", "Calibration Regression Approve", ...templatedFieldsArgs("prd", { refTarget: "problem" }), "--json", "--no-ai"],
      tmpDir,
    );
    expect(createResult.exitCode).toBe(0);
    const doc = parseJson<{ id: string }>(createResult).data!;

    const approveResult = runLore(["approve", doc.id, "--json"], tmpDir);
    expect(approveResult.exitCode).toBe(0);
    const approved = parseJson<{ status: string }>(approveResult).data!;
    expect(approved.status).toBe("approved");
  });

  it("REGRESSION: reject on a doc with no AI judgment still exits 0 and the doc remains 'draft'", () => {
    const createResult = runLore(
      ["create", "prd", "--title", "Calibration Regression Reject", ...templatedFieldsArgs("prd", { refTarget: "problem" }), "--json", "--no-ai"],
      tmpDir,
    );
    expect(createResult.exitCode).toBe(0);
    const doc = parseJson<{ id: string }>(createResult).data!;

    const rejectResult = runLore(["reject", doc.id, "--json"], tmpDir);
    expect(rejectResult.exitCode).toBe(0);
    const rejected = parseJson<{ status: string }>(rejectResult).data!;
    expect(rejected.status).toBe("draft");
  });
});
