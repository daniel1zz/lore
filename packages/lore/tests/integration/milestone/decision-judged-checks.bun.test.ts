/**
 * @spec_ref spec-a-decision-carrying-write-records-its-decision-on-its
 * @ac_ref AC-DR-8
 *
 * Milestone judged checks of recorded decisions: the judge input carries a decisions section (premise quotes,
 * alternatives, old and new rule statement), a stub judge's three kinds of objection become findings naming
 * `<slug>@<version>`, and after a direct statement change every criterion citing the rule is re-run, a failing one
 * being a finding.
 *
 * Coverage: HAPPY (supported answer, passing re-run: no finding) / NEGATIVE (a decision without `before` re-runs
 * nothing) / BOUNDARY (a criterion that cites another rule is not re-run) / ERROR (a judge that leaves a decision
 * unanswered fails after one retry; a re-run that cannot run is unverifiable) / STATE (three objection kinds) /
 * REGRESSION (the seven-dimension answer is unchanged by the decisions answer).
 */

import { describe, expect, it } from "vitest";
import {
  DOC_TYPE_ROLE_MAP,
  MILESTONE_DIMENSIONS,
  err,
  ok,
  type DecisionRecord,
  type DocId,
  type DocRecord,
  type MilestoneReview,
  type PlanBundle,
} from "@lore/core";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { buildJudgedDecisionInputs, type CriterionRerunPort } from "../../../src/service/decision-recheck.js";
import { MilestoneReviewService } from "../../../src/service/milestone-review-service.js";

const STAMP = "2026-10-01T00:00:00.000Z";
let counter = 0;

function doc(type: DocRecord["type"], label: string, extra: Record<string, unknown> = {}, status: DocRecord["status"] = "draft"): DocRecord {
  counter += 1;
  return {
    id: `01HJUDGED${String(counter).padStart(17, "0")}` as DocId,
    slug: `${type}-judged-${label}`,
    type,
    role: DOC_TYPE_ROLE_MAP[type],
    title: `${type} ${label}`,
    status,
    priority: "medium",
    content: label,
    parent_id: null,
    extra,
    tags: [],
    version: 1,
    created_at: STAMP,
    updated_at: STAMP,
    created_by: "agent:test",
    deleted_at: null,
    ordinal: null,
  } as DocRecord;
}

const rule = (statement: string) => ({ id: "BR-9001", statement, confidence: "high", enforced_by: "both", examples: ["e"], lifecycle: "live" });

const decision = (extra: Partial<DecisionRecord> = {}): DecisionRecord => ({
  reason: "the old wording let a stale cache through",
  premises: [{ claim: "the limit is 180000", tier: "S", source: { kind: "file", path: "registry.ts", lines: [59, 59], sha: "abc123", quote: "const LIMIT = 180000;" } }],
  alternatives: [{ option: "keep the old wording", why_rejected: "it is ambiguous" }],
  ...extra,
});

interface World {
  readonly store: InMemoryStore;
  readonly bundle: PlanBundle;
  readonly leaf: DocRecord;
}

/** A plan whose spec adds a rule to a leaf; the leaf has a version-2 write recording `recorded`. */
async function world(recorded: DecisionRecord, opts: { citedRule?: string; extraCriterionCites?: string } = {}): Promise<World> {
  const store = new InMemoryStore();
  const leaf = await store.insert(doc("baseline", "leaf", { node: "leaf", rules: [rule("new statement")] }));
  if (!leaf.ok) throw new Error(JSON.stringify(leaf.error));
  const spec = await store.insert(
    doc("spec", "s", {
      rule_changes: [{ op: "add", id: "BR-9001", leaf: leaf.value.slug, statement: "s", examples: ["e"], enforced_by: "both" }],
      acceptance_criteria: [
        { id: "AC-CITES", cites: [opts.citedRule ?? "BR-9001"] },
        { id: "AC-OTHER", cites: [opts.extraCriterionCites ?? "BR-7777"] },
      ],
    }),
  );
  if (!spec.ok) throw new Error(JSON.stringify(spec.error));
  const planDoc = await store.insert(doc("plan", "p"));
  if (!planDoc.ok) throw new Error(JSON.stringify(planDoc.error));
  for (const [version, statement, withDecision] of [[1, "old statement", false], [2, "new statement", true]] as const) {
    const written = await store.insertVersion({
      doc_id: leaf.value.id,
      version,
      content: leaf.value.content,
      extra: { ...leaf.value.extra, rules: [rule(statement)] },
      status: "draft",
      title: leaf.value.title,
      action: "update",
      created_at: `2026-10-0${version}T00:00:00.000Z`,
      created_by: "agent:test",
      slug: leaf.value.slug,
      ...(withDecision ? { decision: recorded } : {}),
    });
    if (!written.ok) throw new Error(JSON.stringify(written.error));
  }
  return { store, bundle: { plan: planDoc.value, spec: spec.value, tasks: [] } as unknown as PlanBundle, leaf: leaf.value };
}

