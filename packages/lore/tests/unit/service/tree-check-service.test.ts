/**
 * RED-phase TDD tests for TreeCheckService.
 *
 * These tests import from `src/service/tree-check-service.ts` which does NOT
 * exist yet. The canonical RED signal is ERR_MODULE_NOT_FOUND at load time.
 * The sibling GREEN-phase task (TASK-01KV4XVEQTMP6FD58ENV0AK8ED) will implement
 * the service and turn these tests green.
 *
 * @spec_ref AC-TREE-CHECK-001
 * Spec source: TECH-01KV4W88GZF74B98BHCBBV9GHD §4.3 + §4.4 + §10
 *
 * Six dimensions:
 *   HAPPY      — blueprint matches tree → consistent, no drifts
 *   NEGATIVE   — wrong placement, R4 dedupe regression
 *   BOUNDARY   — min=0, max=null, exact max, one-over max
 *   ERROR      — soft-deleted parent, cycle detection
 *   STATE      — idempotent fix, cycle detection in fix candidates
 *   REGRESSION — double-count guard, D-RECONCILE inconsistency detection
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import type { DocRecord, DocId, DocType } from "@lore/core";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { TreeBlueprint } from "@lore/core";
// RED SIGNAL: this import will fail with ERR_MODULE_NOT_FOUND until the impl lands
import { TreeCheckService } from "../../../src/service/tree-check-service.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeId(suffix: string): DocId {
  // 26-char ULID-shaped string, unique per test via suffix
  return `01TEST${suffix.padStart(20, "0")}`;
}

async function seedDoc(
  store: InMemoryStore,
  partial: Partial<DocRecord> & { type: DocType; id: DocId },
): Promise<DocRecord> {
  const now = new Date().toISOString();
  const rec: DocRecord = {
    id: partial.id,
    slug: partial.slug ?? `${partial.type}-${partial.id.slice(-6).toLowerCase()}`,
    type: partial.type,
    role: DOC_TYPE_ROLE_MAP[partial.type],
    title: partial.title ?? "T",
    status: "draft",
    priority: "medium",
    content: "",
    parent_id: partial.parent_id ?? null,
    created_at: now,
    updated_at: now,
    created_by: "test",
    version: partial.version ?? 1,
    deleted_at: partial.deleted_at ?? null,
    tags: [],
    extra: partial.extra ?? {},
  };
  // InMemoryStore uses `insert` (not `create`) — see store-interface.ts
  const r = await store.insert(rec);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

/** Build a minimal blueprint: one prd root, with a child spec slot */
function prdSpecBlueprint(min = 1, max: number | null = null): TreeBlueprint {
  return {
    version: 1,
    root: {
      type: "prd",
      min: 1,
      max: null,
      children: [
        {
          type: "spec",
          min,
          max,
          children: [],
        },
      ],
    },
  };
}

/** Blueprint: prd root, with spec child and plan child */
function prdSpecPlanBlueprint(): TreeBlueprint {
  return {
    version: 1,
    root: {
      type: "prd",
      min: 1,
      max: null,
      children: [
        { type: "spec", min: 0, max: null, children: [] },
        { type: "plan", min: 0, max: null, children: [] },
      ],
    },
  };
}

// ─── HAPPY PATH ─────────────────────────────────────────────────────────────

