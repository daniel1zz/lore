/**
 * Six-dimension tests for OutlineService's SPEC-043 D3/D9 invalidated-doc handling:
 * RecentDecisions filter-before-slice, RelatedOf skip, Embed degrade, and the
 * REGRESSION guard that ChildrenOf/ActivePlans/ModuleTree/HealthStats stay
 * unfiltered structural navigation. Uses InMemoryStore — no file I/O, no SQLite.
 *
 * Dimension mapping:
 *   HAPPY:      RecentDecisions filters invalidated ADRs BEFORE slice so the
 *               next-most-recent valid decision backfills the limit; RelatedOf
 *               skips an invalidated target by default; Embed degrades to the
 *               skip-note by default; includeInvalid restores RecentDecisions/
 *               RelatedOf/Embed (Embed WITH an inline banner line)
 *   NEGATIVE:   n/a — no invalid-input path in these resolvers beyond what
 *               outline-service.test.ts already covers
 *   BOUNDARY:   ALL candidates invalidated → short/empty list, not an error
 *               (exhaustion boundary)
 *   ERROR:      n/a — resolve() never errors on invalidated content, only degrades
 *   STATE:      n/a — OutlineService is stateless between resolve() calls
 *   REGRESSION: ChildrenOf/ActivePlans/ModuleTree/HealthStats are UNCHANGED by an
 *               invalidated doc in their result sets (D9 — pointers, not content
 *               splices, stay unfiltered)
 *
 * @spec_ref SPEC-043 AC-MH-6
 */

import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import type { DocRecord } from "@lore/core";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { actedStore } from "../../live-invocation.js";

const NOW = "2026-06-08T00:00:00.000Z";
const OLDER = "2026-05-01T00:00:00.000Z";
const OLDEST = "2026-04-01T00:00:00.000Z";
/** Fixed "now" for isInvalidated checks — after every fixture's invalid_at below. */
const RESOLVE_NOW = "2026-06-09T00:00:00.000Z";

function makeDoc(overrides: Partial<DocRecord> & { id: string; title: string }): DocRecord {
  return {
    id: overrides.id,
    slug: overrides.slug ?? `${overrides.id}-slug`,
    type: overrides.type ?? "adr",
    role: overrides.role ?? "decision",
    title: overrides.title,
    status: overrides.status ?? "approved",
    priority: overrides.priority ?? "medium",
    content: overrides.content ?? "",
    parent_id: overrides.parent_id ?? null,
    created_at: overrides.updated_at ?? NOW,
    updated_at: overrides.updated_at ?? NOW,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: overrides.tags ?? [],
    extra: overrides.extra ?? {},
  };
}

function invalidatedExtra(reason = "obsolete"): Record<string, unknown> {
  return { validity: { invalid_at: "2026-06-01T00:00:00.000Z", reason } };
}

async function insertAll(store: StoreInterface, docs: DocRecord[]): Promise<void> {
  for (const doc of docs) {
    const result = await store.insert(doc);
    if (!result.ok) throw new Error(`Corpus setup failed: ${result.error.code}`);
  }
}

async function resolveComponent(
  service: OutlineService,
  doc: DocRecord,
): Promise<{ name: string; data: unknown }> {
  const result = await service.resolve(doc, undefined, () => RESOLVE_NOW);
  if (!result.ok) throw new Error(`resolve() failed: ${JSON.stringify(result.error)}`);
  const component = result.value.resolvedComponents[0];
  if (component === undefined) throw new Error("expected exactly one resolved component");
  return { name: component.name, data: component.data };
}

// ─── HAPPY — RecentDecisions filter-before-slice ────────────────────────────

describe("HAPPY — RecentDecisions filters BEFORE slice so next-most-recent backfills the limit", () => {
  it("an invalidated NEWEST ADR is skipped, and the next-most-recent valid ADR fills the limit slot", async () => {
    const store = actedStore(new InMemoryStore());
    const service = new OutlineService(store);
    const adr1 = makeDoc({ id: "adr-001", title: "Newest (invalidated)", updated_at: NOW, extra: invalidatedExtra() });
    const adr2 = makeDoc({ id: "adr-002", title: "Second", updated_at: OLDER });
    const adr3 = makeDoc({ id: "adr-003", title: "Third", updated_at: OLDEST });
    await insertAll(store, [adr1, adr2, adr3]);

    const host = makeDoc({ id: "host-001", type: "prd", title: "Host", content: "<RecentDecisions limit={2} />" });
    const { name, data } = await resolveComponent(service, host);

    expect(name).toBe("RecentDecisions");
    const decisions = (data as { decisions: Array<{ id: string }> }).decisions;
    // Without filtering, limit=2 would have returned [adr1, adr2] — filtering BEFORE
    // slice means adr1 is excluded and adr3 backfills the second slot.
    expect(decisions.map((d) => d.id)).toEqual(["adr-002", "adr-003"]);
  });

  it("includeInvalid restores the invalidated ADR to the result", async () => {
    const store = actedStore(new InMemoryStore());
    const service = new OutlineService(store);
    const adr1 = makeDoc({ id: "adr-001", title: "Newest (invalidated)", updated_at: NOW, extra: invalidatedExtra() });
    const adr2 = makeDoc({ id: "adr-002", title: "Second", updated_at: OLDER });
    await insertAll(store, [adr1, adr2]);

    const host = makeDoc({
      id: "host-001",
      type: "prd",
      title: "Host",
      content: "<RecentDecisions limit={2} includeInvalid={true} />",
    });
    const { data } = await resolveComponent(service, host);
    const decisions = (data as { decisions: Array<{ id: string }> }).decisions;
    expect(decisions.map((d) => d.id)).toEqual(["adr-001", "adr-002"]);
  });
});

