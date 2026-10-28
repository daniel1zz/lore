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
 * (schema version is 43).
 */

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
  it("AC-AF-2 the schema version is 43", () => {
    expect(LATEST_SCHEMA_VERSION).toBe(43);
  });

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
    const base = { suite_result_id: "suite-1", commit_sha: COMMIT, duration_ms: 5, measured_at: "2026-10-28T10:01:00.000Z" };
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
