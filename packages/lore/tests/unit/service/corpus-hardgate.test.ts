/**
 * RED-phase TDD tests for the create/link type-contract hard gate on CorpusService.
 *
 * These tests encode the SPEC behavior described in TECH-01KV4W88GZF74B98BHCBBV9GHD §4.1 + §10.
 * The implementation gate (TASK-01KV4XV263XKH7R3J3DTTG044D) does not yet exist.
 *
 * Expected RED tests (will FAIL until impl lands):
 *   - spec→task parent type gate (create path)
 *   - task→prd parent type gate (create path — task child, prd as parent is WRONG)
 *   - adr→task parent type gate (create path)
 *   - link(spec, task, "parent") type gate (link path)
 *
 * Expected GREEN tests (existing behavior already present):
 *   - create spec→prd succeeds (positive control — type gate should allow this)
 *   - create spec without parent_id → PARENT_REQUIRED (Zod two-stage defense)
 *   - link cycle B→A when A is already parent of B → LINK_CYCLE
 *   - link self→self → LINK_CYCLE
 *   - parent soft-deleted → DOC_NOT_FOUND (current impl already checks existence)
 *
 * @spec_ref AC-HARDGATE-001
 * @tdd_role red
 * @task_id TASK-01KV4XV263D8VD0PR852C7ME7Z
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import type { CreateDocInput } from "@lore/core";
import type { DocId, DocRecord } from "@lore/core";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import { ulid } from "ulidx";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeStore() {
  return new InMemoryStore();
}

function makeService(store = makeStore()) {
  return { service: new CorpusService(store), store };
}

/** Create a valid PRD (no parent required) */
function prdInput(title = "Root Product"): CreateDocInput {
  return { type: "prd", title };
}

/** Create a valid plan (no parent required) */
function planInput(title = "Phase Plan"): CreateDocInput {
  return { type: "plan", title };
}

/**
 * Insert a raw DocRecord directly into the store bypassing service Zod validation.
 * Use this to seed documents of types whose own creation constraints (e.g. task
 * requiring plan_id to exist) would otherwise force deep fixture chains.
 * This bypasses the SERVICE gate so we can test the SERVICE-level gate independently.
 */
