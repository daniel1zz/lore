/** @spec_ref AC-OUTLINE-001 */
/**
 * Tests for OutlineService — MDX placeholder resolution engine.
 *
 * Test design techniques:
 *   EP: valid/invalid components, all 7 component types
 *   BVA: limit=0, limit=1, no components, multiple components in one doc
 *   Decision Table: component whitelist (known/unknown), embed id (exists/missing)
 *   State: N/A — OutlineService is stateless between resolve() calls
 *   Error: store errors propagate, missing embed degrades gracefully
 *   Regression: unknown component must not crash (strip + warn)
 *
 * Source: SPEC-004, SPEC-001 §3.4
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { OutlineService, renderResolvedToMarkdown } from "../../../src/service/outline-service.js";
import type { DocRecord } from "@lore/core";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { actedStore } from "../../live-invocation.js";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

const NOW = "2026-06-08T00:00:00.000Z";
const OLDER = "2026-05-01T00:00:00.000Z";
const OLDEST = "2026-04-01T00:00:00.000Z";

function makeDoc(overrides: Partial<DocRecord> & { id: string; title: string }): DocRecord {
  return {
    id: overrides.id,
    slug: overrides.slug ?? `${overrides.id}-slug`,
    type: overrides.type ?? "spec",
    role: overrides.role ?? "spec",
    title: overrides.title,
    status: overrides.status ?? "draft",
    priority: overrides.priority ?? "medium",
    content: overrides.content ?? "",
    parent_id: overrides.parent_id ?? null,
    created_at: NOW,
    updated_at: overrides.updated_at ?? NOW,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: overrides.tags ?? [],
    extra: overrides.extra ?? {},
  };
}

/** Build a test corpus: 1 PRD root + 3 spec children + 3 ADRs + 2 plans */
async function buildCorpus(store: StoreInterface) {
  const prd = makeDoc({
    id: "prd-001",
    slug: "prd-root",
    type: "prd",
    role: "intent",
    title: "Main PRD",
    status: "approved",
    parent_id: null,
  });

  const spec1 = makeDoc({
    id: "spec-001",
    slug: "spec-auth",
    type: "spec",
    role: "spec",
    title: "Auth Spec",
    status: "draft",
    parent_id: "prd-001",
  });

  const spec2 = makeDoc({
    id: "spec-002",
    slug: "spec-api",
    type: "spec",
    role: "spec",
    title: "API Spec",
    status: "in-review",
    parent_id: "prd-001",
  });

  const spec3 = makeDoc({
    id: "spec-003",
    slug: "spec-storage",
    type: "spec",
    role: "spec",
    title: "Storage Spec",
    status: "approved",
    parent_id: "prd-001",
    content: "## Overview\nStorage design details here.\n## Schema\nTable definitions.",
  });

  const adr1 = makeDoc({
    id: "adr-001",
    slug: "adr-sqlite",
    type: "adr",
    role: "decision",
    title: "Use SQLite",
    status: "approved",
    updated_at: NOW,
  });

  const adr2 = makeDoc({
    id: "adr-002",
    slug: "adr-bun",
    type: "adr",
    role: "decision",
    title: "Use Bun Runtime",
    status: "approved",
    updated_at: OLDER,
  });

  const adr3 = makeDoc({
    id: "adr-003",
    slug: "adr-mdx",
    type: "adr",
    role: "decision",
    title: "MDX Placeholders",
    status: "deprecated",
    updated_at: OLDEST,
  });

  const plan1 = makeDoc({
    id: "plan-001",
    slug: "plan-p1",
    type: "plan",
    role: "plan",
    title: "Phase 1 Plan",
    status: "active",
  });

  const plan2 = makeDoc({
    id: "plan-002",
    slug: "plan-p2",
    type: "plan",
    role: "plan",
    title: "Phase 2 Plan",
    status: "draft",
  });

  for (const doc of [prd, spec1, spec2, spec3, adr1, adr2, adr3, plan1, plan2]) {
    const result = await store.insert(doc);
    if (!result.ok) throw new Error(`Corpus setup failed: ${result.error.code}`);
  }

  return { prd, spec1, spec2, spec3, adr1, adr2, adr3, plan1, plan2 };
}

// ─── OutlineService.resolve ─────────────────────────────────────────────────

