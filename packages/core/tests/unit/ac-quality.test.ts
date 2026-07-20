/**
 * Tests for @lore/core ac-quality — lintAcQuantifiability, lintStatement, AC_ABSTRACT_WORDS.
 * Pure function, no IO.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      human-mode AC with an abstract word and no threshold blocks;
 *               the same statement rewritten with a numeric threshold clears;
 *               script-mode ACs are never blocked (oracle-bound by
 *               construction); ai-mode ACs are cleared when the rubric (not
 *               the statement) carries the threshold; lintStatement(text)
 *               (SPEC-059 AC-RQ-1) mirrors the same behavior on bare text
 *   NEGATIVE:   ai-mode AC blocked when BOTH statement and rubric lack a
 *               measurable token
 *   BOUNDARY:   abstract word appearing only as a substring of a larger word
 *               ("goodbye", "quickly") never matches; empty statement; empty
 *               criteria array; multiple abstract words in one statement are
 *               returned in first-occurrence order
 *   ERROR:      malformed input (missing statement) never throws
 *   STATE:      n/a — pure stateless function
 *   REGRESSION: dogfood-self-application (AC-ACQ-6) and false-positive-bound
 *               (AC-ACQ-7) — this lint must never flag its own governing
 *               spec's ACs, nor representative oracle-bound/quantified ACs
 *               drawn from the corpus's existing conventions; this file's
 *               pre-SPEC-059 assertions are the byte-identical regression
 *               fixture for `lintAcQuantifiability`'s SPEC-059 refactor onto
 *               `lintStatement` (AC-RQ-2) — unchanged and still green proves it
 *
 * @spec_ref SPEC AC-Quantifiability Gate §Scope, §Acceptance Criteria
 *   AC-ACQ-1, AC-ACQ-6, AC-ACQ-7; SPEC-059 §Acceptance Criteria AC-RQ-1, AC-RQ-2
 */

import { describe, it, expect } from "vitest";
import {
  lintAcQuantifiability,
  lintStatement,
  AC_ABSTRACT_WORDS,
  type AcQualityFinding,
} from "../../src/ac-quality.js";
import type { AcceptanceCriterion } from "../../src/acceptance.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function human(id: string, statement: string): AcceptanceCriterion {
  return { id, statement, verify: { mode: "human" } };
}

function script(id: string, statement: string, command = "bun test"): AcceptanceCriterion {
  return { id, statement, verify: { mode: "script", oracle: "test", command } };
}

function ai(id: string, statement: string, rubric: string): AcceptanceCriterion {
  return { id, statement, verify: { mode: "ai", rubric } };
}

// ─── AC-ACQ-1: core lint behavior ───────────────────────────────────────────

describe("lintAcQuantifiability — core behavior (AC-ACQ-1)", () => {
  it("blocks a human-mode AC whose statement has an abstract word and no measurable token", () => {
    const findings = lintAcQuantifiability([human("AC-1", "the dashboard loads fast")]);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.word === "fast" && f.severity === "block")).toBe(true);
    expect(findings.every((f) => f.ac_id === "AC-1")).toBe(true);
  });

  it("clears the same statement once rewritten with a numeric threshold", () => {
    const findings = lintAcQuantifiability([human("AC-1", "the dashboard P95 load < 200ms")]);
    expect(findings).toEqual([]);
  });

  it("never blocks a script-mode AC even when its statement carries an abstract word", () => {
    const findings = lintAcQuantifiability([
      script("AC-2", "the export pipeline stays fast and clean end to end"),
    ]);
    expect(findings.filter((f) => f.severity === "block")).toEqual([]);
  });

  it("clears an ai-mode AC when the rubric (not the statement) carries the threshold", () => {
    const findings = lintAcQuantifiability([
      ai("AC-3", "the UI feels seamless", "judge scores seamlessness; pass requires score >= 4/5"),
    ]);
    expect(findings).toEqual([]);
  });

  it("blocks an ai-mode AC when neither the statement nor the rubric has a measurable token", () => {
    const findings = lintAcQuantifiability([
      ai("AC-4", "the UI feels seamless", "judge subjectively confirms the UI feels seamless"),
    ]);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0]?.ac_id).toBe("AC-4");
  });

  it("message names the offending word and suggests a fix", () => {
    const findings = lintAcQuantifiability([human("AC-5", "keep the onboarding flow simple")]);
    expect(findings[0]?.message).toContain("AC-5");
    expect(findings[0]?.message).toContain('"simple"');
    expect(findings[0]?.message).toMatch(/threshold|oracle|measurably/i);
  });
});

