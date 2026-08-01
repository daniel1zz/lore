/**
 * Fixture SOURCE STRINGS for `scripts/tests/check-test-budgets.test.ts`
 * (`spec-a-test-case-s-timeout-budget-must-be-declared-when-its`,
 * AC-TB-1..5). Plain data — never itself a test file, never executed, only
 * ever passed as a string to `scanFile`. Kept as inline template strings
 * (not real files on disk) so the suite needs no filesystem/subprocess I/O,
 * matching this repo's established convention for testing a `scripts/*.ts`
 * algorithm in isolation (see `packages/lore/tests/unit/scripts/
 * changed-tests-selector.test.ts`'s module header).
 *
 * Side-effect class: pure data, no exports have side effects.
 */

/**
 * A parameterised "boundary" fixture: identical scaffolding, differing ONLY
 * in whether `runBinary` (a `node:child_process` `spawnSync` wrapper — one
 * level of indirection, matching this oracle's detectable "spawn helper"
 * shape) is called 2 or 3 times in the SAME test body. Used for AC-TB-3's
 * matched-pair boundary assertion — a control that only ever showed the
 * failing side would prove nothing.
 */
export function boundaryFixture(spawnCount: 2 | 3): string {
  const calls =
    spawnCount === 2
      ? `    runBinary(["a"]);\n    runBinary(["b"]);\n`
      : `    runBinary(["a"]);\n    runBinary(["b"]);\n    runBinary(["c"]);\n`;
  return (
    `import { describe, it, expect } from "bun:test";\n` +
    `import { spawnSync } from "node:child_process";\n\n` +
    `function runBinary(args: string[]): number {\n` +
    `  const result = spawnSync("true", args);\n` +
    `  return result.status ?? 0;\n` +
    `}\n\n` +
    `describe("boundary suite", () => {\n` +
    `  it("boundary case with two spawns", () => {\n` +
    calls +
    `    expect(true).toBe(true);\n` +
    `  });\n` +
    `});\n`
  );
}

/** AC-TB-2 control fixture: 3 direct spawn-helper calls, no explicit timeout — must be reported, naming this exact test title. */
export const CONTROL_THREE_SPAWNS_NO_TIMEOUT = `import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";

function runBinary(args: string[]): number {
  const result = spawnSync("true", args);
  return result.status ?? 0;
}

describe("control fixture suite", () => {
  it("control fixture is reported", () => {
    runBinary(["a"]);
    runBinary(["b"]);
    runBinary(["c"]);
    expect(true).toBe(true);
  });
});
`;

/** HAPPY: 3 spawns, but WITH an explicit numeric timeout (ms) third argument — must NOT be reported. */
export const THREE_SPAWNS_WITH_NUMERIC_TIMEOUT = `import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";

function runBinary(args: string[]): number {
  const result = spawnSync("true", args);
  return result.status ?? 0;
}

describe("declared budget suite", () => {
  it("declares an explicit numeric timeout", () => {
    runBinary(["a"]);
    runBinary(["b"]);
    runBinary(["c"]);
    expect(true).toBe(true);
  }, 10000);
});
`;

/** HAPPY: 3 spawns, but WITH an explicit `{ timeout }` options object — must NOT be reported (D1: any value satisfies, not just a bare number). */
export const THREE_SPAWNS_WITH_OPTIONS_TIMEOUT = `import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";

function runBinary(args: string[]): number {
  const result = spawnSync("true", args);
  return result.status ?? 0;
}

describe("declared budget suite (options form)", () => {
  it("declares an explicit timeout via options object", () => {
    runBinary(["a"]);
    runBinary(["b"]);
    runBinary(["c"]);
    expect(true).toBe(true);
  }, { timeout: 10000 });
});
`;

/** NEGATIVE: a bare trailing comma after the callback must NOT be mistaken for an explicit-timeout 3rd argument. */
export const THREE_SPAWNS_TRAILING_COMMA = `import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";

function runBinary(args: string[]): number {
  const result = spawnSync("true", args);
  return result.status ?? 0;
}

describe("trailing comma suite", () => {
  it("trailing comma is not an explicit timeout", () => {
    runBinary(["a"]);
    runBinary(["b"]);
    runBinary(["c"]);
    expect(true).toBe(true);
  },);
});
`;

/** NEGATIVE: a `.spawn(` call on an unrelated object/class (never imported from child_process, never a detected wrapper) must never be miscounted. */
export const UNRELATED_SPAWN_WORD_NO_FALSE_POSITIVE = `import { describe, it, expect } from "bun:test";

class ObjectPool {
  spawn(id: string): string {
    return id;
  }
}

describe("unrelated spawn word suite", () => {
  it("does not flag unrelated .spawn( member calls", () => {
    const pool = new ObjectPool();
    pool.spawn("a");
    pool.spawn("b");
    pool.spawn("c");
    expect(true).toBe(true);
  });
});
`;

/**
 * REGRESSION: mirrors the actual reported incident's shape —
 * `cli-plan-promote-advisory.bun.test.ts`'s AC-VRW-5b case (4 direct
 * `runLore` calls, a `Bun.spawnSync`-wrapping local helper, no explicit
 * timeout) — with the EXACT verbatim title text from that file. Proves this
 * oracle would have caught the real incident.
 */