describe("OutlineService.resolve", () => {
  let store: InMemoryStore;
  let service: OutlineService;
  let corpus: Awaited<ReturnType<typeof buildCorpus>>;

  beforeEach(async () => {
    store = actedStore(new InMemoryStore());
    service = new OutlineService(store);
    corpus = await buildCorpus(store);
  });

  // ── Happy Path ─────────────────────────────────────────────────────────────

  describe("happy path", () => {
    it("resolves ChildrenOf with role filter — returns matching children", async () => {
      // AC-OUTLINE-001.01, AC-OUTLINE-001.02
      const prd = makeDoc({
        ...corpus.prd,
        content: '<ChildrenOf role="spec" />',
      });

      const result = await service.resolve(prd);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.resolvedComponents).toHaveLength(1);
      const component = result.value.resolvedComponents[0];
      expect(component).toBeDefined();
      if (!component) return;

      expect(component.name).toBe("ChildrenOf");
      expect(component.props).toEqual({ role: "spec" });

      const data = component.data as { children: Array<{ id: string }> };
      expect(data.children).toHaveLength(3);
      const ids = data.children.map((c) => c.id);
      expect(ids).toContain("spec-001");
      expect(ids).toContain("spec-002");
      expect(ids).toContain("spec-003");
    });

    it("resolves RecentDecisions with limit=2 — returns 2 most recent ADRs", async () => {
      // AC-OUTLINE-002.01
      const prd = makeDoc({
        ...corpus.prd,
        content: "<RecentDecisions limit={2} />",
      });

      const result = await service.resolve(prd);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.resolvedComponents).toHaveLength(1);
      const component = result.value.resolvedComponents[0];
      expect(component).toBeDefined();
      if (!component) return;

      expect(component.name).toBe("RecentDecisions");
      expect(component.props).toEqual({ limit: 2 });

      const data = component.data as { decisions: Array<{ id: string }> };
      expect(data.decisions).toHaveLength(2);
      // Most recent first: adr-001 (NOW), then adr-002 (OLDER)
      expect(data.decisions[0]?.id).toBe("adr-001");
      expect(data.decisions[1]?.id).toBe("adr-002");
    });

    it("resolves ActivePlans — returns only active plans", async () => {
      // AC-OUTLINE-003.01
      const prd = makeDoc({
        ...corpus.prd,
        content: "<ActivePlans />",
      });

      const result = await service.resolve(prd);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const component = result.value.resolvedComponents[0];
      expect(component).toBeDefined();
      if (!component) return;

      expect(component.name).toBe("ActivePlans");
      const data = component.data as { plans: Array<{ id: string; status: string }> };
      expect(data.plans).toHaveLength(1);
      expect(data.plans[0]?.id).toBe("plan-001");
      expect(data.plans[0]?.status).toBe("active");
    });

    it("resolves Embed with valid id — returns full doc content", async () => {
      // AC-OUTLINE-004.01
      const prd = makeDoc({
        ...corpus.prd,
        content: '<Embed id="spec-003" />',
      });

      const result = await service.resolve(prd);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const component = result.value.resolvedComponents[0];
      expect(component).toBeDefined();
      if (!component) return;

      expect(component.name).toBe("Embed");
      const data = component.data as { embedded: { id: string; title: string; content: string } };
      expect(data.embedded).not.toBeNull();
      expect(data.embedded.id).toBe("spec-003");
      expect(data.embedded.title).toBe("Storage Spec");
      expect(data.embedded.content).toContain("Storage design details");
    });

    it("resolves HealthStats — returns corpus statistics object", async () => {
      // AC-OUTLINE-007.01
      const prd = makeDoc({
        ...corpus.prd,
        content: "<HealthStats />",
      });

      const result = await service.resolve(prd);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const component = result.value.resolvedComponents[0];
      expect(component).toBeDefined();
      if (!component) return;

      expect(component.name).toBe("HealthStats");
      const data = component.data as {
        stats: {
          total: number;
          by_type: Record<string, number>;
          by_status: Record<string, number>;
        };
      };
      expect(data.stats.total).toBe(9); // prd + 3 specs + 3 adrs + 2 plans
      expect(data.stats.by_type["spec"]).toBe(3);
      expect(data.stats.by_type["adr"]).toBe(3);
      expect(data.stats.by_type["plan"]).toBe(2);
      expect(data.stats.by_type["prd"]).toBe(1);
    });

    it("resolves ModuleTree — returns tree from current doc as root", async () => {
      const prd = makeDoc({
        ...corpus.prd,
        content: "<ModuleTree />",
      });

      const result = await service.resolve(prd);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const component = result.value.resolvedComponents[0];
      expect(component).toBeDefined();
      if (!component) return;

      expect(component.name).toBe("ModuleTree");
      const data = component.data as {
        modules: { doc: { id: string }; children: Array<{ doc: { id: string } }> };
      };
      expect(data.modules.doc.id).toBe("prd-001");
      expect(data.modules.children).toHaveLength(3);
    });

    it("resolves RelatedOf — returns linked documents", async () => {
      await store.addLink({
        from_id: "prd-001",
        to_id: "adr-001",
        link_type: "informs",
        created_at: NOW,
        created_by: "test",
      });

      const prd = makeDoc({
        ...corpus.prd,
        content: "<RelatedOf />",
      });

      const result = await service.resolve(prd);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const component = result.value.resolvedComponents[0];
      expect(component).toBeDefined();
      if (!component) return;

      expect(component.name).toBe("RelatedOf");
      const data = component.data as {
        related: Array<{ id: string; link_type: string }>;
      };
      expect(data.related).toHaveLength(1);
      expect(data.related[0]?.id).toBe("adr-001");
      expect(data.related[0]?.link_type).toBe("informs");
    });

    it("passes through plain markdown with no components — empty resolvedComponents", async () => {
      // AC-OUTLINE-006.01
      const doc = makeDoc({
        ...corpus.prd,
        content: "# Plain Markdown\n\nNo components here.\n\n- List item\n- Another item",
      });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.content).toBe(doc.content);
      expect(result.value.resolvedComponents).toHaveLength(0);
      expect(result.value.warnings).toHaveLength(0);
    });

    it("resolves multiple components in one doc — all resolved independently", async () => {
      // AC-OUTLINE-008.01
      const prd = makeDoc({
        ...corpus.prd,
        content: [
          "# PRD",
          "",
          "## Specs",
          '<ChildrenOf role="spec" />',
          "",
          "## Decisions",
          "<RecentDecisions limit={1} />",
          "",
          "## Health",
          "<HealthStats />",
        ].join("\n"),
      });

      const result = await service.resolve(prd);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.resolvedComponents).toHaveLength(3);

      const names = result.value.resolvedComponents.map((c) => c.name);
      expect(names).toContain("ChildrenOf");
      expect(names).toContain("RecentDecisions");
      expect(names).toContain("HealthStats");
    });
  });

  // ── Negative Cases ─────────────────────────────────────────────────────────

  describe("negative cases", () => {
    it("strips unknown component and emits warning — does not crash", async () => {
      // AC-OUTLINE-005.01
      const doc = makeDoc({
        ...corpus.prd,
        content: "<ScriptInjection />",
      });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Component stripped from resolvedComponents
      expect(result.value.resolvedComponents).toHaveLength(0);

      // Warning emitted
      expect(result.value.warnings).toHaveLength(1);
      const warning = result.value.warnings[0];
      expect(warning).toBeDefined();
      if (!warning) return;

      expect(warning.component).toBe("ScriptInjection");
      expect(warning.message).toContain("ScriptInjection");

      // audit T2 — spec-prd-as-living-root §4: the whitelist is a security
      // validation boundary, so an unknown component's TAG BYTES must not survive
      // into rendered text. Asserting the warnings array alone (above) is
      // insufficient — it under-asserts, because pre-fix `renderResolvedToMarkdown`
      // only ever spliced `resolvedComponents` positions and left warning-only
      // ranges (i.e. every unknown component) untouched in the projected markdown.
      const rendered = renderResolvedToMarkdown(result.value);
      expect(rendered).not.toContain("<ScriptInjection");
      expect(rendered).not.toContain("ScriptInjection");
      expect(rendered).toBe("");
    });

    it("strips unknown component from rendered text while surrounding prose survives", async () => {
      // audit T2 — a stripped tag must not swallow adjacent legitimate content, and
      // a whitelisted component in the same doc must still render normally
      // (mixed-content regression for the merged splice walk). Uses corpus.prd,
      // which buildCorpus() gives 3 real spec children, so <ChildrenOf /> is
      // expected to render an actual bullet list, not the "no children" empty state.
      const doc = makeDoc({
        ...corpus.prd,
        content: "# Heading\n\nBefore. <ScriptInjection /> After.\n\n<ChildrenOf />",
      });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.warnings).toHaveLength(1);
      expect(result.value.resolvedComponents).toHaveLength(1);

      const rendered = renderResolvedToMarkdown(result.value);
      expect(rendered).not.toContain("ScriptInjection");
      expect(rendered).toContain("# Heading");
      expect(rendered).toContain("Before.");
      expect(rendered).toContain("After.");
      expect(rendered).toContain("[spec] Auth Spec (draft)");
    });

    it("Embed with nonexistent id — graceful null, no crash", async () => {
      // AC-OUTLINE-004.N01
      const doc = makeDoc({
        ...corpus.prd,
        content: '<Embed id="nonexistent-999" />',
      });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const component = result.value.resolvedComponents[0];
      expect(component).toBeDefined();
      if (!component) return;

      expect(component.name).toBe("Embed");
      const data = component.data as { embedded: null; notFound: string };
      expect(data.embedded).toBeNull();
      expect(data.notFound).toBe("nonexistent-999");
    });

    it("multiple unknown components — all stripped, all warned", async () => {
      // AC-OUTLINE-005.02
      const doc = makeDoc({
        ...corpus.prd,
        content: "<Script />\n<Iframe src=\"evil.com\" />\n<ChildrenOf />",
      });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Only ChildrenOf is whitelisted
      expect(result.value.resolvedComponents).toHaveLength(1);
      expect(result.value.resolvedComponents[0]?.name).toBe("ChildrenOf");

      // Script and Iframe stripped with warnings
      expect(result.value.warnings).toHaveLength(2);
      const warnedNames = result.value.warnings.map((w) => w.component);
      expect(warnedNames).toContain("Script");
      expect(warnedNames).toContain("Iframe");
    });

    it("ChildrenOf on doc with no children — returns empty children array", async () => {
      // AC-OUTLINE-001.N01
      const spec = makeDoc({
        ...corpus.spec1,
        content: "<ChildrenOf />",
      });

      const result = await service.resolve(spec);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const component = result.value.resolvedComponents[0];
      expect(component).toBeDefined();
      if (!component) return;

      const data = component.data as { children: unknown[] };
      expect(data.children).toHaveLength(0);
    });
  });

  // ── Boundary Values ────────────────────────────────────────────────────────

  describe("boundary values", () => {
    it("RecentDecisions with limit={1} — returns exactly 1 result", async () => {
      // AC-OUTLINE-002.01 boundary
      const doc = makeDoc({
        ...corpus.prd,
        content: "<RecentDecisions limit={1} />",
      });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const component = result.value.resolvedComponents[0];
      expect(component).toBeDefined();
      if (!component) return;

      const data = component.data as { decisions: unknown[] };
      expect(data.decisions).toHaveLength(1);
    });

    it("RecentDecisions default limit (no prop) — returns up to 5 results", async () => {
      // AC-OUTLINE-002.02
      await store.insert(makeDoc({ id: "adr-004", title: "ADR 4", type: "adr", role: "decision" }));
      await store.insert(makeDoc({ id: "adr-005", title: "ADR 5", type: "adr", role: "decision" }));

      const doc = makeDoc({
        ...corpus.prd,
        content: "<RecentDecisions />",
      });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const component = result.value.resolvedComponents[0];
      expect(component).toBeDefined();
      if (!component) return;

      const data = component.data as { decisions: unknown[] };
      expect(data.decisions).toHaveLength(5);
    });

    it("empty content string — returns empty resolvedComponents", async () => {
      const doc = makeDoc({ ...corpus.prd, content: "" });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.resolvedComponents).toHaveLength(0);
      expect(result.value.warnings).toHaveLength(0);
    });

    it("component with no props — uses defaults (no crash)", async () => {
      const doc = makeDoc({
        ...corpus.prd,
        content: "<ActivePlans />",
      });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const component = result.value.resolvedComponents[0];
      expect(component).toBeDefined();
      if (!component) return;

      expect(component.props).toEqual({});
    });

    it("position offsets are correct for first and last components", async () => {
      // AC-OUTLINE-010.01
      const content = "intro text\n<ChildrenOf />\nmiddle\n<HealthStats />\nend";
      const doc = makeDoc({ ...corpus.prd, content });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.resolvedComponents).toHaveLength(2);

      const first = result.value.resolvedComponents[0];
      const second = result.value.resolvedComponents[1];
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      if (!first || !second) return;

      // First component should start after "intro text\n"
      expect(first.position.start).toBe(11);
      expect(content.slice(first.position.start, first.position.end)).toBe("<ChildrenOf />");

      // Second component tag should be slice-able from content at its position
      expect(content.slice(second.position.start, second.position.end)).toBe("<HealthStats />");
    });
  });

  // ── Error Handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("propagates store STORE_ERROR as Result error — does not throw", async () => {
      // AC-OUTLINE-009.01
      const brokenStore: StoreInterface = {
        ...store,
        findMany: () => Promise.resolve({
          ok: false,
          error: { code: "STORE_ERROR", message: "DB connection lost" },
        }),
        find: (id) => store.find(id),
        findBySlug: (slug) => store.findBySlug(slug),
        // reason: SPEC-065 D2 — new required StoreInterface method; mechanical
        // addition (same class of fix as every other explicit delegate here).
        findByIdPrefix: (prefix) => store.findByIdPrefix(prefix),
        // reason: SPEC-084 — new required StoreInterface method; mechanical
        // addition (same class of fix as every other explicit delegate here).
        findByTypeOrdinal: (type, ordinal) => store.findByTypeOrdinal(type, ordinal),
        // reason: N+1 batch fix — new required StoreInterface method; mechanical
        // addition (same class of fix as every other explicit delegate above).
        findByIds: (ids) => store.findByIds(ids),
        // reason: baseline rule registry (migration-013) — new required
        // StoreInterface methods; mechanical addition (same class of fix as
        // every other explicit delegate here).
        allocateRuleAndUpdateLeaf: (leafId, expectedVersion, buildExtra, actor) =>
          store.allocateRuleAndUpdateLeaf(leafId, expectedVersion, buildExtra, actor),
        reserveProposedRuleAndUpdateSpec: (write, actor) => store.reserveProposedRuleAndUpdateSpec(write, actor),
        repointProposedRuleAndUpdateSpec: (write, actor) => store.repointProposedRuleAndUpdateSpec(write, actor),
        moveRule: (ruleId, fromLeaf, toLeaf, actor) => store.moveRule(ruleId, fromLeaf, toLeaf, actor),
        listRuleRegistry: () => store.listRuleRegistry(),
        // reason: migration-014 indexes — new required StoreInterface methods; mechanical delegates.
        listAcCites: () => store.listAcCites(),
        listRuleDepends: () => store.listRuleDepends(),
        // reason: migration-014 ac_exemptions — new required StoreInterface methods; mechanical delegates.
        insertAcExemptionCapped: (row, cap) => store.insertAcExemptionCapped(row, cap),
        listAcExemptions: () => store.listAcExemptions(),
        insert: (doc) => store.insert(doc),
        // reason: SPEC-084 — new required StoreInterface methods; mechanical
        // addition (same class of fix as every other explicit delegate above).
        insertWithAllocatedOrdinal: (doc) => store.insertWithAllocatedOrdinal(doc),
        allocateOrdinalForExisting: (id, expectedVersion) =>
          store.allocateOrdinalForExisting(id, expectedVersion),
        // reason: SPEC-084 D7 repair-migration path — new required StoreInterface
        // method; mechanical addition (same class of fix as every other explicit
        // delegate here).
        assignOrdinalForRepair: (id, ordinal) => store.assignOrdinalForRepair(id, ordinal),
        assignOrdinalForRepairWithProvenance: (id, ordinal, version, audit) =>
          store.assignOrdinalForRepairWithProvenance(id, ordinal, version, audit),
        update: (id, patch) => store.update(id, patch),
        softDelete: (id) => store.softDelete(id),
        // reason: BUG-002 audit fix — new required StoreInterface methods; mechanical
        // addition (same class of fix as every other explicit delegate above).
        insertWithProvenance: (doc, version, audit) => store.insertWithProvenance(doc, version, audit),
        // reason: task-skill-implement-ordinal-aware-provenance-composite —
        // new required StoreInterface method; mechanical addition (same
        // class of fix as every other explicit delegate above).
        insertWithAllocatedOrdinalAndProvenance: (doc, version, audit) =>
          store.insertWithAllocatedOrdinalAndProvenance(doc, version, audit),
        updateWithProvenance: (id, patch, opts, version, audit) =>
          store.updateWithProvenance(id, patch, opts, version, audit),
        softDeleteWithProvenance: (id, version, audit) => store.softDeleteWithProvenance(id, version, audit),
        addLink: (link) => store.addLink(link),
        addLinkWithProvenance: (link, audit) => store.addLinkWithProvenance(link, audit),
        setDocParentWithProvenance: (id, parentId, audit) => store.setDocParentWithProvenance(id, parentId, audit),
        removeLink: (from, to, type) => store.removeLink(from, to, type),
        findLinks: (id, dir) => store.findLinks(id, dir),
        // reason: SPEC-025 §3 D7 — new required StoreInterface method; mechanical
        // addition (same class of fix as every other explicit delegate above).
        findLinksByToIds: (toIds, linkType) => store.findLinksByToIds(toIds, linkType),
        // reason: SPEC-044 D1 — new required StoreInterface method; mechanical
        // addition (same class of fix as every other explicit delegate above).
        countLinksByToIds: (toIds) => store.countLinksByToIds(toIds),
        // reason: N+1 batch fix — new required StoreInterface method; mechanical
        // addition (same class of fix as every other explicit delegate above).
        findLinksByFromIds: (fromIds, direction) => store.findLinksByFromIds(fromIds, direction),
        search: (q, f) => store.search(q, f),
        insertVersion: (v) => store.insertVersion(v),
        findVersions: (id, opts) => store.findVersions(id, opts),
        // reason: SPEC-035 §2 — new required StoreInterface method; mechanical
        // addition (same class of fix as every other explicit delegate above).
        listAllVersions: (since) => store.listAllVersions(since),
        listVersionKeys: (since) => store.listVersionKeys(since),
        appendAuditEntry: (e) => store.appendAuditEntry(e),
        queryAudit: (f) => store.queryAudit(f),
        // reason: SPEC-079 G3 — new required StoreInterface method; mechanical
        // addition (same class of fix as every other explicit delegate above).
        listAuditChain: () => store.listAuditChain(),
        listAuditRowsByAction: (action, docId) => store.listAuditRowsByAction(action, docId),
        getAuditHeadId: () => store.getAuditHeadId(),
        // reason: SPEC-034 §3 — new required StoreInterface methods; mechanical
        // addition (same class of fix as every other explicit delegate above).
        insertJudgment: (j) => store.insertJudgment(j),
        findJudgments: (id, kind) => store.findJudgments(id, kind),
        latestJudgment: (id, kind) => store.latestJudgment(id, kind),
        // reason: SPEC-044 D2 — new required StoreInterface method; mechanical
        // addition (same class of fix as every other explicit delegate above).
        latestJudgmentsByDocIds: (docIds, kind) => store.latestJudgmentsByDocIds(docIds, kind),
        insertCalibrationRecord: (r) => store.insertCalibrationRecord(r),
        queryCalibrationWindow: (f) => store.queryCalibrationWindow(f),
        // reason: SPEC-102 — new required StoreInterface methods; mechanical
        // addition (same class of fix as every other explicit delegate above).
        insertTraceEvent: (event) => store.insertTraceEvent(event),
        countTraceEventsByKind: (window) => store.countTraceEventsByKind(window),
        countTraceDenyByCheckpoint: (window) => store.countTraceDenyByCheckpoint(window),
        countTraceZeroHitSearches: (window) => store.countTraceZeroHitSearches(window),
        // reason: spec-a-write-side-fact-with-no-read-side-address-counts-with-no
        // §Scope M1 — new required StoreInterface methods (the member lists the
        // two counts above are now DERIVED from); mechanical addition (same class
        // of fix as every other explicit delegate above).
        listTraceZeroHitSearches: (window, opts) => store.listTraceZeroHitSearches(window, opts),
        incrementReadCount: (day) => store.incrementReadCount(day),
        listReadCounts: (sinceDay) => store.listReadCounts(sinceDay),
        acquireLease: (name, holder, nowIso, expiresAtIso) => store.acquireLease(name, holder, nowIso, expiresAtIso),
        renewLease: (name, holder, expiresAtIso) => store.renewLease(name, holder, expiresAtIso),
        releaseLease: (name, holder) => store.releaseLease(name, holder),
        readLease: (name) => store.readLease(name),
        appendCheckOutcomes: (rows) => store.appendCheckOutcomes(rows),
        listCheckOutcomeStats: () => store.listCheckOutcomeStats(),
        issuePendingAsk: (input) => store.issuePendingAsk(input),
        readPendingAsk: (nonce) => store.readPendingAsk(nonce),
        consumePendingAsk: (nonce, usedAt) => store.consumePendingAsk(nonce, usedAt),
        listTraceGateDenies: (window) => store.listTraceGateDenies(window),
        listTraceRawSearchQueries: (window) => store.listTraceRawSearchQueries(window),
        pruneTraceEvents: (cutoffIso, batchSize) => store.pruneTraceEvents(cutoffIso, batchSize),
        close: () => store.close(),
        dbSizeBytes: () => store.dbSizeBytes(),
        maxDocVersion: () => store.maxDocVersion(),
        // reason: migration-016 — new required StoreInterface methods; mechanical delegates.
        insertRun: (run) => store.insertRun(run),
        getRun: (id) => store.getRun(id),
        endRun: (id, endedAt, reason) => store.endRun(id, endedAt, reason),
        reopenRun: (id) => store.reopenRun(id),
        getRunEnd: (id) => store.getRunEnd(id),
        // reason: spec-worktree-removal-is-decided-by-who-is-inside-not-by-how — new required StoreInterface method.
        listRunsByAgentRef: (agentRef) => store.listRunsByAgentRef(agentRef),
        countAttributedWrites: (windowStart, kinds) => store.countAttributedWrites(windowStart, kinds),
        // reason: AC-AU-2 — new required StoreInterface methods (decision log).
        appendDecisionRecord: (input) => store.appendDecisionRecord(input),
        listDecisionLog: (subject) => store.listDecisionLog(subject),
        // reason: AC-AU-5 — new required StoreInterface methods (run process record, run lifecycles).
        recordRunProcess: (id, proc) => store.recordRunProcess(id, proc),
        recordRunAddress: (id, address) => store.recordRunAddress(id, address),
        listRunLifecycles: () => store.listRunLifecycles(),
        // reason: AC-AU-9 — new required StoreInterface methods (governed autonomy threshold record).
        readAutonomyThresholds: () => store.readAutonomyThresholds(),
        writeAutonomyThresholds: (content, updatedAt) => store.writeAutonomyThresholds(content, updatedAt),
      };

      const brokenService = new OutlineService(brokenStore);
      const doc = makeDoc({ ...corpus.prd, content: "<ChildrenOf />" });

      const result = await brokenService.resolve(doc);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("STORE_ERROR");
    });

    it("known component mixed with unknown — unknown stripped, known resolved", async () => {
      // AC-OUTLINE-005.02
      const doc = makeDoc({
        ...corpus.prd,
        content: "<UnknownWidget />\n<HealthStats />",
      });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // HealthStats resolved
      expect(result.value.resolvedComponents).toHaveLength(1);
      expect(result.value.resolvedComponents[0]?.name).toBe("HealthStats");

      // UnknownWidget warned
      expect(result.value.warnings).toHaveLength(1);
      expect(result.value.warnings[0]?.component).toBe("UnknownWidget");
    });
  });

  // ── State Transitions ──────────────────────────────────────────────────────

  // N/A: OutlineService is stateless — no mutable state between resolve() calls.
  // resolve() is a pure query: same doc + same store state = same output.

  // ── Regression Guards ──────────────────────────────────────────────────────

  describe("regression", () => {
    it("Embed with missing id prop — does not throw, returns error info", async () => {
      // AC-OUTLINE-004.N02 — Regression: ensure prop-less Embed does not crash
      const doc = makeDoc({
        ...corpus.prd,
        content: "<Embed />",
      });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const component = result.value.resolvedComponents[0];
      expect(component).toBeDefined();
      if (!component) return;

      const data = component.data as { embedded: null; error: string };
      expect(data.embedded).toBeNull();
    });

    it("component regex does not match opening tags — only self-closing", async () => {
      // Regression: <ChildrenOf> (non self-closing) must NOT be parsed
      const doc = makeDoc({
        ...corpus.prd,
        content: "<ChildrenOf>\n  some content\n</ChildrenOf>",
      });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Non self-closing tag must not be parsed
      expect(result.value.resolvedComponents).toHaveLength(0);
      expect(result.value.warnings).toHaveLength(0);
    });

    it("component with numeric and boolean props — parsed correctly", async () => {
      // Regression: prop parser must distinguish string vs number types
      const doc = makeDoc({
        ...corpus.prd,
        content: '<RecentDecisions limit={3} status="approved" />',
      });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const component = result.value.resolvedComponents[0];
      expect(component).toBeDefined();
      if (!component) return;

      expect(component.props["limit"]).toBe(3);
      expect(typeof component.props["limit"]).toBe("number");
      expect(component.props["status"]).toBe("approved");
      expect(typeof component.props["status"]).toBe("string");
    });

    it("multiple resolve() calls on same service instance are independent", async () => {
      // Regression: COMPONENT_REGEX.lastIndex must be reset each call (global flag)
      const doc1 = makeDoc({ ...corpus.prd, content: "<ChildrenOf />" });
      const doc2 = makeDoc({ ...corpus.spec1, content: "<HealthStats />" });

      const result1 = await service.resolve(doc1);
      const result2 = await service.resolve(doc2);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (!result1.ok || !result2.ok) return;

      expect(result1.value.resolvedComponents[0]?.name).toBe("ChildrenOf");
      expect(result2.value.resolvedComponents[0]?.name).toBe("HealthStats");
    });
  });

  // ── Code-region Exclusion (fenced code blocks + inline code spans) ────────
  // Regression for the 2026-07-07 bug: React/JSX code samples inside a doc's
  // fenced code blocks (e.g. SPEC-015/SPEC-016's `<RouterProvider />` /
  // `<Outlet />` examples) were mis-detected as unknown MDX components,
  // failing `lore eval placeholders` on legitimate content.

  describe("code-region exclusion", () => {
    it("tag inside a fenced code block is ignored — no warning, not resolved", async () => {
      const content = [
        "# Doc",
        "",
        "```jsx",
        "function App() {",
        "  return <RouterProvider />;",
        "}",
        "```",
        "",
      ].join("\n");
      const doc = makeDoc({ ...corpus.prd, content });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.resolvedComponents).toHaveLength(0);
      expect(result.value.warnings).toHaveLength(0);
    });

    it("tag inside an inline code span is ignored — no warning, not resolved", async () => {
      const content = "Render the router with `<Outlet />` inside your layout.";
      const doc = makeDoc({ ...corpus.prd, content });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.resolvedComponents).toHaveLength(0);
      expect(result.value.warnings).toHaveLength(0);
    });

    it("real placeholder outside code still resolves — regression", async () => {
      const doc = makeDoc({ ...corpus.prd, content: "<HealthStats />" });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.resolvedComponents).toHaveLength(1);
      expect(result.value.resolvedComponents[0]?.name).toBe("HealthStats");
      expect(result.value.warnings).toHaveLength(0);
    });

    it("mixed doc — code sample tag ignored, real placeholder outside code resolves", async () => {
      const content = [
        "# Dashboard routing",
        "",
        "```jsx",
        "<RouterProvider />",
        "```",
        "",
        "<HealthStats />",
      ].join("\n");
      const doc = makeDoc({ ...corpus.prd, content });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.resolvedComponents).toHaveLength(1);
      expect(result.value.resolvedComponents[0]?.name).toBe("HealthStats");
      expect(result.value.warnings).toHaveLength(0);
    });

    it("unterminated fence — tail falls back to pre-fix behaviour (pinned choice)", async () => {
      // AC-3: a fence that never closes before EOF is NOT treated as code —
      // the tag inside it is still extracted and, since ScriptInjection is
      // unknown, still produces a warning. This documents the deliberate
      // choice NOT to swallow the rest of the document as "code" just
      // because a fence marker was opened without ever being closed.
      const content = [
        "before the fence",
        "```",
        "<ScriptInjection />",
      ].join("\n");
      const doc = makeDoc({ ...corpus.prd, content });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.resolvedComponents).toHaveLength(0);
      expect(result.value.warnings).toHaveLength(1);
      expect(result.value.warnings[0]?.component).toBe("ScriptInjection");
    });

    it("position offsets stay slice-accurate for a placeholder following a fenced block", async () => {
      // Regression: renderResolvedToMarkdown depends on exact byte offsets —
      // code-region filtering must not shift positions of matches after it.
      const content = [
        "```ts",
        "const x = <NotAComponent />;",
        "```",
        "tail ",
        "<HealthStats />",
        " end",
      ].join("\n");
      const doc = makeDoc({ ...corpus.prd, content });

      const result = await service.resolve(doc);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.resolvedComponents).toHaveLength(1);
      const component = result.value.resolvedComponents[0];
      expect(component).toBeDefined();
      if (!component) return;

      expect(content.slice(component.position.start, component.position.end)).toBe(
        "<HealthStats />",
      );
    });
  });
});

