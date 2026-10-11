/**
 * Tests for SPEC-054 UAT-verdict-as-plan-close-gate service wiring: UatService.record
 * (sole writer), the CorpusService writer-identity guard on sub_type "uat", the
 * `plan-close` gate through GateEnforcer on a plan's → archived transition, and
 * getLatestUatVerdict round-trip fidelity.
 *
 * Also covers task-lore-uat-record-bu-jiao-yan-mu-biao-doc-lei-xing-verdict's AC-1..AC-8:
 * `record()` refuses a non-`plan` target BEFORE creating anything (AC-4 ordering/no-orphan),
 * names the actual type + the plan-close consumer (AC-3), refuses every non-plan DocType
 * (AC-2), never disturbs a pre-existing mis-linked verdict (AC-6), and still returns the
 * pre-existing not-found error for an unresolvable target (AC-8). AC-5 (MCP surface parity
 * without touching mcp/tools.ts) lives in mcp-tools.test.ts.
 *
 * Deterministic, zero-LLM — no AI provider anywhere on this path.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * Source: SPEC-054 §Acceptance Criteria AC-054-4..AC-054-8;
 *   task-lore-uat-record-bu-jiao-yan-mu-biao-doc-lei-xing-verdict AC-1..AC-8.
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { UatService } from "../../../src/service/uat-service.js";
import { resolveDoc } from "../../../src/service/resolve.js";
import type { CreateDocInput, DocRecord, DocType, LoreConfig, UatVerdict } from "@lore/core";

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
  const corpusService = new CorpusService(store, new RecordLockService(store), undefined, undefined, enforcer);
  const uatService = new UatService({
    createUatDoc: corpusService.createUatDoc.bind(corpusService),
    resolveTarget: (idOrSlug: string) => resolveDoc(store, idOrSlug),
    addLink: store.addLink.bind(store),
    now: () => "2026-07-18T00:00:00.000Z",
  });
  return { store, corpusService, uatService };
}

/** Every non-`plan` DocType — the fixture set for AC-2's per-type refusal sweep. */
const NON_PLAN_TYPES: readonly DocType[] = ["knowledge", "adr", "spec", "prd", "task", "phase"];

/** Creates a minimal doc of `type`, satisfying each type's own required `extra` fields
 *  (parent_id for spec/task, decision_status for adr, sub_type for knowledge, plan_id for
 *  task) so `CorpusService.create` itself never rejects the fixture for unrelated reasons. */
async function makeDocOfType(cs: CorpusService, type: DocType): Promise<DocRecord> {
  if (type === "prd") {
    return mustCreate(cs, { type: "prd", title: `Test ${type}`, content: "body", extra: {} });
  }
  const prd = await mustCreate(cs, { type: "prd", title: "Parent prd", content: "body", extra: {} });
  if (type === "spec") {
    // reason: the spec-create gate's hasSkeleton predicate refuses content with no
    // markdown heading (MISSING_SKELETON) — unrelated to this task's fix, just a
    // fixture requirement.
    return mustCreate(cs, {
      type: "spec",
      title: "Test spec",
      content: "## Overview\nbody",
      extra: {},
    });
  }
  if (type === "adr") {
    return mustCreate(cs, {
      type: "adr",
      title: "Test adr",
      content: "body",
      extra: { decision_status: "accepted" },
    });
  }
  if (type === "knowledge") {
    return mustCreate(cs, {
      type: "knowledge",
      title: "Test knowledge",
      content: "body",
      extra: { sub_type: "reference" },
    });
  }
  const plan = await mustCreate(cs, { type: "plan", title: "Parent plan", content: "body", extra: {} });
  if (type === "task") {
    return mustCreate(cs, {
      type: "task",
      title: "Test task",
      content: "body",
      parent_id: plan.id,
      extra: { plan_id: plan.id },
    });
  }
  // type === "phase"
  return mustCreate(cs, {
    type: "phase",
    title: "Test phase",
    content: "body",
    parent_id: plan.id,
    extra: { plan_id: plan.id },
  });
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const r = await cs.create(input);
  if (!r.ok) throw new Error(`create failed: ${JSON.stringify(r.error)}`);
  return r.value;
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

  // AC-7 (both directions, restated explicitly against the SAME predicate this fix must
  // leave untouched): a P0-accepted verdict linked to a plan still passes; a plan with
  // none still fails UAT_MISSING. requires_uat is never altered by this task.
  it("AC-7/STATE direction A: requires_uat plan WITH a P0-accepted linked verdict passes plan-close", async () => {
    const { corpusService, uatService } = makeHarness();
    const plan = await makePlan(corpusService, { requires_uat: true });
    const rec = await uatService.record(plan.id, ACCEPT_VERDICT, { by: "agent:uat" });
    expect(rec.ok).toBe(true);
    await walkToActive(corpusService, plan);

    const archived = await corpusService.set(plan.id, { status: "archived" });
    expect(archived.ok).toBe(true);
  });

  it("AC-7/STATE direction B: requires_uat plan WITHOUT any verdict fails UAT_MISSING", async () => {
    const { corpusService } = makeHarness();
    const plan = await makePlan(corpusService, { requires_uat: true });
    await walkToActive(corpusService, plan);

    const archived = await corpusService.set(plan.id, { status: "archived" });
    expect(archived.ok).toBe(false);
    if (archived.ok) return;
    expect("field" in archived.error && archived.error.field).toBe("gate:plan-close:uat");
    expect("message" in archived.error && archived.error.message).toContain("UAT_MISSING");
  });
});