async function insertRawDoc(
  store: InMemoryStore,
  type: DocRecord["type"],
  title: string,
  parentId?: DocId,
): Promise<DocRecord> {
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  const slug = `${type}-${title.toLowerCase().replace(/\s+/g, "-")}-${id.slice(-6)}`;
  const doc: DocRecord = {
    id,
    slug,
    type,
    role: DOC_TYPE_ROLE_MAP[type],
    title,
    status: "draft",
    priority: "medium",
    content: "",
    parent_id: parentId ?? null,
    created_at: now,
    updated_at: now,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: type === "task" ? { plan_id: parentId ?? "fake-plan-id" } : {},
  };
  const result = await store.insert(doc);
  if (!result.ok) throw new Error(`insertRawDoc failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

// ─── NEGATIVE: create path type-contract hard gate ────────────────────────────

describe("NEGATIVE — create: parent type contract hard gate (RED — impl missing)", () => {
  /**
   * Spec (§4.1): spec's allowed parent types = ["prd"].
   * If parent is a task, service MUST return INVALID_PARENT_TYPE, not succeed.
   *
   * Current impl: only checks parent EXISTS, not that parent TYPE is allowed.
   * This test will FAIL (RED) until the hard gate is added.
   */
  it("AC-HARDGATE-001.N01: create spec with task parent → INVALID_PARENT_TYPE (child=spec, parent=task, allowed=[prd])", async () => {
    const { service, store } = makeService();

    // Seed a task doc directly via store (bypasses service Zod, verifies service-level gate)
    const taskDoc = await insertRawDoc(store, "task", "Backend Task");

    const result = await service.create({
      type: "spec",
      title: "Auth Spec",
      parent_id: taskDoc.id,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return; // narrow for TS — test already fails above
    expect(result.error.code).toBe("INVALID_PARENT_TYPE");
    if (result.error.code === "INVALID_PARENT_TYPE") {
      expect(result.error.child).toBe("spec");
      expect(result.error.parent).toBe("task");
      expect(result.error.allowed).toContain("prd");
    }
  });

  /**
   * Spec (§4.1): adr's allowed parent types = ["prd"] (adr documents a decision
   * on a product, not on a task).
   *
   * Creating adr with task as parent MUST fail with INVALID_PARENT_TYPE.
   * This test will FAIL (RED) until the hard gate is added.
   */
  it("AC-HARDGATE-001.N02: create adr with task parent → INVALID_PARENT_TYPE (child=adr, parent=task)", async () => {
    const { service, store } = makeService();

    const taskDoc = await insertRawDoc(store, "task", "Infra Task");

    const result = await service.create({
      type: "adr",
      title: "Use TypeScript",
      parent_id: taskDoc.id,
      extra: { decision_status: "proposed" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_PARENT_TYPE");
    if (result.error.code === "INVALID_PARENT_TYPE") {
      expect(result.error.child).toBe("adr");
      expect(result.error.parent).toBe("task");
    }
  });

  /**
   * Spec (§4.1): plan's allowed parent types = ["prd"]. A plan cannot have a
   * task as its parent — that would be inverted hierarchy.
   *
   * This test will FAIL (RED) until the hard gate is added.
   */
  it("AC-HARDGATE-001.N03: create plan with task parent → INVALID_PARENT_TYPE (child=plan, parent=task)", async () => {
    const { service, store } = makeService();

    const taskDoc = await insertRawDoc(store, "task", "Some Task");

    const result = await service.create({
      type: "plan",
      title: "Implementation Plan",
      parent_id: taskDoc.id,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_PARENT_TYPE");
    if (result.error.code === "INVALID_PARENT_TYPE") {
      expect(result.error.child).toBe("plan");
      expect(result.error.parent).toBe("task");
    }
  });

  /**
   * Adversarial: two different inputs → two different expected outputs.
   * Spec→prd PASSES (allowed), spec→task FAILS (not allowed).
   * This proves the gate is NOT hardcoded to always return INVALID_PARENT_TYPE.
   *
   * The PASS half is a positive control (HAPPY path added inline here).
   * The FAIL half will be RED until gate is implemented.
   */
  it("AC-HARDGATE-001.N04: spec→prd succeeds but spec→adr fails (different inputs → different outputs)", async () => {
    const { service, store } = makeService();

    // Create a prd through the service (allowed)
    const prdResult = await service.create(prdInput("Product Requirement"));
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) return;

    // spec with prd parent should succeed (positive control)
    const specOkResult = await service.create({
      type: "spec",
      title: "Auth Feature Spec",
      parent_id: prdResult.value.id,
    });
    expect(specOkResult.ok).toBe(true);

    // Now seed an adr (not a valid parent for spec)
    const adrDoc = await insertRawDoc(store, "adr", "Old Decision");

    // spec with adr parent should fail with INVALID_PARENT_TYPE
    const specBadResult = await service.create({
      type: "spec",
      title: "Another Spec",
      parent_id: adrDoc.id,
    });
    expect(specBadResult.ok).toBe(false);
    if (!specBadResult.ok) {
      expect(specBadResult.error.code).toBe("INVALID_PARENT_TYPE");
    }
  });
});

// ─── NEGATIVE: link path type-contract hard gate ───────────────────────────────

describe("NEGATIVE — link: parent type contract hard gate (RED — impl missing)", () => {
  /**
   * Spec (§10/M2): link(from=spec, to=task, type="parent") MUST return
   * INVALID_PARENT_TYPE, not succeed.
   *
   * Current impl: resolves both docs, calls store.addLink (cycle check only),
   * then updates parent_id. The type gate does not exist yet.
   * This test will FAIL (RED) until the hard gate is added.
   */
  it("AC-HARDGATE-001.N05: link(spec, task, 'parent') → INVALID_PARENT_TYPE (link path)", async () => {
    const { service, store } = makeService();

    // Create a prd first so we can create a spec properly
    const prdResult = await service.create(prdInput("Product"));
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) return;

    // Create a spec under prd (valid)
    const specResult = await service.create({
      type: "spec",
      title: "Auth Spec",
      parent_id: prdResult.value.id,
    });
    expect(specResult.ok).toBe(true);
    if (!specResult.ok) return;

    // Seed a task directly
    const taskDoc = await insertRawDoc(store, "task", "Backend Task");

    // Attempt to re-link spec → task as parent — should be rejected
    const linkResult = await service.link(specResult.value.id, taskDoc.id, "parent");

    expect(linkResult.ok).toBe(false);
    if (linkResult.ok) return;
    expect(linkResult.error.code).toBe("INVALID_PARENT_TYPE");
    if (linkResult.error.code === "INVALID_PARENT_TYPE") {
      expect(linkResult.error.child).toBe("spec");
      expect(linkResult.error.parent).toBe("task");
      expect(linkResult.error.allowed).toContain("prd");
    }
  });

  /**
   * Second link-path scenario with different types to avoid hardcoded-return false-pass.
   * plan→spec as parent is invalid (spec is not a valid parent for plan per §4.1).
   * This test will FAIL (RED) until the hard gate is added.
   */
  it("AC-HARDGATE-001.N06: link(plan, spec, 'parent') → INVALID_PARENT_TYPE (link path, different types)", async () => {
    const { service, store } = makeService();

    // Create a plan via service
    const planResult = await service.create(planInput("Execution Plan"));
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;

    // Seed a spec doc directly (it normally needs prd parent, bypass that for gate testing)
    const specDoc = await insertRawDoc(store, "spec", "Auth Spec");

    // Attempt to link plan → spec as parent — spec is not an allowed parent for plan
    const linkResult = await service.link(planResult.value.id, specDoc.id, "parent");

    expect(linkResult.ok).toBe(false);
    if (linkResult.ok) return;
    expect(linkResult.error.code).toBe("INVALID_PARENT_TYPE");
    if (linkResult.error.code === "INVALID_PARENT_TYPE") {
      expect(linkResult.error.child).toBe("plan");
      expect(linkResult.error.parent).toBe("spec");
    }
  });
});

// ─── ERROR: soft-deleted parent ────────────────────────────────────────────────

describe("ERROR — create: soft-deleted parent → DOC_NOT_FOUND", () => {
  /**
   * Spec (§4.1): parent_id must resolve to a non-deleted, existing doc.
   * When parent's deleted_at !== null, service MUST return DOC_NOT_FOUND.
   *
   * Current impl: resolve() calls store.find() which returns the doc record even
   * when deleted_at is set — the resolve() method does not filter on deleted_at.
   * The behavior around deleted parent may already fail or pass depending on whether
   * resolve() checks deleted_at. This test captures the SPEC requirement: deleted
   * parent → DOC_NOT_FOUND.
   *
   * NOTE: If current impl silently uses the deleted parent (returns ok=true), this
   * test is RED and reveals a bug. If resolve() already excludes deleted docs, this
   * test is a REGRESSION guard.
   */
  it("AC-HARDGATE-001.E01: create spec with soft-deleted prd parent → DOC_NOT_FOUND", async () => {
    const { service, store } = makeService();

    // Create a prd and then soft-delete it
    const prdResult = await service.create(prdInput("Deleted Product"));
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) return;

    const prdId = prdResult.value.id;
    const deleteResult = await store.softDelete(prdId);
    expect(deleteResult.ok).toBe(true);

    // Now try to create a spec with the deleted prd as parent
    const specResult = await service.create({
      type: "spec",
      title: "Orphaned Spec",
      parent_id: prdId,
    });

    expect(specResult.ok).toBe(false);
    if (specResult.ok) return;
    expect(specResult.error.code).toBe("DOC_NOT_FOUND");
  });
});

// ─── REGRESSION: existing store-level cycle detection ──────────────────────────

describe("REGRESSION — link: store-level cycle detection (already implemented)", () => {
  /**
   * Regression guard: adding link B→A when A already has a parent link A→B
   * creates a cycle. InMemoryStore.detectParentCycle already handles this.
   * This test SHOULD PASS (existing behavior). Confirms we haven't broken it.
   *
   * @regression store.addLink detectParentCycle
   */
  it("AC-HARDGATE-001.R01: link B→A when A→B parent link exists → LINK_CYCLE", async () => {
    const { service, store } = makeService();

    // Create two docs: A = prd, B = spec (prd→nothing, spec→prd is normal)
    const prdAResult = await service.create(prdInput("Product A"));
    expect(prdAResult.ok).toBe(true);
    if (!prdAResult.ok) return;

    const prdBResult = await service.create(prdInput("Product B"));
    expect(prdBResult.ok).toBe(true);
    if (!prdBResult.ok) return;

    const idA = prdAResult.value.id;
    const idB = prdBResult.value.id;

    // Link A → B as parent (A's parent is B)
    const firstLink = await service.link(idA, idB, "parent");
    expect(firstLink.ok).toBe(true);

    // Now try to link B → A as parent — would create cycle B→A→B
    const cycleLink = await service.link(idB, idA, "parent");

    expect(cycleLink.ok).toBe(false);
    if (cycleLink.ok) return;
    expect(cycleLink.error.code).toBe("LINK_CYCLE");
  });

  /**
   * Regression guard: self-link as parent creates immediate cycle.
   * store.addLink detectParentCycle: from_id === to_id path check.
   *
   * @regression store.addLink self-cycle
   */
  it("AC-HARDGATE-001.R02: link(self, self, 'parent') → LINK_CYCLE", async () => {
    const { service } = makeService();

    const prdResult = await service.create(prdInput("Solo Product"));
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) return;

    const selfId = prdResult.value.id;
    const selfLink = await service.link(selfId, selfId, "parent");

    expect(selfLink.ok).toBe(false);
    if (selfLink.ok) return;
    expect(selfLink.error.code).toBe("LINK_CYCLE");
  });
});

// ─── REGRESSION: Zod two-stage defense (schema gate fires BEFORE service gate) ──

describe("REGRESSION — create: Zod schema gate (two-stage defense)", () => {
  /**
   * Regression guard: spec without parent_id → Zod superRefine fires PARENT_REQUIRED.
   * This proves two-stage defense: Zod rejects at schema layer FIRST,
   * service type-contract gate fires SECOND (after parent exists).
   * The Zod gate is already implemented. This test SHOULD PASS.
   *
   * @regression PARENT_REQUIRED Zod superRefine
   */
  it("AC-HARDGATE-001.R03: create spec without parent_id → PARENT_REQUIRED (Zod gate, first stage)", async () => {
    const { service } = makeService();

    const result = await service.create({ type: "spec", title: "Orphan Spec" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PARENT_REQUIRED");
    if (result.error.code === "PARENT_REQUIRED") {
      expect(result.error.type).toBe("spec");
    }
  });

  /**
   * Regression guard: task without parent_id → PARENT_REQUIRED (Zod gate).
   *
   * @regression PARENT_REQUIRED Zod superRefine for task
   */
  it("AC-HARDGATE-001.R04: create task without parent_id → PARENT_REQUIRED (Zod gate)", async () => {
    const { service } = makeService();

    const result = await service.create({
      type: "task",
      title: "Orphan Task",
      extra: { plan_id: "fake-plan" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PARENT_REQUIRED");
    if (result.error.code === "PARENT_REQUIRED") {
      expect(result.error.type).toBe("task");
    }
  });
});

// ─── HAPPY: positive control (verify gate is not over-blocking) ────────────────

describe("HAPPY — create: valid parent types are allowed through", () => {
  /**
   * Positive control: spec with prd parent MUST succeed.
   * If the type-gate impl incorrectly blocks valid parent types, this test catches it.
   * Ensures the gate returns ok for allowed combinations.
   */
  it("AC-HARDGATE-001.H01: create spec with prd parent → success", async () => {
    const { service } = makeService();

    const prdResult = await service.create(prdInput("Valid Product"));
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) return;

    const specResult = await service.create({
      type: "spec",
      title: "Valid Spec",
      parent_id: prdResult.value.id,
    });

    expect(specResult.ok).toBe(true);
    if (!specResult.ok) {
      // If it fails, surface the error for debugging
      throw new Error(`Expected ok=true but got error: ${JSON.stringify(specResult.error)}`);
    }
    expect(specResult.value.type).toBe("spec");
    expect(specResult.value.parent_id).toBe(prdResult.value.id);
  });

  /**
   * Positive control: link(spec, prd, "parent") MUST succeed.
   * The type gate on the link path should allow spec→prd parent links.
   * Different input than N05/N06, different expected output (ok=true).
   * Defeats hardcoded-return false pass.
   */
  it("AC-HARDGATE-001.H02: link(spec, prd, 'parent') → success (link path allows valid type)", async () => {
    const { service, store } = makeService();

    // Seed spec directly (bypassing service to avoid circular dependency setup)
    const specDoc = await insertRawDoc(store, "spec", "Unlinked Spec");
    const prdResult = await service.create(prdInput("Target PRD"));
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) return;

    const linkResult = await service.link(specDoc.id, prdResult.value.id, "parent");

    expect(linkResult.ok).toBe(true);
    if (!linkResult.ok) {
      throw new Error(`Expected ok=true but got: ${JSON.stringify(linkResult.error)}`);
    }
    expect(linkResult.value.link_type).toBe("parent");
    expect(linkResult.value.from_id).toBe(specDoc.id);
    expect(linkResult.value.to_id).toBe(prdResult.value.id);
  });
});