const DIMS = Object.fromEntries(MILESTONE_DIMENSIONS.map((d) => [d, { verdict: "pass", reason: `${d} holds`, reference: "Google engineering code review guide" }]));
const answer = (decisions?: unknown): string => JSON.stringify({ dimensions: DIMS, ...(decisions !== undefined ? { decisions } : {}) });

interface Harness {
  readonly service: MilestoneReviewService;
  readonly provider: InMemoryAIProvider;
  readonly stored: MilestoneReview[];
}

function harnessOf(w: World, judged: string[]): Harness {
  const provider = new InMemoryAIProvider("stub-judge", { kind: "sequence", responses: judged.map((content) => ({ kind: "ok" as const, content })) });
  const stored: MilestoneReview[] = [];
  const service = new MilestoneReviewService({
    getPlanBundle: async () => ok(w.bundle),
    getCitedRuleStates: async () => ok([]),
    listDecisionLog: async () => ok([]),
    judge: async (prompt, title) => {
      const out = await provider.generate({ prompt, doc_type: "knowledge", title });
      return out.ok ? ok(out.value.content) : out;
    },
    createReviewDoc: async (input) => {
      stored.push((input.extra as { milestone_review: MilestoneReview }).milestone_review);
      return ok({ id: "R1", slug: "review-1" } as unknown as DocRecord);
    },
    link: async () => ok(undefined),
    judgedDecisionInputs: (bundle) => buildJudgedDecisionInputs({ store: w.store }, bundle),
  });
  return { service, provider, stored };
}

const ADDRESS = (w: World) => `${w.leaf.slug}@2`;
const BASE = { diffSource: "none", maxDiffChars: 1000 };

describe("AC-DR-8 the judge input", () => {
  it("AC-DR-8 holds each premise's quote, the alternatives, and the old and new statement of a rule rewording", async () => {
    const w = await world(decision({ before: "old statement" }));
    const h = harnessOf(w, [answer([{ decision: ADDRESS(w), premises_supported: [true], meaning_unchanged: true }])]);
    const reviewed = await h.service.review("plan", BASE);
    expect(reviewed.ok).toBe(true);
    const prompt = h.provider.calls[0]?.prompt ?? "";
    const section = prompt.slice(prompt.indexOf("# Recorded decisions"));
    expect(section).toContain(ADDRESS(w));
    expect(section).toContain("const LIMIT = 180000;");
    expect(section).toContain("keep the old wording");
    expect(section).toContain("old statement");
    expect(section).toContain("new statement");
    expect(section).toContain("BR-9001");
  });

  it("AC-DR-8 a plan with no recorded decision says so and asks for no decisions answer", async () => {
    const w = await world(decision());
    const empty = new InMemoryStore();
    const h = harnessOf({ ...w, store: empty }, [answer()]);
    expect((await h.service.review("plan", BASE)).ok).toBe(true);
    const prompt = h.provider.calls[0]?.prompt ?? "";
    expect(prompt.slice(prompt.indexOf("# Recorded decisions"))).toContain("None.");
    expect(h.stored[0]?.decision_findings).toBeUndefined();
  });
});

describe("AC-DR-8 judged findings", () => {
  it("AC-DR-8 a supported premise with the meaning unchanged is no finding", async () => {
    const w = await world(decision({ before: "old statement" }));
    const h = harnessOf(w, [answer([{ decision: ADDRESS(w), premises_supported: [true], meaning_unchanged: true }])]);
    expect((await h.service.review("plan", BASE)).ok).toBe(true);
    expect(h.stored[0]?.decision_findings).toBeUndefined();
  });

  it("AC-DR-8 a premise the judge says its quote does not support is a finding naming slug@version", async () => {
    const w = await world(decision());
    const h = harnessOf(w, [answer([{ decision: ADDRESS(w), premises_supported: [false], meaning_unchanged: true, reason: "the quote is about something else" }])]);
    expect((await h.service.review("plan", BASE)).ok).toBe(true);
    expect(h.stored[0]?.decision_findings).toEqual([
      expect.objectContaining({ decision: ADDRESS(w), part: "premise 1", kind: "premise-not-supported", fact: expect.stringContaining("something else") }),
    ]);
  });

  it("AC-DR-8 a rewording the judge says changed the rule's meaning is a finding naming slug@version", async () => {
    const w = await world(decision({ before: "old statement" }));
    const h = harnessOf(w, [answer([{ decision: ADDRESS(w), premises_supported: [true], meaning_unchanged: false, reason: "now allows what it forbade" }])]);
    expect((await h.service.review("plan", BASE)).ok).toBe(true);
    expect(h.stored[0]?.decision_findings).toEqual([
      expect.objectContaining({ decision: ADDRESS(w), part: "rule BR-9001", kind: "meaning-changed", fact: expect.stringContaining("now allows") }),
    ]);
  });

  it("AC-DR-8 a better option the judge names is a finding naming slug@version", async () => {
    const w = await world(decision());
    const h = harnessOf(w, [answer([{ decision: ADDRESS(w), premises_supported: [true], meaning_unchanged: true, better_option: "split the rule in two" }])]);
    expect((await h.service.review("plan", BASE)).ok).toBe(true);
    expect(h.stored[0]?.decision_findings).toEqual([
      expect.objectContaining({ decision: ADDRESS(w), part: "alternatives", kind: "better-option", fact: expect.stringContaining("split the rule in two") }),
    ]);
  });

  it("AC-DR-8 these findings list on the review and leave the seven dimensions as the judge gave them", async () => {
    const w = await world(decision());
    const h = harnessOf(w, [answer([{ decision: ADDRESS(w), premises_supported: [false], meaning_unchanged: true }])]);
    expect((await h.service.review("plan", BASE)).ok).toBe(true);
    expect(h.stored[0]?.overall).toBe("pass");
    expect(h.stored[0]?.dimensions.snapshot_accuracy.verdict).toBe("pass");
  });

  it("AC-DR-8 a judge that leaves a recorded decision unanswered is retried once, then the review fails and stores nothing", async () => {
    const w = await world(decision());
    const h = harnessOf(w, [answer(), answer([{ decision: "someone-else@9", premises_supported: [true], meaning_unchanged: true }])]);
    const reviewed = await h.service.review("plan", BASE);
    expect(reviewed.ok).toBe(false);
    expect(h.provider.calls).toHaveLength(2);
    expect(h.provider.calls[1]?.prompt).toContain(ADDRESS(w));
    expect(h.stored).toEqual([]);
  });

  it("AC-DR-8 a retry that answers the decisions is accepted", async () => {
    const w = await world(decision());
    const h = harnessOf(w, [answer(), answer([{ decision: ADDRESS(w), premises_supported: [true], meaning_unchanged: true }])]);
    expect((await h.service.review("plan", BASE)).ok).toBe(true);
  });
});

