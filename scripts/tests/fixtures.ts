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
