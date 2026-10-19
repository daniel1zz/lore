/**
 * BL-D4 (baseline-close-a-plan BR-225) — closing a plan with NO linked assessment must say so,
 * explicitly, instead of passing the assessment-freshness condition silently.
 *
 * Decision (from the existing rule BR-225, which says "having no assessment ... is not checked"):
 * the close is NOT refused (a plan never needs an assessment to close); the close prints the line
 *   `assessment freshness not applicable: no assessment linked`
 * on the gate's warning channel and the verdict stays `ok`. A measured freshness check, an
 * exempted one, and an activity-less one each say something different (or nothing, when measured).
 *
 * Pure: `GateEnforcer.enforce` with a collecting `WarnSink`; no store, no IO.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / STATE / REGRESSION. Every `it()` title carries `D4-n`.
 */
import { describe, it, expect } from "vitest";
import type { AcCoverageFact, DeclaredScopeCoverage, TaskAttestationInfo } from "@lore/core";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import type { GateContext } from "../../../src/service/checkpoint-registry.js";

const NO_ASSESSMENT_LINE = "assessment freshness not applicable: no assessment linked";
const NO_ACTIVITY_LINE = "assessment freshness not applicable: no task evidence or completion since the assessment";

const TASK: TaskAttestationInfo = { slug: "task-a", title: "A", evidenceCount: 1, attestedCount: 1 };
const COVERAGE: readonly AcCoverageFact[] = [
  {
    ac_id: "AC-1",
    mode: "script",
    pass: 1,
    fail: 0,
    refs: [{ task_id: "task-a", result: "pass", attested: true }],
    attested_pass: 1,
    attested_fail: 0,
    falsified: 0,
  },
];
const SCOPE: DeclaredScopeCoverage = {
  declared_acs: ["AC-1"],
  unattested_acs: [],
  scope_undeclared: false,
  meets_coverage: true,
};

/** A plan whose OTHER conjuncts measure (so the all-inapplicable notice never fires): isolates the freshness line. */
function ctx(overrides: Partial<GateContext>): GateContext {
  return {
    targetIdOrSlug: "plan-x",
    planTasksAttestation: [TASK],
    attestationMinRatio: null,
    planClaimedAcCoverage: COVERAGE,
    planDeclaredScopeCoverage: SCOPE,
    ...overrides,
  };
}

function enforceCollecting(c: GateContext): { result: ReturnType<GateEnforcer["enforce"]>; lines: string[] } {
  const lines: string[] = [];
  const enforcer = new GateEnforcer(undefined, undefined, undefined, undefined, {}, (line) => lines.push(line));
  return { result: enforcer.enforce("plan-close", c), lines };
}

describe("plan-close reports assessment freshness as not applicable (D4)", () => {
  it("D4-1 HAPPY: no linked assessment closes ok AND prints the explicit not-applicable line", () => {
    const { result, lines } = enforceCollecting(ctx({ newestTaskActivityAt: "2026-10-01T00:00:00.000Z" }));
    expect(result).toEqual({ ok: true, value: undefined });
    expect(lines).toContain(NO_ASSESSMENT_LINE);
  });

  it("D4-2 BOUNDARY: assessment linked but no task activity prints the distinct no-activity line", () => {
    const { result, lines } = enforceCollecting(ctx({ newestAssessmentAt: "2026-10-01T00:00:00.000Z" }));
    expect(result).toEqual({ ok: true, value: undefined });
    expect(lines).toContain(NO_ACTIVITY_LINE);
    expect(lines).not.toContain(NO_ASSESSMENT_LINE);
  });

  it("D4-3 NEGATIVE: a measured (fresh) freshness check prints neither line", () => {
    const { result, lines } = enforceCollecting(
      ctx({ newestAssessmentAt: "2026-10-02T00:00:00.000Z", newestTaskActivityAt: "2026-10-01T00:00:00.000Z" }),
    );
    expect(result).toEqual({ ok: true, value: undefined });
    expect(lines.filter((l) => l.startsWith("assessment freshness not applicable"))).toEqual([]);
  });

  it("D4-4 STATE: an exempted plan prints no not-applicable line (the exemption is its own notice)", () => {
    const { lines } = enforceCollecting(ctx({ assessmentFreshnessExempt: true }));
    expect(lines.filter((l) => l.startsWith("assessment freshness not applicable"))).toEqual([]);
  });

  it("D4-5 REGRESSION: a stale assessment still denies and prints no not-applicable line", () => {
    const { result, lines } = enforceCollecting(
      ctx({ newestAssessmentAt: "2026-10-01T00:00:00.000Z", newestTaskActivityAt: "2026-10-02T00:00:00.000Z" }),
    );
    expect(result.ok).toBe(false);
    expect(lines.filter((l) => l.startsWith("assessment freshness not applicable"))).toEqual([]);
  });

  it("D4-6 STATE: other checkpoints never print the plan-close line", () => {
    const lines: string[] = [];
    const enforcer = new GateEnforcer(undefined, undefined, undefined, undefined, {}, (l) => lines.push(l));
    enforcer.enforce("task-claim", { hasSpecParent: false });
    expect(lines).toEqual([]);
  });
});
