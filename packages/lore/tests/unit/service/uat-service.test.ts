/**
 * Tests for SPEC-054 UAT-verdict-as-plan-close-gate service wiring: UatService.record
 * (sole writer), the CorpusService writer-identity guard on sub_type "uat", the
 * `plan-close` gate through GateEnforcer on a plan's → archived transition, and
 * getLatestUatVerdict round-trip fidelity.
 *
 * Deterministic, zero-LLM — no AI provider anywhere on this path.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * Source: SPEC-054 §Acceptance Criteria AC-054-4..AC-054-8.
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { UatService } from "../../../src/service/uat-service.js";
import type { CreateDocInput, DocRecord, LoreConfig, UatVerdict } from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ACCEPT_VERDICT: UatVerdict = {
  verdict: "accept",
  tier_results: [{ tier: "P0", accepted: 5, rejected: 0, unverified: 0 }],
  requirement_coverage: { total: 5, covered: 5, uncovered_p0: [] },
  uiux: { blocker_count: 0, min_dimension_score: 4 },
  run_meta: { at: "2026-07-18T00:00:00.000Z", by: "agent:uat" },
};

const REJECT_VERDICT: UatVerdict = {
  ...ACCEPT_VERDICT,
  verdict: "reject",
  requirement_coverage: { total: 5, covered: 4, uncovered_p0: ["R-3"] },
};

function makeHarness(config?: LoreConfig) {
  const store = new InMemoryStore();
  const enforcer = new GateEnforcer(config);
  const corpusService = new CorpusService(store, undefined, undefined, enforcer);
  const uatService = new UatService({
    createUatDoc: corpusService.createUatDoc.bind(corpusService),
    resolveDocId: corpusService.resolve.bind(corpusService),
    addLink: store.addLink.bind(store),
    now: () => "2026-07-18T00:00:00.000Z",
  });
  return { store, corpusService, uatService };
}

async function makePlan(cs: CorpusService, extra: Record<string, unknown> = {}): Promise<DocRecord> {
  const input: CreateDocInput = {
    type: "plan",
    title: "Test plan",
    content: "## Plan\n\nbody",
    extra,
  };
  const r = await cs.create(input);
  if (!r.ok) throw new Error(`plan create failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** Walk a plan draft → approved → active (each a valid transition), so → archived is legal. */
async function walkToActive(cs: CorpusService, plan: DocRecord): Promise<void> {
  for (const status of ["approved", "active"] as const) {
    const r = await cs.set(plan.id, { status });
    if (!r.ok) throw new Error(`transition to ${status} failed: ${JSON.stringify(r.error)}`);
  }
}

// ─── AC-054-5: writer-identity guard ─────────────────────────────────────────