// ─── task-lore-uat-record-bu-jiao-yan-mu-biao-doc-lei-xing-verdict ───────────
// AC-2/AC-3/AC-4/AC-6/AC-8: `record()` refuses a non-`plan` target BEFORE any doc/link
// is created, names the actual type + the plan-close consumer, and never retroactively
// touches a pre-existing mis-linked verdict.

describe("task-lore-uat-record — non-plan target is refused before any write", () => {
  it.each(NON_PLAN_TYPES)(
    "AC-2/NEGATIVE: recording against a '%s' doc is refused with VALIDATION_ERROR",
    async (docType) => {
      const { corpusService, uatService } = makeHarness();
      const target = await makeDocOfType(corpusService, docType);

      const rec = await uatService.record(target.slug, ACCEPT_VERDICT, { by: "agent:uat" });
      expect(rec.ok).toBe(false);
      if (rec.ok) return;
      expect(rec.error.code).toBe("VALIDATION_ERROR");
    },
  );

  it("AC-3: the refusal names the actual type AND the plan-close consumer as independent lone tokens", async () => {
    const { corpusService, uatService } = makeHarness();
    const adr = await makeDocOfType(corpusService, "adr");

    const rec = await uatService.record(adr.slug, ACCEPT_VERDICT, { by: "agent:uat" });
    expect(rec.ok).toBe(false);
    if (rec.ok) return;
    const message = "message" in rec.error ? rec.error.message : "";
    // reason: two INDEPENDENT lone-token assertions (contiguous-substring rule) — a check
    // keyed on one hard-coded remembered sentence would pass even if either half regressed.
    expect(message).toContain("adr");
    expect(message).toContain("plan-close");
  });

  it("AC-4/ORDERING: a refused call creates NO knowledge/uat doc and adds NO link (measured by corpus state)", async () => {
    const { store, corpusService, uatService } = makeHarness();
    const adr = await makeDocOfType(corpusService, "adr");

    const beforeDocs = await corpusService.list({ type: "knowledge" });
    const beforeLinks = await store.findLinks(adr.id, "in");
    expect(beforeDocs.ok).toBe(true);
    expect(beforeLinks.ok).toBe(true);
    if (!beforeDocs.ok || !beforeLinks.ok) return;

    const rec = await uatService.record(adr.slug, ACCEPT_VERDICT, { by: "agent:uat" });
    expect(rec.ok).toBe(false);

    const afterDocs = await corpusService.list({ type: "knowledge" });
    const afterLinks = await store.findLinks(adr.id, "in");
    expect(afterDocs.ok).toBe(true);
    expect(afterLinks.ok).toBe(true);
    if (!afterDocs.ok || !afterLinks.ok) return;
    // NO orphan doc minted (this is exactly what would produce the nested
    // `knowledge-uat-knowledge-…` slug the original defect report measured).
    expect(afterDocs.value.total).toBe(beforeDocs.value.total);
    // NO informs link added to the (wrong) target.
    expect(afterLinks.value.length).toBe(beforeLinks.value.length);
  });

  it("AC-8/ERROR: an unresolvable id/slug still returns the pre-existing DOC_NOT_FOUND, never the new type error", async () => {
    const { uatService } = makeHarness();
    const rec = await uatService.record("plan-does-not-exist-anywhere", ACCEPT_VERDICT, { by: "agent:uat" });
    expect(rec.ok).toBe(false);
    if (rec.ok) return;
    expect(rec.error.code).toBe("DOC_NOT_FOUND");
  });

  it("AC-6/REGRESSION: a verdict already mis-linked to a non-plan doc (pre-existing data) still reads back fine, untouched", async () => {
    const { store, corpusService } = makeHarness();
    const adr = await makeDocOfType(corpusService, "adr");

    // reason: simulates data written under the OLD (unfixed) behavior — direct use of
    // the guarded seam + store.addLink, bypassing UatService.record's new type check
    // entirely, exactly as the pre-fix code path would have done for an ADR target.
    const created = await corpusService.createUatDoc({
      type: "knowledge",
      title: "Legacy mis-linked verdict",
      content: "body",
      extra: { sub_type: "uat", uat: ACCEPT_VERDICT },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const link = await store.addLink({
      from_id: created.value.id,
      to_id: adr.id,
      link_type: "informs",
      created_at: "2026-01-01T00:00:00.000Z",
      created_by: "agent:legacy",
    });
    expect(link.ok).toBe(true);

    // This fix changes the WRITE boundary only — AC-6 forbids sweeping/invalidating
    // the pre-existing legacy doc, so it must still read back exactly as written.
    const readBack = await store.find(created.value.id);
    expect(readBack.ok).toBe(true);
    if (!readBack.ok || readBack.value === null) return;
    expect(readBack.value.status).not.toBe("deprecated");
    expect(readBack.value.deleted_at).toBeNull();
    expect((readBack.value.extra as Record<string, unknown>)["validity"]).toBeUndefined();
    expect((readBack.value.extra as Record<string, unknown>)["uat"]).toEqual(ACCEPT_VERDICT);

    const legacyLinks = await store.findLinks(adr.id, "in");
    expect(legacyLinks.ok).toBe(true);
    if (!legacyLinks.ok) return;
    expect(legacyLinks.value.some((l) => l.from_id === created.value.id && l.link_type === "informs")).toBe(true);
  });
});