export const REGRESSION_AC_VRW_5B_SHAPE = `import { describe, it, expect } from "bun:test";

function runLore(args: string[], cwd: string): { exitCode: number } {
  const proc = Bun.spawnSync(args, { cwd });
  return { exitCode: proc.exitCode ?? 1 };
}

describe("lore approve <plan-under-reachable-spec> — no advisory (AC-VRW-5b)", () => {
  it("prints ZERO advisory lines and exits 0 when the ancestor spec declares >= 1 script-mode AC", () => {
    const specResult = runLore(["create", "spec"], "/tmp/x");
    const acResult = runLore(["ac", "add"], "/tmp/x");
    const specApprove = runLore(["approve", "spec-slug"], "/tmp/x");
    const result = runLore(["approve", "plan-slug"], "/tmp/x");
    expect(result.exitCode).toBe(0);
  });
});
`;

/**
 * ERROR: a missing closing paren on `.toBe(1` leaves the file's `(`/`)`
 * count genuinely unbalanced (6 opens vs 5 closes) — a true structural
 * break `assertBalancedBrackets` must catch, never a silent skip.
 */
export const UNPARSEABLE_MISSING_CLOSE_PAREN = `import { describe, it, expect } from "bun:test";

describe("broken fixture — never a silent skip", () => {
  it("is missing a closing paren and must be loud", () => {
    expect(1).toBe(1;
  });
});
`;

// ─────────────────────────────────────────────────────────────────────────
// task-key-test-budget-ledger-rows-on-a-test-title-fingerprint — AC-5
// (duplicate-title collision) and AC-6 (insertion-shift regression) fixtures.
// ─────────────────────────────────────────────────────────────────────────

/**
 * AC-6 regression fixture: ONE violating test case (title overridable via
 * `title` — used by the rename control), preceded by `extraLinesAbove` inert
 * comment lines. Proves a title-keyed ledger row survives a pure
 * line-INSERTION above it — the exact scenario that broke the old
 * `(path, line, spawnCount)` key three times in ~24 hours with zero git
 * conflict and zero anchor overlap
 * (`knowledge-file-level-anchor-mutex-does-not-prevent-one-agent-s`).
 */
export function insertionShiftFixture(extraLinesAbove: number, title = "the violating case"): string {
  const padding = "// padding line to shift the case below\n".repeat(extraLinesAbove);
  return `import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";

function runBinary(args: string[]): number {
  const result = spawnSync("true", args);
  return result.status ?? 0;
}

${padding}describe("insertion-shift suite", () => {
  it(${JSON.stringify(title)}, () => {
    runBinary(["a"]);
    runBinary(["b"]);
    runBinary(["c"]);
    expect(true).toBe(true);
  });
});
`;
}

/** AC-6 control (b): the same suite with the violating case entirely REMOVED — its ledger row must orphan (fail loud), never silently vanish. */
export const INSERTION_SHIFT_FIXTURE_CASE_DELETED = `import { describe, it, expect } from "bun:test";

describe("insertion-shift suite", () => {
  it("an unrelated, clean case", () => {
    expect(true).toBe(true);
  });
});
`;

/** AC-6 control (c): the original violating case PLUS a genuinely NEW, differently-titled violating case — the new one must report as new debt while the original stays exempted (not double-counted, not hidden). */
export const INSERTION_SHIFT_FIXTURE_PLUS_NEW_VIOLATION = `import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";

function runBinary(args: string[]): number {
  const result = spawnSync("true", args);
  return result.status ?? 0;
}

describe("insertion-shift suite", () => {
  it("the violating case", () => {
    runBinary(["a"]);
    runBinary(["b"]);
    runBinary(["c"]);
    expect(true).toBe(true);
  });

  it("a genuinely new violating case", () => {
    runBinary(["x"]);
    runBinary(["y"]);
    runBinary(["z"]);
    expect(true).toBe(true);
  });
});
`;

/**
 * AC-5: two `it()` cases in the SAME file sharing an identical title AND an
 * identical spawn count — legal source in both runners, but the one shape a
 * `(path, titleFingerprint, spawnCount)`-keyed ledger cannot disambiguate.
 * `checkLedger` must refuse this loud (`TestBudgetFingerprintCollisionError`),
 * never "first match wins" silently.
 */
export const DUPLICATE_TITLE_SAME_SPAWN_COUNT = `import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";

function runBinary(args: string[]): number {
  const result = spawnSync("true", args);
  return result.status ?? 0;
}

describe("duplicate title suite", () => {
  it("duplicate case title", () => {
    runBinary(["a"]);
    runBinary(["b"]);
    runBinary(["c"]);
    expect(true).toBe(true);
  });

  it("duplicate case title", () => {
    runBinary(["d"]);
    runBinary(["e"]);
    runBinary(["f"]);
    expect(true).toBe(true);
  });
});
`;

/**
 * BOUNDARY companion to `DUPLICATE_TITLE_SAME_SPAWN_COUNT`: identical title,
 * but a DIFFERENT spawn count — `spawnCount` still disambiguates the pair,
 * so this must NOT be treated as a collision (AC-4: spawnCount stays part
 * of the exact-match key, never dropped for "same title, any count").
 */
export const DUPLICATE_TITLE_DIFFERENT_SPAWN_COUNT = `import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";

function runBinary(args: string[]): number {
  const result = spawnSync("true", args);
  return result.status ?? 0;
}

describe("duplicate title, different spawn count suite", () => {
  it("same title different count", () => {
    runBinary(["a"]);
    runBinary(["b"]);
    runBinary(["c"]);
    expect(true).toBe(true);
  });

  it("same title different count", () => {
    runBinary(["d"]);
    runBinary(["e"]);
    runBinary(["f"]);
    runBinary(["g"]);
    expect(true).toBe(true);
  });
});
`;
