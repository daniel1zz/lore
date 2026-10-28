/**
 * Tests for CorpusService.getPlanBundle (SPEC-026 §3 D1; §4 AC-ASSESS-12).
 * Uses InMemoryStore — no file I/O, no SQLite dependency.
 *
 * Spec-first expectations (SPEC-026 §4 AC-ASSESS-12, §8.2):
 *   - plan parented under a spec → { plan, spec, tasks[] }, spec populated
 *   - plan parented under a PRD (no spec ancestor) → spec is undefined, NOT an error
 *   - plan with no parent at all → spec is undefined, NOT an error
 *   - a non-plan doc id/slug → VALIDATION_ERROR (not DOC_NOT_FOUND, not a silent empty bundle)
 *   - a nonexistent id/slug → DOC_NOT_FOUND
 *   - tasks[] carries each task's full extra, including verification_evidence
 *   - tasks[] excludes tasks belonging to OTHER plans (parent_id filter is exact)
 *
 * Six-dimension coverage:
 *   HAPPY:      plan+spec+tasks happy path; tasks carry verification_evidence
 *   NEGATIVE:   non-plan type input → VALIDATION_ERROR
 *   BOUNDARY:   plan with zero tasks → tasks: [] (not an error — AC-ASSESS-8 is enforced
 *               by the CLI/MCP callers, not by getPlanBundle itself)
 *   ERROR:      nonexistent id → DOC_NOT_FOUND
 *   STATE:      tasks from an unrelated plan are not leaked into this plan's bundle
 *   REGRESSION: spec is undefined (key absent behavior), never a null placeholder object
 *
 * @spec_ref AC-ASSESS-12
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import type { CreateDocInput } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
function makeService() {
  const store = actedStore(new InMemoryStore());
  return { service: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined))), store };
}

// ─── HAPPY ─────────────────────────────────────────────────────────────────

describe("getPlanBundle — HAPPY (spec-parented plan, AC-ASSESS-12)", () => {
  it("plan parented under a spec returns { plan, spec, tasks[] } with spec populated", async () => {
    const { service } = makeService();
    const prd = await service.create({ type: "prd", title: "Root PRD", content: "x" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd failed");
    const spec = await service.create({
      type: "spec",
      title: "Feature Spec",
      content: "AC-1: must do X",
    } as CreateDocInput);
    if (!spec.ok) throw new Error("spec failed");
    const plan = await service.create({
      type: "plan",
      title: "Impl Plan",
      parent_id: spec.value.id,
      content: "goals",
    } as CreateDocInput);
    if (!plan.ok) throw new Error("plan failed");
    const task = await service.create({
      type: "task",
      title: "Task A",
      parent_id: plan.value.id,
      content: "do the thing",
      extra: { plan_id: plan.value.id },
    } as CreateDocInput);
    if (!task.ok) throw new Error("task failed");

    const bundleResult = await service.getPlanBundle(plan.value.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.plan.id).toBe(plan.value.id);
    expect(bundleResult.value.spec?.id).toBe(spec.value.id);
    expect(bundleResult.value.tasks).toHaveLength(1);
    expect(bundleResult.value.tasks[0]?.id).toBe(task.value.id);
  });

  it("resolving by slug works the same as resolving by id", async () => {
    const { service } = makeService();
    const plan = await service.create({ parent_id: await ensureRequirementsDocId(service), type: "plan", title: "Slug Resolve Plan", content: "x" } as CreateDocInput);
    if (!plan.ok) throw new Error("plan failed");

    const bundleResult = await service.getPlanBundle(plan.value.slug);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.plan.id).toBe(plan.value.id);
  });

  it("tasks[] carries extra.verification_evidence entries intact", async () => {
    const { service } = makeService();
    const plan = await service.create({ parent_id: await ensureRequirementsDocId(service), type: "plan", title: "Evidence Plan", content: "x" } as CreateDocInput);
    if (!plan.ok) throw new Error("plan failed");
    const task = await service.create({
      type: "task",
      title: "Evidenced Task",
      parent_id: plan.value.id,
      content: "y",
      extra: {
        plan_id: plan.value.id,
        verification_evidence: [
          { oracle: "test", command: "bun test", result: "pass", recorded_at: "2026-07-01T00:00:00.000Z", recorded_by: "bob" },
        ],
      },
    } as CreateDocInput);
    if (!task.ok) throw new Error("task failed");

    const bundleResult = await service.getPlanBundle(plan.value.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    const evidence = bundleResult.value.tasks[0]?.extra["verification_evidence"];
    expect(evidence).toEqual([
      { oracle: "test", command: "bun test", result: "pass", recorded_at: "2026-07-01T00:00:00.000Z", recorded_by: "bob" },
    ]);
  });
});

// ─── HAPPY — PRD-parented / unparented plan (spec undefined) ────────────────

describe("getPlanBundle — PRD-parented and unparented plans (AC-ASSESS-12)", () => {
  it("plan parented directly under a PRD (no spec ancestor) → spec is undefined, not an error", async () => {
    const { service } = makeService();
    const prd = await service.create({ type: "prd", title: "Direct PRD", content: "x" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd failed");
    const plan = await service.create({
      type: "plan",
      title: "PRD-Parented Plan",
      parent_id: prd.value.id,
      content: "goals",
    } as CreateDocInput);
    if (!plan.ok) throw new Error("plan failed");

    const bundleResult = await service.getPlanBundle(plan.value.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.spec).toBeUndefined();
    // Not a fabricated placeholder — the `spec` key is genuinely absent from the object,
    // not present-and-set-to-undefined (defeats a `{ ...base, spec: undefined }` bug).
    expect("spec" in bundleResult.value).toBe(false);
  });

  it("plan with no parent at all → spec is undefined, not an error", async () => {
    const { service } = makeService();
    const plan = await service.create({ parent_id: await ensureRequirementsDocId(service), type: "plan", title: "Orphan Plan", content: "goals" } as CreateDocInput);
    if (!plan.ok) throw new Error("plan failed");

    const bundleResult = await service.getPlanBundle(plan.value.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.spec).toBeUndefined();
    expect(bundleResult.value.plan.id).toBe(plan.value.id);
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────

describe("getPlanBundle — NEGATIVE (non-plan input)", () => {
  it("a spec id/slug → VALIDATION_ERROR, not a silently-wrong bundle", async () => {
    const { service } = makeService();
    const prd = await service.create({ type: "prd", title: "Root", content: "x" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd failed");
    const spec = await service.create({
      type: "spec",
      title: "Not A Plan",
      content: "x",
    } as CreateDocInput);
    if (!spec.ok) throw new Error("spec failed");

    const bundleResult = await service.getPlanBundle(spec.value.id);
    expect(bundleResult.ok).toBe(false);
    if (bundleResult.ok) return;
    expect(bundleResult.error.code).toBe("VALIDATION_ERROR");
  });

  it("a task id/slug → VALIDATION_ERROR", async () => {
    const { service } = makeService();
    const plan = await service.create({ parent_id: await ensureRequirementsDocId(service), type: "plan", title: "Parent Plan", content: "x" } as CreateDocInput);
    if (!plan.ok) throw new Error("plan failed");
    const task = await service.create({
      type: "task",
      title: "A Task",
      parent_id: plan.value.id,
      content: "x",
      extra: { plan_id: plan.value.id },
    } as CreateDocInput);
    if (!task.ok) throw new Error("task failed");

    const bundleResult = await service.getPlanBundle(task.value.id);
    expect(bundleResult.ok).toBe(false);
    if (bundleResult.ok) return;
    expect(bundleResult.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── ERROR ────────────────────────────────────────────────────────────────

describe("getPlanBundle — ERROR (nonexistent doc)", () => {
  it("a nonexistent slug → DOC_NOT_FOUND", async () => {
    const { service } = makeService();
    const bundleResult = await service.getPlanBundle("plan-does-not-exist-anywhere");
    expect(bundleResult.ok).toBe(false);
    if (bundleResult.ok) return;
    expect(bundleResult.error.code).toBe("DOC_NOT_FOUND");
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────

describe("getPlanBundle — BOUNDARY (zero-task plan)", () => {
  it("a plan with zero child tasks returns tasks: [] — getPlanBundle itself is not the AC-ASSESS-8 gate", async () => {
    const { service } = makeService();
    const plan = await service.create({ parent_id: await ensureRequirementsDocId(service), type: "plan", title: "Empty Plan", content: "x" } as CreateDocInput);
    if (!plan.ok) throw new Error("plan failed");

    const bundleResult = await service.getPlanBundle(plan.value.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.tasks).toEqual([]);
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────

describe("getPlanBundle — STATE (task/plan isolation)", () => {
  it("tasks belonging to a DIFFERENT plan are not leaked into this plan's bundle", async () => {
    const { service } = makeService();
    const planA = await service.create({ parent_id: await ensureRequirementsDocId(service), type: "plan", title: "Plan A", content: "x" } as CreateDocInput);
    if (!planA.ok) throw new Error("planA failed");
    const planB = await service.create({ parent_id: await ensureRequirementsDocId(service), type: "plan", title: "Plan B", content: "x" } as CreateDocInput);
    if (!planB.ok) throw new Error("planB failed");

    await service.create({
      type: "task",
      title: "Task on A",
      parent_id: planA.value.id,
      content: "x",
      extra: { plan_id: planA.value.id },
    } as CreateDocInput);
    await service.create({
      type: "task",
      title: "Task on B",
      parent_id: planB.value.id,
      content: "x",
      extra: { plan_id: planB.value.id },
    } as CreateDocInput);

    const bundleA = await service.getPlanBundle(planA.value.id);
    expect(bundleA.ok).toBe(true);
    if (!bundleA.ok) return;
    expect(bundleA.value.tasks).toHaveLength(1);
    expect(bundleA.value.tasks[0]?.title).toBe("Task on A");
  });
});
