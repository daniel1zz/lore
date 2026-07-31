/** @spec_ref AC-IC-3 */
/**
 * Unit tests for `scripts/check-no-timer-retry.ts`'s PURE parsers — the D3
 * target extraction and the source scan (AC-IC-3 of
 * spec-report-issue-has-no-specified-concurrency-contract-ac-072). No corpus, no
 * subprocess: the module is importable from vitest precisely because its
 * `bun:sqlite` read is lazy.
 *
 * Why these tests exist rather than "the check passes, so it works": a grep-based
 * oracle whose target list silently narrows reports CLEAN while measuring
 * nothing. The narrowing guards below are the only thing standing between that
 * failure mode and a false green.
 *
 * Six-dimension coverage:
 *   HAPPY:      the live spec's real D3 wording yields exactly the three
 *               corrected enforcement paths and the three banned tokens.
 *   NEGATIVE:   no D3 bullet at all → loud throw, never an empty-but-clean run.
 *   BOUNDARY:   a D3 bullet listing fewer paths/tokens than the documented
 *               minimum → loud throw (the narrowing guard).
 *   ERROR:      scanning reports every occurrence with its line + token,
 *               including inside comments.
 *   STATE:      extraction stops at the next bullet / heading, so paths quoted
 *               elsewhere in the spec (Contract Details' `app.ts`,
 *               `sqlite-store.ts`) never widen the target.
 *   REGRESSION: the nonexistent path D3 used to name
 *               (`adapters/cli/report-issue.ts`) is NOT produced from the
 *               corrected wording, and matching is case-insensitive so `Sleep`
 *               cannot slip past.
 */

import { describe, expect, it } from "vitest";
import {
  extractD3Targets,
  MIN_DECLARED_PATHS,
  NoTimerRetryCheckError,
  scanSource,
} from "../check-no-timer-retry.js";

/**
 * The live spec's D3 bullet, followed by a sibling bullet and a later section
 * that both quote OTHER source paths — the exact shape the parser must not be
 * widened by.
 */
const SPEC_MARKDOWN = [
  "## Design Decisions",
  "",
  "- **D1 — Evidence before mechanism.** The first task records which layer refuses.",
  "- **D3 — No timer-based retry in the enforcement path.** Enforced structurally, not by " +
    "review. The search target is fixed here so it cannot be narrowed after the fact to " +
    "whatever file happens to be clean: `packages/lore/src/service/issue-report-service.ts`, " +
    "`packages/core/src/issue-report.ts`, and " +
    "`packages/lore/src/adapters/cli/commands/report-issue.ts` must together contain zero " +
    "`setTimeout` / `sleep` / `backoff` occurrences. **The checker MUST assert that every " +
    "path in this list exists and fail loud when one is missing**.",
  "- **D4 — If option 2 is chosen, the wait bound is declared in config** — see " +
    "`packages/core/src/config.ts`.",
  "",
  "## Contract Details",
  "",
  "**Refusing layer — L2, the upstream write.** `packages/lore/src/store/sqlite-store.ts`.",
  "Every `lore` command writes its own corpus at startup: `packages/lore/src/app.ts`.",
  "D3's list originally named `packages/lore/src/adapters/cli/report-issue.ts`, which does not exist.",
].join("\n");

