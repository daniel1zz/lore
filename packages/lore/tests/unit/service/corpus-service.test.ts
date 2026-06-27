/**
 * Unit tests for CorpusService.
 * Uses InMemoryStore — no file I/O, no SQLite dependency.
 * Covers: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION cases.
 * @spec_ref AC-SVC-001
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import type { CreateDocInput } from "@lore/core";

// ─── Test helpers ───────────────────────────────────────────────────────────

function makeStore() {
  return new InMemoryStore();
}

function makeService(store = makeStore()) {
  return { service: new CorpusService(store), store };
}

/** Create a valid PRD input */
function prdInput(title = "My Product"): CreateDocInput {
  return { type: "prd", title };
}

/** Create a valid spec input that requires parent_id */
function specInput(parentId: string, title = "My Spec"): CreateDocInput {
  return { type: "spec", title, parent_id: parentId };
}

/** Create a valid ADR input */
function adrInput(title = "Use TypeScript"): CreateDocInput {
  return {
    type: "adr",
    title,
    extra: { decision_status: "proposed" },
  };
}

// ─── resolve ────────────────────────────────────────────────────────────────

describe("resolve", () => {
  it("AC-SVC-001.01: ULID input → finds by id", async () => {
    const { service } = makeService();
    const createResult = await service.create(prdInput());
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const id = createResult.value.id;
    const resolveResult = await service.resolve(id);
    expect(resolveResult.ok).toBe(true);
    if (!resolveResult.ok) return;
    expect(resolveResult.value).toBe(id);
  });

  it("AC-SVC-001.02: slug input → finds by slug", async () => {
    const { service } = makeService();
    const createResult = await service.create(prdInput("Auth Service"));
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const slug = createResult.value.slug;
    const resolveResult = await service.resolve(slug);
    expect(resolveResult.ok).toBe(true);
    if (!resolveResult.ok) return;
    expect(resolveResult.value).toBe(createResult.value.id);
  });

  it("AC-SVC-001.N01: nonexistent ULID → DOC_NOT_FOUND", async () => {
    const { service } = makeService();
    await service.create(prdInput("Some Doc"));
    // 26 uppercase alphanumeric = ULID format
    const result = await service.resolve("01AAAAAAAAAAAAAAAAAAAAAAA0");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });

  it("AC-SVC-001.N02: nonexistent slug → DOC_NOT_FOUND", async () => {
    const { service } = makeService();
    const result = await service.resolve("spec-does-not-exist");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });
});

// ─── create ─────────────────────────────────────────────────────────────────