describe("AC-DR-8 re-run after a direct statement change", () => {
  const supported = (w: World) => answer([{ decision: ADDRESS(w), premises_supported: [true], meaning_unchanged: true }]);
  const portOf = (outcome: (ac: string) => ReturnType<CriterionRerunPort["rerun"]>): { port: CriterionRerunPort; ran: string[] } => {
    const ran: string[] = [];
    return { ran, port: { rerun: async (spec, ac) => (ran.push(`${spec.slug}#${ac}`), outcome(ac)) } };
  };

  it("AC-DR-8 a citing criterion that now fails when re-run is a finding naming the rule, the criterion and the decision", async () => {
    const w = await world(decision({ before: "old statement" }));
    const h = harnessOf(w, [supported(w)]);
    const { port, ran } = portOf(async () => ok({ passed: false, detail: "expected 2 got 3" }));
    expect((await h.service.review("plan", { ...BASE, rerunCriterion: port })).ok).toBe(true);
    expect(ran).toEqual(["spec-judged-s#AC-CITES"]);
    expect(h.stored[0]?.decision_findings).toEqual([
      expect.objectContaining({ decision: ADDRESS(w), part: "rule BR-9001 / AC-CITES", kind: "criterion-fails", fact: expect.stringContaining("expected 2 got 3") }),
    ]);
  });

  it("AC-DR-8 a citing criterion that still passes is no finding", async () => {
    const w = await world(decision({ before: "old statement" }));
    const h = harnessOf(w, [supported(w)]);
    const { port, ran } = portOf(async () => ok({ passed: true, detail: "" }));
    expect((await h.service.review("plan", { ...BASE, rerunCriterion: port })).ok).toBe(true);
    expect(ran).toHaveLength(1);
    expect(h.stored[0]?.decision_findings).toBeUndefined();
  });

  it("AC-DR-8 a decision with no `before` (no statement change) re-runs nothing", async () => {
    const w = await world(decision());
    const h = harnessOf(w, [supported(w)]);
    const { port, ran } = portOf(async () => ok({ passed: false, detail: "x" }));
    expect((await h.service.review("plan", { ...BASE, rerunCriterion: port })).ok).toBe(true);
    expect(ran).toEqual([]);
    expect(h.stored[0]?.decision_findings).toBeUndefined();
  });

  it("AC-DR-8 a re-run that cannot run is unverifiable, not a failing criterion", async () => {
    const w = await world(decision({ before: "old statement" }));
    const h = harnessOf(w, [supported(w)]);
    const { port } = portOf(async () => err({ code: "STORE_ERROR", message: "no worktree" }));
    expect((await h.service.review("plan", { ...BASE, rerunCriterion: port })).ok).toBe(true);
    expect(h.stored[0]?.decision_findings).toEqual([expect.objectContaining({ decision: ADDRESS(w), kind: "unverifiable", fact: expect.stringContaining("no worktree") })]);
  });

  it("AC-DR-8 without a re-run port the re-run is skipped and says nothing false", async () => {
    const w = await world(decision({ before: "old statement" }));
    const h = harnessOf(w, [supported(w)]);
    expect((await h.service.review("plan", BASE)).ok).toBe(true);
    expect(h.stored[0]?.decision_findings).toBeUndefined();
  });
});