// ─── BOUNDARY — exhaustion ──────────────────────────────────────────────────

describe("BOUNDARY — ALL candidates invalidated yields an empty list, not an error", () => {
  it("RecentDecisions with every ADR invalidated returns an empty decisions array", async () => {
    const store = actedStore(new InMemoryStore());
    const service = new OutlineService(store);
    const adr1 = makeDoc({ id: "adr-001", title: "A", updated_at: NOW, extra: invalidatedExtra() });
    const adr2 = makeDoc({ id: "adr-002", title: "B", updated_at: OLDER, extra: invalidatedExtra() });
    await insertAll(store, [adr1, adr2]);

    const host = makeDoc({ id: "host-001", type: "prd", title: "Host", content: "<RecentDecisions limit={5} />" });
    const result = await service.resolve(host, undefined, () => RESOLVE_NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const component = result.value.resolvedComponents[0];
    expect(component).toBeDefined();
    if (!component) return;
    expect((component.data as { decisions: unknown[] }).decisions).toEqual([]);
  });
});

// ─── HAPPY — RelatedOf skip / includeInvalid ────────────────────────────────

describe("HAPPY — RelatedOf skips invalidated targets by default; includeInvalid restores", () => {
  it("an invalidated linked target is excluded from RelatedOf by default", async () => {
    const store = actedStore(new InMemoryStore());
    const service = new OutlineService(store);
    const host = makeDoc({ id: "host-001", type: "spec", title: "Host", content: "<RelatedOf />" });
    const validTarget = makeDoc({ id: "target-001", type: "knowledge", role: "knowledge", title: "Valid target" });
    const invalidTarget = makeDoc({
      id: "target-002",
      type: "knowledge",
      role: "knowledge",
      title: "Invalid target",
      extra: invalidatedExtra(),
    });
    await insertAll(store, [host, validTarget, invalidTarget]);
    await store.addLink({ from_id: host.id, to_id: validTarget.id, link_type: "relates-to", created_at: NOW, created_by: "test" });
    await store.addLink({ from_id: host.id, to_id: invalidTarget.id, link_type: "relates-to", created_at: NOW, created_by: "test" });

    const { name, data } = await resolveComponent(service, host);
    expect(name).toBe("RelatedOf");
    const related = (data as { related: Array<{ id: string }> }).related;
    expect(related.map((r) => r.id)).toEqual([validTarget.id]);
  });

  it("includeInvalid restores the invalidated target to RelatedOf", async () => {
    const store = actedStore(new InMemoryStore());
    const service = new OutlineService(store);
    const host = makeDoc({ id: "host-001", type: "spec", title: "Host", content: "<RelatedOf includeInvalid={true} />" });
    const invalidTarget = makeDoc({
      id: "target-002",
      type: "knowledge",
      role: "knowledge",
      title: "Invalid target",
      extra: invalidatedExtra(),
    });
    await insertAll(store, [host, invalidTarget]);
    await store.addLink({ from_id: host.id, to_id: invalidTarget.id, link_type: "relates-to", created_at: NOW, created_by: "test" });

    const { data } = await resolveComponent(service, host);
    const related = (data as { related: Array<{ id: string }> }).related;
    expect(related.map((r) => r.id)).toEqual([invalidTarget.id]);
  });
});

// ─── HAPPY — Embed degrade / includeInvalid banner ──────────────────────────

describe("HAPPY — Embed degrades to the skip-note by default; includeInvalid embeds WITH a banner", () => {
  it("an invalidated embed target degrades to invalidatedSkip data (not the spliced content)", async () => {
    const store = actedStore(new InMemoryStore());
    const service = new OutlineService(store);
    const target = makeDoc({
      id: "target-001",
      type: "knowledge",
      role: "knowledge",
      title: "Stale doc",
      content: "the stale body",
      extra: invalidatedExtra("obsolete"),
    });
    const host = makeDoc({ id: "host-001", type: "spec", title: "Host", content: `<Embed id="${target.id}" />` });
    await insertAll(store, [host, target]);

    const { name, data } = await resolveComponent(service, host);
    expect(name).toBe("Embed");
    const record = data as Record<string, unknown>;
    expect(record["embedded"]).toBeNull();
    expect(typeof record["invalidatedSkip"]).toBe("string");
    expect(record["invalidatedSkip"] as string).toContain(target.slug);
    expect(record["invalidatedSkip"] as string).toContain("includeInvalid");
  });

  it("includeInvalid embeds the invalidated doc WITH an inline banner line prepended", async () => {
    const store = actedStore(new InMemoryStore());
    const service = new OutlineService(store);
    const target = makeDoc({
      id: "target-001",
      type: "knowledge",
      role: "knowledge",
      title: "Stale doc",
      content: "the stale body",
      extra: invalidatedExtra("obsolete"),
    });
    const host = makeDoc({
      id: "host-001",
      type: "spec",
      title: "Host",
      content: `<Embed id="${target.id}" includeInvalid={true} />`,
    });
    await insertAll(store, [host, target]);

    const { data } = await resolveComponent(service, host);
    const record = data as { embedded: { content: string } | null };
    expect(record.embedded).not.toBeNull();
    expect(record.embedded?.content).toContain("⚠ INVALIDATED");
    expect(record.embedded?.content).toContain("the stale body");
  });

  it("a VALID embed target is spliced verbatim with no banner (REGRESSION)", async () => {
    const store = actedStore(new InMemoryStore());
    const service = new OutlineService(store);
    const target = makeDoc({ id: "target-001", type: "knowledge", role: "knowledge", title: "Fresh doc", content: "fresh body" });
    const host = makeDoc({ id: "host-001", type: "spec", title: "Host", content: `<Embed id="${target.id}" />` });
    await insertAll(store, [host, target]);

    const { data } = await resolveComponent(service, host);
    const record = data as { embedded: { content: string } | null };
    expect(record.embedded?.content).toBe("fresh body");
    expect(record.embedded?.content).not.toContain("INVALIDATED");
  });
});

// ─── REGRESSION — ChildrenOf/ActivePlans/ModuleTree/HealthStats unchanged ───

describe("REGRESSION — ChildrenOf/ActivePlans/ModuleTree/HealthStats stay unfiltered structural navigation", () => {
  it("ChildrenOf includes an invalidated child (pointers, not content splices)", async () => {
    const store = actedStore(new InMemoryStore());
    const service = new OutlineService(store);
    const parent = makeDoc({ id: "parent-001", type: "prd", title: "Parent", content: "<ChildrenOf />" });
    const child = makeDoc({ id: "child-001", type: "knowledge", role: "knowledge", title: "Invalidated child", parent_id: parent.id, extra: invalidatedExtra() });
    await insertAll(store, [parent, child]);

    const { data } = await resolveComponent(service, parent);
    const children = (data as { children: Array<{ id: string }> }).children;
    expect(children.map((c) => c.id)).toContain(child.id);
  });

  it("ActivePlans includes an invalidated-extra plan (validity has no meaning on plans, but the resolver never checks it)", async () => {
    const store = actedStore(new InMemoryStore());
    const service = new OutlineService(store);
    const plan = makeDoc({ id: "plan-001", type: "plan", role: "plan", title: "Plan", status: "active", extra: invalidatedExtra() });
    await insertAll(store, [plan]);

    const host = makeDoc({ id: "host-001", type: "prd", title: "Host", content: "<ActivePlans />" });
    const { data } = await resolveComponent(service, host);
    const plans = (data as { plans: Array<{ id: string }> }).plans;
    expect(plans.map((p) => p.id)).toContain(plan.id);
  });

  it("ModuleTree includes an invalidated-extra node", async () => {
    const store = actedStore(new InMemoryStore());
    const service = new OutlineService(store);
    const root = makeDoc({ id: "root-001", type: "prd", title: "Root", content: "<ModuleTree />", extra: invalidatedExtra() });
    const child = makeDoc({ id: "child-001", type: "spec", title: "Child", parent_id: root.id });
    await insertAll(store, [root, child]);

    const { data } = await resolveComponent(service, root);
    const modules = data as { modules: { doc: { id: string }; children: Array<{ doc: { id: string } }> } };
    expect(modules.modules.doc.id).toBe(root.id);
    expect(modules.modules.children.map((c) => c.doc.id)).toContain(child.id);
  });

  it("HealthStats counts an invalidated doc the same as any other (structural aggregate, not filtered)", async () => {
    const store = actedStore(new InMemoryStore());
    const service = new OutlineService(store);
    const k = makeDoc({ id: "k-001", type: "knowledge", role: "knowledge", title: "K", extra: invalidatedExtra() });
    await insertAll(store, [k]);

    const host = makeDoc({ id: "host-001", type: "prd", title: "Host", content: "<HealthStats />" });
    const { data } = await resolveComponent(service, host);
    const stats = (data as { stats: { total: number; by_type: Record<string, number> } }).stats;
    expect(stats.by_type["knowledge"]).toBe(1);
    expect(stats.total).toBeGreaterThanOrEqual(1);
  });
});