// ─── Boundary ────────────────────────────────────────────────────────────────

describe("lintAcQuantifiability — boundary", () => {
  it("never matches an abstract word that only appears as a substring of a larger word", () => {
    const findings = lintAcQuantifiability([
      human("AC-B1", "The goodbye page loads quickly and the classifier runs in the background."),
    ]);
    expect(findings).toEqual([]);
  });

  it("returns no findings for an empty statement", () => {
    const findings = lintAcQuantifiability([human("AC-B2", "")]);
    expect(findings).toEqual([]);
  });

  it("returns no findings for an empty criteria array", () => {
    expect(lintAcQuantifiability([])).toEqual([]);
  });

  it("orders multiple abstract-word findings by first occurrence in the statement", () => {
    const findings = lintAcQuantifiability([
      human("AC-B3", "keep it simple, keep it elegant, and above all keep it robust"),
    ]);
    const words = findings.map((f) => f.word);
    expect(words).toEqual(["simple", "elegant", "robust"]);
  });

  it("matches Chinese abstract words as a plain substring", () => {
    const findings = lintAcQuantifiability([human("AC-B4", "这个界面必须现代化、简洁")]);
    const words = findings.map((f) => f.word);
    expect(words).toContain("现代化");
    expect(words).toContain("简洁");
  });
});

// ─── Error tolerance ─────────────────────────────────────────────────────────

describe("lintAcQuantifiability — malformed input never throws", () => {
  it("treats a missing statement defensively (no throw, no finding)", () => {
    const malformed = { id: "AC-E1", verify: { mode: "human" } } as unknown as AcceptanceCriterion;
    expect(() => lintAcQuantifiability([malformed])).not.toThrow();
    expect(lintAcQuantifiability([malformed])).toEqual([]);
  });

  it("skips a null/undefined entry in the criteria array without throwing", () => {
    const withHole = [null, undefined, human("AC-E2", "fine and quantified: P95 < 100ms")] as unknown as AcceptanceCriterion[];
    expect(() => lintAcQuantifiability(withHole)).not.toThrow();
  });
});

// ─── AC-ACQ-6: dogfood self-application ─────────────────────────────────────

describe("lintAcQuantifiability — dogfood-self-application", () => {
  // Verbatim from `lore ac list spec-spec-ac-quantifiability-gate-design-time-standardization-en`
  // (this spec's own governing structured ACs) — all seven are declared script-mode with
  // measurable/threshold language, so this lint must find zero block findings on them.
  const thisSpecsOwnAcs: AcceptanceCriterion[] = [
    script(
      "AC-ACQ-1",
      "lintAcQuantifiability returns >=1 block finding for an AC statement with an abstract word and 0 measurable token, and exactly 0 findings when rewritten with a numeric threshold",
      "bunx vitest run packages/core/tests/unit/ac-quality.test.ts",
    ),
    script(
      "AC-ACQ-2",
      "ac-quality.ts imports no AIProvider/generate symbol and issues 0 provider calls; source-scan test asserts grep finds no AIProvider in the module",
      "bun test packages/core/tests/unit/ac-quality-no-llm.bun.test.ts",
    ),
    script(
      "AC-ACQ-3",
      "spec-create with an AC carrying an unquantified abstract word exits 4 with a feeding pack naming the offending AC id; same spec with all ACs quantified exits 0",
      "bunx vitest run packages/lore/tests/unit/service/ac-quantifiable-gate.test.ts",
    ),
    script(
      "AC-ACQ-4",
      "with workflow.gates.spec-create.ac_quantifiable.enabled false, a spec that AC-ACQ-3 would block passes with exit 0",
      "bunx vitest run packages/lore/tests/unit/service/ac-quantifiable-gate.test.ts -t config-escape",
    ),
    script(
      "AC-ACQ-5",
      "a spec-create with provider absent still passes the deterministic gate for a quantified spec; the gate path issues 0 provider calls; AI vagueness check runs only under lore review",
      "bunx vitest run packages/lore/tests/unit/service/ac-quantifiable-gate.test.ts -t advisory-only",
    ),
    script(
      "AC-ACQ-6",
      "this spec's own declared acceptance_criteria produce 0 block findings from lintAcQuantifiability",
      "bunx vitest run packages/core/tests/unit/ac-quality.test.ts -t dogfood-self-application",
    ),
    script(
      "AC-ACQ-7",
      "lintAcQuantifiability over every existing corpus spec's declared script-mode ACs yields 0 block findings",
      "bunx vitest run packages/core/tests/unit/ac-quality.test.ts -t false-positive-bound",
    ),
  ];

  it("produces 0 block findings on this spec's own declared acceptance_criteria", () => {
    const findings = lintAcQuantifiability(thisSpecsOwnAcs);
    expect(findings.filter((f) => f.severity === "block")).toHaveLength(0);
  });
});

