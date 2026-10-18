/**
 * Tests for `plan.extra.ac_scope` cross-entity validation (SPEC-040 §T2 D5) on both the
 * create and set() write paths of CorpusService, plus the v6 assess prompt's D5 scope-fit
 * rendering (`buildAssessPromptV6`).
 *
 * Spec-first expectations:
 *   - Zod (`planAcScopeSchema`, `.min(1)`) rejects an empty `ac_scope` array at CREATE time
 *     via `createDocInputSchema`'s superRefine → VALIDATION_ERROR, before CorpusService's
 *     own cross-entity check ever runs.
 *   - CorpusService's cross-entity check rejects an `ac_scope` id not declared on the
 *     parent spec, AND rejects any `ac_scope` at all when the plan's parent is not a spec
 *     with declared acceptance criteria (PRD-parented plan, or spec with none declared).
 *   - A valid `ac_scope` (subset of the parent spec's declared ids) succeeds.
 *   - The set() path re-implements BOTH the shape check (Zod's `.min(1)` does NOT run
 *     automatically on `docPatchSchema.extra`, which is untyped `z.record(z.unknown())`)
 *     and the cross-entity membership check — this is NOT redundant with the create-path
 *     empty-array test; it is a distinct code path (`planAcScopeSchema.safeParse` inside
 *     `CorpusService.set`) that could regress independently.
 *   - `buildAssessPromptV6` marks every declared-but-out-of-scope criterion row with the
 *     literal suffix " (out of scope for this plan)" and restricts `declaredAcIds` (and the
 *     prompt's `ac_id MUST be one of:` instruction) to the plan's scoped subset.
 *
 * @spec_ref AC-ADF-5
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { buildAssessPromptV6 } from "../../../src/ai/assess-template.js";
import type { CreateDocInput } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

const DEFAULT_BUDGETS = { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 };

async function makePrdAndSpec(store: InMemoryStore, criteria: unknown[]) {
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const prdResult = await corpusService.create({
    type: "prd",
    title: "AC Scope Test PRD",
    content: "Root PRD for ac_scope tests.",
  } as CreateDocInput);
  if (!prdResult.ok) throw new Error("prd create failed");

  const specResult = await corpusService.create({
    type: "spec",
    title: "AC Scope Test Spec",
    content: "Spec body.",
    extra: { acceptance_criteria: criteria },
  } as CreateDocInput);
  if (!specResult.ok) throw new Error("spec create failed");

  return { corpusService, prdId: prdResult.value.id, specId: specResult.value.id };
}

const ONE_CRITERION = [
  { id: "AC-X-1", statement: "The widget renders without throwing.", verify: { mode: "human" } },
];

const TWO_CRITERIA = [
  { id: "AC-X-1", statement: "The widget renders without throwing.", verify: { mode: "human" } },
  { id: "AC-X-2", statement: "The widget meets WCAG AA contrast requirements.", verify: { mode: "human" } },
];

describe("CorpusService.create — plan extra.ac_scope cross-entity validation (AC-ADF-5)", () => {
  it("NEGATIVE (BOUNDARY): an empty ac_scope array is rejected by Zod's planAcScopeSchema.min(1) at create time", async () => {
    const store = actedStore(new InMemoryStore());
    const { corpusService, specId } = await makePrdAndSpec(store, ONE_CRITERION);

    const result = await corpusService.create({
      type: "plan",
      title: "Empty Scope Plan",
      parent_id: specId,
      content: "Plan body.",
      extra: { ac_scope: [] },
    } as CreateDocInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("NEGATIVE: an ac_scope id not declared on the parent spec is rejected, naming the unknown id", async () => {
    const store = actedStore(new InMemoryStore());
    const { corpusService, specId } = await makePrdAndSpec(store, ONE_CRITERION);

    const result = await corpusService.create({
      type: "plan",
      title: "Unknown Id Plan",
      parent_id: specId,
      content: "Plan body.",
      extra: { ac_scope: ["AC-UNKNOWN"] },
    } as CreateDocInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect("message" in result.error ? result.error.message : "").toContain("AC-UNKNOWN");
  });

  it("NEGATIVE: a plan parented directly under a PRD (no spec) declaring ac_scope is rejected", async () => {
    const store = actedStore(new InMemoryStore());
    const { corpusService, prdId } = await makePrdAndSpec(store, ONE_CRITERION);

    const result = await corpusService.create({
      type: "plan",
      title: "PRD-Parented Plan",
      parent_id: prdId,
      content: "Plan body.",
      extra: { ac_scope: ["AC-X-1"] },
    } as CreateDocInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("HAPPY: an ac_scope matching a declared spec criterion succeeds", async () => {
    const store = actedStore(new InMemoryStore());
    const { corpusService, specId } = await makePrdAndSpec(store, ONE_CRITERION);

    const result = await corpusService.create({
      type: "plan",
      title: "Valid Scope Plan",
      parent_id: specId,
      content: "Plan body.",
      extra: { ac_scope: ["AC-X-1"] },
    } as CreateDocInput);

    expect(result.ok).toBe(true);
  });
});

describe("CorpusService.set — plan extra.ac_scope cross-entity validation on the update path (AC-ADF-5, REGRESSION)", () => {
  it("NEGATIVE: set() rejects an ac_scope id not declared on the parent spec", async () => {
    const store = actedStore(new InMemoryStore());
    const { corpusService, specId } = await makePrdAndSpec(store, ONE_CRITERION);

    const planResult = await corpusService.create({
      type: "plan",
      title: "Set Path Plan",
      parent_id: specId,
      content: "Plan body.",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error("plan create failed");

    const setResult = await corpusService.set(planResult.value.id, { extra: { ac_scope: ["AC-UNKNOWN"] } });
    expect(setResult.ok).toBe(false);
    if (setResult.ok) return;
    expect(setResult.error.code).toBe("VALIDATION_ERROR");
  });

  it("NEGATIVE (STATE/REGRESSION): set() rejects an empty ac_scope array — NOT auto-caught by Zod on this path (docPatchSchema.extra is untyped), proving the explicit planAcScopeSchema re-check inside set() actually runs", async () => {
    const store = actedStore(new InMemoryStore());
    const { corpusService, specId } = await makePrdAndSpec(store, ONE_CRITERION);

    const planResult = await corpusService.create({
      type: "plan",
      title: "Set Path Empty Scope Plan",
      parent_id: specId,
      content: "Plan body.",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error("plan create failed");

    const setResult = await corpusService.set(planResult.value.id, { extra: { ac_scope: [] } });
    expect(setResult.ok).toBe(false);
    if (setResult.ok) return;
    expect(setResult.error.code).toBe("VALIDATION_ERROR");
  });

  it("HAPPY: set() accepts an ac_scope matching a declared spec criterion", async () => {
    const store = actedStore(new InMemoryStore());
    const { corpusService, specId } = await makePrdAndSpec(store, ONE_CRITERION);

    const planResult = await corpusService.create({
      type: "plan",
      title: "Set Path Valid Plan",
      parent_id: specId,
      content: "Plan body.",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error("plan create failed");

    const setResult = await corpusService.set(planResult.value.id, { extra: { ac_scope: ["AC-X-1"] } });
    expect(setResult.ok).toBe(true);
  });
});

describe("buildAssessPromptV6 — D5 scope-fit rendering restricts out-of-scope rows and the declared-id universe (AC-ADF-5)", () => {
  it("a plan scoped to a strict subset of the spec's declared criteria marks the out-of-scope row and restricts declaredAcIds + the ac_id instruction", async () => {
    const store = actedStore(new InMemoryStore());
    const { corpusService, specId } = await makePrdAndSpec(store, TWO_CRITERIA);

    const planResult = await corpusService.create({
      type: "plan",
      title: "Scoped Plan",
      parent_id: specId,
      content: "Plan body for the scoped-AC test.",
      extra: { ac_scope: ["AC-X-1"] },
    } as CreateDocInput);
    if (!planResult.ok) throw new Error("plan create failed");

    const bundleResult = await corpusService.getPlanBundle(planResult.value.id);
    if (!bundleResult.ok) throw new Error("getPlanBundle failed");

    const result = buildAssessPromptV6(bundleResult.value, undefined, DEFAULT_BUDGETS);

    // AC-X-2's table row must be annotated as out of scope.
    expect(result.prompt).toMatch(/AC-X-2[^\n]*\(out of scope for this plan\)/);
    // AC-X-1 must NOT be annotated (it's in scope).
    expect(result.prompt).not.toMatch(/AC-X-1[^\n]*\(out of scope for this plan\)/);

    // The output instruction's declared-id universe is restricted to the scoped subset.
    const instructionLine = result.prompt
      .split("\n")
      .find((line) => line.includes("ac_id MUST be one of:"));
    expect(instructionLine).toBeDefined();
    expect(instructionLine).toContain("AC-X-1");
    expect(instructionLine).not.toContain("AC-X-2");

    expect(result.declaredAcIds).toEqual(["AC-X-1"]);
  });
});
