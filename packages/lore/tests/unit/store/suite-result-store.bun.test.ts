// @layer store AC-AF-2 (owner is suite-result-service.test.ts; this file pins the SQLite round trip)
/**
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-2, BR-1497)
 *
 * migration-043 round trip on a real SQLiteStore (throwaway file in a temp dir, never the repo's `.lore`): a stored
 * result reads back field for field, `(commit_sha, attempt)` is unique, the status/cause CHECK refuses a result that
 * cannot say why it failed, and per-file rows come back attached to their result in order.
 *
 * Dimensions: HAPPY (round trip), NEGATIVE (duplicate attempt, unrunnable without cause), BOUNDARY (no rows -> empty /
 * null), ERROR (corrupt JSON column fails loud as STORE_ERROR), STATE (retry attempt 2 beside attempt 1), REGRESSION
 * (migration-044 reclassifies non-run suite results).
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore, LATEST_SCHEMA_VERSION } from "../../../src/store/sqlite-store.js";
import type { SuiteResultRecord } from "../../../src/store/store-interface.js";

let dir: string;
let store: SQLiteStore;

const COMMIT = "c".repeat(40);

function result(overrides: Partial<SuiteResultRecord> = {}): SuiteResultRecord {
  return {
    id: "suite-1",
    commit_sha: COMMIT,
    tree_sha: "d".repeat(40),
    status: "measured",
    attempt: 1,
    cause: null,
    commands: [{ command: "bun run test", exit_code: 1, output_tail: "FAIL a" }],
    skipped: [{ command: "bun run check:plan-close", reason: "not defined" }],
    failing_test_files: [{ file: "tests/a.test.ts", imports: ["src/a.ts"] }],
    duration_ms: 1234,
    measured_at: "2026-10-28T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-suite-result-store-"));
  store = new SQLiteStore(join(dir, "lore.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("suite_results (migration-043)", () => {
  it("AC-AF-2 a stored result reads back field for field, by commit, by id and in the full list", async () => {
    const record = result();
    expect((await store.insertSuiteResult(record)).ok).toBe(true);
    const byCommit = await store.listSuiteResultsForCommit(COMMIT);
    const byId = await store.getSuiteResult("suite-1");
    const all = await store.listSuiteResults();
    expect(byCommit.ok && byCommit.value).toEqual([record]);
    expect(byId.ok && byId.value).toEqual(record);
    expect(all.ok && all.value).toEqual([record]);
  });

  it("AC-AF-2 an unknown commit or id reads as empty / null", async () => {
    const byCommit = await store.listSuiteResultsForCommit("e".repeat(40));
    const byId = await store.getSuiteResult("missing");
    expect(byCommit.ok && byCommit.value).toEqual([]);
    expect(byId.ok && byId.value).toBeNull();
  });

  it("AC-AF-2 a retry is a second row (attempt 2, new id) beside the unrunnable first, oldest attempt first", async () => {
    await store.insertSuiteResult(result({ id: "suite-1", status: "unrunnable", cause: "install failed", commands: [], skipped: [], failing_test_files: [] }));
    await store.insertSuiteResult(result({ id: "suite-2", attempt: 2, measured_at: "2026-10-28T10:05:00.000Z" }));
    const listed = await store.listSuiteResultsForCommit(COMMIT);
    expect(listed.ok && listed.value.map((r) => [r.id, r.status, r.attempt, r.cause])).toEqual([
      ["suite-1", "unrunnable", 1, "install failed"],
      ["suite-2", "measured", 2, null],
    ]);
  });

  it("AC-AF-2 a second row for the same commit and attempt is refused", async () => {
    await store.insertSuiteResult(result());
    const dup = await store.insertSuiteResult(result({ id: "suite-other" }));
    expect(dup.ok).toBe(false);
  });

  it("AC-AF-2 an unrunnable result without a cause, and a measured one with a cause, are refused", async () => {
    const noCause = await store.insertSuiteResult(result({ status: "unrunnable", cause: null }));
    const strayCause = await store.insertSuiteResult(result({ id: "suite-2", cause: "why" }));
    expect(noCause.ok).toBe(false);
    expect(strayCause.ok).toBe(false);
  });

  it("AC-AF-2 a corrupt JSON column fails loud as STORE_ERROR instead of reading as no result", async () => {
    await store.insertSuiteResult(result());
    // reason: the test corrupts the row behind the store's back to pin the fail-loud read.
    (store as unknown as { db: { run: (sql: string, params: unknown[]) => void } }).db.run("UPDATE suite_results SET commands = ? WHERE id = ?", ["{not json", "suite-1"]);
    const listed = await store.listSuiteResultsForCommit(COMMIT);
    expect(listed.ok).toBe(false);
    if (!listed.ok) expect(listed.error.code).toBe("STORE_ERROR");
  });
});

describe("suite_file_runs (migration-043)", () => {
  it("AC-AF-2 per-file rows come back attached to their result in insertion order; none for another result", async () => {
    await store.insertSuiteResult(result());
    const base = { suite_result_id: "suite-1", commit_sha: COMMIT, duration_ms: 5, measured_at: "2026-10-28T10:01:00.000Z", classification: "green" as const, inconclusive_cause: null };
    const inserted = await store.insertSuiteFileRuns([
      { ...base, file: "tests/a.test.ts", exit_code: 1, output_tail: "red" },
      { ...base, file: "tests/b.test.ts", exit_code: 0, output_tail: "green" },
    ]);
    expect(inserted.ok).toBe(true);
    const listed = await store.listSuiteFileRuns("suite-1");
    expect(listed.ok && listed.value.map((r) => [r.file, r.exit_code, r.output_tail])).toEqual([
      ["tests/a.test.ts", 1, "red"],
      ["tests/b.test.ts", 0, "green"],
    ]);
    const other = await store.listSuiteFileRuns("suite-2");
    expect(other.ok && other.value).toEqual([]);
    expect((await store.insertSuiteFileRuns([])).ok).toBe(true);
  });
});

describe("migration-044 reclassifies suite results whose command never ran the tests", () => {
  const cmd = (exit_code: number, output_tail = "") => [{ command: "bun run test", exit_code, output_tail }];

  it("AC-AF-2 a measured result with a command exit outside {0, 1} becomes unrunnable with its cause, every other row and every column kept, and a second open changes nothing", async () => {
    const old = new SQLiteStore(join(dir, "old.db"), { schemaCeiling: 43 });
    const contended = result({ id: "r-contended", commit_sha: "1".repeat(40), commands: [...cmd(1), ...cmd(5, "oracle-lock: contended")], failing_test_files: [] });
    const redRow = result({ id: "r-red", commit_sha: "2".repeat(40), commands: cmd(1) });
    const greenRow = result({ id: "r-green", commit_sha: "3".repeat(40), commands: cmd(0), failing_test_files: [] });
    const noCommands = result({ id: "r-none", commit_sha: "4".repeat(40), commands: [], failing_test_files: [] });
    const unrunnable = result({ id: "r-unrunnable", commit_sha: "5".repeat(40), status: "unrunnable", cause: "timed out", commands: [], failing_test_files: [] });
    for (const r of [contended, redRow, greenRow, noCommands, unrunnable]) expect((await old.insertSuiteResult(r)).ok).toBe(true);
    old.close();

    const upgraded = new SQLiteStore(join(dir, "old.db"), { migrate: true });
    try {
      const all = await upgraded.listSuiteResults();
      const byId = new Map((all.ok ? all.value : []).map((r) => [r.id, r] as const));
      expect(byId.size).toBe(5);
      expect(byId.get("r-contended")).toMatchObject({ status: "unrunnable", attempt: 1, commands: contended.commands });
      expect(byId.get("r-contended")?.cause).toContain("`bun run test` exited with code 5");
      expect(byId.get("r-contended")?.cause).toContain("the tests did not run");
      expect(byId.get("r-red")).toEqual(redRow);
      expect(byId.get("r-green")).toEqual(greenRow);
      expect(byId.get("r-none")).toEqual(noCommands);
      expect(byId.get("r-unrunnable")).toEqual(unrunnable);
    } finally {
      upgraded.close();
    }
    const again = new SQLiteStore(join(dir, "old.db"));
    try {
      const after = await again.listSuiteResults();
      expect((after.ok ? after.value : []).filter((r) => r.status === "unrunnable").map((r) => r.id).sort()).toEqual(["r-contended", "r-unrunnable"]);
    } finally {
      again.close();
    }
  });
});

describe("migration-045 single-file runs are unique per (key, file) (#528)", () => {
  const base = { commit_sha: COMMIT, file: "tests/a.test.ts", duration_ms: 5, measured_at: "2026-10-28T10:01:00.000Z", classification: "green" as const, inconclusive_cause: null };
  const key = `file-bisect@${COMMIT}`;

  it("AC-AF-2 the schema version includes 045 (046 widened docs.type for templates)", () => {
    expect(LATEST_SCHEMA_VERSION).toBe(47);
  });

  it("AC-AF-2 a second row for the same single-file key and file is ignored, the first stays; another file or key still stores", async () => {
    expect((await store.insertSuiteFileRuns([{ ...base, suite_result_id: key, exit_code: 0, output_tail: "first" }])).ok).toBe(true);
    expect((await store.insertSuiteFileRuns([{ ...base, suite_result_id: key, exit_code: 1, output_tail: "second" }])).ok).toBe(true);
    await store.insertSuiteFileRuns([{ ...base, file: "tests/b.test.ts", suite_result_id: key, exit_code: 1, output_tail: "other file" }]);
    await store.insertSuiteFileRuns([{ ...base, suite_result_id: `file-confirm@${COMMIT}`, exit_code: 1, output_tail: "other kind" }]);
    const listed = await store.listSuiteFileRuns(key);
    expect(listed.ok && listed.value.map((r) => [r.file, r.output_tail])).toEqual([
      ["tests/a.test.ts", "first"],
      ["tests/b.test.ts", "other file"],
    ]);
  });

  it("AC-AF-2 re-runs attached to a suite result id are still appended, duplicates included", async () => {
    await store.insertSuiteFileRuns([{ ...base, suite_result_id: "suite-1", exit_code: 0, output_tail: "a" }]);
    await store.insertSuiteFileRuns([{ ...base, suite_result_id: "suite-1", exit_code: 1, output_tail: "b" }]);
    const listed = await store.listSuiteFileRuns("suite-1");
    expect(listed.ok && listed.value.map((r) => r.output_tail)).toEqual(["a", "b"]);
  });

  it("AC-AF-2 upgrading a schema-44 corpus keeps every existing row (re-run duplicates included) and then enforces uniqueness on single-file keys", async () => {
    new SQLiteStore(join(dir, "old45.db"), { schemaCeiling: 44 }).close();
    // reason: the schema-44 table has no classification columns, so the rows go in with the schema-44 statement (the store's writer names the 047 columns).
    const rawOld = new Database(join(dir, "old45.db"));
    const insertOld = "INSERT INTO suite_file_runs (suite_result_id, commit_sha, file, exit_code, output_tail, duration_ms, measured_at) VALUES ('suite-1', ?, ?, ?, ?, 5, '2026-10-28T10:01:00.000Z')";
    rawOld.run(insertOld, [COMMIT, "tests/a.test.ts", 0, "a"]);
    rawOld.run(insertOld, [COMMIT, "tests/a.test.ts", 1, "b"]);
    rawOld.close();
    const upgraded = new SQLiteStore(join(dir, "old45.db"), { migrate: true });
    try {
      const kept = await upgraded.listSuiteFileRuns("suite-1");
      expect(kept.ok && kept.value.map((r) => r.output_tail)).toEqual(["a", "b"]);
      await upgraded.insertSuiteFileRuns([{ ...base, suite_result_id: key, exit_code: 0, output_tail: "first" }]);
      await upgraded.insertSuiteFileRuns([{ ...base, suite_result_id: key, exit_code: 1, output_tail: "second" }]);
      const once = await upgraded.listSuiteFileRuns(key);
      expect(once.ok && once.value.map((r) => r.output_tail)).toEqual(["first"]);
    } finally {
      upgraded.close();
    }
  });
});
