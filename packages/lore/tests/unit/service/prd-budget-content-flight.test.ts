/**
 * RED-phase TDD tests for the not-yet-implemented budget oracle module
 * `packages/lore/src/service/prd-budget-check.ts` (paired implementation task: T4,
 * SPEC-080 C3 "lore status --check-prd-budget"). The module does not exist yet — this
 * whole file fails at import resolution until it is created, which IS the RED signal.
 *
 * ── Assumed public API (documented here because there is no source to read yet;
 *    the T4 implementer owns the final shape — this is the paired-red contract) ──
 *
 *   export interface OutlineEntryLike {
 *     section: string;
 *     title: string;
 *     tier: "core" | "domain";
 *     direction: string;                 // bounded summary prose — the field this
 *                                         // suite treats as the tier's char-budget driver
 *     decision_pointers: string[];
 *     constraints: string[];
 *     links: Array<{ slug: string; rel: "detail" | "landing-spec" | "adr" }>;
 *   }
 *
 *   export interface OutlineBudgetLike {
 *     core_chars: number;        // tier:"core" cap — SPEC-080 C3 default 4000
 *     domain_chars: number;      // tier:"domain" cap — SPEC-080 C3 default 2000
 *     whole_doc_chars: number;   // whole rendered body cap — SPEC-080 G1 default 24000
 *     extra_prose_chars: number; // free-text extra[] string cap — SPEC-080 C3 default 1000
 *   }
 *
 *   export interface PrdBudgetCheckInput {
 *     raw_body: string;
 *     outline?: OutlineEntryLike[];        // absent => legacy PRD, whole-doc budget only
 *     extra?: Record<string, unknown>;     // scanned by the content-flight check
 *     budget?: Partial<OutlineBudgetLike>; // corpus-governed; caller resolves + supplies
 *   }
 *
 *   export type PrdBudgetBreachKind = "whole_doc" | "tier" | "extra_prose";
 *
 *   export interface PrdBudgetBreach {
 *     kind: PrdBudgetBreachKind;
 *     detail: string;    // MUST name the offending entity AND the breached budget number
 *     section?: string;  // outline entry section key, when kind === "tier"
 *   }
 *
 *   export interface PrdBudgetCheckResult {
 *     consistent: boolean;
 *     breaches: PrdBudgetBreach[];
 *     whole_doc_chars: number;
 *   }
 *
 *   export function checkPrdBudget(input: PrdBudgetCheckInput): PrdBudgetCheckResult;
 *   export function scanContentFlight(
 *     extra: Record<string, unknown>,
 *     extraProseCharsThreshold: number,
 *   ): PrdBudgetBreach[];
 *
 * TYPED_SCHEMA_KEYS excluded from the content-flight scan (AC-080-6): "requirements",
 * "acceptance_criteria", "phases", "outline" — these are the corpus's own proven
 * typed-array shapes (SPEC-055/038/023/this-spec), never free prose.
 *
 * ── Anti-hardcoding discipline ──
 * Every numeric assertion below is copied from the SPEC TEXT (4000 / 2000 / 24000 /
 * 1000), never read back from the module under test — a hardcoded-wrong-default bug
 * in the real implementation must FAIL these tests, not silently validate itself.
 * One scenario (CUSTOM BUDGET) additionally proves the budget values are actually
 * READ from `input.budget`, not baked-in constants — a `return DEFAULT_RESULT`-shaped
 * stub would pass every fixed-default test here but fail that one.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * @spec_ref AC-080-1 AC-080-6 (SPEC-080 C3, Downstream Handoff "Invariants to test")
 */

import { describe, it, expect } from "vitest";
import { checkPrdBudget, scanContentFlight } from "../../../src/service/prd-budget-check.js";
import type { OutlineEntryLike, OutlineBudgetLike } from "../../../src/service/prd-budget-check.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SPEC_DEFAULT_CORE_CHARS = 4000;
const SPEC_DEFAULT_DOMAIN_CHARS = 2000;
const SPEC_DEFAULT_WHOLE_DOC_CHARS = 24000;
const SPEC_DEFAULT_EXTRA_PROSE_CHARS = 1000;

function makeOutlineEntry(overrides: Partial<OutlineEntryLike> = {}): OutlineEntryLike {
  return {
    section: "distribution",
    title: "Distribution",
    tier: "core",
    direction: "",
    decision_pointers: [],
    constraints: [],
    links: [],
    ...overrides,
  };
}

function breachKinds(result: { breaches: Array<{ kind: string }> }): string[] {
  return result.breaches.map((b) => b.kind);
}

// ─── scanContentFlight — extra-prose char budget (AC-080-6) ─────────────────

