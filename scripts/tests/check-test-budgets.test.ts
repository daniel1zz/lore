/**
 * Unit suite for `scripts/check-test-budgets.ts`'s pure `scanFile` algorithm
 * (`spec-a-test-case-s-timeout-budget-must-be-declared-when-its`, task
 * `task-t1-structural-test-budget-oracle`, AC-TB-1/2/3/5) PLUS the baseline
 * exemption ledger mechanism (`adr-a-newly-armed-structural-oracle-enforces-from-a-baseline`,
 * task `task-land-the-baseline-ledger-policy-for-check-test-budgets-55`) PLUS
 * the title-fingerprint re-key
 * (`task-key-test-budget-ledger-rows-on-a-test-title-fingerprint`,
 * `knowledge-file-level-anchor-mutex-does-not-prevent-one-agent-s`).
 *
 * Every `scanFile`/`checkLedger`/`parseLedgerFile` case here drives the
 * function directly against an injected fixture — no subprocess — mirroring
 * `packages/lore/tests/unit/scripts/changed-tests-selector.test.ts`'s
 * established pattern for unit-testing a `scripts/*.ts` algorithm apart from
 * its CLI/IO shell. The one exception is the "real repo tree" describe block
 * below, which deliberately calls `main()` with NO injected repoRoot — a
 * genuine, un-mocked run against this checkout's own test tree and the
 * checked-in `scripts/test-budget-ledger.json`, because that is the only way
 * to actually PROVE the ledger currently zeroes out every real violation
 * (task Acceptance Criterion #1) rather than merely asserting it manually.
 *
 * Coverage (six dimensions), scanFile suites unchanged from the original
 * landing; the ledger suites below add:
 *   HAPPY — an exact `(path, titleFingerprint, spawnCount)` match exempts a
 *     violation; `main()` exits 0 against the real repo tree with the real
 *     ledger; a pure line-INSERTION above a ledgered case does NOT break its
 *     match (AC-6 — the exact scenario that broke the old key three times).
 *   NEGATIVE — a violation with no ledger row is reported as new debt
 *     (AC #2); invalid JSON / schema-invalid (missing `titleFingerprint`)
 *     ledger content is rejected.
 *   BOUNDARY — a ledger row whose `spawnCount` has drifted from the current
 *     measurement (same path+title, different count) is treated as orphaned,
 *     not silently re-matched — the match is exact, not "close enough"; two
 *     cases sharing an identical title but a DIFFERENT spawn count are NOT a
 *     fingerprint collision (spawnCount still disambiguates, AC-4/AC-5).
 *   ERROR — a ledger row whose violation was fixed, renamed, or removed is
 *     orphaned and fails loud (AC #3, AC-6 controls a/b); a row pointing at
 *     a nonexistent path is reported by name (AC #4); a missing ledger file
 *     on disk throws `TestBudgetLedgerError` (`code: "not_found"`); two
 *     violations in the same file sharing an identical
 *     `(titleFingerprint, spawnCount)` throw `TestBudgetFingerprintCollisionError`,
 *     loud and deterministic, never "first match wins" (AC-5).
 *   STATE — `checkLedger` and `parseLedgerFile` are idempotent.
 *   REGRESSION — the real, checked-in ledger's every entry carries all five
 *     required fields (AC #5 of the original ledger task): `path` /
 *     `titleFingerprint` / `spawnCount` / `line` / `reason`, with no
 *     duplicate `(path, titleFingerprint, spawnCount)` rows; a genuinely new
 *     violating case introduced alongside an insertion-shifted one is still
 *     reported as new debt, never accidentally exempted (AC-6 control c).
 *
 * @spec_ref spec-a-test-case-s-timeout-budget-must-be-declared-when-its
 *   §Acceptance Criteria AC-TB-1, AC-TB-2, AC-TB-3, AC-TB-5
 * @spec_ref adr-a-newly-armed-structural-oracle-enforces-from-a-baseline
 * @spec_ref task-key-test-budget-ledger-rows-on-a-test-title-fingerprint
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  scanFile,
  SPAWN_THRESHOLD,
  TestBudgetParseError,
  checkLedger,
  parseLedgerFile,
  loadLedgerFromDisk,
  TestBudgetLedgerError,
  TestBudgetFingerprintCollisionError,
  LEDGER_RELATIVE_PATH,
  main,
  type Violation,
  type TestBudgetLedgerEntry,
} from "../check-test-budgets.js";
import {
  boundaryFixture,
  CONTROL_THREE_SPAWNS_NO_TIMEOUT,
  THREE_SPAWNS_WITH_NUMERIC_TIMEOUT,
  THREE_SPAWNS_WITH_OPTIONS_TIMEOUT,
  THREE_SPAWNS_TRAILING_COMMA,
  UNRELATED_SPAWN_WORD_NO_FALSE_POSITIVE,
  REGRESSION_AC_VRW_5B_SHAPE,
  UNPARSEABLE_MISSING_CLOSE_PAREN,
  insertionShiftFixture,
  INSERTION_SHIFT_FIXTURE_CASE_DELETED,
  INSERTION_SHIFT_FIXTURE_PLUS_NEW_VIOLATION,
  DUPLICATE_TITLE_SAME_SPAWN_COUNT,
  DUPLICATE_TITLE_DIFFERENT_SPAWN_COUNT,
} from "./fixtures.js";

const FIXTURE_PATH = "scripts/tests/fixtures/probe.test.ts";

describe("check-test-budgets: threshold sanity", () => {
  it("SPAWN_THRESHOLD is 3 (spec D2)", () => {
    expect(SPAWN_THRESHOLD).toBe(3);
  });
});

// ─── HAPPY ───────────────────────────────────────────────────────────────

describe("check-test-budgets: HAPPY — declaration satisfies regardless of spawn count", () => {
  it("a 2-spawn body with no timeout produces zero violations", () => {
    const violations = scanFile(FIXTURE_PATH, boundaryFixture(2));
    expect(violations).toEqual([]);
  });

  it("a 3-spawn body WITH an explicit numeric timeout produces zero violations", () => {
    const violations = scanFile(FIXTURE_PATH, THREE_SPAWNS_WITH_NUMERIC_TIMEOUT);
    expect(violations).toEqual([]);
  });

  it("a 3-spawn body WITH an explicit { timeout } options object produces zero violations", () => {
    const violations = scanFile(FIXTURE_PATH, THREE_SPAWNS_WITH_OPTIONS_TIMEOUT);
    expect(violations).toEqual([]);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────

describe("check-test-budgets: NEGATIVE", () => {
  it("control fixture is reported", () => {
    const violations = scanFile("scripts/tests/fixtures/control.test.ts", CONTROL_THREE_SPAWNS_NO_TIMEOUT);
    expect(violations.length).toBe(1);
    expect(violations[0]?.title).toBe("control fixture is reported");
    expect(violations[0]?.spawnCount).toBeGreaterThanOrEqual(SPAWN_THRESHOLD);
  });

  it("a bare trailing comma after the callback is never mistaken for an explicit timeout", () => {
    const violations = scanFile(FIXTURE_PATH, THREE_SPAWNS_TRAILING_COMMA);
    expect(violations.length).toBe(1);
    expect(violations[0]?.title).toBe("trailing comma is not an explicit timeout");
  });

  it("a .spawn( call on an unrelated, non-imported, non-wrapper object is never miscounted", () => {
    const violations = scanFile(FIXTURE_PATH, UNRELATED_SPAWN_WORD_NO_FALSE_POSITIVE);
    expect(violations).toEqual([]);
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────

describe("check-test-budgets: BOUNDARY", () => {
  it("threshold boundary two versus three", () => {
    const twoSpawns = scanFile(FIXTURE_PATH, boundaryFixture(2));
    expect(twoSpawns).toEqual([]);

    const threeSpawns = scanFile(FIXTURE_PATH, boundaryFixture(3));
    expect(threeSpawns.length).toBe(1);
    expect(threeSpawns[0]?.title).toBe("boundary case with two spawns");
    expect(threeSpawns[0]?.spawnCount).toBe(3);
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────

describe("check-test-budgets: ERROR", () => {
  it("unparseable file is loud", () => {
    const path = "scripts/tests/fixtures/unparseable.test.ts";
    let threw = false;
    try {
      scanFile(path, UNPARSEABLE_MISSING_CLOSE_PAREN);
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(TestBudgetParseError);
      const parseError = e as TestBudgetParseError;
      expect(parseError.file).toBe(path);
      expect(parseError.message).toContain(path);
    }
    // reason: failure-first discipline — a silent skip (no throw) is
    // EXACTLY the defect D5 exists to prevent. Fail the assertion loudly
    // rather than let a missing throw read as "0 violations = clean".
    expect(threw).toBe(true);
  });

  it("never returns a result for an unparseable file (no silent partial scan)", () => {
    expect(() => scanFile("scripts/tests/fixtures/unparseable-2.test.ts", UNPARSEABLE_MISSING_CLOSE_PAREN)).toThrow(TestBudgetParseError);
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────

describe("check-test-budgets: STATE", () => {
  it("scanFile is idempotent across repeated runs on the same source", () => {
    const first = scanFile("scripts/tests/fixtures/idempotent.test.ts", CONTROL_THREE_SPAWNS_NO_TIMEOUT);
    const second = scanFile("scripts/tests/fixtures/idempotent.test.ts", CONTROL_THREE_SPAWNS_NO_TIMEOUT);
    expect(second).toEqual(first);
    expect(second.length).toBe(1);
  });

  it("scanFile is idempotent on a clean (zero-violation) source too", () => {
    const first = scanFile(FIXTURE_PATH, boundaryFixture(2));
    const second = scanFile(FIXTURE_PATH, boundaryFixture(2));
    expect(second).toEqual(first);
    expect(second).toEqual([]);
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────

describe("check-test-budgets: REGRESSION — reported instance shape", () => {
  it("reports the AC-VRW-5b shape with its exact verbatim title", () => {
    const violations = scanFile("packages/lore/tests/unit/adapters/cli-plan-promote-advisory.bun.test.ts", REGRESSION_AC_VRW_5B_SHAPE);
    expect(violations.length).toBe(1);
    expect(violations[0]?.title).toBe("prints ZERO advisory lines and exits 0 when the ancestor spec declares >= 1 script-mode AC");
    expect(violations[0]?.spawnCount).toBeGreaterThanOrEqual(SPAWN_THRESHOLD);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Baseline exemption ledger (adr-a-newly-armed-structural-oracle-enforces-from-a-baseline)
// task-land-the-baseline-ledger-policy-for-check-test-budgets-55
// re-keyed on a title fingerprint by
// task-key-test-budget-ledger-rows-on-a-test-title-fingerprint
// ═══════════════════════════════════════════════════════════════════════

function violation(file: string, title: string, spawnCount: number, line = 1): Violation {
  return { file, line, spawnCount, title };
}

function ledgerEntry(path: string, titleFingerprint: string, spawnCount: number, line = 1, reason = "pre-existing debt"): TestBudgetLedgerEntry {
  return { path, titleFingerprint, spawnCount, line, reason };
}

// ─── checkLedger: HAPPY ──────────────────────────────────────────────────

describe("check-test-budgets ledger: checkLedger HAPPY", () => {
  it("an exact (path, titleFingerprint, spawnCount) match fully exempts the violation", () => {
    const violations = [violation("a.test.ts", "probe", 3)];
    const entries = [ledgerEntry("a.test.ts", "probe", 3)];
    const result = checkLedger(violations, entries, () => true);
    expect(result.newViolations).toEqual([]);
    expect(result.orphanedEntries).toEqual([]);
    expect(result.missingPathEntries).toEqual([]);
  });

  it("multiple entries across multiple files each exempt their own violation independently", () => {
    const violations = [violation("a.test.ts", "probe a", 3), violation("b.test.ts", "probe b", 5)];
    const entries = [ledgerEntry("a.test.ts", "probe a", 3), ledgerEntry("b.test.ts", "probe b", 5)];
    const result = checkLedger(violations, entries, () => true);
    expect(result.newViolations).toEqual([]);
    expect(result.orphanedEntries).toEqual([]);
  });

  it("a ledger row still matches a violation whose LINE differs from the row's recorded (diagnostic-only) line", () => {
    // line is deliberately NOT part of the match — a row recorded at line 1
    // must still exempt a violation the scanner now reports at a totally
    // different line, as long as (path, titleFingerprint, spawnCount) agree.
    const violations = [violation("a.test.ts", "probe", 3, 999)];
    const entries = [ledgerEntry("a.test.ts", "probe", 3, 1)];
    const result = checkLedger(violations, entries, () => true);
    expect(result.newViolations).toEqual([]);
    expect(result.orphanedEntries).toEqual([]);
  });
});

// ─── checkLedger: NEGATIVE (AC #2 — new debt is never exempt) ───────────

describe("check-test-budgets ledger: checkLedger NEGATIVE — AC #2 new violation", () => {
  it("a violation introduced after the baseline (no matching ledger row) is reported as new debt", () => {
    const path = "scripts/tests/fixtures/new-debt.test.ts";
    const violations = scanFile(path, CONTROL_THREE_SPAWNS_NO_TIMEOUT); // 1 real violation, via the real scanFile engine
    const result = checkLedger(violations, [], () => true); // empty ledger — nothing recorded yet
    expect(result.newViolations.length).toBe(1);
    expect(result.newViolations[0]?.file).toBe(path);
    expect(result.orphanedEntries).toEqual([]);
    expect(result.missingPathEntries).toEqual([]);
  });

  it("a violation covered by ONE ledger entry still reports an UNRELATED second violation in the same file as new debt", () => {
    const violations = [violation("a.test.ts", "recorded case", 3), violation("a.test.ts", "unrecorded case", 4)];
    const entries = [ledgerEntry("a.test.ts", "recorded case", 3)]; // only the first is recorded
    const result = checkLedger(violations, entries, () => true);
    expect(result.newViolations.length).toBe(1);
    expect(result.newViolations[0]?.title).toBe("unrecorded case");
  });
});

// ─── checkLedger: BOUNDARY — exact match, not fuzzy; title-only is never enough ──

describe("check-test-budgets ledger: checkLedger BOUNDARY — spawnCount drift and title-alone ambiguity", () => {
  it("a ledger row at the SAME (path, titleFingerprint) but a DIFFERENT spawnCount than currently measured is orphaned, not silently re-exempted", () => {
    const violations = [violation("a.test.ts", "probe", 4)]; // now measures 4 spawns
    const entries = [ledgerEntry("a.test.ts", "probe", 3)]; // ledger recorded 3
    const result = checkLedger(violations, entries, () => true);
    expect(result.orphanedEntries.length).toBe(1);
    expect(result.orphanedEntries[0]?.titleFingerprint).toBe("probe");
    // reason: the drifted violation itself is ALSO unexempted new debt — the
    // ledger's stale row does not protect it (AC-4: spawnCount is never
    // dropped from the match, "same title, any count" is not accepted).
    expect(result.newViolations.length).toBe(1);
    expect(result.newViolations[0]?.spawnCount).toBe(4);
  });

  it("AC-5 boundary: two cases sharing an identical title but a DIFFERENT spawn count are NOT a fingerprint collision", () => {
    // DUPLICATE_TITLE_DIFFERENT_SPAWN_COUNT has two "same title different count"
    // it() cases with 3 and 4 spawns respectively — spawnCount alone
    // disambiguates them, so scanning + checking must NOT throw.
    const violations = scanFile("scripts/tests/fixtures/dup-title-diff-count.test.ts", DUPLICATE_TITLE_DIFFERENT_SPAWN_COUNT);
    expect(violations.length).toBe(2);
    expect(() => checkLedger(violations, [], () => true)).not.toThrow();
    const result = checkLedger(violations, [], () => true);
    expect(result.newViolations.length).toBe(2);
  });
});

// ─── checkLedger: ERROR (AC #3 — fixed violation orphans its row) ──────

describe("check-test-budgets ledger: checkLedger ERROR — AC #3 orphaned entry", () => {
  it("a ledger row whose violation has been fixed (scanFile now finds nothing there) is orphaned and fails loud", () => {
    const path = "scripts/tests/fixtures/fixed.test.ts";
    // THREE_SPAWNS_WITH_NUMERIC_TIMEOUT now declares an explicit timeout — scanFile finds ZERO violations for it.
    const violations = scanFile(path, THREE_SPAWNS_WITH_NUMERIC_TIMEOUT);
    expect(violations).toEqual([]); // sanity: this fixture really is clean now
    const entries = [ledgerEntry(path, "declares an explicit numeric timeout", 3, 1, "was pre-existing debt before it declared a timeout")];
    const result = checkLedger(violations, entries, () => true);
    expect(result.orphanedEntries.length).toBe(1);
    expect(result.orphanedEntries[0]?.path).toBe(path);
    expect(result.newViolations).toEqual([]);
  });
});

// ─── checkLedger: ERROR (AC #4 — nonexistent path) ──────────────────────

describe("check-test-budgets ledger: checkLedger ERROR — AC #4 nonexistent path", () => {
  it("a ledger row whose path does not exist is reported by name, separately from orphanedEntries", () => {
    const entries = [ledgerEntry("packages/lore/tests/does-not-exist.test.ts", "probe", 3)];
    const result = checkLedger([], entries, () => false); // pathExists is always false
    expect(result.missingPathEntries.length).toBe(1);
    expect(result.missingPathEntries[0]?.path).toBe("packages/lore/tests/does-not-exist.test.ts");
    // reason: a missing-path row must be counted ONCE, in its own bucket — not
    // double-reported as also "orphaned" (that bucket is reserved for rows
    // whose path DOES exist but no longer matches a real violation).
    expect(result.orphanedEntries).toEqual([]);
  });

  it("pathExists is invoked with the entry's exact repo-relative path", () => {
    const seen: string[] = [];
    const entries = [ledgerEntry("some/file.test.ts", "probe", 3)];
    checkLedger([], entries, (p) => {
      seen.push(p);
      return true;
    });
    expect(seen).toEqual(["some/file.test.ts"]);
  });
});

// ─── checkLedger: ERROR (AC-5 — duplicate title+spawnCount fingerprint) ─

describe("check-test-budgets ledger: checkLedger ERROR — AC-5 fingerprint collision", () => {
  it("two violations in the SAME file sharing an identical title AND spawnCount throw TestBudgetFingerprintCollisionError, loud and deterministic", () => {
    const path = "scripts/tests/fixtures/dup-title-same-count.test.ts";
    const violations = scanFile(path, DUPLICATE_TITLE_SAME_SPAWN_COUNT);
    expect(violations.length).toBe(2); // sanity: both cases really are violations
    let threw = false;
    try {
      checkLedger(violations, [], () => true);
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(TestBudgetFingerprintCollisionError);
      const err = e as TestBudgetFingerprintCollisionError;
      expect(err.file).toBe(path);
      expect(err.titleFingerprint).toBe("duplicate case title");
      expect(err.spawnCount).toBe(3);
      expect(err.occurrences).toBe(2);
    }
    // reason: failure-first discipline — a silent pass-through here would be
    // EXACTLY the "first match wins" ambiguity AC-5 forbids.
    expect(threw).toBe(true);
  });

  it("the collision is reported even when a ledger entry already exists for that exact key (still ambiguous which occurrence it exempts)", () => {
    const violations = [violation("a.test.ts", "same title", 3), violation("a.test.ts", "same title", 3)];
    const entries = [ledgerEntry("a.test.ts", "same title", 3)];
    expect(() => checkLedger(violations, entries, () => true)).toThrow(TestBudgetFingerprintCollisionError);
  });

  it("a collision in one file does not mask an unrelated collision-free violation in another file — the thrown error names the offending file", () => {
    const violations = [
      violation("a.test.ts", "dup", 3),
      violation("a.test.ts", "dup", 3),
      violation("b.test.ts", "unique", 4),
    ];
    let threw = false;
    try {
      checkLedger(violations, [], () => true);
    } catch (e) {
      threw = true;
      expect((e as TestBudgetFingerprintCollisionError).file).toBe("a.test.ts");
    }
    expect(threw).toBe(true);
  });
});

// ─── checkLedger: STATE ──────────────────────────────────────────────────

describe("check-test-budgets ledger: checkLedger STATE", () => {
  it("is idempotent — identical inputs produce structurally identical results", () => {
    const violations = [violation("a.test.ts", "recorded case", 3), violation("b.test.ts", "other case", 4)];
    const entries = [ledgerEntry("a.test.ts", "recorded case", 3)];
    const first = checkLedger(violations, entries, () => true);
    const second = checkLedger(violations, entries, () => true);
    expect(second).toEqual(first);
    expect(second.newViolations.length).toBe(1);
  });
});

// ─── parseLedgerFile / loadLedgerFromDisk ────────────────────────────────

describe("check-test-budgets ledger: parseLedgerFile HAPPY", () => {
  it("parses valid, schema-conformant ledger JSON", () => {
    const raw = JSON.stringify({
      baseline_commit: "48d3dbc",
      entries: [{ path: "a.test.ts", titleFingerprint: "probe", line: 10, spawnCount: 3, reason: "debt" }],
    });
    const ledger = parseLedgerFile(raw);
    expect(ledger.baseline_commit).toBe("48d3dbc");
    expect(ledger.entries).toEqual([{ path: "a.test.ts", titleFingerprint: "probe", line: 10, spawnCount: 3, reason: "debt" }]);
  });

  it("is idempotent across repeated parses of the same content", () => {
    const raw = JSON.stringify({ baseline_commit: "x", entries: [] });
    expect(parseLedgerFile(raw)).toEqual(parseLedgerFile(raw));
  });
});

describe("check-test-budgets ledger: parseLedgerFile NEGATIVE", () => {
  it("rejects non-JSON content with a TestBudgetLedgerError coded invalid_json", () => {
    let threw = false;
    try {
      parseLedgerFile("{ not valid json");
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(TestBudgetLedgerError);
      expect((e as TestBudgetLedgerError).code).toBe("invalid_json");
    }
    expect(threw).toBe(true);
  });

  it("rejects JSON that fails schema validation (missing 'reason') with code schema", () => {
    const raw = JSON.stringify({ baseline_commit: "x", entries: [{ path: "a.ts", titleFingerprint: "t", line: 1, spawnCount: 3 }] });
    let threw = false;
    try {
      parseLedgerFile(raw);
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(TestBudgetLedgerError);
      expect((e as TestBudgetLedgerError).code).toBe("schema");
    }
    expect(threw).toBe(true);
  });

  it("AC-9: rejects a row missing titleFingerprint with code schema — loud, never silently matching nothing", () => {
    const raw = JSON.stringify({ baseline_commit: "x", entries: [{ path: "a.ts", line: 1, spawnCount: 3, reason: "r" }] });
    let threw = false;
    try {
      parseLedgerFile(raw);
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(TestBudgetLedgerError);
      expect((e as TestBudgetLedgerError).code).toBe("schema");
    }
    expect(threw).toBe(true);
  });

  it("rejects an empty-string titleFingerprint", () => {
    const raw = JSON.stringify({ baseline_commit: "x", entries: [{ path: "a.ts", titleFingerprint: "", line: 1, spawnCount: 3, reason: "r" }] });
    expect(() => parseLedgerFile(raw)).toThrow(TestBudgetLedgerError);
  });

  it("rejects a non-positive line number", () => {
    const raw = JSON.stringify({ baseline_commit: "x", entries: [{ path: "a.ts", titleFingerprint: "t", line: 0, spawnCount: 3, reason: "r" }] });
    expect(() => parseLedgerFile(raw)).toThrow(TestBudgetLedgerError);
  });
});

describe("check-test-budgets ledger: loadLedgerFromDisk", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it("ERROR: throws TestBudgetLedgerError coded not_found when the ledger file is absent", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "tb-ledger-"));
    let threw = false;
    try {
      loadLedgerFromDisk(tmpDir);
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(TestBudgetLedgerError);
      expect((e as TestBudgetLedgerError).code).toBe("not_found");
    }
    expect(threw).toBe(true);
  });

  it("HAPPY: reads and validates a real ledger file from disk at the conventional path", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "tb-ledger-"));
    mkdirSync(join(tmpDir, "scripts"), { recursive: true }); // LEDGER_RELATIVE_PATH lives under <repoRoot>/scripts/
    writeFileSync(
      join(tmpDir, LEDGER_RELATIVE_PATH),
      JSON.stringify({ baseline_commit: "abc123", entries: [{ path: "x.ts", titleFingerprint: "probe", line: 1, spawnCount: 3, reason: "r" }] }),
      "utf8",
    );
    const ledger = loadLedgerFromDisk(tmpDir);
    expect(ledger.entries.length).toBe(1);
    expect(ledger.entries[0]?.path).toBe("x.ts");
  });
});

// ─── main(): real repo tree (task AC #1) ─────────────────────────────────

describe("check-test-budgets ledger: main() — real repo tree, task Acceptance Criterion #1", () => {
  it("exits 0 against THIS checkout's real test tree with the checked-in, title-fingerprint-keyed ledger in place", () => {
    // Deliberately un-mocked: no injected repoRoot, no injected violations,
    // no injected ledger. This is the actual `bun run check:test-budgets`
    // code path, proving the production ledger (scripts/test-budget-ledger.json)
    // currently accounts for every real violation in the tree (AC-7).
    const exitCode = main();
    expect(exitCode).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-6: insertion-shift regression — the exact scenario that broke the OLD
// (path, line, spawnCount) key three times in ~24 hours. Verified empirically
// against this repo's own history (see the migration commit's report): the
// OLD key computed as `${path}:${line}` and a pure insertion of unrelated
// lines above a ledgered case shifts `line`, breaking the (path, line) match
// while title and spawnCount stay identical — that is precisely what the new
// key is designed to survive.
// ═══════════════════════════════════════════════════════════════════════

describe("check-test-budgets ledger: AC-6 REGRESSION — insertion-shift survival", () => {
  it("HAPPY: a ledger row recorded before an insertion still matches the SAME case after 5 unrelated lines are inserted above it", () => {
    const path = "scripts/tests/fixtures/insertion-shift.test.ts";
    const before = scanFile(path, insertionShiftFixture(0));
    expect(before.length).toBe(1);
    const beforeLine = before[0]!.line;

    const entries = [ledgerEntry(path, before[0]!.title, before[0]!.spawnCount, beforeLine, "pre-existing debt")];

    const after = scanFile(path, insertionShiftFixture(5));
    expect(after.length).toBe(1);
    // sanity: the insertion really did shift the line — otherwise this test
    // would prove nothing (contiguous-substring-style false confidence).
    expect(after[0]!.line).not.toBe(beforeLine);
    expect(after[0]!.title).toBe(before[0]!.title);
    expect(after[0]!.spawnCount).toBe(before[0]!.spawnCount);

    const result = checkLedger(after, entries, () => true);
    expect(result.newViolations).toEqual([]);
    expect(result.orphanedEntries).toEqual([]);
    expect(result.missingPathEntries).toEqual([]);
  });

  it("ERROR control (a): renaming the case's title (no insertion) makes its ledger row orphan and fail loud, never silently exempted", () => {
    const path = "scripts/tests/fixtures/insertion-shift.test.ts";
    const before = scanFile(path, insertionShiftFixture(0, "the violating case"));
    const entries = [ledgerEntry(path, before[0]!.title, before[0]!.spawnCount, before[0]!.line)];

    const renamed = scanFile(path, insertionShiftFixture(0, "the violating case, renamed"));
    const result = checkLedger(renamed, entries, () => true);
    expect(result.orphanedEntries.length).toBe(1);
    expect(result.orphanedEntries[0]?.titleFingerprint).toBe("the violating case");
    // reason: the renamed case is a DIFFERENT identity now — it must surface
    // as new debt too, not be silently treated as "the same test, moved".
    expect(result.newViolations.length).toBe(1);
    expect(result.newViolations[0]?.title).toBe("the violating case, renamed");
  });

  it("ERROR control (b): deleting the violating case makes its ledger row orphan and fail loud", () => {
    const path = "scripts/tests/fixtures/insertion-shift.test.ts";
    const before = scanFile(path, insertionShiftFixture(0));
    const entries = [ledgerEntry(path, before[0]!.title, before[0]!.spawnCount, before[0]!.line)];

    const afterDelete = scanFile(path, INSERTION_SHIFT_FIXTURE_CASE_DELETED);
    expect(afterDelete).toEqual([]); // sanity: the case really is gone now
    const result = checkLedger(afterDelete, entries, () => true);
    expect(result.orphanedEntries.length).toBe(1);
    expect(result.newViolations).toEqual([]);
  });

  it("REGRESSION control (c): a genuinely NEW violating case introduced alongside the insertion-shifted one is still reported as new debt, not exempted", () => {
    const path = "scripts/tests/fixtures/insertion-shift.test.ts";
    const before = scanFile(path, insertionShiftFixture(0));
    const entries = [ledgerEntry(path, before[0]!.title, before[0]!.spawnCount, before[0]!.line)];

    const afterPlusNew = scanFile(path, INSERTION_SHIFT_FIXTURE_PLUS_NEW_VIOLATION);
    expect(afterPlusNew.length).toBe(2);
    const result = checkLedger(afterPlusNew, entries, () => true);
    expect(result.orphanedEntries).toEqual([]); // the original row still matches
    expect(result.newViolations.length).toBe(1);
    expect(result.newViolations[0]?.title).toBe("a genuinely new violating case");
  });
});

// ─── REGRESSION: the real ledger's shape (AC #5 of the original ledger task, AC-9 of this task) ──

describe("check-test-budgets ledger: REGRESSION — the real ledger's entries carry all five required fields", () => {
  it("every entry in scripts/test-budget-ledger.json has path, titleFingerprint, spawnCount, line, and reason", () => {
    const ledger = loadLedgerFromDisk(join(__dirname, "..", ".."));
    expect(ledger.entries.length).toBeGreaterThan(0);
    for (const entry of ledger.entries) {
      expect(typeof entry.path).toBe("string");
      expect(entry.path.length).toBeGreaterThan(0);
      expect(typeof entry.titleFingerprint).toBe("string");
      expect(entry.titleFingerprint.length).toBeGreaterThan(0);
      expect(Number.isInteger(entry.line)).toBe(true);
      expect(entry.line).toBeGreaterThan(0);
      expect(Number.isInteger(entry.spawnCount)).toBe(true);
      expect(entry.spawnCount).toBeGreaterThanOrEqual(SPAWN_THRESHOLD);
      expect(typeof entry.reason).toBe("string");
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it("the real ledger has no duplicate (path, titleFingerprint, spawnCount) rows", () => {
    const ledger = loadLedgerFromDisk(join(__dirname, "..", ".."));
    const keys = ledger.entries.map((e) => `${e.path} ${e.titleFingerprint} ${e.spawnCount}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
