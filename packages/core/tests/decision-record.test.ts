import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_ORDER,
  GATE_EVIDENCE_S_TO_C,
  GATE_MEANING_UNCHANGED,
  decisionRecordSchema,
  hasStrongPremise,
  isConfidenceLowered,
  isStrongTier,
  isTrivialRulePatch,
  parseAlternativeFlag,
  parseDecisionSource,
  parseGateFlag,
  parsePremiseFlag,
  parseScoreFlag,
  parseWeightTableFlag,
} from "../src/decision-record.js";
import { knowledgeExtraSchema } from "../src/schemas.js";
import { milestoneReviewSchema } from "../src/milestone-review.js";

describe("AC-DR-3 trivial check and confidence order", () => {
  it("AC-DR-3 orders confidence established > observed > unconfirmed > undecided", () => {
    expect([...CONFIDENCE_ORDER]).toEqual(["established", "observed", "unconfirmed", "undecided"]);
    expect(isConfidenceLowered("established", "observed")).toBe(true);
    expect(isConfidenceLowered("observed", "undecided")).toBe(true);
    expect(isConfidenceLowered("undecided", "established")).toBe(false);
    expect(isConfidenceLowered("observed", "observed")).toBe(false);
  });

  it("AC-DR-3 trivial: examples alone", () => {
    expect(isTrivialRulePatch("observed", { examples: ["a"] })).toBe(true);
  });

  it("AC-DR-3 trivial: confidence alone moved lower", () => {
    expect(isTrivialRulePatch("established", { confidence: "observed" })).toBe(true);
  });

  it("AC-DR-3 not trivial: confidence raised, unchanged, or unknown", () => {
    expect(isTrivialRulePatch("observed", { confidence: "established" })).toBe(false);
    expect(isTrivialRulePatch("observed", { confidence: "observed" })).toBe(false);
    expect(isTrivialRulePatch("observed", { confidence: "bogus" })).toBe(false);
  });

  it("AC-DR-3 not trivial: statement, mixed keys, empty patch", () => {
    expect(isTrivialRulePatch("observed", { statement: "x" })).toBe(false);
    expect(isTrivialRulePatch("observed", { examples: ["a"], confidence: "undecided" })).toBe(false);
    expect(isTrivialRulePatch("observed", { examples: ["a"], statement: "x" })).toBe(false);
    expect(isTrivialRulePatch("observed", {})).toBe(false);
  });

  it("AC-DR-3 tier S..C detection", () => {
    for (const t of ["S", "A", "B", "C"]) expect(isStrongTier(t)).toBe(true);
    for (const t of ["D", "E", "s", "", "X"]) expect(isStrongTier(t)).toBe(false);
    const base = { reason: "r", alternatives: [{ option: "o", why_rejected: "w" }] };
    const issue = (tier: "S" | "D") => ({ claim: "c", tier, source: { kind: "issue" as const, number: 1 } });
    expect(hasStrongPremise({ ...base, premises: [issue("D"), issue("S")] })).toBe(true);
    expect(hasStrongPremise({ ...base, premises: [issue("D")] })).toBe(false);
    expect(hasStrongPremise({ ...base, premises: [] })).toBe(false);
  });

  it("AC-DR-3 source parser accepts the four kinds", () => {
    expect(parseDecisionSource("file:src/a.ts:10-12@abc1234")).toEqual({
      ok: true,
      source: { kind: "file", path: "src/a.ts", lines: [10, 12], sha: "abc1234" },
    });
    expect(parseDecisionSource("file:src/a.ts:7")).toEqual({
      ok: true,
      source: { kind: "file", path: "src/a.ts", lines: [7, 7] },
    });
    expect(parseDecisionSource("cmd:lore get x ~ approved")).toEqual({
      ok: true,
      source: { kind: "cmd", command: "lore get x", expect: "approved" },
    });
    expect(parseDecisionSource("issue:#473")).toEqual({ ok: true, source: { kind: "issue", number: 473 } });
    expect(parseDecisionSource("doc:spec-a@3")).toEqual({ ok: true, source: { kind: "doc", slug: "spec-a", version: 3 } });
    expect(parseDecisionSource("doc:spec-a")).toEqual({ ok: true, source: { kind: "doc", slug: "spec-a" } });
  });

  it("AC-DR-3 source parser rejects everything else", () => {
    for (const bad of [
      "",
      "http://x",
      "file:a.ts",
      "file:a.ts:0",
      "file:a.ts:5-3",
      "file:a.ts:1@zz",
      "cmd:ls",
      "cmd: ~ x",
      "cmd:ls ~ ",
      "issue:473",
      "issue:#0",
      "issue:#x",
      "doc:",
      "doc:a@0",
      "doc:a@x",
      "git:abc",
    ]) {
      expect(parseDecisionSource(bad).ok, bad).toBe(false);
    }
  });

  it("AC-DR-3 flag parsers split claim|source|tier and the other flags", () => {
    expect(parsePremiseFlag("limit is 60000|file:a.ts:5@abc1234|S")).toEqual({
      ok: true,
      premise: { claim: "limit is 60000", tier: "S", source: { kind: "file", path: "a.ts", lines: [5, 5], sha: "abc1234" } },
    });
    expect(parsePremiseFlag("c|cmd:a | b ~ x|B")).toMatchObject({ ok: true, premise: { source: { command: "a | b" } } });
    expect(parsePremiseFlag("c|issue:#1|Z").ok).toBe(false);
    expect(parsePremiseFlag("only").ok).toBe(false);
    expect(parseAlternativeFlag("opt|because")).toEqual({ ok: true, alternative: { option: "opt", why_rejected: "because" } });
    expect(parseAlternativeFlag("opt").ok).toBe(false);
    expect(parseGateFlag(`${GATE_MEANING_UNCHANGED}|pass|same words`)).toEqual({
      ok: true,
      gate: { id: GATE_MEANING_UNCHANGED, verdict: "pass", evidence: "same words", computed: false },
    });
    expect(parseGateFlag("g|maybe|e").ok).toBe(false);
    expect(parseScoreFlag("o|d|-1|e")).toEqual({ ok: true, score: { option: "o", dimension: "d", value: -1, evidence: "e" } });
    expect(parseScoreFlag("o|d|2|e").ok).toBe(false);
    expect(parseWeightTableFlag("w-slug@4")).toEqual({ ok: true, weightTable: { slug: "w-slug", version: 4 } });
    expect(parseWeightTableFlag("w-slug").ok).toBe(false);
    expect(GATE_EVIDENCE_S_TO_C).toBe("evidence-s-to-c");
  });

  it("AC-DR-3 record schema requires reason and premises shape; extra schemas accept the new keys", () => {
    const ok = {
      reason: "r",
      premises: [{ claim: "c", tier: "A", source: { kind: "doc", slug: "s" } }],
      alternatives: [{ option: "o", why_rejected: "w" }],
    };
    expect(decisionRecordSchema.safeParse(ok).success).toBe(true);
    expect(decisionRecordSchema.safeParse({ ...ok, reason: "" }).success).toBe(false);
    expect(decisionRecordSchema.safeParse({ ...ok, scores: [{ option: "o", dimension: "d", value: 2, evidence: "e" }] }).success).toBe(false);
    const wt = { kind: "rule revision", dimensions: { a: 0.5, b: 0.5 } };
    expect(knowledgeExtraSchema.safeParse({ sub_type: "reference", weight_table: wt }).success).toBe(true);
    expect(knowledgeExtraSchema.safeParse({ sub_type: "reference", weight_table: { ...wt, dimensions: { a: 0.5, b: 0.4 } } }).success).toBe(false);
    expect(knowledgeExtraSchema.safeParse({ sub_type: "reference", weight_table: { ...wt, dimensions: { a: 1, b: 0 } } }).success).toBe(false);
    expect(milestoneReviewSchema.shape.decision_findings).toBeDefined();
    expect(milestoneReviewSchema.shape.traced_decisions).toBeDefined();
  });
});