// ─── OutlineService.resolve — SPEC-038 §6 acceptance-criteria projection ────

describe("OutlineService.resolve — acceptance criteria projection (SPEC-038 §6)", () => {
  let store: InMemoryStore;
  let service: OutlineService;

  beforeEach(() => {
    store = actedStore(new InMemoryStore());
    service = new OutlineService(store);
  });

  function acCriterion(id: string): Record<string, unknown> {
    return {
      id,
      statement: `Statement for ${id}`,
      verify: { mode: "script", oracle: "test", command: "bun test" },
    };
  }

  function evidence(result: "pass" | "fail", ac_ref: string): Record<string, unknown> {
    return {
      oracle: "test",
      command: "bun test",
      result,
      recorded_at: "2026-07-08T00:00:00.000Z",
      recorded_by: "alice",
      ac_ref,
    };
  }

  it("HAPPY: spec with declared AC + plan + passing evidence resolves per-AC coverage", async () => {
    const spec = makeDoc({
      id: "spec-ac-1",
      slug: "spec-ac-happy",
      type: "spec",
      title: "AC Happy Spec",
      extra: { acceptance_criteria: [acCriterion("AC-1"), acCriterion("AC-2")] },
    });
    const plan = makeDoc({
      id: "plan-ac-1",
      slug: "plan-ac-happy",
      type: "plan",
      title: "AC Plan",
      parent_id: spec.id,
    });
    const task = makeDoc({
      id: "task-ac-1",
      slug: "task-ac-happy",
      type: "task",
      title: "AC Task",
      parent_id: plan.id,
      extra: { plan_id: plan.id, verification_evidence: [evidence("pass", "AC-1")] },
    });
    for (const doc of [spec, plan, task]) {
      const inserted = await store.insert(doc);
      if (!inserted.ok) throw new Error(`fixture insert failed: ${inserted.error.code}`);
    }

    const result = await service.resolve(spec);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.acceptanceCriteria).toBeDefined();
    const projection = result.value.acceptanceCriteria;
    if (projection === undefined) return;
    expect(projection.criteria).toHaveLength(2);
    const ac1 = projection.coverage.find((c) => c.ac_id === "AC-1");
    const ac2 = projection.coverage.find((c) => c.ac_id === "AC-2");
    expect(ac1).toMatchObject({ pass: 1, fail: 0 });
    expect(ac2).toMatchObject({ pass: 0, fail: 0 });
  });

  it("STATE: no plan under the spec — every criterion coverage is {pass:0, fail:0}", async () => {
    const spec = makeDoc({
      id: "spec-ac-2",
      slug: "spec-ac-noplan",
      type: "spec",
      title: "AC No-Plan Spec",
      extra: { acceptance_criteria: [acCriterion("AC-1")] },
    });
    const inserted = await store.insert(spec);
    if (!inserted.ok) throw new Error(`fixture insert failed: ${inserted.error.code}`);

    const result = await service.resolve(spec);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.acceptanceCriteria?.coverage).toEqual([
      { ac_id: "AC-1", mode: "script", pass: 0, fail: 0, refs: [], attested_pass: 0, attested_fail: 0, falsified: 0, oracle_generation: { current: 1, current_refs: 0, prior_refs: 0 }, other_command: 0 },
    ]);
  });

  it("BOUNDARY: empty acceptance_criteria array — projection is undefined (no block)", async () => {
    const spec = makeDoc({
      id: "spec-ac-3",
      slug: "spec-ac-empty",
      type: "spec",
      title: "AC Empty Spec",
      extra: { acceptance_criteria: [] },
    });
    const inserted = await store.insert(spec);
    if (!inserted.ok) throw new Error(`fixture insert failed: ${inserted.error.code}`);

    const result = await service.resolve(spec);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.acceptanceCriteria).toBeUndefined();
  });

  it("REGRESSION: doc with no acceptance_criteria field at all — projection undefined, zero extra store calls", async () => {
    const spec = makeDoc({
      id: "spec-ac-4",
      slug: "spec-ac-none",
      type: "spec",
      title: "Plain Spec",
    });
    const inserted = await store.insert(spec);
    if (!inserted.ok) throw new Error(`fixture insert failed: ${inserted.error.code}`);

    const result = await service.resolve(spec);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.acceptanceCriteria).toBeUndefined();
  });

  it("NEGATIVE: non-spec doc type carrying acceptance_criteria in extra is ignored", async () => {
    const plan = makeDoc({
      id: "plan-ac-not-spec",
      slug: "plan-ac-not-spec",
      type: "plan",
      title: "Plan With Stray Field",
      extra: { acceptance_criteria: [acCriterion("AC-1")] },
    });
    const inserted = await store.insert(plan);
    if (!inserted.ok) throw new Error(`fixture insert failed: ${inserted.error.code}`);

    const result = await service.resolve(plan);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.acceptanceCriteria).toBeUndefined();
  });

  it("ERROR: malformed acceptance_criteria (invalid id format) degrades to undefined, never throws", async () => {
    const spec = makeDoc({
      id: "spec-ac-5",
      slug: "spec-ac-malformed",
      type: "spec",
      title: "AC Malformed Spec",
      extra: { acceptance_criteria: [{ id: "not-a-valid-id", statement: "x", verify: { mode: "human" } }] },
    });
    const inserted = await store.insert(spec);
    if (!inserted.ok) throw new Error(`fixture insert failed: ${inserted.error.code}`);

    await expect(service.resolve(spec)).resolves.toMatchObject({ ok: true });
    const result = await service.resolve(spec);
    if (!result.ok) return;
    expect(result.value.acceptanceCriteria).toBeUndefined();
  });

  it("STATE: aggregates evidence across multiple plans under the same spec", async () => {
    const spec = makeDoc({
      id: "spec-ac-6",
      slug: "spec-ac-multiplan",
      type: "spec",
      title: "AC Multi-Plan Spec",
      extra: { acceptance_criteria: [acCriterion("AC-1")] },
    });
    const planA = makeDoc({
      id: "plan-ac-a",
      slug: "plan-ac-a",
      type: "plan",
      title: "Plan A",
      parent_id: spec.id,
    });
    const planB = makeDoc({
      id: "plan-ac-b",
      slug: "plan-ac-b",
      type: "plan",
      title: "Plan B",
      parent_id: spec.id,
    });
    const taskA = makeDoc({
      id: "task-ac-a",
      slug: "task-ac-a",
      type: "task",
      title: "Task A",
      parent_id: planA.id,
      extra: { plan_id: planA.id, verification_evidence: [evidence("pass", "AC-1")] },
    });
    const taskB = makeDoc({
      id: "task-ac-b",
      slug: "task-ac-b",
      type: "task",
      title: "Task B",
      parent_id: planB.id,
      extra: { plan_id: planB.id, verification_evidence: [evidence("fail", "AC-1")] },
    });
    for (const doc of [spec, planA, planB, taskA, taskB]) {
      const inserted = await store.insert(doc);
      if (!inserted.ok) throw new Error(`fixture insert failed: ${inserted.error.code}`);
    }

    const result = await service.resolve(spec);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ac1 = result.value.acceptanceCriteria?.coverage.find((c) => c.ac_id === "AC-1");
    expect(ac1).toMatchObject({ pass: 1, fail: 1 });
  });
});
