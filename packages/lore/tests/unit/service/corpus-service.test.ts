/**
 * Unit tests for CorpusService.
 * Uses InMemoryStore — no file I/O, no SQLite dependency.
 * Covers: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION cases.
 * @spec_ref AC-SVC-001
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import type { CreateDocInput, DocId } from "@lore/core";

// ─── Test helpers ───────────────────────────────────────────────────────────

function makeStore() {
  return new InMemoryStore();
}

function makeService(store = makeStore()) {
  return { service: new CorpusService(store, new RecordLockService(store)), store };
}

/** Create a valid PRD input */
function prdInput(title = "My Product"): CreateDocInput {
  return { type: "prd", title };
}

/** Create a valid spec input — a spec takes NO parent (BR-1) */
function specInput(title = "My Spec"): CreateDocInput {
  return { type: "spec", title };
}

/** Create a valid plan input under a parent (the parent-taking child used for tree/navigation shapes) */
function planInput(parentId: string, title = "My Plan"): CreateDocInput {
  return { type: "plan", title, parent_id: parentId };
}

/**
 * A spec carrying a parent_id — the LEGACY pre-migration shape (`lore migrate spec-parents` clears it).
 * reason: create refuses a spec parent (BR-2), so the shape is built the way a corrupted/legacy row
 * arises: a parentless create, then a direct store write. Tests of tree walking and ancestry must still
 * hold on such rows until the migration has run.
 */
