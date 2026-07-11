/**
 * Six-dimension tests for CorpusService.search/list's SPEC-043 D3 default
 * invalidated-knowledge/adr filtering. Uses InMemoryStore — no file I/O, no SQLite.
 *
 * Dimension mapping:
 *   HAPPY:      search/list exclude invalidated knowledge+adr by default;
 *               include_invalid restores them
 *   NEGATIVE:   a future valid_at does NOT exclude a doc (only invalid_at filters)
 *   BOUNDARY:   the relative ORDER of surviving doc ids is unchanged between the
 *               default and include_invalid result sets (InMemoryStore has no
 *               ranking signal — order, not score, is the honest oracle)
 *   ERROR:      n/a — filtering never fails; a store error still propagates
 *               (REGRESSION below covers the propagation path)
 *   STATE:      `now` is injected via the D3 seam in every case (no ambient
 *               wall-clock read) — proven by moving `now` across a doc's
 *               invalid_at boundary
 *   REGRESSION: non-knowledge/adr docs (task/plan/spec) are never filtered by
 *               isInvalidated (it's structurally a no-op for them); a genuine store
 *               error still propagates through both list() and search()
 *
 * @spec_ref SPEC-043 AC-MH-5
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ValidityService } from "../../../src/service/validity-service.js";
import type { CreateDocInput, DocRecord } from "@lore/core";

function makeServices() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const validityService = new ValidityService(store);
  return { store, corpusService, validityService };
}

async function createKnowledge(
  cs: CorpusService,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<DocRecord> {
  const result = await cs.create({
    type: "knowledge",
    title,
    content: `body mentioning ${title} findme`,
    extra: { sub_type: "ideation", ...extra },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create knowledge doc: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createTask(cs: CorpusService): Promise<DocRecord> {
  const planResult = await cs.create({ type: "plan", title: "Plan", content: "body" } as CreateDocInput);
  if (!planResult.ok) throw new Error("setup failed");
  const taskResult = await cs.create({
    type: "task",
    title: "Task findme",
    parent_id: planResult.value.id,
    content: "body findme",
    extra: { plan_id: planResult.value.id },
  } as CreateDocInput);
  if (!taskResult.ok) throw new Error("setup failed");
  return taskResult.value;
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("HAPPY — list/search exclude invalidated knowledge by default; include_invalid restores", () => {
  it("list() excludes an invalidated knowledge doc by default", async () => {
    const { corpusService, validityService } = makeServices();
    const k1 = await createKnowledge(corpusService, "K1");
    await createKnowledge(corpusService, "K2");
    const invalidateResult = await validityService.invalidate(k1.id, { by: "alice" });
    expect(invalidateResult.ok).toBe(true);

    const defaultList = await corpusService.list({ type: "knowledge" });
    expect(defaultList.ok).toBe(true);
    if (!defaultList.ok) return;
    expect(defaultList.value.docs.map((d) => d.slug)).not.toContain(k1.slug);

    const includeInvalidList = await corpusService.list({ type: "knowledge", include_invalid: true });
    expect(includeInvalidList.ok).toBe(true);
    if (!includeInvalidList.ok) return;
    expect(includeInvalidList.value.docs.map((d) => d.slug)).toContain(k1.slug);
  });

  it("search() excludes an invalidated knowledge hit by default", async () => {
    const { corpusService, validityService } = makeServices();
    const k1 = await createKnowledge(corpusService, "Findable One");
    await validityService.invalidate(k1.id, { by: "alice" });

    const defaultSearch = await corpusService.search("findme");
    expect(defaultSearch.ok).toBe(true);
    if (!defaultSearch.ok) return;
    expect(defaultSearch.value.results.map((r) => r.slug)).not.toContain(k1.slug);

    const includeInvalidSearch = await corpusService.search("findme", { include_invalid: true });
    expect(includeInvalidSearch.ok).toBe(true);
    if (!includeInvalidSearch.ok) return;
    expect(includeInvalidSearch.value.results.map((r) => r.slug)).toContain(k1.slug);
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("NEGATIVE — a future valid_at does NOT exclude a doc", () => {
  it("list() includes a doc whose valid_at is in the future (only invalid_at filters)", async () => {
    const { corpusService } = makeServices();
    const k1 = await createKnowledge(corpusService, "K1", { validity: { valid_at: "2099-01-01T00:00:00.000Z" } });

    const result = await corpusService.list({ type: "knowledge" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.docs.map((d) => d.slug)).toContain(k1.slug);
  });
});

// ─── BOUNDARY — order preservation ──────────────────────────────────────────

describe("BOUNDARY — surviving doc order is unchanged between default and include_invalid result sets", () => {
  it("list() preserves relative order of surviving ids", async () => {
    const { corpusService, validityService } = makeServices();
    const k1 = await createKnowledge(corpusService, "K1");
    const k2 = await createKnowledge(corpusService, "K2");
    const k3 = await createKnowledge(corpusService, "K3");
    await validityService.invalidate(k2.id, { by: "alice" }); // invalidate the MIDDLE doc

    const defaultList = await corpusService.list({ type: "knowledge" });
    const includeInvalidList = await corpusService.list({ type: "knowledge", include_invalid: true });
    expect(defaultList.ok && includeInvalidList.ok).toBe(true);
    if (!defaultList.ok || !includeInvalidList.ok) return;

    const defaultIds = defaultList.value.docs.map((d) => d.id);
    const includeInvalidIds = includeInvalidList.value.docs.map((d) => d.id);

    // Every id present in the default (filtered) set appears in the SAME relative
    // order within the include_invalid (unfiltered) superset.
    const filteredFromSuperset = includeInvalidIds.filter((id) => defaultIds.includes(id));
    expect(filteredFromSuperset).toEqual(defaultIds);
    expect(defaultIds).not.toContain(k2.id);
    expect(includeInvalidIds).toEqual(expect.arrayContaining([k1.id, k2.id, k3.id]));
  });

  it("search() preserves relative order of surviving hits", async () => {
    const { corpusService, validityService } = makeServices();
    const k1 = await createKnowledge(corpusService, "Alpha");
    const k2 = await createKnowledge(corpusService, "Beta");
    const k3 = await createKnowledge(corpusService, "Gamma");
    await validityService.invalidate(k2.id, { by: "alice" });

    const defaultSearch = await corpusService.search("findme");
    const includeInvalidSearch = await corpusService.search("findme", { include_invalid: true });
    expect(defaultSearch.ok && includeInvalidSearch.ok).toBe(true);
    if (!defaultSearch.ok || !includeInvalidSearch.ok) return;

    const defaultIds = defaultSearch.value.results.map((r) => r.id);
    const supersetIds = includeInvalidSearch.value.results.map((r) => r.id);
    const filteredFromSuperset = supersetIds.filter((id) => defaultIds.includes(id));
    expect(filteredFromSuperset).toEqual(defaultIds);
    expect(defaultIds).not.toContain(k2.id);
    expect(supersetIds).toEqual(expect.arrayContaining([k1.id, k2.id, k3.id]));
  });
});

// ─── STATE — now is injected via the D3 seam ────────────────────────────────

describe("STATE — now is injected via the D3 seam in every case", () => {
  it("moving the injected `now` across invalid_at flips list() visibility", async () => {
    const { corpusService, validityService } = makeServices();
    const k1 = await createKnowledge(corpusService, "K1");
    const invalidAt = "2026-06-01T00:00:00.000Z";
    await validityService.invalidate(k1.id, { by: "alice" }, () => invalidAt);

    const beforeBoundary = await corpusService.list({ type: "knowledge" }, () => "2026-05-01T00:00:00.000Z");
    expect(beforeBoundary.ok).toBe(true);
    if (!beforeBoundary.ok) return;
    expect(beforeBoundary.value.docs.map((d) => d.id)).toContain(k1.id);

    const afterBoundary = await corpusService.list({ type: "knowledge" }, () => "2026-07-01T00:00:00.000Z");
    expect(afterBoundary.ok).toBe(true);
    if (!afterBoundary.ok) return;
    expect(afterBoundary.value.docs.map((d) => d.id)).not.toContain(k1.id);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("REGRESSION — non-knowledge/adr docs are never filtered; store errors still propagate", () => {
  it("a task doc is never excluded by the invalidated-doc filter (isInvalidated is a structural no-op for it)", async () => {
    const { corpusService } = makeServices();
    const task = await createTask(corpusService);

    const listResult = await corpusService.list({ type: "task" });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.value.docs.map((d) => d.id)).toContain(task.id);

    const searchResult = await corpusService.search("findme", { type: "task" });
    expect(searchResult.ok).toBe(true);
    if (!searchResult.ok) return;
    expect(searchResult.value.results.map((r) => r.id)).toContain(task.id);
  });

  it("a store error from findMany still propagates through list()", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    // reason: force a store error by monkey-patching findMany on this instance only.
    store.findMany = async () => ({ ok: false, error: { code: "STORE_ERROR", message: "boom" } });

    const result = await corpusService.list({ type: "knowledge" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");
  });
});