describe("create", () => {
  it("AC-SVC-002.01: spec with parent → success, slug auto-generated", async () => {
    const { service } = makeService();
    const prdResult = await service.create(prdInput("Product Requirement"));
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) return;

    const specResult = await service.create(specInput(prdResult.value.id, "Auth Feature"));
    expect(specResult.ok).toBe(true);
    if (!specResult.ok) return;

    expect(specResult.value.type).toBe("spec");
    expect(specResult.value.slug).toMatch(/^spec-/);
    expect(specResult.value.parent_id).toBe(prdResult.value.id);
    expect(specResult.value.version).toBe(1);
    expect(specResult.value.status).toBe("draft");
  });

  it("AC-SVC-002.02: spec can resolve parent by slug", async () => {
    const { service } = makeService();
    const prdResult = await service.create(prdInput("Root PRD"));
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) return;

    const prdSlug = prdResult.value.slug;
    const specResult = await service.create(specInput(prdSlug, "Child Spec"));
    expect(specResult.ok).toBe(true);
    if (!specResult.ok) return;
    expect(specResult.value.parent_id).toBe(prdResult.value.id);
  });

  it("AC-SVC-002.03: spec without parent → PARENT_REQUIRED error", async () => {
    const { service } = makeService();
    const result = await service.create({ type: "spec", title: "Orphan Spec" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PARENT_REQUIRED");
    if (result.error.code === "PARENT_REQUIRED") {
      expect(result.error.type).toBe("spec");
    }
  });

  it("AC-SVC-002.04: task without parent → PARENT_REQUIRED error", async () => {
    const { service } = makeService();
    const result = await service.create({
      type: "task",
      title: "Orphan Task",
      extra: { plan_id: "SOMEPLANID00000000000000001" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PARENT_REQUIRED");
  });

  it("AC-SVC-002.05: creates version record (version=1, action=create) on insert", async () => {
    const { service, store } = makeService();
    const prdResult = await service.create(prdInput("Versioned Doc"));
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) return;

    const versionsResult = await store.findVersions(prdResult.value.id);
    expect(versionsResult.ok).toBe(true);
    if (!versionsResult.ok) return;
    expect(versionsResult.value.length).toBe(1);
    expect(versionsResult.value[0]?.action).toBe("create");
    expect(versionsResult.value[0]?.version).toBe(1);
  });

  it("AC-SVC-002.06: slug collision → auto-appends -2", async () => {
    const { service } = makeService();
    const r1 = await service.create(prdInput("Collision Test"));
    const r2 = await service.create(prdInput("Collision Test"));
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.value.slug).not.toBe(r2.value.slug);
    expect(r2.value.slug).toMatch(/-2$/);
  });

  it("AC-SVC-002.07: adr with valid extra.decision_status → role=decision", async () => {
    const { service } = makeService();
    const result = await service.create(adrInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("adr");
    expect(result.value.role).toBe("decision");
  });

  it("AC-SVC-002.N01: adr without decision_status → VALIDATION_ERROR", async () => {
    const { service } = makeService();
    const result = await service.create({ type: "adr", title: "Missing status" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── get ────────────────────────────────────────────────────────────────────

describe("get", () => {
  it("AC-SVC-003.01: get by slug → returns doc with navigation (parent=null, children populated)", async () => {
    const { service } = makeService();
    const prdResult = await service.create(prdInput("Navigation Root"));
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) return;

    const specResult = await service.create(specInput(prdResult.value.id, "Child A"));
    expect(specResult.ok).toBe(true);
    if (!specResult.ok) return;

    const getResult = await service.get(prdResult.value.slug);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;

    expect(getResult.value.doc.id).toBe(prdResult.value.id);
    expect(getResult.value.navigation.children.length).toBe(1);
    expect(getResult.value.navigation.children[0]?.id).toBe(specResult.value.id);
    expect(getResult.value.navigation.parent).toBeNull();
  });

  it("AC-SVC-003.02: get child → returns parent and siblings", async () => {
    const { service } = makeService();
    const prdResult = await service.create(prdInput("Parent Doc"));
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) return;

    const spec1 = await service.create(specInput(prdResult.value.id, "Sibling A"));
    const spec2 = await service.create(specInput(prdResult.value.id, "Sibling B"));
    expect(spec1.ok && spec2.ok).toBe(true);
    if (!spec1.ok || !spec2.ok) return;

    const getResult = await service.get(spec1.value.slug);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;

    expect(getResult.value.navigation.parent?.id).toBe(prdResult.value.id);
    expect(getResult.value.navigation.siblings.length).toBe(1);
    expect(getResult.value.navigation.siblings[0]?.id).toBe(spec2.value.id);
  });

  it("AC-SVC-003.03: get shows related links (non-parent)", async () => {
    const { service } = makeService();
    const r1 = await service.create(prdInput("Doc A"));
    const r2 = await service.create(prdInput("Doc B"));
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    await service.link(r1.value.id, r2.value.id, "relates-to");

    const getResult = await service.get(r1.value.slug);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.value.navigation.related.length).toBe(1);
    expect(getResult.value.navigation.related[0]?.link_type).toBe("relates-to");
  });

  it("AC-SVC-003.N01: get nonexistent → DOC_NOT_FOUND", async () => {
    const { service } = makeService();
    await service.create(prdInput("Existing Doc"));

    const result = await service.get("spec-does-not-exist");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });
});

// ─── set ────────────────────────────────────────────────────────────────────

describe("set", () => {
  it("AC-SVC-004.01: update content → version incremented", async () => {
    const { service } = makeService();
    const createResult = await service.create(prdInput("Original Title"));
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const setResult = await service.set(createResult.value.slug, { content: "Updated content" });
    expect(setResult.ok).toBe(true);
    if (!setResult.ok) return;

    expect(setResult.value.version).toBe(2);
    expect(setResult.value.content).toBe("Updated content");
  });

  it("AC-SVC-004.02: update approved doc content → status resets to draft", async () => {
    const { service } = makeService();
    const createResult = await service.create(prdInput("Approved Doc"));
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const approveResult = await service.set(createResult.value.slug, { status: "approved" });
    expect(approveResult.ok).toBe(true);
    if (!approveResult.ok) return;
    expect(approveResult.value.status).toBe("approved");

    const setResult = await service.set(createResult.value.slug, { content: "New content" });
    expect(setResult.ok).toBe(true);
    if (!setResult.ok) return;
    expect(setResult.value.status).toBe("draft");
  });

  it("AC-SVC-004.03: update approved doc title → status resets to draft", async () => {
    const { service } = makeService();
    const createResult = await service.create(prdInput("Draft Doc"));
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    await service.set(createResult.value.slug, { status: "approved" });
    const setResult = await service.set(createResult.value.slug, { title: "New Title" });
    expect(setResult.ok).toBe(true);
    if (!setResult.ok) return;
    expect(setResult.value.status).toBe("draft");
  });

  it("AC-SVC-004.04: update tags on approved doc → status unchanged", async () => {
    const { service } = makeService();
    const r = await service.create(prdInput("Tag Doc"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    await service.set(r.value.slug, { status: "approved" });
    const setResult = await service.set(r.value.slug, { tags: ["important"] });
    expect(setResult.ok).toBe(true);
    if (!setResult.ok) return;
    expect(setResult.value.status).toBe("approved");
  });

  it("AC-SVC-004.05: creates version snapshot on update", async () => {
    const { service, store } = makeService();
    const r = await service.create(prdInput("Snapshot Test"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    await service.set(r.value.slug, { content: "v2 content" });

    const versionsResult = await store.findVersions(r.value.id);
    expect(versionsResult.ok).toBe(true);
    if (!versionsResult.ok) return;
    expect(versionsResult.value.length).toBe(2);
  });

  it("AC-SVC-004.N01: set nonexistent doc → DOC_NOT_FOUND", async () => {
    const { service } = makeService();
    const result = await service.set("prd-nonexistent", { content: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });
});

// ─── delete ──────────────────────────────────────────────────────────────────

describe("delete", () => {
  it("AC-SVC-005.01: without confirm → DELETE_REQUIRES_CONFIRM", async () => {
    const { service } = makeService();
    const r = await service.create(prdInput("To Delete"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const deleteResult = await service.delete(r.value.slug, false);
    expect(deleteResult.ok).toBe(false);
    if (deleteResult.ok) return;
    expect(deleteResult.error.code).toBe("DELETE_REQUIRES_CONFIRM");
  });

  it("AC-SVC-005.02: with confirm → soft deleted, returns recoverable_until", async () => {
    const { service } = makeService();
    const r = await service.create(prdInput("Delete Me"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const deleteResult = await service.delete(r.value.slug, true);
    expect(deleteResult.ok).toBe(true);
    if (!deleteResult.ok) return;
    expect(deleteResult.value.id).toBe(r.value.id);
    expect(deleteResult.value.recoverable_until).toBeTruthy();

    // Doc should no longer appear in list
    const listResult = await service.list({});
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    const ids = listResult.value.docs.map((d) => d.id);
    expect(ids).not.toContain(r.value.id);
  });

  it("AC-SVC-005.03: delete creates version record with action=delete", async () => {
    const { service, store } = makeService();
    const r = await service.create(prdInput("Delete Versioned"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    await service.delete(r.value.slug, true);

    const versionsResult = await store.findVersions(r.value.id);
    expect(versionsResult.ok).toBe(true);
    if (!versionsResult.ok) return;
    const actions = versionsResult.value.map((v) => v.action);
    expect(actions).toContain("delete");
  });
});

// ─── list ────────────────────────────────────────────────────────────────────

describe("list", () => {
  it("AC-SVC-006.01: filter by type → correct subset", async () => {
    const { service } = makeService();
    const prd = await service.create(prdInput("PRD 1"));
    expect(prd.ok).toBe(true);
    if (!prd.ok) return;

    await service.create(adrInput("ADR 1"));
    await service.create(adrInput("ADR 2"));

    const prds = await service.list({ type: "prd" });
    expect(prds.ok).toBe(true);
    if (!prds.ok) return;
    expect(prds.value.docs.length).toBe(1);
    expect(prds.value.total).toBe(1);
    expect(prds.value.docs[0]?.type).toBe("prd");

    const adrs = await service.list({ type: "adr" });
    expect(adrs.ok).toBe(true);
    if (!adrs.ok) return;
    expect(adrs.value.docs.length).toBe(2);
  });

  it("AC-SVC-006.02: list all docs → returns all active docs", async () => {
    const { service } = makeService();
    await service.create(prdInput("Doc 1"));
    await service.create(prdInput("Doc 2"));
    await service.create(adrInput("ADR 1"));

    const result = await service.list({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total).toBe(3);
  });

  it("AC-SVC-006.E01: empty corpus → list returns empty", async () => {
    const { service } = makeService();
    const result = await service.list({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.docs).toHaveLength(0);
    expect(result.value.total).toBe(0);
  });
});

// ─── search ──────────────────────────────────────────────────────────────────

describe("search", () => {
  it("AC-SVC-007.01: matching query → results returned", async () => {
    const { service } = makeService();
    await service.create(prdInput("Authentication System"));
    await service.create(prdInput("User Management"));

    const result = await service.search("authentication");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results.length).toBe(1);
    expect(result.value.results[0]?.title).toContain("Authentication");
  });

  it("AC-SVC-007.N01: no match → empty results", async () => {
    const { service } = makeService();
    await service.create(prdInput("Some Document"));

    const result = await service.search("zzznomatch");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results.length).toBe(0);
  });

  it("AC-SVC-007.E01: empty query → empty results", async () => {
    const { service } = makeService();
    await service.create(prdInput("Test Doc"));

    const result = await service.search("");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results).toHaveLength(0);
  });
});

// ─── tree ────────────────────────────────────────────────────────────────────

describe("tree", () => {
  it("AC-SVC-008.01: PRD with 3 child specs → tree has 3 children", async () => {
    const { service } = makeService();
    const prd = await service.create(prdInput("Root PRD"));
    expect(prd.ok).toBe(true);
    if (!prd.ok) return;

    await service.create(specInput(prd.value.id, "Spec A"));
    await service.create(specInput(prd.value.id, "Spec B"));
    await service.create(specInput(prd.value.id, "Spec C"));

    const treeResult = await service.tree(prd.value.id);
    expect(treeResult.ok).toBe(true);
    if (!treeResult.ok) return;
    expect(treeResult.value.doc.id).toBe(prd.value.id);
    expect(treeResult.value.children.length).toBe(3);
  });

  it("AC-SVC-008.02: no root given → uses first PRD", async () => {
    const { service } = makeService();
    const prd = await service.create(prdInput("First PRD"));
    expect(prd.ok).toBe(true);
    if (!prd.ok) return;

    const treeResult = await service.tree();
    expect(treeResult.ok).toBe(true);
    if (!treeResult.ok) return;
    expect(treeResult.value.doc.id).toBe(prd.value.id);
  });

  it("AC-SVC-008.03: depth=1 → children only, no grandchildren", async () => {
    const { service } = makeService();
    const prd = await service.create(prdInput("Depth Test PRD"));
    expect(prd.ok).toBe(true);
    if (!prd.ok) return;

    const spec = await service.create(specInput(prd.value.id, "Child Spec"));
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;

    await service.create(specInput(spec.value.id, "Grandchild"));

    const treeResult = await service.tree(prd.value.id, { depth: 1 });
    expect(treeResult.ok).toBe(true);
    if (!treeResult.ok) return;
    expect(treeResult.value.children.length).toBe(1);
    expect(treeResult.value.children[0]?.children).toHaveLength(0);
  });

  it("AC-SVC-008.N01: no PRD in corpus → DOC_NOT_FOUND", async () => {
    const { service } = makeService();
    const result = await service.tree();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });
});

// ─── link / unlink ───────────────────────────────────────────────────────────

describe("link", () => {
  it("AC-SVC-009.01: create relates-to link → findLinks returns it", async () => {
    const { service, store } = makeService();
    const r1 = await service.create(prdInput("Doc A"));
    const r2 = await service.create(prdInput("Doc B"));
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    const linkResult = await service.link(r1.value.id, r2.value.id, "relates-to");
    expect(linkResult.ok).toBe(true);
    if (!linkResult.ok) return;
    expect(linkResult.value.link_type).toBe("relates-to");

    const findResult = await store.findLinks(r1.value.id, "out");
    expect(findResult.ok).toBe(true);
    if (!findResult.ok) return;
    expect(findResult.value.length).toBe(1);
    expect(findResult.value[0]?.to_id).toBe(r2.value.id);
  });

  it("AC-SVC-009.02: parent link → updates from doc parent_id", async () => {
    const { service, store } = makeService();
    const r1 = await service.create(prdInput("Parent"));
    const r2 = await service.create(prdInput("Child to reparent"));
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    const linkResult = await service.link(r2.value.id, r1.value.id, "parent");
    expect(linkResult.ok).toBe(true);

    const findResult = await store.find(r2.value.id);
    expect(findResult.ok).toBe(true);
    if (!findResult.ok) return;
    expect(findResult.value?.parent_id).toBe(r1.value.id);
  });

  it("AC-SVC-009.03: unlink removes the link", async () => {
    const { service, store } = makeService();
    const r1 = await service.create(prdInput("A"));
    const r2 = await service.create(prdInput("B"));
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    await service.link(r1.value.id, r2.value.id, "relates-to");
    const unlinkResult = await service.unlink(r1.value.id, r2.value.id);
    expect(unlinkResult.ok).toBe(true);

    const findResult = await store.findLinks(r1.value.id, "out");
    expect(findResult.ok).toBe(true);
    if (!findResult.ok) return;
    expect(findResult.value.length).toBe(0);
  });

  it("AC-SVC-009.N01: link to nonexistent doc → DOC_NOT_FOUND", async () => {
    const { service } = makeService();
    const r = await service.create(prdInput("Linker"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const result = await service.link(r.value.id, "prd-nonexistent-slug", "relates-to");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });
});

// ─── status ──────────────────────────────────────────────────────────────────

describe("status", () => {
  it("AC-SVC-010.01: returns correct counts", async () => {
    const { service } = makeService();
    await service.create(prdInput("PRD 1"));
    await service.create(prdInput("PRD 2"));
    await service.create(adrInput("ADR 1"));

    const result = await service.status();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.total_docs).toBe(3);
    expect(result.value.by_type["prd"]).toBe(2);
    expect(result.value.by_type["adr"]).toBe(1);
    expect(result.value.by_status["draft"]).toBe(3);
    expect(result.value.last_updated).toBeTruthy();
  });

  it("AC-SVC-010.E01: empty corpus → total_docs = 0", async () => {
    const { service } = makeService();
    const result = await service.status();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total_docs).toBe(0);
  });

  it("AC-SVC-010.02: deleted docs not counted in total", async () => {
    const { service } = makeService();
    const r = await service.create(prdInput("To Delete"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    await service.delete(r.value.slug, true);

    const result = await service.status();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total_docs).toBe(0);
  });
});
