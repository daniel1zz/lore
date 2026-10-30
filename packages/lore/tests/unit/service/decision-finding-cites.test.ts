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
const FILE_SOURCE: DecisionFinding["source"] = { kind: "file", path: "packages/a/t.bun.test.ts", lines: [254, 275], sha };
const wrong = (fact: string, decision = "decision-x@2", part = "premise 1", source: DecisionFinding["source"] = FILE_SOURCE): DecisionFinding => ({
  decision,
  part,
  kind: "wrong-when-written",
  fact,
  ...(source !== undefined ? { source } : {}),
});
const QUOTE = wrong("any wording");

const dims = (snapshot: Record<string, unknown>) => ({ snapshot_accuracy: snapshot }) as never;
const failed = { verdict: "fail", reason: "recorded decision wrong when written: ...", reference: "Bazel action cache" };

function snapshotFinding(cites: readonly string[] | undefined) {
  return { plan: "p", dimension: "snapshot_accuracy", reason: failed.reason, reference: "", reviewSlug: "r", ...(cites !== undefined ? { cites } : {}) } as const;
}

describe("decision finding cites (#500)", () => {
  it("HAPPY: a wrong-when-written finding with a file source yields decision, decision+part and the premise source path", () => {
    expect(decisionFindingCites([QUOTE])).toEqual(["decision-x@2", "decision-x@2 premise 1", "packages/a/t.bun.test.ts"]);
  });

  it("HAPPY: non-file sources cite their structured address (command, issue number, document slug@version)", () => {
    expect(decisionFindingCites([wrong("w", "d@1", "premise 1", { kind: "cmd", command: "grep -n X f.ts" })])).toContain("grep -n X f.ts");
    expect(decisionFindingCites([wrong("w", "d@1", "premise 1", { kind: "issue", number: 7 })])).toContain("#7");
    expect(decisionFindingCites([wrong("w", "d@1", "premise 1", { kind: "doc", slug: "spec-y", version: 3 })])).toContain("spec-y@3");
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
    expect(fp(wrong(QUOTE.fact, "decision-x@2", "premise 1", { kind: "file", path: "packages/a/u.bun.test.ts" }))).not.toBe(fp(QUOTE));
  });

  it("BOUNDARY: findings of other kinds add no cite and leave the dimension untouched", () => {
    const stale: DecisionFinding = { decision: "d@1", part: "premise 1", kind: "stale-since", fact: "x" };
    expect(decisionFindingCites([stale])).toEqual([]);
    const d = dims(failed);
    expect(withDecisionFindingCites(d, [stale])).toBe(d);
  });

  it("STATE: the source cite comes from the structured field, never from the fact text", () => {
    const f = wrong("other/path.ts does not exist at abc123 (a file the wording names but the source does not)");
    expect(decisionFindingCites([f])).not.toContain("other/path.ts");
    expect(decisionFindingCites([f])).toContain("packages/a/t.bun.test.ts");
    // no structured source: only decision and part, whatever the wording says
    expect(decisionFindingCites([{ decision: "decision-x@2", part: "premise 1", kind: "wrong-when-written", fact: "a.ts does not exist at abc" }])).toEqual(["decision-x@2", "decision-x@2 premise 1"]);
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
