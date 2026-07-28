/**
 * RED-phase TDD tests for the `plan-terminality` drift kind.
 *
 * @spec_ref spec-plan-closure-must-be-loud-terminality-divergence-silent DD-1
 * @spec_ref task-skill-test-closure-terminality-detector-red-scenarios
 *
 * These tests describe a NOT-YET-IMPLEMENTED drift kind: `"plan-terminality"`
 * — a plan doc whose status is non-terminal (not `archived`/`deprecated`)
 * while it has >=1 child task and ALL child tasks are terminal.
 *
 * RED signal: `TreeDrift.kind` is currently typed as the `DriftKind` union
 * (`"missing" | "extra" | "misplaced" | "cycle" | "orphan"`), which does NOT
 * include `"plan-terminality"` yet. checkTree() therefore never produces a
 * drift of that kind — every "drift present" assertion below fails with
 * "expected length > 0, received 0" (missing implementation), never a type
 * error and never a test-authoring bug. We deliberately compare against the
 * string literal `"plan-terminality"` (via `d.kind as string`) rather than
 * importing a not-yet-existing `DriftKind` union member, so `tsc` stays
 * green throughout red AND green.
 *
 * ⛔ Vacuous guard (the single most important scenario here): a plan with
 * ZERO child tasks must NEVER report `plan-terminality` drift. A detector
 * that fires on "no tasks at all" would flag every freshly created plan and
 * would be strictly worse than no detector — see the BOUNDARY (vacuous
 * guard) test below, asserted separately and explicitly.
 *
 * Six dimensions represented for this drift kind:
 *   HAPPY    — non-terminal plan, all children terminal (archived) → drift
 *   BOUNDARY — vacuous guard (0 children) → NO drift
 *   NEGATIVE — non-terminal plan, mixed terminal/non-terminal children → NO drift
 *   STATE    — already-terminal (archived) plan, all children terminal → NO drift
 *   BOUNDARY — `deprecated` child counts as terminal, same as `archived` → drift
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import type { DocRecord, DocId, DocType, DocStatus } from "@lore/core";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { TreeBlueprint } from "@lore/core";
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
    status: partial.status ?? "draft",
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
  const r = await store.insert(rec);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

/** Minimal blueprint: prd root → plan child → task grandchild, all min=0. */
function prdPlanTaskBlueprint(): TreeBlueprint {
  return {
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
}

/**
 * Extract `plan-terminality` drifts from a checkTree result via a widened
 * string comparison — `DriftKind` does not (yet) include this member, so
 * comparing `d.kind === "plan-terminality"` directly would be a TS2367
 * compile error ("this comparison appears to be unintentional") until the
 * paired impl task widens the union. Casting to `string` sidesteps that
 * without importing the not-yet-existing member.
 */
function planTerminalityDrifts(drifts: readonly { kind: string }[]): { kind: string }[] {
  return drifts.filter((d) => (d.kind as string) === "plan-terminality");
}

async function seedPlanWithChildTasks(
  store: InMemoryStore,
  opts: { planStatus: DocStatus; childStatuses: DocStatus[] },
): Promise<{ prdId: DocId; planId: DocId; taskIds: DocId[] }> {
  const prdId = makeId("PRD001");
  const planId = makeId("PLN001");
  await seedDoc(store, { id: prdId, type: "prd", status: "active" });
  await seedDoc(store, { id: planId, type: "plan", parent_id: prdId, status: opts.planStatus });

  const taskIds: DocId[] = opts.childStatuses.map((_status, i) => makeId(`TSK00${i}`));

  for (let i = 0; i < opts.childStatuses.length; i++) {
    await seedDoc(store, {
      id: taskIds[i]!,
      type: "task",
      parent_id: planId,
      status: opts.childStatuses[i]!,
      extra: { plan_id: planId },
    });
  }

  return { prdId, planId, taskIds };
}

// ─── plan-terminality ───────────────────────────────────────────────────────

describe("TreeCheckService.checkTree — plan-terminality (HAPPY)", () => {
  it("AC-CLOSURE-1-HAPPY: non-terminal plan, 2 children both archived → plan-terminality drift naming that plan", async () => {
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const { planId } = await seedPlanWithChildTasks(store, {
      planStatus: "active", // non-terminal
      childStatuses: ["archived", "archived"],
    });

    const result = await svc.checkTree(prdPlanTaskBlueprint());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const drifts = planTerminalityDrifts(result.value.drifts);
    expect(drifts.length).toBe(1);
    const drift = drifts[0] as unknown as {
      kind: string;
      actual?: { id: DocId; type: DocType };
      detail: string;
    };
    // The drift must NAME the plan — either via `actual` (the established
    // TreeDrift convention for orphan/misplaced) or via its `detail` text.
    const namesThePlan =
      drift.actual?.id === planId || drift.detail.includes(planId);
    expect(namesThePlan).toBe(true);
  });
});

describe("TreeCheckService.checkTree — plan-terminality (BOUNDARY: vacuous guard)", () => {
  it("AC-CLOSURE-1-BND-VACUOUS: non-terminal plan with ZERO child tasks → NO plan-terminality drift", async () => {
    /**
     * ⛔ THE critical guard. A plan freshly created (no children yet) must
     * NEVER be flagged — "zero tasks" is not "all tasks terminal". A
     * detector that conflates "no evidence of non-terminality" with "proof
     * of terminality-readiness" would fire on every brand-new plan in the
     * corpus and would be strictly worse than shipping no detector at all.
     */
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const { planId } = await seedPlanWithChildTasks(store, {
      planStatus: "active", // non-terminal
      childStatuses: [], // ZERO children — the vacuous case
    });

    const result = await svc.checkTree(prdPlanTaskBlueprint());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const drifts = planTerminalityDrifts(result.value.drifts);
    expect(drifts.length).toBe(0);
    // Extra belt-and-braces: no drift of this kind references the plan at all.
    const anyNamingPlan = drifts.some(
      (d) =>
        (d as unknown as { actual?: { id: DocId } }).actual?.id === planId,
    );
    expect(anyNamingPlan).toBe(false);
  });
});

describe("TreeCheckService.checkTree — plan-terminality (NEGATIVE)", () => {
  it("AC-CLOSURE-1-NEG: non-terminal plan, 2 children — one archived, one active → NO plan-terminality drift", async () => {
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    await seedPlanWithChildTasks(store, {
      planStatus: "active", // non-terminal
      childStatuses: ["archived", "active"], // NOT all terminal
    });

    const result = await svc.checkTree(prdPlanTaskBlueprint());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const drifts = planTerminalityDrifts(result.value.drifts);
    expect(drifts.length).toBe(0);
  });
});

describe("TreeCheckService.checkTree — plan-terminality (STATE)", () => {
  it("AC-CLOSURE-1-STATE: already-archived plan whose children are all archived → NO plan-terminality drift", async () => {
    /**
     * The drift is about DIVERGENCE (plan says open, children say done).
     * A plan that has already been closed and whose children are terminal
     * is consistent — there is nothing left to announce.
     */
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    await seedPlanWithChildTasks(store, {
      planStatus: "archived", // ALREADY terminal
      childStatuses: ["archived", "archived"],
    });

    const result = await svc.checkTree(prdPlanTaskBlueprint());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const drifts = planTerminalityDrifts(result.value.drifts);
    expect(drifts.length).toBe(0);
  });
});

describe("TreeCheckService.checkTree — plan-terminality (BOUNDARY: deprecated counts as terminal)", () => {
  it("AC-CLOSURE-1-BND-DEPRECATED: non-terminal plan, children archived+deprecated (mix of terminal statuses) → plan-terminality drift", async () => {
    /**
     * `deprecated` is a terminal status (VALID_TRANSITIONS[deprecated] = {}),
     * same as `archived` — the detector must treat it identically, not just
     * pattern-match the literal string "archived".
     */
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    const { planId } = await seedPlanWithChildTasks(store, {
      planStatus: "active", // non-terminal
      childStatuses: ["archived", "deprecated"], // both terminal, mixed kinds
    });

    const result = await svc.checkTree(prdPlanTaskBlueprint());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const drifts = planTerminalityDrifts(result.value.drifts);
    expect(drifts.length).toBe(1);
    const drift = drifts[0] as unknown as {
      actual?: { id: DocId };
      detail: string;
    };
    const namesThePlan =
      drift.actual?.id === planId || drift.detail.includes(planId);
    expect(namesThePlan).toBe(true);
  });

  it("AC-CLOSURE-1-BND-DEPRECATED-ONLY: non-terminal plan, single child deprecated (not archived) → plan-terminality drift", async () => {
    const store = new InMemoryStore();
    const svc = new TreeCheckService(store);
    await seedPlanWithChildTasks(store, {
      planStatus: "draft", // non-terminal
      childStatuses: ["deprecated"], // sole child, terminal via deprecation only
    });

    const result = await svc.checkTree(prdPlanTaskBlueprint());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const drifts = planTerminalityDrifts(result.value.drifts);
    expect(drifts.length).toBe(1);
  });
});