describe("check-no-timer-retry: D3 target extraction (AC-IC-3)", () => {
  it("HAPPY + STATE: extracts exactly D3's own paths and tokens, ignoring paths quoted elsewhere", () => {
    const targets = extractD3Targets(SPEC_MARKDOWN);

    expect(targets.paths).toEqual([
      "packages/lore/src/service/issue-report-service.ts",
      "packages/core/src/issue-report.ts",
      "packages/lore/src/adapters/cli/commands/report-issue.ts",
    ]);
    expect(targets.tokens).toEqual(["setTimeout", "sleep", "backoff"]);

    // The sibling D4 bullet and the Contract Details section quote three other
    // real source paths — none of them may join the target list.
    expect(targets.paths).not.toContain("packages/core/src/config.ts");
    expect(targets.paths).not.toContain("packages/lore/src/store/sqlite-store.ts");
    expect(targets.paths).not.toContain("packages/lore/src/app.ts");
    // REGRESSION: the nonexistent path the old D3 wording named must never be
    // produced from the corrected wording.
    expect(targets.paths).not.toContain("packages/lore/src/adapters/cli/report-issue.ts");
  });

  it("NEGATIVE: a spec with no D3 bullet throws instead of scanning nothing", () => {
    expect(() => extractD3Targets("## Design Decisions\n\n- **D1 — something else.**")).toThrow(
      NoTimerRetryCheckError,
    );
    expect(() => extractD3Targets("")).toThrow(/could not find D3/);
  });

  it("BOUNDARY: a D3 bullet below the declared minimums throws (the narrowing guard)", () => {
    const tooFewPaths =
      "- **D3 — No timer-based retry.** `packages/core/src/issue-report.ts` and " +
      "`packages/lore/src/service/issue-report-service.ts` must contain zero `setTimeout` / " +
      "`sleep` / `backoff` occurrences.";
    expect(() => extractD3Targets(tooFewPaths)).toThrow(
      new RegExp(`parsed only 2 declared path\\(s\\).*at least ${MIN_DECLARED_PATHS}`),
    );

    const tooFewTokens =
      "- **D3 — No timer-based retry.** `packages/core/src/issue-report.ts`, " +
      "`packages/lore/src/service/issue-report-service.ts`, " +
      "`packages/lore/src/adapters/cli/commands/report-issue.ts` must contain zero `sleep` " +
      "occurrences.";
    expect(() => extractD3Targets(tooFewTokens)).toThrow(/parsed only 1 banned token/);
  });

  it("BOUNDARY: a token list that GROWS in the spec is picked up with no code change", () => {
    const withFourth = SPEC_MARKDOWN.replace(
      "`setTimeout` / `sleep` / `backoff` occurrences",
      "`setTimeout` / `sleep` / `backoff` / `setInterval` occurrences",
    );
    expect(extractD3Targets(withFourth).tokens).toEqual(["setTimeout", "sleep", "backoff", "setInterval"]);
  });
});

describe("check-no-timer-retry: source scan (AC-IC-3)", () => {
  const tokens = ["setTimeout", "sleep", "backoff"];

  it("HAPPY: clean source yields zero violations", () => {
    const source = [
      "// The mechanism is a declared bounded wait at the store edge.",
      "export const WRITE_CONTENTION_EXIT_CODE = 5;",
    ].join("\n");
    expect(scanSource("packages/core/src/issue-report.ts", source, tokens)).toEqual([]);
  });

  it("ERROR + REGRESSION: every occurrence is reported with line and token, comments and casing included", () => {
    const source = [
      "const a = 1;",
      "await Bun.sleep(5);",
      "// retry-with-backoff is banned here",
      "setTimeout(() => run(), 10);",
      "const notAToken = sleepless;",
      "const Capitalised = Sleep;",
    ].join("\n");

    const violations = scanSource("x.ts", source, tokens);
    expect(violations.map((violation) => [violation.line, violation.token])).toEqual([
      [2, "sleep"],
      [3, "backoff"],
      [4, "setTimeout"],
      [6, "sleep"],
    ]);
    // Word-bounded: `sleepless` is not an occurrence of `sleep`…
    expect(violations.some((violation) => violation.line === 5)).toBe(false);
    // …but casing never hides one (line 6's `Sleep`).
    expect(violations.find((violation) => violation.line === 6)?.text).toContain("Sleep");
    expect(violations[0]?.path).toBe("x.ts");
  });

  it("BOUNDARY: an empty token list scans nothing, and empty source has nothing to find", () => {
    expect(scanSource("x.ts", "await Bun.sleep(1);", [])).toEqual([]);
    expect(scanSource("x.ts", "", tokens)).toEqual([]);
  });
});
