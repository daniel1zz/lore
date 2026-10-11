/**
 * Outline writers RETIRED (slice 3a, BR-985) — what survives of SPEC-080 C1's dedicated-writer contract.
 *
 * `PrdOutlineService` no longer has `outlineSet`, `outlineRm` or `exempt` (the CLI refuses the matching
 * verbs with exit 4; see tests/integration/cli/outline-retired.bun.test.ts). This file used to pin those
 * writers (single-entry CAS patch, unknown-section rejection, blank-reason rejection); it now pins:
 *   - the service surface: only `outlineList` remains, and it still reads stored entries / rejects a
 *     non-prd target
 *   - the `CorpusService.set` guards that keep stored outline / `prd_sync_exempt` data from being
 *     silently rewritten through `lore set`, now naming the retirement instead of a dead verb
 *   - `renderOutlineContent` (@lore/core, read projection) is unchanged
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * @spec_ref AC-BLS3-6
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { PrdOutlineService } from "../../../src/service/prd-outline-service.js";
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
  const corpusService = new CorpusService(store, new RecordLockService(store));
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

// ═══ the service surface: read-only ═════════════════════════════════════════

describe("PrdOutlineService is read-only after the retirement (BR-985)", () => {
  it("REGRESSION: outlineSet, outlineRm and exempt no longer exist on the service", () => {
    const { prdOutlineService } = makeServices();
    const surface = prdOutlineService as unknown as Record<string, unknown>;
    expect(surface["outlineSet"]).toBeUndefined();
    expect(surface["outlineRm"]).toBeUndefined();
    expect(surface["exempt"]).toBeUndefined();
    expect(typeof surface["outlineList"]).toBe("function");
  });

  it("HAPPY/STATE: outlineList returns the stored entries in declaration order and never changes the doc version", async () => {
    const { store, corpusService, prdOutlineService } = makeServices();
    const prdId = await createPrd(corpusService, {
      outline: [outlineEntry({ section: "distribution" }), outlineEntry({ section: "sync" })],
    });
    const before = await store.find(prdId);
    if (!before.ok || before.value === null) throw new Error("prd fetch failed");

    const result = await prdOutlineService.outlineList(prdId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((e) => e.section)).toEqual(["distribution", "sync"]);
    const after = await store.find(prdId);
    expect(after.ok && after.value?.version).toBe(before.value.version);
  });

  it("BOUNDARY: a PRD with no outline lists as an empty array", async () => {
    const { corpusService, prdOutlineService } = makeServices();
    const prdId = await createPrd(corpusService);

    const result = await prdOutlineService.outlineList(prdId);

    expect(result.ok && result.value).toEqual([]);
  });

  it("NEGATIVE: outlineList on a non-prd doc rejects with VALIDATION_ERROR naming prd", async () => {
    const { corpusService, prdOutlineService } = makeServices();
    const prdId = await createPrd(corpusService, { outline: [outlineEntry({ section: "sync" })] });
    const specId = await createSpec(corpusService, prdId);

    const result = await prdOutlineService.outlineList(specId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(((result.error as { message?: string }).message ?? "").toLowerCase()).toContain("prd");
  });
});

// ═══ NEGATIVE — CorpusService.set: direct extra.outline patch (AC-080-2) ═════

describe("NEGATIVE — CorpusService.set rejects a direct extra.outline patch, naming the retirement and `lore baseline add`", () => {
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
    expect(message).toContain("retired");
    expect(message).toContain("lore baseline add");

    const after = await corpusService.get(prdId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.extra["outline"]).toEqual([originalEntry]);
  });

  it("REGRESSION: restating the identical outline array via direct set is STILL rejected — no value-equality escape hatch", async () => {
    // Deliberately stronger than the extra.validity guard (which tolerates a
    // same-value restate) — SPEC-080 C1 says direct extra.outline writes are
    // NEVER legal; since BR-985 no verb writes the outline at all.
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
  it("NEGATIVE: rejects a patch that DROPS an existing exemption (present before, absent after), naming the retirement", async () => {
    const { corpusService } = makeServices();
    const exemption = { reason: "domain doc rewrite scheduled next plan", by: "agent:alice", at: "2026-07-26T00:00:00.000Z" };
    const planId = await createPlan(corpusService, { prdSyncExempt: exemption });

    const result = await corpusService.set(planId, { extra: { some_unrelated_field: true } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    const message = (result.error as { message?: string }).message ?? "";
    expect(message).toContain("retired");

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