describe("SPEC-054 AC-054-5 — direct create of sub_type 'uat' is rejected", () => {
  it("NEGATIVE: CorpusService.create with sub_type 'uat' returns VALIDATION_ERROR naming lore uat record", async () => {
    const { corpusService } = makeHarness();
    const result = await corpusService.create({
      type: "knowledge",
      title: "forged uat",
      content: "x",
      extra: { sub_type: "uat", uat: ACCEPT_VERDICT },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect("message" in result.error && result.error.message).toContain("lore uat record");
  });
});

// ─── AC-054-4 + AC-054-8: record creates doc + informs link + round-trip ─────

describe("SPEC-054 AC-054-4/8 — UatService.record + getLatestUatVerdict", () => {
  it("HAPPY: record creates one knowledge/uat doc AND an informs link to the plan", async () => {
    const { store, corpusService, uatService } = makeHarness();
    const plan = await makePlan(corpusService);

    const rec = await uatService.record(plan.id, ACCEPT_VERDICT, { by: "agent:uat" });
    expect(rec.ok).toBe(true);
    if (!rec.ok) return;

    const doc = await store.find(rec.value.doc.id);
    expect(doc.ok && doc.value?.type).toBe("knowledge");
    expect(doc.ok && (doc.value?.extra as Record<string, unknown>)["sub_type"]).toBe("uat");

    // informs link from the verdict doc → plan
    const links = await store.findLinks(plan.id, "in");
    expect(links.ok).toBe(true);
    if (!links.ok) return;
    const informs = links.value.filter((l) => l.link_type === "informs" && l.from_id === rec.value.doc.id);
    expect(informs).toHaveLength(1);
  });

  it("STATE/round-trip: getLatestUatVerdict returns the persisted payload equal to what was written", async () => {
    const { corpusService, uatService } = makeHarness();
    const plan = await makePlan(corpusService);
    await uatService.record(plan.id, ACCEPT_VERDICT, { by: "agent:uat" });

    const latest = await corpusService.getLatestUatVerdict(plan.id);
    expect(latest.ok).toBe(true);
    if (!latest.ok) return;
    expect(latest.value.present).toBe(true);
    expect(latest.value.p0Accepted).toBe(true);
    expect(latest.value.verdict).toEqual(ACCEPT_VERDICT);
  });

  it("BOUNDARY: no linked verdict → present:false, p0Accepted:false (a fact, not an error)", async () => {
    const { corpusService } = makeHarness();
    const plan = await makePlan(corpusService);
    const latest = await corpusService.getLatestUatVerdict(plan.id);
    expect(latest.ok).toBe(true);
    if (!latest.ok) return;
    expect(latest.value.present).toBe(false);
    expect(latest.value.p0Accepted).toBe(false);
  });

  it("ERROR: an invalid payload is rejected loud", async () => {
    const { corpusService, uatService } = makeHarness();
    const plan = await makePlan(corpusService);
    const rec = await uatService.record(plan.id, { verdict: "bogus" }, { by: "agent:uat" });
    expect(rec.ok).toBe(false);
  });
});

// ─── AC-054-6 + AC-054-7: plan-close gate branches + feeding pack ────────────

describe("SPEC-054 AC-054-6/7 — plan-close gate", () => {
  it("NEGATIVE: requires_uat plan with NO verdict → archive blocked (gate:plan-close), pack names lore uat record", async () => {
    const { corpusService } = makeHarness();
    const plan = await makePlan(corpusService, { requires_uat: true });
    await walkToActive(corpusService, plan);

    const archived = await corpusService.set(plan.id, { status: "archived" });
    expect(archived.ok).toBe(false);
    if (archived.ok) return;
    expect(archived.error.code).toBe("VALIDATION_ERROR");
    expect("field" in archived.error && archived.error.field).toBe("gate:plan-close:uat");
    // AC-054-7: recovery command named in the feeding pack
    expect("message" in archived.error && archived.error.message).toContain("lore uat record");
  });

  it("NEGATIVE: requires_uat plan with a P0-REJECT verdict → archive blocked", async () => {
    const { corpusService, uatService } = makeHarness();
    const plan = await makePlan(corpusService, { requires_uat: true });
    await uatService.record(plan.id, REJECT_VERDICT, { by: "agent:uat" });
    await walkToActive(corpusService, plan);

    const archived = await corpusService.set(plan.id, { status: "archived" });
    expect(archived.ok).toBe(false);
    if (archived.ok) return;
    expect("field" in archived.error && archived.error.field).toBe("gate:plan-close:uat");
  });

  it("HAPPY: requires_uat plan with a P0-ACCEPT verdict → archive succeeds", async () => {
    const { corpusService, uatService } = makeHarness();
    const plan = await makePlan(corpusService, { requires_uat: true });
    await uatService.record(plan.id, ACCEPT_VERDICT, { by: "agent:uat" });
    await walkToActive(corpusService, plan);

    const archived = await corpusService.set(plan.id, { status: "archived" });
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(archived.value.status).toBe("archived");
  });

  it("REGRESSION: a plan WITHOUT requires_uat archives with no verdict (vacuous pass)", async () => {
    const { corpusService } = makeHarness();
    const plan = await makePlan(corpusService);
    await walkToActive(corpusService, plan);

    const archived = await corpusService.set(plan.id, { status: "archived" });
    expect(archived.ok).toBe(true);
  });

  it("STATE: the gate can be disabled via config (workflow.gates.plan-close.enabled: false)", async () => {
    const config = { workflow: { gates: { "plan-close": { enabled: false } } } } as unknown as LoreConfig;
    const { corpusService } = makeHarness(config);
    const plan = await makePlan(corpusService, { requires_uat: true });
    await walkToActive(corpusService, plan);

    const archived = await corpusService.set(plan.id, { status: "archived" });
    expect(archived.ok).toBe(true);
  });
});
