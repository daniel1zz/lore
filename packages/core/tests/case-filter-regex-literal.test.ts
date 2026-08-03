/**
 * Unit coverage for the literal-vs-regex case-filter primitives added to
 * `attestation-completeness.ts` by
 * task-a-t-filter-is-a-regex-so-this-repo-s-own-ac-titles:
 * `extractCaseFilterPatterns`, `findRegexMetacharacters`,
 * `escapeCaseFilterPattern`, `REGEX_METACHARACTERS_DESCRIPTION`.
 *
 * The defect: a `-t` value is a REGULAR EXPRESSION, so an AC title pasted
 * verbatim from this repo's own naming convention (`AC-2.H1 (GREEN)`,
 * `real repo tree + real corpus`) compiles into a pattern that cannot match the
 * title it came from — zero cases selected, runner exits 0, indistinguishable
 * from a pass. Measured three times in this repo.
 *
 * Six dimensions:
 *   HAPPY:      both measured strings escape into a pattern that matches them;
 *               every recognised flag shape yields its value.
 *   NEGATIVE:   a metacharacter-free title is returned CHARACTER-IDENTICAL and
 *               reports no metacharacters; a filterless command extracts [].
 *   BOUNDARY:   the FULL metacharacter set (all 14), one case per character,
 *               asserting the escape round-trip invariant for each — not only
 *               the three that happened to bite.
 *   ERROR:      a pattern that is not a valid regular expression at all
 *               (unbalanced `(`, trailing `\`) escapes into one that compiles
 *               AND matches.
 *   STATE:      several filters in one command extract in order, de-duplicated.
 *   REGRESSION: extraction and detection read the same flag vocabulary, so they
 *               can never disagree; a flag with no value token extracts nothing
 *               rather than swallowing the following flag.
 */

import { describe, it, expect } from "vitest";
import {
  CASE_FILTER_FLAGS_DESCRIPTION,
  REGEX_METACHARACTERS_DESCRIPTION,
  commandHasCaseFilter,
  escapeCaseFilterPattern,
  extractCaseFilterPatterns,
  findRegexMetacharacters,
} from "../src/attestation-completeness.js";

/** The two filter strings measured silently matching zero cases, verbatim. */
const MEASURED_PARENS_TITLE = "AC-2.H1 (GREEN)";
const MEASURED_PLUS_TITLE = "real repo tree + real corpus";

/**
 * The metacharacter set this task's AC-1 requires covered, spelled out here
 * INDEPENDENTLY of the implementation's own list — a test that imported the
 * production set would pass no matter how much that set shrank.
 * `REGEX_METACHARACTERS_DESCRIPTION` is cross-checked against it below, so a
 * drift in either direction is loud.
 */
const REQUIRED_METACHARACTERS = [
  "(",
  ")",
  "+",
  "[",
  "]",
  "*",
  "?",
  ".",
  "|",
  "$",
  "^",
  "{",
  "}",
  "\\",
] as const;

describe("case-filter literal/regex primitives — HAPPY", () => {
  it("escapes the measured parenthesised title into a pattern that matches it", () => {
    const escaped = escapeCaseFilterPattern(MEASURED_PARENS_TITLE);
    expect(escaped).toBe("AC-2\\.H1 \\(GREEN\\)");
    expect(new RegExp(escaped).test(MEASURED_PARENS_TITLE)).toBe(true);
    // The RAW title, compiled as the regex the runner really compiles, does NOT
    // match itself — this is the whole defect, asserted as a fact.
    expect(new RegExp(MEASURED_PARENS_TITLE).test(MEASURED_PARENS_TITLE)).toBe(false);
  });

  it("escapes the measured `+` title into a pattern that matches it", () => {
    const escaped = escapeCaseFilterPattern(MEASURED_PLUS_TITLE);
    expect(escaped).toBe("real repo tree \\+ real corpus");
    expect(new RegExp(escaped).test(MEASURED_PLUS_TITLE)).toBe(true);
    expect(new RegExp(MEASURED_PLUS_TITLE).test(MEASURED_PLUS_TITLE)).toBe(false);
  });

  it("extracts the filter value from every recognised flag shape", () => {
    expect(
      extractCaseFilterPatterns(`bunx vitest run a.test.ts -t '${MEASURED_PARENS_TITLE}'`),
    ).toEqual([MEASURED_PARENS_TITLE]);
    expect(
      extractCaseFilterPatterns('bunx vitest run --testNamePattern "AC-1 happy" a.test.ts'),
    ).toEqual(["AC-1 happy"]);
    expect(extractCaseFilterPatterns("bunx vitest run --testNamePattern=AC-1 a.test.ts")).toEqual([
      "AC-1",
    ]);
  });

  it("reports exactly the metacharacters present in a title", () => {
    expect(findRegexMetacharacters(MEASURED_PARENS_TITLE)).toEqual([".", "(", ")"]);
    expect(findRegexMetacharacters(MEASURED_PLUS_TITLE)).toEqual(["+"]);
  });
});