describe("scanContentFlight", () => {
  // BOUNDARY — one char over threshold flags, exactly-at-threshold does not.
  it("flags a free-text extra string one char over extra_prose_chars", () => {
    const extra = { migration_note: "x".repeat(SPEC_DEFAULT_EXTRA_PROSE_CHARS + 1) };
    const flags = scanContentFlight(extra, SPEC_DEFAULT_EXTRA_PROSE_CHARS);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags[0]?.kind).toBe("extra_prose");
    // Must NAME the field and the breached budget, not an opaque "flagged" marker.
    expect(flags[0]?.detail).toContain("migration_note");
    expect(flags[0]?.detail).toContain(String(SPEC_DEFAULT_EXTRA_PROSE_CHARS));
  });

  it("does NOT flag a free-text extra string exactly at extra_prose_chars", () => {
    const extra = { migration_note: "x".repeat(SPEC_DEFAULT_EXTRA_PROSE_CHARS) };
    const flags = scanContentFlight(extra, SPEC_DEFAULT_EXTRA_PROSE_CHARS);
    expect(flags).toEqual([]);
  });

  // NEGATIVE — typed schema keys are NEVER flagged, no matter how long their prose is.
  it("never flags free text living inside the four typed schema keys (requirements/acceptance_criteria/phases/outline)", () => {
    const hugeProse = "y".repeat(5 * SPEC_DEFAULT_EXTRA_PROSE_CHARS);
    const extra = {
      requirements: [{ id: "R-1", statement: hugeProse, priority: "P0" }],
      acceptance_criteria: [{ id: "AC-1", statement: hugeProse, verify: { mode: "human" } }],
      phases: [{ key: "phase-1", title: hugeProse }],
      outline: [makeOutlineEntry({ direction: hugeProse })],
    };
    const flags = scanContentFlight(extra, SPEC_DEFAULT_EXTRA_PROSE_CHARS);
    expect(flags).toEqual([]);
  });

  // Different-inputs-different-outputs guard: a MIX of one typed key (silent) and one
  // free-text key (flagged) proves the scan discriminates per-key, not globally.
  it("flags only the free-text key when a typed key and a free-text key coexist", () => {
    const extra = {
      requirements: [{ id: "R-1", statement: "y".repeat(5000), priority: "P0" }],
      internal_note: "z".repeat(SPEC_DEFAULT_EXTRA_PROSE_CHARS + 50),
    };
    const flags = scanContentFlight(extra, SPEC_DEFAULT_EXTRA_PROSE_CHARS);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.detail).toContain("internal_note");
  });
});

// ─── checkPrdBudget — tier boundary math (AC-080-1, core tier explicitly requested) ──

describe("checkPrdBudget: tier=\"core\" entry budget", () => {
  // BOUNDARY — 4001 breaches, naming the tier budget (4000); 4000 exactly is clean.
  it("flags a tier=\"core\" outline entry one char over the 4000-char budget, naming the tier budget", () => {
    const entry = makeOutlineEntry({ tier: "core", direction: "a".repeat(SPEC_DEFAULT_CORE_CHARS + 1) });
    const result = checkPrdBudget({ raw_body: "short compliant body", outline: [entry] });
    expect(result.consistent).toBe(false);
    const tierBreach = result.breaches.find((b) => b.kind === "tier");
    expect(tierBreach).toBeDefined();
    expect(tierBreach?.section).toBe("distribution");
    expect(tierBreach?.detail).toContain(String(SPEC_DEFAULT_CORE_CHARS));
  });

  it("does not flag a tier=\"core\" outline entry at exactly the 4000-char budget", () => {
    const entry = makeOutlineEntry({ tier: "core", direction: "a".repeat(SPEC_DEFAULT_CORE_CHARS) });
    const result = checkPrdBudget({ raw_body: "short compliant body", outline: [entry] });
    expect(result.consistent).toBe(true);
    expect(breachKinds(result)).not.toContain("tier");
  });
});

// ─── checkPrdBudget — tier=domain + whole-doc boundary math (Downstream Handoff pin) ──

describe("checkPrdBudget: tier=\"domain\" entry budget (=2000 invariant)", () => {
  it("flags a tier=\"domain\" outline entry one char over the 2000-char budget", () => {
    const entry = makeOutlineEntry({
      section: "feedback-loop",
      tier: "domain",
      direction: "b".repeat(SPEC_DEFAULT_DOMAIN_CHARS + 1),
    });
    const result = checkPrdBudget({ raw_body: "short compliant body", outline: [entry] });
    expect(result.consistent).toBe(false);
    const tierBreach = result.breaches.find((b) => b.kind === "tier" && b.section === "feedback-loop");
    expect(tierBreach).toBeDefined();
    expect(tierBreach?.detail).toContain(String(SPEC_DEFAULT_DOMAIN_CHARS));
  });

  it("does not flag a tier=\"domain\" outline entry at exactly the 2000-char budget", () => {
    const entry = makeOutlineEntry({ tier: "domain", direction: "b".repeat(SPEC_DEFAULT_DOMAIN_CHARS) });
    const result = checkPrdBudget({ raw_body: "short compliant body", outline: [entry] });
    expect(breachKinds(result)).not.toContain("tier");
  });
});