describe("TreeCheckService.checkTree — HAPPY", () => {
  it("AC-TREE-HAPPY-01: empty store with min=0 blueprint → consistent, drifts=[]", async () => {
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const blueprint: TreeBlueprint = {
      version: 1,
      root: {
        type: "prd",
        min: 0,
        max: null,
        children: [],
      },
    };

    const result = await svc.checkTree(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consistent).toBe(true);
    expect(result.value.drifts).toHaveLength(0);
  });

  it("AC-TREE-HAPPY-02: prd root + spec child matches blueprint → consistent", async () => {
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);

    const prdId = makeId("PRD001");
    const specId = makeId("SPC001");
    await seedDoc(store, { id: prdId, type: "prd" });
    await seedDoc(store, { id: specId, type: "spec", parent_id: prdId });

    const result = await svc.checkTree(prdSpecBlueprint(1, null));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consistent).toBe(true);
    expect(result.value.drifts).toHaveLength(0);
  });

  it("AC-TREE-HAPPY-03: two different doc ids produce different drift reports", async () => {
    // Guard against hardcoded return — vary structure
    const store1 = new InMemoryStore();
    const svc1 = new TreeCheckService(store1);
    await seedDoc(store1, { id: makeId("PRD001"), type: "prd" });
    const r1 = await svc1.checkTree(prdSpecBlueprint(1, null));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    // One prd, zero specs, min=1 → missing drift expected
    expect(r1.value.consistent).toBe(false);

    const store2 = new InMemoryStore();
    const svc2 = new TreeCheckService(store2);
    const prdId = makeId("PRD002");
    await seedDoc(store2, { id: prdId, type: "prd" });
    await seedDoc(store2, { id: makeId("SPC002"), type: "spec", parent_id: prdId });
    const r2 = await svc2.checkTree(prdSpecBlueprint(1, null));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    // prd + one spec satisfies min=1 → consistent
    expect(r2.value.consistent).toBe(true);
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("TreeCheckService.checkTree — NEGATIVE", () => {
  it("AC-TREE-NEG-01: spec placed under plan (blueprint says spec under prd) → misplaced drift, NOT also missing", async () => {
    /**
     * R4 dedupe regression test: a spec misplaced under a plan should report
     * ONE misplaced drift, not also a "missing" drift for the spec slot under prd.
     * If both are reported, the implementation double-counts.
     */
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const prdId = makeId("PRD001");
    const planId = makeId("PLN001");
    const specId = makeId("SPC001");

    await seedDoc(store, { id: prdId, type: "prd" });
    await seedDoc(store, { id: planId, type: "plan", parent_id: prdId });
    // spec is under plan instead of under prd (misplaced)
    await seedDoc(store, { id: specId, type: "spec", parent_id: planId });

    const blueprint: TreeBlueprint = {
      version: 1,
      root: {
        type: "prd",
        min: 1,
        max: null,
        children: [
          { type: "spec", min: 1, max: null, children: [] },
          { type: "plan", min: 0, max: null, children: [] },
        ],
      },
    };

    const result = await svc.checkTree(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consistent).toBe(false);

    const misplacedDrifts = result.value.drifts.filter((d) => d.kind === "misplaced");
    expect(misplacedDrifts).toHaveLength(1);
    expect(misplacedDrifts[0]?.actual?.id).toBe(specId);

    // The spec is misplaced (same type in wrong place) — should NOT generate an
    // additional "missing" drift because misSameType dedupe applies (R4).
    const missingDrifts = result.value.drifts.filter((d) => d.kind === "missing");
    expect(missingDrifts).toHaveLength(0);
  });

  it("AC-TREE-NEG-02: orphan doc with non-null parent_id pointing to unknown parent → orphan drift", async () => {
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const ghostParentId = makeId("GHOST01");
    const specId = makeId("SPC001");
    // Spec with parent_id that doesn't exist in store
    await seedDoc(store, { id: specId, type: "spec", parent_id: ghostParentId });

    const result = await svc.checkTree(prdSpecBlueprint(0, null));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consistent).toBe(false);
    const orphanDrifts = result.value.drifts.filter((d) => d.kind === "orphan");
    expect(orphanDrifts.length).toBeGreaterThanOrEqual(1);
    const orphan = orphanDrifts.find((d) => d.actual?.id === specId);
    expect(orphan).toBeDefined();
  });

  it("AC-TREE-NEG-03: root-level doc that is not a ROOT_TYPE → orphan drift", async () => {
    // A spec with parent_id=null is orphaned (not a root type)
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    await seedDoc(store, { id: makeId("SPC001"), type: "spec", parent_id: null });

    const result = await svc.checkTree(prdSpecBlueprint(0, null));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consistent).toBe(false);
    const orphanDrifts = result.value.drifts.filter((d) => d.kind === "orphan");
    expect(orphanDrifts.length).toBeGreaterThanOrEqual(1);
  });

  it("AC-TREE-NEG-04: SPEC-069 ad-hoc task (extra.adhoc=true) parented to root prd → NOT misplaced", async () => {
    /**
     * SPEC-069 §Design Decisions D2 deliberately parents `--adhoc` tasks (incl.
     * issue reports, which set `adhoc: true` too) to the corpus root PRD for
     * tree reachability, bypassing PARENT_TYPE_CONTRACT.task (whose only
     * declared parent is `plan`) on purpose. Pre-fix, checkTree's Step 4 has
     * no awareness of this and flags every adhoc task "misplaced" — a
     * permanent false positive that arms the pre-push gate
     * (`lore status --check-tree`) forever. This is the RED case.
     */
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const prdId = makeId("PRD001");
    const adhocTaskId = makeId("ADH001");

    await seedDoc(store, { id: prdId, type: "prd" });
    await seedDoc(store, {
      id: adhocTaskId,
      type: "task",
      parent_id: prdId,
      extra: { adhoc: true },
    });

    const blueprint: TreeBlueprint = {
      version: 1,
      root: { type: "prd", min: 0, max: null, children: [] },
    };

    const result = await svc.checkTree(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const misplacedForAdhoc = result.value.drifts.filter(
      (d) => d.kind === "misplaced" && d.actual?.id === adhocTaskId,
    );
    expect(misplacedForAdhoc).toHaveLength(0);
    expect(result.value.consistent).toBe(true);
  });

  it("AC-TREE-NEG-05: a NON-adhoc task parented to root prd → STILL misplaced (adhoc exemption is not a blanket task→prd allowance)", async () => {
    /**
     * Guards the exemption's precision: without extra.adhoc===true, a task
     * directly under a prd is a genuine drift (e.g. a caller forcing
     * --parent to a PRD without --adhoc) and must keep tripping the gate.
     */
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const prdId = makeId("PRD001");
    const strayTaskId = makeId("STR001");

    await seedDoc(store, { id: prdId, type: "prd" });
    await seedDoc(store, { id: strayTaskId, type: "task", parent_id: prdId });

    const blueprint: TreeBlueprint = {
      version: 1,
      root: { type: "prd", min: 0, max: null, children: [] },
    };

    const result = await svc.checkTree(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const misplacedForStray = result.value.drifts.filter(
      (d) => d.kind === "misplaced" && d.actual?.id === strayTaskId,
    );
    expect(misplacedForStray).toHaveLength(1);
    expect(result.value.consistent).toBe(false);
  });

  it("AC-TREE-NEG-06: a genuinely misparented doc (spec under task) still trips misplaced → exit-3-worthy", async () => {
    /**
     * Negative control for the exemption: proves the adhoc carve-out is
     * scoped to task-under-prd only, not a general relaxation of the
     * misplaced check for unrelated type combinations.
     */
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const prdId = makeId("PRD001");
    const planId = makeId("PLN001");
    const taskId = makeId("TSK001");
    const specId = makeId("SPC001");

    await seedDoc(store, { id: prdId, type: "prd" });
    await seedDoc(store, { id: planId, type: "plan", parent_id: prdId });
    await seedDoc(store, { id: taskId, type: "task", parent_id: planId });
    // spec placed under task — not a valid parent type for spec anywhere
    await seedDoc(store, { id: specId, type: "spec", parent_id: taskId });

    const blueprint: TreeBlueprint = {
      version: 1,
      root: {
        type: "prd",
        min: 0,
        max: null,
        children: [
          {
            type: "plan",
            min: 0,
            max: null,
            children: [{ type: "task", min: 0, max: null, children: [] }],
          },
        ],
      },
    };

    const result = await svc.checkTree(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consistent).toBe(false);

    const misplacedForSpec = result.value.drifts.filter(
      (d) => d.kind === "misplaced" && d.actual?.id === specId,
    );
    expect(misplacedForSpec).toHaveLength(1);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("TreeCheckService.checkTree — BOUNDARY", () => {
  it("AC-TREE-BND-01: min=0 with no matching docs → no missing drift", async () => {
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const prdId = makeId("PRD001");
    await seedDoc(store, { id: prdId, type: "prd" });
    // Blueprint says min=0 for spec under prd → 0 specs is acceptable

    const result = await svc.checkTree(prdSpecBlueprint(0, null));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const missingDrifts = result.value.drifts.filter((d) => d.kind === "missing");
    expect(missingDrifts).toHaveLength(0);
  });

  it("AC-TREE-BND-02: max=null with many docs → no extra drift", async () => {
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const prdId = makeId("PRD001");
    await seedDoc(store, { id: prdId, type: "prd" });
    // 5 specs under prd, max=null (unlimited)
    for (let i = 0; i < 5; i++) {
      await seedDoc(store, { id: makeId(`SPC00${i}`), type: "spec", parent_id: prdId });
    }

    const result = await svc.checkTree(prdSpecBlueprint(0, null));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const extraDrifts = result.value.drifts.filter((d) => d.kind === "extra");
    expect(extraDrifts).toHaveLength(0);
  });

  it("AC-TREE-BND-03: max=2 with exactly 2 matched → no extra drift", async () => {
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const prdId = makeId("PRD001");
    await seedDoc(store, { id: prdId, type: "prd" });
    await seedDoc(store, { id: makeId("SPC001"), type: "spec", parent_id: prdId });
    await seedDoc(store, { id: makeId("SPC002"), type: "spec", parent_id: prdId });

    const result = await svc.checkTree(prdSpecBlueprint(0, 2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const extraDrifts = result.value.drifts.filter((d) => d.kind === "extra");
    expect(extraDrifts).toHaveLength(0);
  });

  it("AC-TREE-BND-04: max=2 with 3 matched → exactly 1 extra drift", async () => {
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const prdId = makeId("PRD001");
    await seedDoc(store, { id: prdId, type: "prd" });
    await seedDoc(store, { id: makeId("SPC001"), type: "spec", parent_id: prdId });
    await seedDoc(store, { id: makeId("SPC002"), type: "spec", parent_id: prdId });
    await seedDoc(store, { id: makeId("SPC003"), type: "spec", parent_id: prdId });

    const result = await svc.checkTree(prdSpecBlueprint(0, 2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const extraDrifts = result.value.drifts.filter((d) => d.kind === "extra");
    expect(extraDrifts).toHaveLength(1);
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("TreeCheckService.checkTree — ERROR", () => {
  it("AC-TREE-ERR-01: child of soft-deleted parent → orphan drift, NOT misplaced", async () => {
    /**
     * Spec: doc ∉ cyclic AND parent_id!==null AND !byId.has(parent_id) → orphan.
     * A soft-deleted parent is excluded from findMany(exclude_deleted=true),
     * so its id is absent from byId. Child must be reported as orphan, not misplaced.
     */
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const prdId = makeId("PRD001");
    const specId = makeId("SPC001");
    // Insert parent with deleted_at set
    await seedDoc(store, {
      id: prdId,
      type: "prd",
      deleted_at: "2024-01-01T00:00:00.000Z",
    });
    await seedDoc(store, { id: specId, type: "spec", parent_id: prdId });

    const result = await svc.checkTree(prdSpecBlueprint(0, null));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consistent).toBe(false);

    const drifts = result.value.drifts;
    const misplacedDrifts = drifts.filter((d) => d.kind === "misplaced" && d.actual?.id === specId);
    expect(misplacedDrifts).toHaveLength(0); // MUST NOT be misplaced

    const orphanDrifts = drifts.filter((d) => d.kind === "orphan" && d.actual?.id === specId);
    expect(orphanDrifts).toHaveLength(1); // MUST be orphan
  });

  it("AC-TREE-ERR-02: cycle in tree → drifts include cycle kind for each node in cycle", async () => {
    /**
     * Spec: cycles via ancestorChainWalk per doc → cyclic Set.
     * drifts include `cycle` for each cycle.
     * Cyclic nodes must NOT appear as orphan or misplaced.
     */
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const aId = makeId("AAAA001");
    const bId = makeId("BBBB001");

    // A's parent = B, B's parent = A → cycle
    await seedDoc(store, { id: aId, type: "plan", parent_id: bId });
    await seedDoc(store, { id: bId, type: "plan", parent_id: aId });

    const blueprint: TreeBlueprint = {
      version: 1,
      root: { type: "prd", min: 0, max: null, children: [] },
    };

    const result = await svc.checkTree(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consistent).toBe(false);

    const cycleDrifts = result.value.drifts.filter((d) => d.kind === "cycle");
    expect(cycleDrifts.length).toBeGreaterThanOrEqual(1);

    // Cyclic nodes must NOT appear in orphan or misplaced drifts
    const nonCycleDrifts = result.value.drifts.filter(
      (d) => d.kind === "orphan" || d.kind === "misplaced",
    );
    const cyclicIds = new Set([aId, bId]);
    for (const drift of nonCycleDrifts) {
      expect(cyclicIds.has(drift.actual?.id ?? "")).toBe(false);
    }
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("TreeCheckService.fix — STATE", () => {
  it("AC-TREE-STATE-01: orphan with unique legal parent → fix returns FIXED, version incremented", async () => {
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const prdId = makeId("PRD001");
    const specId = makeId("SPC001");

    await seedDoc(store, { id: prdId, type: "prd" });
    // spec with no parent (orphaned root-level spec)
    await seedDoc(store, { id: specId, type: "spec", parent_id: null, version: 1 });

    // Blueprint with prd containing spec slot
    const blueprint = prdSpecBlueprint(0, null);

    const result = await svc.fix(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { fixed, skipped } = result.value;
    expect(fixed.length).toBeGreaterThanOrEqual(1);
    const fixedItem = fixed.find((f) => f.id === specId);
    expect(fixedItem).toBeDefined();
    expect(fixedItem?.toParentId).toBe(prdId);
    expect(fixedItem?.newVersion).toBeGreaterThan(1);
    expect(skipped.find((s) => s.id === specId)).toBeUndefined();
  });

  it("AC-TREE-STATE-02: second fix call on already-fixed tree → all SKIPPED (idempotent)", async () => {
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const prdId = makeId("PRD001");
    const specId = makeId("SPC001");

    await seedDoc(store, { id: prdId, type: "prd" });
    await seedDoc(store, { id: specId, type: "spec", parent_id: null, version: 1 });

    const blueprint = prdSpecBlueprint(0, null);

    // First fix
    const first = await svc.fix(blueprint);
    expect(first.ok).toBe(true);

    // Second fix — already consistent, nothing to fix
    const second = await svc.fix(blueprint);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // Either fixed is empty (already consistent) OR skipped with "0-or-many candidates"
    // because there's no longer an orphan to fix.
    expect(second.value.fixed).toHaveLength(0);
  });

  it("AC-TREE-STATE-03: orphan whose only candidate is a DESCENDANT of itself → SKIPPED reason=would-create-cycle", async () => {
    /**
     * Scenario: prdA → planB → specC is the tree.
     * planB is removed (parentless), making it orphaned.
     * If we tried to put planB under specC (its own descendant), that creates a cycle.
     * Blueprint only allows plan as child of prd.
     * We construct a case where the sole candidate parent is itself a descendant.
     *
     * Implementation note: fix() must detect would-create-cycle via ancestorChainWalk
     * BEFORE updating the store.
     */
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);

    // Build: prd → plan → spec
    // Then make plan orphaned (no parent), with spec as only child.
    // Blueprint has prd → spec → plan (plan is grandchild).
    // So the only candidate parent for plan is spec (its descendant) → cycle.
    const prdId = makeId("PRD001");
    const planId = makeId("PLN001");
    const specId = makeId("SPC001");

    await seedDoc(store, { id: prdId, type: "prd" });
    await seedDoc(store, { id: specId, type: "spec", parent_id: prdId });
    // plan has spec as its child; plan itself is orphaned (parent_id=null, but spec is its kid)
    // Wait: to create would-create-cycle, plan must be orphaned AND its only legal candidate
    // parent must be a descendant of itself.
    // planId's child is specId. Blueprint says: prd→spec, prd→plan.
    // Only prd qualifies as legal parent for plan. prd is NOT a descendant of plan.
    // So we need a different topology.
    //
    // Revised: blueprint = prd → spec → plan (plan lives under spec).
    // planId is orphaned (parent_id=null). Its only candidate is specId (lives under prdId).
    // specId is a child of prdId, not a descendant of planId. Still no cycle.
    //
    // The cycle scenario is: planId's ONLY legal parent candidate is a doc that has
    // planId as an ancestor. E.g., if specId had parent_id=planId (spec is child of plan),
    // and blueprint says plan can appear under spec, then fixing plan → spec creates A→B→A cycle.

    // Rebuild: plan → spec (spec is child of plan), plan is orphaned (no parent itself)
    // Blueprint: prd → plan → spec (plan under prd, spec under plan)
    // Only legal parent for (orphaned) plan = prd. prd is NOT a descendant of plan. Still no cycle.

    // True would-create-cycle: plan is orphaned. spec is plan's child.
    // Blueprint says plan can live under spec. So the only candidate is spec.
    // But spec is a descendant of plan → cycle.
    await store.update(specId, { parent_id: planId }); // make spec child of plan
    // plan is orphaned (parent_id=null)

    const blueprint: TreeBlueprint = {
      version: 1,
      root: {
        type: "prd",
        min: 0,
        max: null,
        children: [
          {
            type: "spec",
            min: 0,
            max: null,
            children: [
              // plan can live under spec — this is the only legal slot for plan
              { type: "plan", min: 0, max: null, children: [] },
            ],
          },
        ],
      },
    };

    const result = await svc.fix(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const skippedItem = result.value.skipped.find((s) => s.id === planId);
    expect(skippedItem).toBeDefined();
    expect(skippedItem?.reason).toBe("would-create-cycle");
    // plan must NOT appear in fixed
    expect(result.value.fixed.find((f) => f.id === planId)).toBeUndefined();
  });

  it("AC-TREE-STATE-04: orphan with zero legal parent candidates → SKIPPED reason=0-or-many candidates", async () => {
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const specId = makeId("SPC001");
    // spec with no parent, blueprint has no spec slot → 0 candidates
    await seedDoc(store, { id: specId, type: "spec", parent_id: null });

    const blueprint: TreeBlueprint = {
      version: 1,
      root: { type: "prd", min: 0, max: null, children: [] }, // no spec slot
    };

    const result = await svc.fix(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const skippedItem = result.value.skipped.find((s) => s.id === specId);
    expect(skippedItem).toBeDefined();
    expect(skippedItem?.reason).toBe("0-or-many candidates");
  });

  it("AC-TREE-STATE-05: orphan with multiple legal parent candidates → SKIPPED reason=0-or-many candidates", async () => {
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const prdId1 = makeId("PRD001");
    const prdId2 = makeId("PRD002");
    const specId = makeId("SPC001");

    // Two prd docs — both are legal parents for a spec
    await seedDoc(store, { id: prdId1, type: "prd" });
    await seedDoc(store, { id: prdId2, type: "prd" });
    // spec orphaned (parent_id=null)
    await seedDoc(store, { id: specId, type: "spec", parent_id: null });

    const blueprint = prdSpecBlueprint(0, null);

    const result = await svc.fix(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const skippedItem = result.value.skipped.find((s) => s.id === specId);
    expect(skippedItem).toBeDefined();
    expect(skippedItem?.reason).toBe("0-or-many candidates");
    expect(skippedItem?.candidates.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("TreeCheckService.checkTree — REGRESSION", () => {
  it("AC-TREE-REG-01: 2 misplaced specs under plan → exactly 2 misplaced drifts (not 2+2=4)", async () => {
    /**
     * Regression: R4 double-count guard.
     * 2 specs misplaced under a plan node. Blueprint says spec goes under prd (min=2).
     * There are 2 spec siblings of same type at wrong place.
     * misSameType.length == 2 == deficit → missing count = max(deficit - misSameType, 0) = 0.
     * So: 2 misplaced drifts and 0 missing drifts (not 2+2=4).
     */
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const prdId = makeId("PRD001");
    const planId = makeId("PLN001");
    const spec1Id = makeId("SPC001");
    const spec2Id = makeId("SPC002");

    await seedDoc(store, { id: prdId, type: "prd" });
    await seedDoc(store, { id: planId, type: "plan", parent_id: prdId });
    // Both specs under plan instead of under prd
    await seedDoc(store, { id: spec1Id, type: "spec", parent_id: planId });
    await seedDoc(store, { id: spec2Id, type: "spec", parent_id: planId });

    const blueprint: TreeBlueprint = {
      version: 1,
      root: {
        type: "prd",
        min: 1,
        max: null,
        children: [
          { type: "spec", min: 2, max: null, children: [] }, // min=2
          { type: "plan", min: 0, max: null, children: [] },
        ],
      },
    };

    const result = await svc.checkTree(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consistent).toBe(false);

    const misplacedDrifts = result.value.drifts.filter((d) => d.kind === "misplaced");
    expect(misplacedDrifts).toHaveLength(2);

    // R4: misSameType (2) covers the deficit (2) → no missing drift
    const missingDrifts = result.value.drifts.filter((d) => d.kind === "missing");
    expect(missingDrifts).toHaveLength(0);
  });

  it("AC-TREE-REG-02: deleted parent → hanging child is orphan, NOT causing erroneous misplaced", async () => {
    // Regression guard for soft-deleted parent detection (separate from ERROR suite)
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const deletedPrdId = makeId("PRD001");
    const specId = makeId("SPC001");

    await seedDoc(store, {
      id: deletedPrdId,
      type: "prd",
      deleted_at: "2024-01-01T00:00:00.000Z",
    });
    await seedDoc(store, { id: specId, type: "spec", parent_id: deletedPrdId });

    const result = await svc.checkTree(prdSpecBlueprint(0, null));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Must be orphan — not misplaced (parent unknown because soft-deleted)
    const misplacedWithSpec = result.value.drifts.filter(
      (d) => d.kind === "misplaced" && d.actual?.id === specId,
    );
    expect(misplacedWithSpec).toHaveLength(0);

    const orphanWithSpec = result.value.drifts.filter(
      (d) => d.kind === "orphan" && d.actual?.id === specId,
    );
    expect(orphanWithSpec).toHaveLength(1);
  });
});

// ─── D-RECONCILE ─────────────────────────────────────────────────────────────

describe("TreeCheckService.reconcile — D-RECONCILE", () => {
  it("AC-TREE-REC-01: doc.parent_id set but no parent link record → reported as inconsistency", async () => {
    /**
     * Dual-track reconciliation (§4.3 D-RECONCILE):
     * Doc has parent_id=prdId in DocRecord.parent_id field,
     * but no link record of type 'parent' exists in the link table.
     * reconcile() must detect and report this.
     */
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const prdId = makeId("PRD001");
    const specId = makeId("SPC001");

    await seedDoc(store, { id: prdId, type: "prd" });
    await seedDoc(store, { id: specId, type: "spec", parent_id: prdId });
    // Deliberately do NOT add a parent link record

    const result = await svc.reconcile();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const inconsistencies = result.value.inconsistencies;
    expect(inconsistencies.length).toBeGreaterThanOrEqual(1);
    const hit = inconsistencies.find((i) => i.doc_id === specId);
    expect(hit).toBeDefined();
    expect(hit?.parent_id_field).toBe(prdId);
    // link_table_parent is null because no link exists
    expect(hit?.link_table_parent).toBeNull();
  });

  it("AC-TREE-REC-02: link record exists but points to different parent than doc.parent_id → inconsistency", async () => {
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const prdId = makeId("PRD001");
    const prd2Id = makeId("PRD002");
    const specId = makeId("SPC001");
    const now = new Date().toISOString();

    await seedDoc(store, { id: prdId, type: "prd" });
    await seedDoc(store, { id: prd2Id, type: "prd" });
    await seedDoc(store, { id: specId, type: "spec", parent_id: prdId }); // field says prdId

    // Add a link pointing to prd2Id instead (mismatch)
    await store.addLink({
      from_id: specId,
      to_id: prd2Id,
      link_type: "parent",
      created_at: now,
      created_by: "test",
    });

    const result = await svc.reconcile();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const inconsistencies = result.value.inconsistencies;
    const hit = inconsistencies.find((i) => i.doc_id === specId);
    expect(hit).toBeDefined();
    expect(hit?.parent_id_field).toBe(prdId);    // field says prdId
    expect(hit?.link_table_parent).toBe(prd2Id); // link says prd2Id
  });

  it("AC-TREE-REC-03: consistent doc (parent_id matches link record) → no inconsistency reported", async () => {
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const prdId = makeId("PRD001");
    const specId = makeId("SPC001");
    const now = new Date().toISOString();

    await seedDoc(store, { id: prdId, type: "prd" });
    await seedDoc(store, { id: specId, type: "spec", parent_id: prdId });

    // Add matching link record
    await store.addLink({
      from_id: specId,
      to_id: prdId,
      link_type: "parent",
      created_at: now,
      created_by: "test",
    });

    const result = await svc.reconcile();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No inconsistency for specId since link matches parent_id field
    const hit = result.value.inconsistencies.find((i) => i.doc_id === specId);
    expect(hit).toBeUndefined();
  });

  it("AC-TREE-REC-04: doc.parent_id=null but link record exists → inconsistency", async () => {
    /**
     * Spec: "link exists while parent_id null → inconsistency"
     */
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const prdId = makeId("PRD001");
    const specId = makeId("SPC001");
    const now = new Date().toISOString();

    await seedDoc(store, { id: prdId, type: "prd" });
    // spec has parent_id=null (acts like root)
    await seedDoc(store, { id: specId, type: "spec", parent_id: null });

    // But a link record claims prdId as parent
    await store.addLink({
      from_id: specId,
      to_id: prdId,
      link_type: "parent",
      created_at: now,
      created_by: "test",
    });

    const result = await svc.reconcile();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const hit = result.value.inconsistencies.find((i) => i.doc_id === specId);
    expect(hit).toBeDefined();
    expect(hit?.parent_id_field).toBeNull();
    expect(hit?.link_table_parent).toBe(prdId);
  });
});

// ─── plan-close hint wording (spec-governance-visibility B1.2) ─────────────

describe("TreeCheckService.checkTree — plan-close hint wording", () => {
  it("plan-close-hint-wording: plan-terminality drift no longer claims the gate never evaluated, and the suggested command's justification matches its real gate behaviour", async () => {
    // Measured 2026-08-10 (spec-governance-visibility-an-armed-gate-that-
    // vacuously-passes §B1): corpus-service.ts:2029 reads
    // `this.gateEnforcer.isEnabled("plan-close")`, and `resolveGateEnabled`
    // (packages/core/src/config.ts:1115) returns `!== false` — the
    // `plan-close` checkpoint EVALUATES on `lore set <plan> --status
    // archived` unless a config explicitly disables it. The prior wording
    // ("The plan-close gate never evaluated it") was false under that
    // default and is the exact sentence B1.2 requires removed.
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);

    const prdId = makeId("PRD100");
    const specId = makeId("SPC100");
    const planId = makeId("PLN100");
    const taskId = makeId("TSK100");
    const planSlug = "plan-hint-wording-fixture";

    await seedDoc(store, { id: prdId, type: "prd" });
    await seedDoc(store, { id: specId, type: "spec", parent_id: prdId });
    await seedDoc(store, { id: planId, type: "plan", parent_id: specId, slug: planSlug });
    await seedDoc(store, { id: taskId, type: "task", parent_id: planId });
    // seedDoc hardcodes status "draft" — flip the child task to a terminal
    // status directly via the store so the plan-terminality predicate
    // (every child task terminal, plan itself not) actually fires.
    const archived = await store.update(taskId, { status: "archived" });
    if (!archived.ok) throw new Error(JSON.stringify(archived.error));

    const result = await svc.checkTree(prdSpecPlanBlueprint());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const terminalityDrifts = result.value.drifts.filter((d) => d.kind === "plan-terminality");
    expect(terminalityDrifts).toHaveLength(1);
    const detail = terminalityDrifts[0]!.detail;

    // RED: the retired sentence asserted the gate had never evaluated the
    // doc AT ALL — false under the default config.
    expect(detail).not.toContain("gate never evaluated");

    // The suggested remediation command is UNCHANGED — a sibling
    // integration test (check-tree.test.ts
    // AC-CLOSURE-2.plan-terminality.check) asserts this exact substring in
    // `lore status --check-tree` stdout, so B1.2's "correct the command it
    // suggests" is about the command's JUSTIFICATION, not its literal text.
    expect(detail).toContain(`lore set ${planSlug} --status archived`);

    // The justification must now describe what that command actually does:
    // the plan-close gate WILL evaluate the transition (unless disabled),
    // matching corpus-service.ts:2029's real predicate.
    expect(detail).toMatch(/plan-close gate (will |WILL )?evaluat/i);
  });
});