async function createLegacyParentedSpec(
  service: CorpusService,
  store: InMemoryStore,
  parentId: string,
  title: string,
) {
  const created = await service.create(specInput(title));
  if (!created.ok) return created;
  const updated = await store.update(created.value.id, { parent_id: parentId as DocId });
  if (!updated.ok) return updated;
  return created.ok ? { ...created, value: updated.value } : created;
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
  it("AC-SVC-002.01: spec with no parent → success, slug auto-generated, parent_id null (BR-1)", async () => {
    const { service } = makeService();
    const specResult = await service.create(specInput("Auth Feature"));
    expect(specResult.ok).toBe(true);
    if (!specResult.ok) return;

    expect(specResult.value.type).toBe("spec");
    expect(specResult.value.slug).toMatch(/^spec-/);
    expect(specResult.value.parent_id).toBeNull();
    expect(specResult.value.version).toBe(1);
    expect(specResult.value.status).toBe("draft");
  });

  it("AC-SVC-002.02: a parent-taking type (plan) can resolve its parent by slug", async () => {
    const { service } = makeService();
    const prdResult = await service.create(prdInput("Root PRD"));
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) return;

    const prdSlug = prdResult.value.slug;
    const planResult = await service.create(planInput(prdSlug, "Child Plan"));
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    expect(planResult.value.parent_id).toBe(prdResult.value.id);
  });

  it("AC-SVC-002.03: spec WITH a parent (by id or slug) → VALIDATION_ERROR naming citations, nothing written (BR-2)", async () => {
    const { service, store } = makeService();
    const prd = await service.create(prdInput("Root PRD"));
    expect(prd.ok).toBe(true);
    if (!prd.ok) return;
    for (const parent of [prd.value.id as string, prd.value.slug as string]) {
      const result = await service.create({ type: "spec", title: "Filed Spec", parent_id: parent });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_ERROR");
      if (result.error.code === "VALIDATION_ERROR") {
        expect(result.error.message).toContain("lore ac cite");
      }
    }
    const specs = await store.findMany({ type: "spec" });
    expect(specs.ok && specs.value.length).toBe(0);
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

  // spec_kind taxonomy default materialization (SPEC-032 §3.1) — Zod superRefine
  // cannot inject a default (addIssue only), so CorpusService._createImpl is the
  // sole place that materializes "feature" when the field is absent at creation.
  describe("spec_kind (SPEC-032 §3.1)", () => {
    it("AC-SPECKIND.SVC-01: spec created with no --kind → extra.spec_kind defaults to 'feature'", async () => {
      const { service } = makeService();
      const prdResult = await service.create(prdInput("Root PRD"));
      expect(prdResult.ok).toBe(true);
      if (!prdResult.ok) return;

      const specResult = await service.create(specInput("Undeclared Kind Spec"));
      expect(specResult.ok).toBe(true);
      if (!specResult.ok) return;
      expect(specResult.value.extra["spec_kind"]).toBe("feature");
    });

    it("AC-SPECKIND.SVC-02: spec created with extra.spec_kind='design' persists 'design' (no override)", async () => {
      const { service } = makeService();
      const prdResult = await service.create(prdInput("Root PRD"));
      expect(prdResult.ok).toBe(true);
      if (!prdResult.ok) return;

      const specResult = await service.create({
        type: "spec",
        title: "Design Spec",
        extra: { spec_kind: "design" },
      });
      expect(specResult.ok).toBe(true);
      if (!specResult.ok) return;
      expect(specResult.value.extra["spec_kind"]).toBe("design");
    });

    it("AC-SPECKIND.SVC-N01: spec created with extra.spec_kind='bogus' → VALIDATION_ERROR", async () => {
      const { service } = makeService();
      const prdResult = await service.create(prdInput("Root PRD"));
      expect(prdResult.ok).toBe(true);
      if (!prdResult.ok) return;

      const specResult = await service.create({
        type: "spec",
        title: "Bogus Kind Spec",
        extra: { spec_kind: "bogus" },
      });
      expect(specResult.ok).toBe(false);
      if (specResult.ok) return;
      expect(specResult.error.code).toBe("VALIDATION_ERROR");
    });

    it("[regression] non-spec types are never defaulted with spec_kind", async () => {
      const { service } = makeService();
      const prdResult = await service.create(prdInput("Plain PRD"));
      expect(prdResult.ok).toBe(true);
      if (!prdResult.ok) return;
      expect(prdResult.value.extra["spec_kind"]).toBeUndefined();
    });

    it("[boundary] existing extra keys survive spec_kind default materialization", async () => {
      const { service } = makeService();
      const prdResult = await service.create(prdInput("Root PRD"));
      expect(prdResult.ok).toBe(true);
      if (!prdResult.ok) return;

      const specResult = await service.create({
        type: "spec",
        title: "Spec With Other Extra",
        extra: { custom_field: "preserved" },
      });
      expect(specResult.ok).toBe(true);
      if (!specResult.ok) return;
      expect(specResult.value.extra["spec_kind"]).toBe("feature");
      expect(specResult.value.extra["custom_field"]).toBe("preserved");
    });
  });
});

// ─── get ────────────────────────────────────────────────────────────────────