describe("case-filter literal/regex primitives — NEGATIVE", () => {
  it("returns a metacharacter-free title CHARACTER-IDENTICAL", () => {
    const plain = "AC-1 happy path records one row";
    expect(escapeCaseFilterPattern(plain)).toBe(plain);
    expect(findRegexMetacharacters(plain)).toEqual([]);
  });

  it("extracts nothing from a command carrying no case filter", () => {
    expect(extractCaseFilterPatterns("bunx vitest run packages/lore/tests/a.test.ts")).toEqual([]);
    expect(extractCaseFilterPatterns("bun run typecheck")).toEqual([]);
    expect(extractCaseFilterPatterns("")).toEqual([]);
  });

  it("does not treat `--title` (which merely contains -t) as a case filter", () => {
    expect(extractCaseFilterPatterns("bun run test --title foo")).toEqual([]);
  });

  it("escaping an empty pattern yields an empty pattern", () => {
    expect(escapeCaseFilterPattern("")).toBe("");
    expect(findRegexMetacharacters("")).toEqual([]);
  });
});

describe("case-filter literal/regex primitives — BOUNDARY (full metacharacter set)", () => {
  it("REGEX_METACHARACTERS_DESCRIPTION names every required metacharacter and no more", () => {
    const described = REGEX_METACHARACTERS_DESCRIPTION.split(" ");
    for (const metacharacter of REQUIRED_METACHARACTERS) {
      expect(described).toContain(metacharacter);
    }
    expect(described).toHaveLength(REQUIRED_METACHARACTERS.length);
  });

  for (const metacharacter of REQUIRED_METACHARACTERS) {
    it(`detects and escapes the metacharacter ${JSON.stringify(metacharacter)} in a title`, () => {
      const title = `AC-1 boundary ${metacharacter} tail`;

      expect(findRegexMetacharacters(title)).toContain(metacharacter);

      const escaped = escapeCaseFilterPattern(title);
      expect(escaped).toContain(`\\${metacharacter}`);
      // The round-trip invariant the repair rests on: the escaped pattern,
      // compiled as a regex, matches the ORIGINAL literal title.
      expect(new RegExp(escaped).test(title)).toBe(true);
    });
  }

  it("escapes a title carrying EVERY metacharacter at once into a matching pattern", () => {
    const title = `AC-1 ${REQUIRED_METACHARACTERS.join("")} done`;
    const escaped = escapeCaseFilterPattern(title);
    expect(new RegExp(escaped).test(title)).toBe(true);
    expect(findRegexMetacharacters(title)).toHaveLength(REQUIRED_METACHARACTERS.length);
  });
});

describe("case-filter literal/regex primitives — ERROR", () => {
  it("escapes a title that is not a valid regular expression at all", () => {
    for (const title of ["AC-1 (unbalanced", "AC-1 [unterminated", "AC-1 trailing \\"]) {
      expect(() => new RegExp(title)).toThrow();
      const escaped = escapeCaseFilterPattern(title);
      expect(new RegExp(escaped).test(title)).toBe(true);
    }
  });
});

describe("case-filter literal/regex primitives — STATE", () => {
  it("extracts several filters in command order, de-duplicated", () => {
    expect(
      extractCaseFilterPatterns(
        "bunx vitest run a.test.ts -t 'AC-1' && bunx vitest run b.test.ts -t 'AC-2' " +
          "&& bunx vitest run c.test.ts -t 'AC-1'",
      ),
    ).toEqual(["AC-1", "AC-2"]);
  });
});

describe("case-filter literal/regex primitives — REGRESSION", () => {
  it("extraction is non-empty for exactly the shapes detection recognises", () => {
    // reason: detection (`commandHasCaseFilter`) gates whether the filtered-pass
    // guard runs at all, extraction supplies the diagnosis inside it. If the two
    // read different flag vocabularies, a detected filter could yield no
    // pattern (silent, undiagnosed) or an undetected one could yield a pattern
    // nothing consults. They share the same two sets; this pins that.
    const detected = [
      "bunx vitest run a.test.ts -t 'AC-1'",
      'bunx vitest run --testNamePattern "AC-1" a.test.ts',
      "bunx vitest run --testNamePattern=AC-1 a.test.ts",
    ];
    for (const command of detected) {
      expect(commandHasCaseFilter(command)).toBe(true);
      expect(extractCaseFilterPatterns(command).length).toBeGreaterThan(0);
    }

    const undetected = ["bunx vitest run a.test.ts", "bun run test --title foo"];
    for (const command of undetected) {
      expect(commandHasCaseFilter(command)).toBe(false);
      expect(extractCaseFilterPatterns(command)).toEqual([]);
    }
  });

  it("a case-filter flag with no value token extracts nothing", () => {
    // Fail-open in the withhold-a-diagnosis direction, never fabricate one.
    expect(extractCaseFilterPatterns("bunx vitest run a.test.ts -t")).toEqual([]);
    expect(extractCaseFilterPatterns("bunx vitest run -t --reporter json a.test.ts")).toEqual([]);
  });

  it("the flags description still spells both recognised flag forms", () => {
    expect(CASE_FILTER_FLAGS_DESCRIPTION).toContain("-t");
    expect(CASE_FILTER_FLAGS_DESCRIPTION).toContain("--testNamePattern");
  });
});
