/**
 * @spec_ref spec-plans-close-themselves-level-triggered-reconciliation-of (BR-1379)
 *
 * #500: a snapshot_accuracy failure built from a wrong-when-written decision finding carries structured cites
 * (decision address, part, premise source path), so --file-issues fingerprints it; a pure judge-text failure stays refused.
 * Dimensions: HAPPY, NEGATIVE, BOUNDARY, ERROR, REGRESSION.
 */
import { describe, it, expect } from "vitest";
import type { DecisionFinding } from "@lore/core";
import { decisionFindingCites, withDecisionFindingCites } from "../../../src/service/decision-finding-cites.js";
import { rootCauseOf } from "../../../src/service/root-cause-fingerprint.js";

const sha = "bba93a16";
const wrong = (fact: string, decision = "decision-x@2", part = "premise 1"): DecisionFinding => ({ decision, part, kind: "wrong-when-written", fact });
// the three wrong-when-written fact shapes decision-recheck.ts checkFileSource emits
const QUOTE = wrong(`packages/a/t.bun.test.ts:254-275@${sha} read "x" when written, the premise quotes "y"`);
const ABSENT = wrong(`packages/a/t.bun.test.ts does not exist at ${sha}`);
const SHORT = wrong(`packages/a/t.bun.test.ts has 10 lines at ${sha}, the premise cites 254-275`);

const dims = (snapshot: Record<string, unknown>) => ({ snapshot_accuracy: snapshot }) as never;
const failed = { verdict: "fail", reason: "recorded decision wrong when written: ...", reference: "Bazel action cache" };

function snapshotFinding(cites: readonly string[] | undefined) {
  return { plan: "p", dimension: "snapshot_accuracy", reason: failed.reason, reference: "", reviewSlug: "r", ...(cites !== undefined ? { cites } : {}) } as const;
}

describe("decision finding cites (#500)", () => {
  it("HAPPY: each wrong-when-written fact shape yields decision, decision+part and the premise source path", () => {
    for (const f of [QUOTE, ABSENT, SHORT]) {
      expect(decisionFindingCites([f])).toEqual(["decision-x@2", "decision-x@2 premise 1", "packages/a/t.bun.test.ts"]);
    }
  });

  it("HAPPY: the failed snapshot_accuracy gets the cites and the filing fingerprints it, same across rewording", () => {
    const out = withDecisionFindingCites(dims(failed), [QUOTE]) as unknown as { snapshot_accuracy: { cites: string[] } };
    const one = rootCauseOf(snapshotFinding(out.snapshot_accuracy.cites));
    const two = rootCauseOf({ ...snapshotFinding(out.snapshot_accuracy.cites), reason: "other wording" });
    expect(one.ok && two.ok && one.value.fingerprint === two.value.fingerprint).toBe(true);
  });

  it("NEGATIVE: another decision, part or source is another fingerprint", () => {
    const fp = (f: DecisionFinding) => {
      const r = rootCauseOf(snapshotFinding(decisionFindingCites([f])));
      if (!r.ok) throw new Error("expected ok");
      return r.value.fingerprint;
    };
    expect(fp(wrong(QUOTE.fact, "decision-y@1"))).not.toBe(fp(QUOTE));
    expect(fp(wrong(QUOTE.fact, "decision-x@2", "premise 2"))).not.toBe(fp(QUOTE));
    expect(fp(wrong(QUOTE.fact.replace("t.bun", "u.bun")))).not.toBe(fp(QUOTE));
  });

  it("BOUNDARY: findings of other kinds add no cite and leave the dimension untouched", () => {
    const stale: DecisionFinding = { decision: "d@1", part: "premise 1", kind: "stale-since", fact: "x" };
    expect(decisionFindingCites([stale])).toEqual([]);
    const d = dims(failed);
    expect(withDecisionFindingCites(d, [stale])).toBe(d);
  });

  it("BOUNDARY: a fact with no parseable path still cites decision and part", () => {
    expect(decisionFindingCites([wrong("garbled")])).toEqual(["decision-x@2", "decision-x@2 premise 1"]);
  });

  it("ERROR: a pure judge-text snapshot_accuracy failure with no cite is still refused", () => {
    const r = rootCauseOf(snapshotFinding(undefined));
    expect(!r.ok && r.error).toMatchObject({ code: "VALIDATION_ERROR", field: "cites" });
  });

  it("REGRESSION: a snapshot_accuracy that did not fail is not given cites", () => {
    const d = dims({ verdict: "pass", reason: "ok", reference: "" });
    expect(withDecisionFindingCites(d, [QUOTE])).toBe(d);
  });
});