describe("get", () => {
  it("AC-SVC-003.01: get by slug → returns doc with navigation (parent=null, children populated)", async () => {
    const { service } = makeService();
    const prdResult = await service.create(prdInput("Navigation Root"));
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) return;

    const specResult = await service.create(planInput(prdResult.value.id, "Child A"));
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

    const spec1 = await service.create(planInput(prdResult.value.id, "Sibling A"));
    const spec2 = await service.create(planInput(prdResult.value.id, "Sibling B"));
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

// ─── get — ancestors (SPEC-036 §2 D1) ───────────────────────────────────────
//
// Six-dimension note: this block covers HAPPY (AC-36-1, full chain + root-doc
// empty case) and REGRESSION (AC-36-2, cycle + broken-parent-ref termination —
// "REGRESSION" because these are exactly the runaway/hang failure modes the
// depth-cap + seen-set guards in `_getImpl` exist to prevent from ever
// recurring). NEGATIVE/BOUNDARY/ERROR/STATE for `get()` itself are already
// covered by the pre-existing "get" describe block above; this block is scoped
// to the ancestors field specifically, per dispatch instructions.

describe("get — ancestors (SPEC-036 §2 D1)", () => {
  it("AC-36-1: 4-level chain prd→spec→plan→task → ancestors is [prd, spec, plan], root-first, self excluded", async () => {
    const { service, store } = makeService();
    const prd = await service.create(prdInput("Root PRD"));
    expect(prd.ok).toBe(true);
    if (!prd.ok) return;

    const spec = await createLegacyParentedSpec(service, store, prd.value.id, "Mid Spec");
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;

    const plan = await service.create({
      type: "plan",
      title: "The Plan",
      parent_id: spec.value.id,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const task = await service.create({
      type: "task",
      title: "The Task",
      parent_id: plan.value.id,
      extra: { plan_id: plan.value.id },
    });
    expect(task.ok).toBe(true);
    if (!task.ok) return;

    const getResult = await service.get(task.value.id);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.value.navigation.ancestors.map((a) => a.id)).toEqual([
      prd.value.id,
      spec.value.id,
      plan.value.id,
    ]);
    // self is excluded from its own ancestor chain
    expect(getResult.value.navigation.ancestors.some((a) => a.id === task.value.id)).toBe(false);
  });

  it("AC-36-1: a root doc (no parent) → ancestors is []", async () => {
    const { service } = makeService();
    const prd = await service.create(prdInput("Lonely Root"));
    expect(prd.ok).toBe(true);
    if (!prd.ok) return;

    const getResult = await service.get(prd.value.id);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.value.navigation.ancestors).toEqual([]);
  });

  it("AC-36-2: a manufactured parent_id cycle (A→C→B→A) terminates with the bounded pre-cycle chain, not a hang or error", async () => {
    const { service, store } = makeService();
    const a = await service.create(prdInput("Node A"));
    expect(a.ok).toBe(true);
    if (!a.ok) return;

    const b = await createLegacyParentedSpec(service, store, a.value.id, "Node B");
    expect(b.ok).toBe(true);
    if (!b.ok) return;

    const c = await service.create({ type: "plan", title: "Node C", parent_id: b.value.id });
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    // Manufacture the cycle A → C by bypassing CorpusService's normal create-time
    // validation — this is exactly how a corrupted/legacy row could arise (the
    // supported write path never lets a doc become its own descendant's parent).
    const rewire = await store.update(a.value.id, { parent_id: c.value.id });
    expect(rewire.ok).toBe(true);

    const getResult = await service.get(a.value.id);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;

    const ancestorIds = getResult.value.navigation.ancestors.map((x) => x.id);
    // bounded: at most the 3 participants, never growing without limit
    expect(ancestorIds.length).toBeLessThanOrEqual(3);
    // no duplicate ids — the seen-set guard stops re-visiting a node
    expect(new Set(ancestorIds).size).toBe(ancestorIds.length);

    // also check from a different entry point in the same cycle
    const getResultC = await service.get(c.value.id);
    expect(getResultC.ok).toBe(true);
    if (!getResultC.ok) return;
    const ancestorIdsC = getResultC.value.navigation.ancestors.map((x) => x.id);
    expect(ancestorIdsC.length).toBeLessThanOrEqual(3);
    expect(new Set(ancestorIdsC).size).toBe(ancestorIdsC.length);
  });

  it("AC-36-2: a broken parent_id ref (points at a never-inserted ULID) → ok:true with ancestors: [], not an error", async () => {
    const { service, store } = makeService();
    const doc = await service.create(prdInput("Has A Broken Parent Later"));
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;

    const ghostId = "01HGHOSTPARENTDOESNOTEXIST";
    const rewire = await store.update(doc.value.id, { parent_id: ghostId });
    expect(rewire.ok).toBe(true);

    const getResult = await service.get(doc.value.id);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.value.navigation.ancestors).toEqual([]);
    expect(getResult.value.navigation.parent).toBeNull();
  });
});

// ─── list / get — DocSummary type-differentiated meta (SPEC-036 §2 D3, AC-36-7) ─

describe("list — DocSummary meta field (AC-36-7)", () => {
  it("a freshly created task with no evidence/claim → meta is { t:'task', evidence_pass:0, evidence_fail:0 }, claimed_by absent; tags/priority present", async () => {
    const { service } = makeService();
    const plan = await service.create({ type: "plan", title: "Plan For Task Meta" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const task = await service.create({
      type: "task",
      title: "Fresh Task",
      parent_id: plan.value.id,
      extra: { plan_id: plan.value.id },
    });
    expect(task.ok).toBe(true);
    if (!task.ok) return;

    const listResult = await service.list({ type: "task" });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;

    const summary = listResult.value.docs.find((d) => d.id === task.value.id);
    expect(summary).toBeDefined();
    if (!summary) return;
    expect(Array.isArray(summary.tags)).toBe(true);
    expect(summary.priority).toBeDefined();
    expect(summary.meta).toEqual({ t: "task", evidence_pass: 0, evidence_fail: 0 });
    expect(summary.meta && "claimed_by" in summary.meta).toBe(false);
  });

  it("a freshly created spec (no explicit spec_kind) → meta is { t:'spec', kind:'feature' } (create-time default)", async () => {
    const { service } = makeService();
    const prd = await service.create(prdInput("Parent For Spec Meta"));
    expect(prd.ok).toBe(true);
    if (!prd.ok) return;

    const spec = await service.create(specInput("Spec With Default Kind"));
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;

    const listResult = await service.list({ type: "spec" });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;

    const summary = listResult.value.docs.find((d) => d.id === spec.value.id);
    expect(summary).toBeDefined();
    if (!summary) return;
    expect(summary.meta).toEqual({ t: "spec", kind: "feature" });
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
    // reason: canonicaliseBody is applied on write — content always ends with exactly one "\n".
    expect(setResult.value.content).toBe("Updated content\n");
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

  // ─── AC-1 (SPEC-032 §3.1): spec_kind cross-cutting validation on the update path ──
  // reason: docPatchSchema.extra is untyped z.record(z.unknown()) — HTTP/MCP callers
  // bypass the CLI's client-side --kind self-validation. set() is the single choke
  // point covering CLI/HTTP/MCP, so this is where the gap must close.

  it("AC-SVC-004.06: set extra.spec_kind to an unknown value on a spec → VALIDATION_ERROR", async () => {
    const { service } = makeService();
    const parent = await service.create(prdInput("Spec Kind Parent"));
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    const spec = await service.create(specInput("Kind Target Spec"));
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;

    const result = await service.set(spec.value.slug, { extra: { spec_kind: "bogus" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code === "VALIDATION_ERROR") {
      expect(result.error.field).toBe("extra.spec_kind");
    }
  });

  it("AC-SVC-004.07: set extra.spec_kind to a valid taxonomy value on a spec → ok", async () => {
    const { service } = makeService();
    const parent = await service.create(prdInput("Spec Kind Parent Valid"));
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    const spec = await service.create(specInput("Kind Target Spec Valid"));
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;

    const result = await service.set(spec.value.slug, { extra: { spec_kind: "tech" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["spec_kind"]).toBe("tech");
  });

  it("AC-SVC-004.08: set extra on a spec with spec_kind absent → ok, no default forced", async () => {
    const { service } = makeService();
    const parent = await service.create(prdInput("Spec Kind Parent Absent"));
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    const spec = await service.create(specInput("Kind Target Spec Absent"));
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;
    // create() defaults spec_kind to "feature" when absent (SPEC-032 §3.1) — patch a
    // different extra key without touching spec_kind, and confirm the create-time
    // default is preserved (set() must not re-derive or strip it).
    expect(spec.value.extra["spec_kind"]).toBe("feature");

    const result = await service.set(spec.value.slug, { extra: { some_other_field: "x" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["spec_kind"]).toBeUndefined();
    expect(result.value.extra["some_other_field"]).toBe("x");
  });

  it("AC-SVC-004.09: set arbitrary extra on a non-spec doc → unaffected by spec_kind validation", async () => {
    const { service } = makeService();
    const r = await service.create(prdInput("Non-Spec Extra Doc"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const result = await service.set(r.value.slug, { extra: { spec_kind: "bogus", note: "fine" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["spec_kind"]).toBe("bogus");
    expect(result.value.extra["note"]).toBe("fine");
  });

  // ─── BUG-003 (audit finding): opts.expectedVersion closes the lost-update race ──
  // reason: pre-fix, set()'s CAS ALWAYS used its own fresh-read `existing.version`,
  // making a caller's own optimistic-concurrency precheck (e.g. dashboard's
  // If-Match header) purely advisory — two concurrent writers who both read v1
  // could BOTH reach set(), and the second one's fresh internal read would
  // already see v2 (the first writer's commit), CAS'ing against ITS OWN fresh
  // read instead of the v1 it actually validated against — silently overwriting
  // the first writer's commit with no conflict ever surfacing (classic lost
  // update). `opts.expectedVersion` closes this: it REPLACES the internal
  // fresh-read with the CALLER's declared version.

  it("BUG-003: two writers both declaring expectedVersion=1 (a simulated A/B race) — A wins, B receives STALE_VERSION instead of a silent lost update", async () => {
    const { service } = makeService();
    const created = await service.create(prdInput("Race Doc"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.version).toBe(1);

    // Writer A and writer B both read version 1 (simulated: both declare
    // expectedVersion: 1, the version they believe is current).
    const writerA = await service.set(created.value.id, { title: "Committed by A" }, { expectedVersion: 1 });
    expect(writerA.ok).toBe(true);
    if (!writerA.ok) return;
    expect(writerA.value.version).toBe(2);
    expect(writerA.value.title).toBe("Committed by A");

    // Writer B's set() call happens AFTER A's commit — by the time B's OWN
    // internal find() runs, the row is already at v2, but B still declares its
    // ORIGINAL v1 belief via expectedVersion. Pre-fix, set() would have CAS'd
    // against its own fresh internal read (v2) and silently overwritten A's
    // commit. Fixed: B's declared v1 no longer matches the row's TRUE current
    // version (2), so the CAS correctly rejects it.
    const writerB = await service.set(created.value.id, { title: "Committed by B" }, { expectedVersion: 1 });
    expect(writerB.ok).toBe(false);
    if (writerB.ok) return;
    expect(writerB.error.code).toBe("STALE_VERSION");
    if (writerB.error.code !== "STALE_VERSION") return;
    expect(writerB.error.expected).toBe(1);
    expect(writerB.error.actual).toBe(2);

    // STATE: A's commit survives untouched — no lost update.
    const finalGet = await service.get(created.value.id);
    expect(finalGet.ok).toBe(true);
    if (!finalGet.ok) return;
    expect(finalGet.value.doc.title).toBe("Committed by A");
    expect(finalGet.value.doc.version).toBe(2);
  });

  it("REGRESSION: omitting opts (no expectedVersion) preserves the pre-fix byte-identical CAS-against-fresh-read behavior", async () => {
    const { service } = makeService();
    const created = await service.create(prdInput("No Opts Doc"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // No opts passed at all — set() falls back to CAS'ing against its own
    // fresh existing.version, exactly like every pre-BUG-003-fix caller.
    const result = await service.set(created.value.id, { title: "Updated" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(2);
    expect(result.value.title).toBe("Updated");
  });

  it("BOUNDARY: expectedVersion matching the doc's true current version succeeds normally", async () => {
    const { service } = makeService();
    const created = await service.create(prdInput("Matching Version Doc"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await service.set(created.value.id, { title: "Matched" }, { expectedVersion: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(2);
  });
});

// ─── set — status transition validation (B1 blocker fix) ────────────────────
// reason: pre-fix, CorpusService.set() never consulted VALID_TRANSITIONS —
// only ReviewService.approve/reject did. Any caller (lore set --status, the
// HTTP dashboard PATCH route, MCP lore_set) could force an illegal jump
// (archived→active, approved→draft, draft→archived — the last skips every
// spec-promote gate since GateEnforcer only fires on a →approved transition).

describe("set — status transition validation (B1)", () => {
  it("AC-SVC-004.10: user-requested archived→active → INVALID_TRANSITION", async () => {
    const { service } = makeService();
    const r = await service.create(prdInput("Archived Doc"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // draft → approved (fast-track) → archived, both legal per VALID_TRANSITIONS.
    const approved = await service.set(r.value.slug, { status: "approved" });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const archived = await service.set(r.value.slug, { status: "archived" });
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(archived.value.status).toBe("archived");

    const result = await service.set(r.value.slug, { status: "active" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_TRANSITION");
    if (result.error.code === "INVALID_TRANSITION") {
      expect(result.error.from).toBe("archived");
      expect(result.error.to).toBe("active");
      expect(result.error.allowed).toEqual([]);
    }
  });

  it("AC-SVC-004.11: user-requested approved→draft (explicit --status, no content change) → INVALID_TRANSITION", async () => {
    const { service } = makeService();
    const r = await service.create(prdInput("Explicit Draft Doc"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const approved = await service.set(r.value.slug, { status: "approved" });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    // No content/title in this patch — this must NOT be conflated with the
    // auto-reset-on-edit invariant (AC-SVC-004.02/.03), which is a distinct,
    // internal, sanctioned path.
    const result = await service.set(r.value.slug, { status: "draft" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_TRANSITION");
    if (result.error.code === "INVALID_TRANSITION") {
      expect(result.error.from).toBe("approved");
      expect(result.error.to).toBe("draft");
      expect(result.error.allowed.sort()).toEqual(["active", "archived", "deprecated"]);
    }
  });

  it("AC-SVC-004.12: user-requested draft→archived → INVALID_TRANSITION (skips every workflow gate otherwise)", async () => {
    const { service } = makeService();
    const r = await service.create(prdInput("Skip Gate Doc"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const result = await service.set(r.value.slug, { status: "archived" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_TRANSITION");
    if (result.error.code === "INVALID_TRANSITION") {
      expect(result.error.from).toBe("draft");
      expect(result.error.to).toBe("archived");
      expect(result.error.allowed.sort()).toEqual(["approved", "in-review"]);
    }
  });

  it("AC-SVC-004.13 (REGRESSION): editing content on an approved doc still auto-resets to draft, unaffected by the new check", async () => {
    const { service } = makeService();
    const r = await service.create(prdInput("Regression Auto Reset Doc"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const approved = await service.set(r.value.slug, { status: "approved" });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const result = await service.set(r.value.slug, { content: "Edited content triggers auto-reset" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("draft");
  });

  it("AC-SVC-004.14 (REGRESSION): legal user-requested transition (draft→in-review) still succeeds", async () => {
    const { service } = makeService();
    const r = await service.create(prdInput("In Review Doc"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const result = await service.set(r.value.slug, { status: "in-review" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("in-review");
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

// ─── list — limit/offset paging ────────────────────────────────────────────

describe("list — limit/offset paging", () => {
  it("STATE (REGRESSION) — absent limit/offset returns ALL matching docs, unpaged", async () => {
    const { service } = makeService();
    await service.create(prdInput("Doc 1"));
    await service.create(prdInput("Doc 2"));
    await service.create(prdInput("Doc 3"));

    const result = await service.list({ type: "prd" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.docs).toHaveLength(3);
    expect(result.value.total).toBe(3);
  });

  it("HAPPY — limit truncates the returned page and total reflects the page size", async () => {
    const { service } = makeService();
    await service.create(prdInput("Doc 1"));
    await service.create(prdInput("Doc 2"));
    await service.create(prdInput("Doc 3"));

    const result = await service.list({ type: "prd", limit: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.docs).toHaveLength(2);
    expect(result.value.total).toBe(2);
  });

  it("HAPPY — limit + offset page through the full set without overlap", async () => {
    const { service } = makeService();
    const created = await Promise.all([
      service.create(prdInput("Doc 1")),
      service.create(prdInput("Doc 2")),
      service.create(prdInput("Doc 3")),
    ]);
    expect(created.every((r) => r.ok)).toBe(true);

    const page1 = await service.list({ type: "prd", limit: 2, offset: 0 });
    const page2 = await service.list({ type: "prd", limit: 2, offset: 2 });
    expect(page1.ok && page2.ok).toBe(true);
    if (!page1.ok || !page2.ok) return;

    expect(page1.value.docs).toHaveLength(2);
    expect(page2.value.docs).toHaveLength(1);
    const page1Ids = new Set(page1.value.docs.map((d) => d.id));
    const page2Ids = new Set(page2.value.docs.map((d) => d.id));
    expect([...page1Ids].some((id) => page2Ids.has(id))).toBe(false);
  });

  it("BOUNDARY — limit 0 returns an empty page, no error", async () => {
    const { service } = makeService();
    await service.create(prdInput("Doc 1"));

    const result = await service.list({ type: "prd", limit: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.docs).toEqual([]);
    expect(result.value.total).toBe(0);
  });

  it("BOUNDARY — offset beyond the matching row count returns an empty page, no error", async () => {
    const { service } = makeService();
    await service.create(prdInput("Doc 1"));

    const result = await service.list({ type: "prd", limit: 10, offset: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.docs).toEqual([]);
  });
});

// ─── listFull — limit/offset paging ────────────────────────────────────────

describe("listFull — limit/offset paging", () => {
  it("STATE (REGRESSION) — absent limit/offset returns ALL matching docs, unpaged", async () => {
    const { service } = makeService();
    await service.create(prdInput("Doc 1"));
    await service.create(prdInput("Doc 2"));

    const result = await service.listFull({ type: "prd" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.docs).toHaveLength(2);
    expect(result.value.total).toBe(2);
  });

  it("HAPPY — limit/offset page a full-DocRecord listing exactly like list()", async () => {
    const { service } = makeService();
    await service.create(prdInput("Doc 1"));
    await service.create(prdInput("Doc 2"));
    await service.create(prdInput("Doc 3"));

    const result = await service.listFull({ type: "prd", limit: 2, offset: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.docs).toHaveLength(2);
    // full DocRecord rows carry `extra`/`content` — not stripped like list()'s DocSummary.
    expect(result.value.docs[0]).toHaveProperty("content");
  });

  it("BOUNDARY — limit 0 returns an empty page, no error", async () => {
    const { service } = makeService();
    await service.create(prdInput("Doc 1"));

    const result = await service.listFull({ type: "prd", limit: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.docs).toEqual([]);
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
    const { service, store } = makeService();
    const prd = await service.create(prdInput("Root PRD"));
    expect(prd.ok).toBe(true);
    if (!prd.ok) return;

    await createLegacyParentedSpec(service, store, prd.value.id, "Spec A");
    await createLegacyParentedSpec(service, store, prd.value.id, "Spec B");
    await createLegacyParentedSpec(service, store, prd.value.id, "Spec C");

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
    const { service, store } = makeService();
    const prd = await service.create(prdInput("Depth Test PRD"));
    expect(prd.ok).toBe(true);
    if (!prd.ok) return;

    const spec = await createLegacyParentedSpec(service, store, prd.value.id, "Child Spec");
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;

    await service.create(planInput(spec.value.id, "Grandchild"));

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

  // ─── BUG-008 (audit finding): buildTreeNode hard recursion-depth backstop ──
  // reason: `remainingDepth <= 0` never terminates for a NaN/Infinity `depth`
  // (both comparisons are `false` in JS) — combined with a manufactured
  // parent_id cycle (a store-level defect `addLink`'s cycle guard cannot see,
  // since it only guards the SEPARATE `links` table, not the `parent_id`
  // column `buildTreeNode` actually walks), this would recurse without bound.

  function treeDepth(node: { children: { children: unknown[] }[] }): number {
    if (node.children.length === 0) return 1;
    return 1 + Math.max(...node.children.map((c) => treeDepth(c as typeof node)));
  }

  it("BUG-008: NaN depth + a manufactured parent_id cycle terminates within the hard cap instead of recursing forever", async () => {
    const { service, store } = makeService();
    // reason: PARENT_TYPE_CONTRACT only allows spec←prd (not spec←spec) — use
    // the prd→spec→plan chain (all valid parent-type pairs) for a 3-node cycle.
    const a = await service.create(prdInput("Cycle A"));
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = await createLegacyParentedSpec(service, store, a.value.id, "Cycle B");
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const c = await service.create({ type: "plan", title: "Cycle C", parent_id: b.value.id });
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    // Manufacture the cycle DIRECTLY on the store — bypasses `addLink`'s
    // cycle guard entirely (that guard only protects the `links` table;
    // `buildTreeNode` walks children purely via the `parent_id` COLUMN, which
    // `store.update` never cycle-checks). A → B → C → A, forever, without a
    // hard cap.
    const cycleUpdate = await store.update(a.value.id, { parent_id: c.value.id });
    expect(cycleUpdate.ok).toBe(true);

    const treeResult = await service.tree(a.value.id, { depth: NaN });
    expect(treeResult.ok).toBe(true);
    if (!treeResult.ok) return;

    // Terminates (no stack overflow, no hang) AND is bounded — NOT the full
    // unbounded cycle depth. hardDepthBudget starts at TREE_NODE_DEPTH_CAP
    // (20) and is checked with `<= 0`, so the root itself (budget=20) plus
    // 20 further descents (budget 19..0) is the true ceiling: 21 node-levels.
    expect(treeDepth(treeResult.value)).toBeLessThanOrEqual(21);
  });

  it("BUG-008: Infinity depth on a normal (non-cyclic) tree still terminates within the hard cap", async () => {
    const { service, store } = makeService();
    const prd = await service.create(prdInput("Infinity Depth PRD"));
    expect(prd.ok).toBe(true);
    if (!prd.ok) return;
    await createLegacyParentedSpec(service, store, prd.value.id, "Only Child");

    const treeResult = await service.tree(prd.value.id, { depth: Infinity });
    expect(treeResult.ok).toBe(true);
    if (!treeResult.ok) return;

    // REGRESSION: a normal, shallow, non-cyclic tree is completely unaffected
    // by the hard cap — both levels are still present.
    expect(treeResult.value.children).toHaveLength(1);
    expect(treeDepth(treeResult.value)).toBeLessThanOrEqual(20);
  });

  it("REGRESSION: a sane finite depth (well under the hard cap) is completely unaffected by TREE_NODE_DEPTH_CAP", async () => {
    const { service, store } = makeService();
    const prd = await service.create(prdInput("Sane Depth PRD"));
    expect(prd.ok).toBe(true);
    if (!prd.ok) return;
    const spec = await createLegacyParentedSpec(service, store, prd.value.id, "Sane Child");
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;
    const grandchild = await service.create({ type: "plan", title: "Sane Grandchild", parent_id: spec.value.id });
    expect(grandchild.ok).toBe(true);

    const treeResult = await service.tree(prd.value.id, { depth: 3 });
    expect(treeResult.ok).toBe(true);
    if (!treeResult.ok) return;
    expect(treeResult.value.children).toHaveLength(1);
    expect(treeResult.value.children[0]?.children).toHaveLength(1);
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
    // AC-SVC-010.03: db_size_bytes delegates to store.dbSizeBytes(); InMemoryStore has no disk footprint
    expect(result.value.db_size_bytes).toBe(0);
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

  it("AC-SVC-010.E02: store.dbSizeBytes() failure propagates as STORE_ERROR — no silent fallback to 0", async () => {
    const store = makeStore();
    const brokenStore = Object.create(
      store,
      {
        dbSizeBytes: {
          value: () =>
            Promise.resolve({
              ok: false as const,
              error: { code: "STORE_ERROR" as const, message: "disk unreachable" },
            }),
        },
      },
    ) as InstanceType<typeof InMemoryStore>;
    const { service } = makeService(brokenStore);

    const result = await service.status();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");
  });
});
