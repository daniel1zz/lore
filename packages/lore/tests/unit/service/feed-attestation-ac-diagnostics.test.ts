/**
 * Tests for `feedAttestationFloor`'s per-claimed-AC diagnostics (checkpoint-registry.ts)
 * — spec-plan-close-predicates-measure-invariants-an-applicability §D5: the
 * attestation-floor feeding pack now names every unattested CLAIMED acceptance
 * criterion id, and prints a ratio-vs-floor line ONLY when `min_ratio` is explicitly
 * configured (never when it is unconfigured/disabled — naming a floor that is not
 * enforcing would misdirect an operator). When printed, that line MUST contain the
 * literal substring "attested ratio" (the exact string this suite's test names pin).
 *
 * This new diagnostic text is inserted BEFORE the byte-pinned
 * `Recovery: run \`lore verify …\`` sentence (`feed-attestation-reachability.test.ts`'s
 * own regression pin, updated in the SAME slice to match the new prefix while keeping
 * that sentence itself byte-identical) — see this suite's companion file for that
 * regression coverage; this file covers ONLY the new AC-diagnostics behavior.
 *
 * Constructed `GateContext` fixtures only — no store, no IO — hence vitest (mirrors
 * `feed-attestation-reachability.test.ts`'s own harness shape).
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / STATE.
 *
 * @spec_ref spec-plan-close-predicates-measure-invariants-an-applicability §D5,
 *   §Acceptance Criteria AC-PCI-9
 */

import { describe, it, expect } from "vitest";
import type { TaskAttestationInfo } from "@lore/core";
import {
  checkpointRegistry,
  selectFailures,
  type GateContext,
} from "../../../src/service/checkpoint-registry.js";

const planClose = checkpointRegistry["plan-close"];
if (planClose === undefined) {
  throw new Error("plan-close checkpoint not registered — test fixture assumption broken");
}

/** Forces `attestationFloor` to fail on its OWN per-task condition (condition 1),
 *  independent of the ratio/coverage conjuncts, so `feedAttestationFloor` always
 *  renders regardless of what this fixture's other fields configure. */
const FAILING_TASK: TaskAttestationInfo[] = [
  { slug: "task-1", title: "Task One", evidenceCount: 1, attestedCount: 0 },
];

function baseCtx(overrides: Partial<GateContext>): GateContext {
  return {
    targetIdOrSlug: "plan-x",
    planTasksAttestation: FAILING_TASK,
    ...overrides,
  };
}

const renderAttestationFloorFeed = (ctx: GateContext): string => {
  const failures = selectFailures(planClose.check(ctx));
  return planClose.feed(ctx, failures);
};

describe("feedAttestationFloor — per-claimed-AC diagnostics (AC-PCI-9)", () => {
  it("HAPPY: unattested naming — the feeding pack names an unattested claimed AC id", () => {
    const ctx = baseCtx({
      planClaimedAcCoverage: [
        {
          ac_id: "AC-UNATTESTED-1",
          mode: "script",
          pass: 1,
          fail: 0,
          refs: [{ task_id: "task-1", result: "pass" }],
          attested_pass: 0,
          attested_fail: 0,
        },
      ],
    });
    const text = renderAttestationFloorFeed(ctx);
    expect(text).toContain("AC-UNATTESTED-1");
    expect(text).toContain("Claimed acceptance criteria with zero runner-attested evidence");
  });

  it("BOUNDARY: unattested naming — multiple unattested claimed ACs are ALL named, and an attested claimed AC is never listed among them", () => {
    const ctx = baseCtx({
      planClaimedAcCoverage: [
        {
          ac_id: "AC-UNATTESTED-1",
          mode: "script",
          pass: 1,
          fail: 0,
          refs: [{ task_id: "task-1", result: "pass" }],
          attested_pass: 0,
          attested_fail: 0,
        },
        {
          ac_id: "AC-UNATTESTED-2",
          mode: "script",
          pass: 0,
          fail: 1,
          refs: [{ task_id: "task-1", result: "fail" }],
          attested_pass: 0,
          attested_fail: 0,
        },
        {
          ac_id: "AC-ATTESTED-1",
          mode: "script",
          pass: 1,
          fail: 0,
          refs: [{ task_id: "task-1", result: "pass", attested: true }],
          attested_pass: 1,
          attested_fail: 0,
        },
      ],
    });
    const text = renderAttestationFloorFeed(ctx);
    expect(text).toContain("AC-UNATTESTED-1");
    expect(text).toContain("AC-UNATTESTED-2");
    const unattestedLineMatch = text.match(
      /Claimed acceptance criteria with zero runner-attested evidence: ([^.]*)\./,
    );
    expect(unattestedLineMatch).not.toBeNull();
    expect(unattestedLineMatch?.[1] ?? "").not.toContain("AC-ATTESTED-1");
  });

  it("STATE: unattested naming — no diagnostic line at all when every claimed AC is attested", () => {
    const ctx = baseCtx({
      planClaimedAcCoverage: [
        {
          ac_id: "AC-ATTESTED-1",
          mode: "script",
          pass: 1,
          fail: 0,
          refs: [{ task_id: "task-1", result: "pass", attested: true }],
          attested_pass: 1,
          attested_fail: 0,
        },
      ],
    });
    const text = renderAttestationFloorFeed(ctx);
    expect(text).not.toContain("Claimed acceptance criteria with zero runner-attested evidence");
  });

  it("HAPPY: unattested naming — the ratio line prints the literal substring 'attested ratio' when min_ratio is explicitly configured", () => {
    const ctx = baseCtx({ attestationMinRatio: 0.5 });
    const text = renderAttestationFloorFeed(ctx);
    expect(text).toContain("attested ratio");
    expect(text).toContain(">= 0.5");
  });

  it("NEGATIVE: unattested naming — the ratio line (and the literal substring 'attested ratio') is ABSENT when min_ratio is unconfigured", () => {
    const ctx = baseCtx({}); // attestationMinRatio omitted entirely — unconfigured
    const text = renderAttestationFloorFeed(ctx);
    expect(text).not.toContain("attested ratio");
  });

  it("NEGATIVE: unattested naming — the ratio line is likewise absent when the caller explicitly resolved a null min_ratio", () => {
    const ctx = baseCtx({ attestationMinRatio: null });
    const text = renderAttestationFloorFeed(ctx);
    expect(text).not.toContain("attested ratio");
  });
});