// ─── AC-ACQ-7: false-positive bound ─────────────────────────────────────────

describe("lintAcQuantifiability — false-positive-bound", () => {
  // Representative, real-shaped oracle-bound / already-quantified AC statements —
  // the kind already declared across this corpus's specs (SPEC-025/039/045/048/050
  // style exit-code and threshold language). None of these should ever be flagged.
  const representativeCorpusAcs: AcceptanceCriterion[] = [
    script("AC-FP-1", "the CLI exits 0 on success and 2 on a usage error"),
    script("AC-FP-2", "P95 API latency stays < 200ms under 100 concurrent users"),
    human("AC-FP-3", "color contrast ratio is >= 4.5:1 for all text elements"),
    script("AC-FP-4", "the packed npm tarball build output stays under 150MB"),
    script("AC-FP-5", "the service exits 4 with a feeding pack naming the offending AC id"),
    script("AC-FP-6", "this fast oracle-bound check runs to completion in under 5s"),
    script("AC-FP-7", "throughput sustains at least 100 req/s under sustained load"),
    script("AC-FP-8", "memory per worker is capped at 1536MB via --max-old-space-size"),
    ai(
      "AC-FP-9",
      "a simple, elegant response completes within 200ms at P99",
      "judge confirms response is well-formed",
    ),
  ];

  it("yields 0 block findings across every representative oracle-bound/quantified statement", () => {
    const findings = lintAcQuantifiability(representativeCorpusAcs);
    const blocks: AcQualityFinding[] = findings.filter((f) => f.severity === "block");
    expect(blocks).toHaveLength(0);
  });
});

// ─── SPEC-059 AC-RQ-1: lintStatement primitive ──────────────────────────────

describe("lintStatement — shared per-statement primitive (AC-RQ-1)", () => {
  it("returns >=1 finding for an abstract word with no measurable token", () => {
    const findings = lintStatement("首页要高质量");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.word === "高质量" && f.severity === "block")).toBe(true);
  });

  it("returns 0 findings for a quantified string", () => {
    const findings = lintStatement("the dashboard P95 load < 200ms");
    expect(findings).toEqual([]);
  });

  it("stamps ac_id as the empty string — the caller supplies the real id", () => {
    const findings = lintStatement("keep the onboarding flow simple");
    expect(findings[0]?.ac_id).toBe("");
  });

  it("never throws on a non-string/empty input", () => {
    expect(() => lintStatement("")).not.toThrow();
    expect(lintStatement("")).toEqual([]);
    // @ts-expect-error — deliberately passing a non-string to prove no throw
    expect(() => lintStatement(undefined)).not.toThrow();
  });

  it("lintAcQuantifiability's per-criterion findings are consistent with lintStatement on the same text", () => {
    const statement = "the export completes fast and stays simple";
    const viaAc = lintAcQuantifiability([human("AC-X", statement)]);
    const viaStatement = lintStatement(statement);
    expect(viaAc.map((f) => f.word)).toEqual(viaStatement.map((f) => f.word));
  });
});

// ─── AC_ABSTRACT_WORDS sanity ────────────────────────────────────────────────

describe("AC_ABSTRACT_WORDS", () => {
  it("is a non-empty readonly array containing both en and zh terms", () => {
    expect(AC_ABSTRACT_WORDS.length).toBeGreaterThan(10);
    expect(AC_ABSTRACT_WORDS).toContain("fast");
    expect(AC_ABSTRACT_WORDS).toContain("high-quality");
    expect(AC_ABSTRACT_WORDS).toContain("高质量");
  });
});