describe("checkPrdBudget: whole rendered body budget (=24000 invariant)", () => {
  it("flags a rendered body one char over the 24000-char whole-doc budget", () => {
    const result = checkPrdBudget({ raw_body: "c".repeat(SPEC_DEFAULT_WHOLE_DOC_CHARS + 1) });
    expect(result.consistent).toBe(false);
    const wholeDocBreach = result.breaches.find((b) => b.kind === "whole_doc");
    expect(wholeDocBreach).toBeDefined();
    expect(wholeDocBreach?.detail).toContain(String(SPEC_DEFAULT_WHOLE_DOC_CHARS));
  });

  it("does not flag a rendered body at exactly the 24000-char whole-doc budget", () => {
    const result = checkPrdBudget({ raw_body: "c".repeat(SPEC_DEFAULT_WHOLE_DOC_CHARS) });
    expect(result.consistent).toBe(true);
    expect(breachKinds(result)).not.toContain("whole_doc");
  });
});

// ─── checkPrdBudget — legacy PRD without extra.outline (Downstream Handoff, error scenario) ──

describe("checkPrdBudget: legacy PRD without extra.outline", () => {
  it("does not throw when outline is entirely absent", () => {
    expect(() => checkPrdBudget({ raw_body: "a legacy PRD body with no outline field at all" })).not.toThrow();
  });

  it("degrades to whole-doc budget only — a compliant legacy body is fully clean", () => {
    const result = checkPrdBudget({ raw_body: "a legacy PRD body with no outline field at all" });
    expect(result.consistent).toBe(true);
    expect(result.breaches).toEqual([]);
  });

  it("degrades to whole-doc budget only — an over-budget legacy body flags ONLY whole_doc, never tier", () => {
    const result = checkPrdBudget({ raw_body: "d".repeat(SPEC_DEFAULT_WHOLE_DOC_CHARS + 1) });
    expect(breachKinds(result)).toEqual(["whole_doc"]);
  });
});

// ─── checkPrdBudget — wires scanContentFlight into its own breaches (integration of the two documented exports) ──

describe("checkPrdBudget: wires the content-flight scan into its own result", () => {
  it("includes an extra_prose breach when input.extra carries a free-text string over the default 1000-char threshold", () => {
    const result = checkPrdBudget({
      raw_body: "short compliant body",
      extra: { migration_note: "x".repeat(SPEC_DEFAULT_EXTRA_PROSE_CHARS + 1) },
    });
    expect(result.consistent).toBe(false);
    expect(breachKinds(result)).toContain("extra_prose");
  });

  it("does not include an extra_prose breach when input.extra is entirely typed-schema content", () => {
    const result = checkPrdBudget({
      raw_body: "short compliant body",
      extra: { requirements: [{ id: "R-1", statement: "y".repeat(5000), priority: "P0" }] },
    });
    expect(breachKinds(result)).not.toContain("extra_prose");
  });
});

// ─── checkPrdBudget — budget values are READ from input, never hardcoded constants ──

describe("checkPrdBudget: custom corpus-governed budget overrides the spec default (anti-hardcoding)", () => {
  it("honours a caller-supplied whole_doc_chars smaller than the spec default", () => {
    // 50 chars is comfortably UNDER the spec default (24000) but OVER this custom budget (30).
    // A hardcoded-24000 implementation would wrongly report this as consistent.
    const customBudget: Partial<OutlineBudgetLike> = { whole_doc_chars: 30 };
    const result = checkPrdBudget({ raw_body: "e".repeat(50), budget: customBudget });
    expect(result.consistent).toBe(false);
    const wholeDocBreach = result.breaches.find((b) => b.kind === "whole_doc");
    expect(wholeDocBreach).toBeDefined();
    expect(wholeDocBreach?.detail).toContain("30");
    // Must NOT cite the spec default's 24000 as the breached budget.
    expect(wholeDocBreach?.detail).not.toContain(String(SPEC_DEFAULT_WHOLE_DOC_CHARS));
  });

  it("honours a caller-supplied core_chars smaller than the spec default", () => {
    // A hardcoded-4000 implementation would wrongly pass this 100-char entry as compliant.
    const entry = makeOutlineEntry({ tier: "core", direction: "f".repeat(51) });
    const customBudget: Partial<OutlineBudgetLike> = { core_chars: 50 };
    const result = checkPrdBudget({ raw_body: "short compliant body", outline: [entry], budget: customBudget });
    expect(result.consistent).toBe(false);
    expect(breachKinds(result)).toContain("tier");
  });
});
