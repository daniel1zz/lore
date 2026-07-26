/**
 * RED-phase spec-driven tests for SPEC-080 C1 (structured outline dedicated-writer
 * contract) — pinned BEFORE `PrdOutlineService` exists. Paired-Impl: T2
 * (`packages/lore/src/service/prd-outline-service.ts`).
 *
 * Assumed interface (derived from SPEC-080 §C1/§C4/§Downstream-Handoff — this file
 * is the executable contract T2 must satisfy, not a description of existing code):
 *
 *   class PrdOutlineService {
 *     constructor(store: StoreInterface)
 *     // Single-entry CAS patch keyed by `section`. Unknown section + no
 *     // `opts.create` → VALIDATION_ERROR listing the declared keys. Only legal
 *     // on a `type: "prd"` doc.
 *     outlineSet(
 *       prdIdOrSlug: string,
 *       entry: OutlineEntryInput,
 *       opts?: { create?: boolean },
 *     ): Promise<Result<OutlineEntry[], LoreError>>
 *
 *     // Writes plan.extra.prd_sync_exempt = {reason, by, at}. Missing/blank
 *     // reason → VALIDATION_ERROR naming "reason".
 *     exempt(
 *       planIdOrSlug: string,
 *       opts: { reason: string; by: string },
 *     ): Promise<Result<{ reason: string; by: string; at: string }, LoreError>>
 *   }
 *
 *   // @lore/core, pure, deterministic — same render-projection convention as
 *   // renderHandoffContent / renderAssessmentContent.
 *   function renderOutlineContent(outline: OutlineEntry[]): string
 *
 * `CorpusService.set` gains two dedicated-writer guards (no new class — same file,
 * same pattern as the existing extra.validity / extra.phases guards):
 *   - ANY direct patch whose `extra` contains an `outline` key is rejected outright
 *     (stronger than the phases/verification_evidence "drop-only" guard — SPEC-080
 *     C1 says direct `extra.outline` writes are never legal, full stop; only
 *     `lore outline set` may touch it).
 *   - A patch that DROPS `plan.extra.prd_sync_exempt` (present before, absent after)
 *     is rejected — this one mirrors the phases/verification_evidence drop-only shape
 *     (SPEC-076 precedent): restating the same value, or a plan that never had an
 *     exemption, is unaffected.
 *
 * RED-first discipline: `PrdOutlineService`/`renderOutlineContent` do not exist yet,
 * so every test below is expected to fail via module-resolution error (or, for the
 * two `CorpusService.set` guard scenarios that don't need those imports, via an
 * assertion failure proving the guard doesn't exist yet) — never a test-authoring bug.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * @spec_ref AC-080-2
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
// Intentional RED: this module does not exist yet — T2 paired implementation.
import { PrdOutlineService } from "../../../src/service/prd-outline-service.js";
// Intentional RED: this export does not exist yet — T2 paired implementation.
import { renderOutlineContent } from "@lore/core";
import type { CreateDocInput } from "@lore/core";

// ─── Fixture types (structural mirror of SPEC-080 §C1's OutlineEntry shape) ───

interface OutlineEntryFixture {
  section: string;
  title: string;
  tier: "core" | "domain";
  direction: string;
  decision_pointers: string[];
  constraints: string[];
  links: Array<{ slug: string; rel: "detail" | "landing-spec" | "adr" }>;
}

function outlineEntry(overrides: Partial<OutlineEntryFixture> = {}): OutlineEntryFixture {
  return {
    section: "sync",
    title: "Sync Predicate",
    tier: "domain",
    direction: "Bounded summary of the sync predicate domain.",
    decision_pointers: [],
    constraints: [],
    links: [{ slug: "spec-domain-sync-detail", rel: "detail" }],
    ...overrides,
  };
}

// ─── Fixture helpers ────────────────────────────────────────────────────────

function makeServices() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const prdOutlineService = new PrdOutlineService(store);
  return { store, corpusService, prdOutlineService };
}

async function createPrd(
  cs: CorpusService,
  opts: { title?: string; outline?: OutlineEntryFixture[] } = {},
): Promise<string> {
  const result = await cs.create({
    type: "prd",
    title: opts.title ?? "Test Root PRD",
    content: "root",
    ...(opts.outline !== undefined ? { extra: { outline: opts.outline } } : {}),
  } as CreateDocInput);
  if (!result.ok) throw new Error(`prd create failed: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createSpec(cs: CorpusService, parentId: string, title = "Test Spec"): Promise<string> {
  const result = await cs.create({
    type: "spec",
    title,
    parent_id: parentId,
    content: "spec body",
  } as CreateDocInput);
  if (!result.ok) throw new Error(`spec create failed: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createPlan(
  cs: CorpusService,
  opts: { title?: string; prdSyncExempt?: { reason: string; by: string; at: string } } = {},
): Promise<string> {
  const result = await cs.create({
    type: "plan",
    title: opts.title ?? "Test Plan",
    content: "plan body",
    ...(opts.prdSyncExempt !== undefined ? { extra: { prd_sync_exempt: opts.prdSyncExempt } } : {}),
  } as CreateDocInput);
  if (!result.ok) throw new Error(`plan create failed: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

// ═══ HAPPY/STATE — outlineSet single-entry CAS patch (AC-080-2) ══════════════

describe("HAPPY/STATE — PrdOutlineService.outlineSet single-entry CAS patch (AC-080-2)", () => {
  it("patches exactly the targeted section; sibling entries stay byte-identical; version bumps exactly once", async () => {
    const { store, corpusService, prdOutlineService } = makeServices();

    const entryA = outlineEntry({ section: "distribution", title: "Distribution Model" });
    const entryB = outlineEntry({ section: "sync", title: "Sync Predicate (old)" });
    const entryC = outlineEntry({ section: "budgets", title: "Budget Oracle" });
    const prdId = await createPrd(corpusService, { outline: [entryA, entryB, entryC] });

    const before = await store.find(prdId);
    if (!before.ok || before.value === null) throw new Error("prd fetch failed");
    const versionBefore = before.value.version;
    // Deep-clone the sibling entries as they existed pre-patch, from the doc's
    // OWN stored state (not the fixture objects) — proves round-trip fidelity.
    const storedOutlineBefore = before.value.extra["outline"] as OutlineEntryFixture[];
    const entryASnapshot = JSON.parse(JSON.stringify(storedOutlineBefore.find((e) => e.section === "distribution")));
    const entryCSnapshot = JSON.parse(JSON.stringify(storedOutlineBefore.find((e) => e.section === "budgets")));

    const patched = outlineEntry({
      section: "sync",
      title: "Sync Predicate (revised)",
      direction: "Revised bounded summary.",
    });
    const result = await prdOutlineService.outlineSet(prdId, patched);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(3);

    const after = await store.find(prdId);
    if (!after.ok || after.value === null) throw new Error("prd re-fetch failed");
    const storedOutlineAfter = after.value.extra["outline"] as OutlineEntryFixture[];

    const afterA = storedOutlineAfter.find((e) => e.section === "distribution");
    const afterC = storedOutlineAfter.find((e) => e.section === "budgets");
    expect(afterA).toEqual(entryASnapshot);
    expect(afterC).toEqual(entryCSnapshot);

    const afterB = storedOutlineAfter.find((e) => e.section === "sync");
    expect(afterB?.title).toBe("Sync Predicate (revised)");
    expect(afterB?.direction).toBe("Revised bounded summary.");

    expect(after.value.version).toBe(versionBefore + 1);
  });
});

// ═══ NEGATIVE — outlineSet on a non-prd doc (AC-080-2 error scenario) ════════

describe("NEGATIVE — PrdOutlineService.outlineSet on a non-prd doc", () => {
  it("rejects with VALIDATION_ERROR naming the allowed type when the target is a spec, not a prd", async () => {
    const { corpusService, prdOutlineService } = makeServices();
    const prdId = await createPrd(corpusService, { outline: [outlineEntry({ section: "sync" })] });
    const specId = await createSpec(corpusService, prdId);

    const result = await prdOutlineService.outlineSet(specId, outlineEntry({ section: "sync" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    const message = (result.error as { message?: string }).message ?? "";
    expect(message.toLowerCase()).toContain("prd");
  });
});

// ═══ ERROR — outlineSet on an unknown section key, no create intent ══════════

describe("ERROR — PrdOutlineService.outlineSet on an unknown section key", () => {
  it("rejects with VALIDATION_ERROR listing the declared section keys when opts.create is omitted", async () => {
    const { corpusService, prdOutlineService } = makeServices();
    const entryAlpha = outlineEntry({ section: "alpha", title: "Alpha Domain" });
    const entryBeta = outlineEntry({ section: "beta", title: "Beta Domain" });
    const prdId = await createPrd(corpusService, { outline: [entryAlpha, entryBeta] });

    const result = await prdOutlineService.outlineSet(prdId, outlineEntry({ section: "gamma-unknown" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    const message = (result.error as { message?: string }).message ?? "";
    expect(message).toContain("alpha");
    expect(message).toContain("beta");

    // Prove no phantom entry was appended by the rejected call.
    const after = await corpusService.get(prdId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect((after.value.doc.extra["outline"] as OutlineEntryFixture[]).map((e) => e.section)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("BOUNDARY: the SAME unknown section key succeeds when opts.create explicitly opts in", async () => {
    const { corpusService, prdOutlineService } = makeServices();
    const prdId = await createPrd(corpusService, { outline: [outlineEntry({ section: "alpha" })] });

    const result = await prdOutlineService.outlineSet(
      prdId,
      outlineEntry({ section: "gamma-new", title: "Gamma Domain" }),
      { create: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((e) => e.section).sort()).toEqual(["alpha", "gamma-new"]);
  });
});

// ═══ NEGATIVE — CorpusService.set: direct extra.outline patch (AC-080-2) ═════

describe("NEGATIVE — CorpusService.set rejects a direct extra.outline patch, naming `lore outline`", () => {
  it("a wholesale-replace patch touching extra.outline is rejected outright, leaving the stored outline untouched", async () => {
    const { corpusService } = makeServices();
    const originalEntry = outlineEntry({ section: "sync", title: "Sync Predicate" });
    const prdId = await createPrd(corpusService, { outline: [originalEntry] });

    const attackerPatch = { extra: { outline: [outlineEntry({ section: "sync", title: "HIJACKED" })] } };
    const result = await corpusService.set(prdId, attackerPatch);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    const message = (result.error as { message?: string }).message ?? "";
    expect(message).toContain("lore outline");

    const after = await corpusService.get(prdId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.extra["outline"]).toEqual([originalEntry]);
  });

  it("REGRESSION: restating the identical outline array via direct set is STILL rejected — no value-equality escape hatch", async () => {
    // Deliberately stronger than the extra.validity guard (which tolerates a
    // same-value restate) — SPEC-080 C1 says direct extra.outline writes are
    // NEVER legal, only `lore outline set`'s dedicated single-entry CAS path.
    const { corpusService } = makeServices();
    const originalEntry = outlineEntry({ section: "sync", title: "Sync Predicate" });
    const prdId = await createPrd(corpusService, { outline: [originalEntry] });

    const identicalPatch = { extra: { outline: [originalEntry] } };
    const result = await corpusService.set(prdId, identicalPatch);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ═══ NEGATIVE/BOUNDARY/HAPPY — CorpusService.set: prd_sync_exempt drop guard ═

describe("CorpusService.set — plan.extra.prd_sync_exempt wholesale-drop guard", () => {
  it("NEGATIVE: rejects a patch that DROPS an existing exemption (present before, absent after), naming the dedicated writer", async () => {
    const { corpusService } = makeServices();
    const exemption = { reason: "domain doc rewrite scheduled next plan", by: "agent:alice", at: "2026-07-26T00:00:00.000Z" };
    const planId = await createPlan(corpusService, { prdSyncExempt: exemption });

    const result = await corpusService.set(planId, { extra: { some_unrelated_field: true } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    const message = (result.error as { message?: string }).message ?? "";
    expect(message).toContain("lore outline exempt");

    const after = await corpusService.get(planId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.extra["prd_sync_exempt"]).toEqual(exemption);
  });

  it("HAPPY: a patch that RESTATES the exemption verbatim alongside a new field succeeds", async () => {
    const { corpusService } = makeServices();
    const exemption = { reason: "domain doc rewrite scheduled next plan", by: "agent:alice", at: "2026-07-26T00:00:00.000Z" };
    const planId = await createPlan(corpusService, { prdSyncExempt: exemption });

    const result = await corpusService.set(planId, {
      extra: { prd_sync_exempt: exemption, some_unrelated_field: true },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["prd_sync_exempt"]).toEqual(exemption);
    expect(result.value.extra["some_unrelated_field"]).toBe(true);
  });

  it("BOUNDARY: a plan with NO exemption declared is unaffected by a bare extra patch", async () => {
    const { corpusService } = makeServices();
    const planId = await createPlan(corpusService, {});

    const result = await corpusService.set(planId, { extra: { some_unrelated_field: true } });
    expect(result.ok).toBe(true);
  });
});

// ═══ ERROR — PrdOutlineService.exempt without a reason ═══════════════════════

describe("ERROR — PrdOutlineService.exempt without a reason", () => {
  it("rejects with VALIDATION_ERROR naming `reason` when the reason is omitted", async () => {
    const { corpusService, prdOutlineService } = makeServices();
    const planId = await createPlan(corpusService, {});

    const badOpts = { by: "agent:alice" } as unknown as { reason: string; by: string };
    const result = await prdOutlineService.exempt(planId, badOpts);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    const message = (result.error as { message?: string }).message ?? "";
    expect(message.toLowerCase()).toContain("reason");
  });

  it("BOUNDARY: rejects a blank-string reason the same way as an omitted one", async () => {
    const { corpusService, prdOutlineService } = makeServices();
    const planId = await createPlan(corpusService, {});

    const result = await prdOutlineService.exempt(planId, { reason: "   ", by: "agent:alice" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    const message = (result.error as { message?: string }).message ?? "";
    expect(message.toLowerCase()).toContain("reason");
  });

  it("HAPPY: a non-blank reason succeeds and is persisted onto the plan", async () => {
    const { corpusService, prdOutlineService } = makeServices();
    const planId = await createPlan(corpusService, {});

    const result = await prdOutlineService.exempt(planId, {
      reason: "domain doc rewrite scheduled next plan",
      by: "agent:alice",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reason).toBe("domain doc rewrite scheduled next plan");
    expect(result.value.by).toBe("agent:alice");
    expect(typeof result.value.at).toBe("string");

    const after = await corpusService.get(planId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.extra["prd_sync_exempt"]).toEqual(result.value);
  });
});

// ═══ REGRESSION — renderOutlineContent 2-entry snapshot (render-projection) ══

describe("REGRESSION — renderOutlineContent renders exactly the given entries, in declaration order", () => {
  it("a 2-entry outline renders both headings, in declaration order, and no others", () => {
    const entryFirst = outlineEntry({ section: "distribution", title: "Distribution Model" });
    const entrySecond = outlineEntry({ section: "sync", title: "Sync Predicate" });

    const output = renderOutlineContent([entryFirst, entrySecond]);

    const headingA = "## Distribution Model";
    const headingB = "## Sync Predicate";
    expect(output).toContain(headingA);
    expect(output).toContain(headingB);
    expect(output.indexOf(headingA)).toBeLessThan(output.indexOf(headingB));

    // "nothing else": exactly two level-2 ATX headings — no stray heading for a
    // section that was never passed in, no leaked "undefined"/"[object Object]".
    const headingMatches = output.match(/^## .+$/gm) ?? [];
    expect(headingMatches).toHaveLength(2);
    expect(output).not.toContain("undefined");
    expect(output).not.toContain("[object Object]");
  });

  it("is deterministic — two calls with the same input produce byte-identical output", () => {
    const entries = [
      outlineEntry({ section: "distribution", title: "Distribution Model" }),
      outlineEntry({ section: "sync", title: "Sync Predicate" }),
    ];

    expect(renderOutlineContent(entries)).toBe(renderOutlineContent(entries));
  });

  it("BOUNDARY: an empty outline array renders without throwing and contains no heading", () => {
    const output = renderOutlineContent([]);
    expect(typeof output).toBe("string");
    expect(output.match(/^## .+$/gm) ?? []).toHaveLength(0);
  });
});
