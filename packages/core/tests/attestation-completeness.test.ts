/**
 * Six-dimension tests for the attestation-completeness pure layer (SPEC-061
 * §Scope D1) — `countExplicitPathArgs`, `parseExecutedUnits`, `judgeCompleteness`.
 *
 * Dimension mapping:
 *   HAPPY:      the literal AC-060-7 three-path shape counts 3; a well-formed
 *               vitest/bun summary tail parses to the right file count; a
 *               zero/under/complete/unknown_runner input yields the matching verdict
 *   NEGATIVE:   a command with no path arguments counts 0; unrecognised stdout
 *               parses to null; a non-test-extension path (e.g. a config file) is
 *               never counted
 *   BOUNDARY:   `bun run test` (zero declared paths) is NEVER judged zero_match —
 *               declaredPaths === 0 short-circuits to "complete"; executed === declared
 *               is exactly "complete", not "under_match"; a flag's own value token is
 *               never counted even when it looks path-shaped
 *   ERROR:      n/a — this module has no IO/throw surface; every function is a total,
 *               referentially-transparent pure computation over its string/number input
 *   STATE:      n/a — no mutable/temporal state; verdict is a pure function of its
 *               two inputs, not any external state
 *   REGRESSION: the exact reproduced AC-060-7 command (2 of 3 paths nonexistent,
 *               vitest silently ran only the matching file) is asserted to be judged
 *               under_match/zero_match depending on the executed-file count — never
 *               silently "complete"
 *
 * @spec_ref SPEC-061 §Scope D1; §Acceptance Criteria AC-061-1, AC-061-2, AC-061-3
 */

import { describe, it, expect } from "vitest";
import {
  countExplicitPathArgs,
  parseExecutedUnits,
  judgeCompleteness,
} from "../src/attestation-completeness.js";

describe("countExplicitPathArgs", () => {
  it("HAPPY: counts the literal AC-060-7 three-path command as 3", () => {
    const command =
      "bun run test:vitest packages/lore/tests/unit/setup-service.test.ts " +
      "packages/lore/tests/unit/assets-ssot.test.ts " +
      "packages/lore/tests/unit/real-setup-ports.test.ts";
    expect(countExplicitPathArgs(command)).toBe(3);
  });

  it("HAPPY: counts a single declared test-file path as 1", () => {
    expect(countExplicitPathArgs("bunx vitest run packages/core/tests/foo.test.ts")).toBe(1);
  });

  it("NEGATIVE: a command with no path arguments counts 0", () => {
    expect(countExplicitPathArgs("bun run test")).toBe(0);
    expect(countExplicitPathArgs("bun run typecheck")).toBe(0);
  });

  it("NEGATIVE: a non-test-extension path is never counted (e.g. a config file)", () => {
    expect(countExplicitPathArgs("bunx vitest run --config packages/foo/vitest.config.ts")).toBe(
      0,
    );
  });

  it("BOUNDARY: a flag's own value contributes 0, e.g. --reporter json", () => {
    expect(countExplicitPathArgs("bunx vitest run --reporter json")).toBe(0);
  });

  it("BOUNDARY: a flag's value is ignored even alongside real declared paths", () => {
    const command = "bunx vitest run --reporter json packages/core/tests/foo.test.ts";
    expect(countExplicitPathArgs(command)).toBe(1);
  });

  it("BOUNDARY: a real path argument immediately after a boolean (valueless) flag is still counted", () => {
    const command = "bunx vitest run --silent packages/core/tests/foo.test.ts";
    expect(countExplicitPathArgs(command)).toBe(1);
  });

  it("BOUNDARY: an empty command string counts 0", () => {
    expect(countExplicitPathArgs("")).toBe(0);
  });
});

describe("parseExecutedUnits", () => {
  it("HAPPY: parses a vitest single-file-passed tail to {files: 1}", () => {
    const stdout = "some preamble\n\n Test Files  1 passed (1)\n Tests  4 passed (4)\n";
    expect(parseExecutedUnits(stdout)?.files).toBe(1);
  });

  it("HAPPY: parses a bun tail (\"Ran 963 tests across 70 files.\") to files: 70", () => {
    const stdout = "...\nRan 963 tests across 70 files. [1.42s]\n";
    expect(parseExecutedUnits(stdout)?.files).toBe(70);
  });

  it("HAPPY: parses a vitest mixed pass/fail tail using the total in parens", () => {
    const stdout = "Test Files  3 failed | 4 passed (7)\n";
    expect(parseExecutedUnits(stdout)?.files).toBe(7);
  });

  it("NEGATIVE: unrecognised stdout returns null", () => {
    expect(parseExecutedUnits("some unrelated tool output with no summary line\n")).toBeNull();
  });

  it("NEGATIVE: empty stdout returns null", () => {
    expect(parseExecutedUnits("")).toBeNull();
  });
});

describe("judgeCompleteness", () => {
  it("HAPPY: complete when executed files equal declared paths", () => {
    expect(judgeCompleteness({ declaredPaths: 3, executedUnits: { files: 3 } })).toBe("complete");
  });

  it("HAPPY: under_match when executed files < declared paths (AC-060-7 partial-match shape)", () => {
    expect(judgeCompleteness({ declaredPaths: 3, executedUnits: { files: 1 } })).toBe(
      "under_match",
    );
  });

  it("HAPPY: zero_match when executed files === 0 with >= 1 declared path", () => {
    expect(judgeCompleteness({ declaredPaths: 3, executedUnits: { files: 0 } })).toBe(
      "zero_match",
    );
  });

  it("HAPPY: unknown_runner when parsing yielded null", () => {
    expect(judgeCompleteness({ declaredPaths: 3, executedUnits: null })).toBe("unknown_runner");
  });

  it("BOUNDARY: declaredPaths === 0 is NEVER zero_match, even with 0 executed files", () => {
    // reason: a command that declares no path filter at all (e.g. `bun run test`) has
    // nothing to under/zero-match against — this is the exact false-positive this guard
    // must never produce (SPEC-061 §Design "the guard must never punish an undeclared-path
    // command").
    expect(judgeCompleteness({ declaredPaths: 0, executedUnits: { files: 0 } })).toBe("complete");
  });

  it("BOUNDARY: declaredPaths === 0 with a real executed count is complete", () => {
    expect(judgeCompleteness({ declaredPaths: 0, executedUnits: { files: 217 } })).toBe(
      "complete",
    );
  });

  it("BOUNDARY: unknown_runner takes precedence over declaredPaths === 0 (null always wins)", () => {
    expect(judgeCompleteness({ declaredPaths: 0, executedUnits: null })).toBe("unknown_runner");
  });

  it("BOUNDARY: executed files greater than declared paths is still complete", () => {
    expect(judgeCompleteness({ declaredPaths: 2, executedUnits: { files: 5 } })).toBe("complete");
  });

  it("REGRESSION: the reproduced AC-060-7 shape (2 of 3 paths nonexistent) is under_match, never complete", () => {
    const command =
      "bun run test:vitest packages/lore/tests/unit/setup-service.test.ts " +
      "packages/lore/tests/unit/assets-ssot.test.ts " +
      "packages/lore/tests/unit/real-setup-ports.test.ts";
    const declaredPaths = countExplicitPathArgs(command);
    // vitest silently ran only the ONE matching file (assets-ssot.test.ts).
    const executedUnits = parseExecutedUnits("...\nTest Files  1 passed (1)\n");
    expect(judgeCompleteness({ declaredPaths, executedUnits })).toBe("under_match");
  });
});
