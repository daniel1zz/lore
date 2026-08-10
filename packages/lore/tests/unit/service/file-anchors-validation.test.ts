/**
 * Tests for the file_anchors write seams (SPEC-042 §Design Decisions D3):
 * `CorpusService._createImpl`'s create-time `extra.file_anchors` validation, and
 * `TaskWorkflowService.setAnchors`/`addAnchors`/`removeAnchors`'s read-modify-write
 * verbs — against `InMemoryStore`, vitest.
 *
 * Six-dimension coverage:
 *   HAPPY:      create-time --anchor set validated + normalized + deduped;
 *               setAnchors/addAnchors/removeAnchors round-trip
 *   NEGATIVE:   ".." / leading "/" / backslash / empty entry / >50 entries /
 *               >512-char entry → each VALIDATION_ERROR naming the offending entry
 *   BOUNDARY:   addAnchors with zero new anchors is a no-op equivalent to existing;
 *               removeAnchors of a non-present anchor is a no-op
 *   ERROR:      normalizeFileAnchors failures abort the write before any store call
 *               (doc unchanged) — asserted via version-number stability
 *   STATE:      mutating anchors on a task holding an active claim AND evidence
 *               preserves BOTH untouched (REGRESSION, review S2)
 *   REGRESSION: see STATE above; also non-task doc types ignore extra.file_anchors
 *               (no validation triggered for a plan create, e.g.)
 *
 * @spec_ref SPEC-042 AC-S3-5
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { MAX_FILE_ANCHORS, MAX_FILE_ANCHOR_LENGTH } from "@lore/core";
import type { CreateDocInput, DocRecord } from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeServices() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
  return { store, corpusService, taskWorkflowService };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createPlan(cs: CorpusService): Promise<string> {
  const plan = await mustCreate(cs, { type: "plan", title: "Plan", content: "# Plan" } as CreateDocInput);
  return plan.id;
}

// ─── Create-time validation (CorpusService._createImpl) ───────────────────────

describe("CorpusService.create — file_anchors create-time validation (SPEC-042 D3)", () => {
  // HAPPY — validated, normalized, deduped
  it("normalizes and dedupes repeatable --anchor entries at create time", async () => {
    const { corpusService } = makeServices();
    const planId = await createPlan(corpusService);
    const result = await corpusService.create({
      type: "task",
      title: "Anchored Task",
      parent_id: planId,
      content: "# Task",
      extra: { plan_id: planId, file_anchors: ["src/a", "./src/a", "src//b/"] },
    } as CreateDocInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["file_anchors"]).toEqual(["src/a", "src/b/"]);
  });

  it("a task created with no file_anchors omits the key entirely", async () => {
    const { corpusService } = makeServices();
    const planId = await createPlan(corpusService);
    const result = await corpusService.create({
      type: "task",
      title: "Unanchored Task",
      parent_id: planId,
      content: "# Task",
      extra: { plan_id: planId },
    } as CreateDocInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["file_anchors"]).toBeUndefined();
  });

  // NEGATIVE — each malformed entry class → VALIDATION_ERROR naming the offending entry
  it("rejects a '..' segment, naming the offending entry", async () => {
    const { corpusService } = makeServices();
    const planId = await createPlan(corpusService);
    const result = await corpusService.create({
      type: "task",
      title: "Bad Task",
      parent_id: planId,
      content: "# Task",
      extra: { plan_id: planId, file_anchors: ["src/../etc"] },
    } as CreateDocInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect((result.error as { value?: unknown }).value).toBe("src/../etc");
  });

  it("rejects a leading '/' entry, naming the offending entry", async () => {
    const { corpusService } = makeServices();
    const planId = await createPlan(corpusService);
    const result = await corpusService.create({
      type: "task",
      title: "Bad Task",
      parent_id: planId,
      content: "# Task",
      extra: { plan_id: planId, file_anchors: ["/etc/passwd"] },
    } as CreateDocInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error as { value?: unknown }).value).toBe("/etc/passwd");
  });

  it("rejects a backslash entry, naming the offending entry", async () => {
    const { corpusService } = makeServices();
    const planId = await createPlan(corpusService);
    const result = await corpusService.create({
      type: "task",
      title: "Bad Task",
      parent_id: planId,
      content: "# Task",
      extra: { plan_id: planId, file_anchors: ["src\\a"] },
    } as CreateDocInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error as { value?: unknown }).value).toBe("src\\a");
  });

  it("rejects an empty-string entry", async () => {
    const { corpusService } = makeServices();
    const planId = await createPlan(corpusService);
    const result = await corpusService.create({
      type: "task",
      title: "Bad Task",
      parent_id: planId,
      content: "# Task",
      extra: { plan_id: planId, file_anchors: [""] },
    } as CreateDocInput);
    expect(result.ok).toBe(false);
  });

  it("rejects >50 entries", async () => {
    const { corpusService } = makeServices();
    const planId = await createPlan(corpusService);
    const anchors = Array.from({ length: MAX_FILE_ANCHORS + 1 }, (_, i) => `src/f-${i}.ts`);
    const result = await corpusService.create({
      type: "task",
      title: "Bad Task",
      parent_id: planId,
      content: "# Task",
      extra: { plan_id: planId, file_anchors: anchors },
    } as CreateDocInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an entry >512 chars, naming the offending entry", async () => {
    const { corpusService } = makeServices();
    const planId = await createPlan(corpusService);
    const tooLong = `src/${"a".repeat(MAX_FILE_ANCHOR_LENGTH)}`;
    const result = await corpusService.create({
      type: "task",
      title: "Bad Task",
      parent_id: planId,
      content: "# Task",
      extra: { plan_id: planId, file_anchors: [tooLong] },
    } as CreateDocInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error as { value?: unknown }).value).toBe(tooLong);
  });

  // REGRESSION — non-task doc types ignore extra.file_anchors, no validation triggered
  it("a plan create with a stray extra.file_anchors key is NOT validated (task-only seam)", async () => {
    const { corpusService } = makeServices();
    const result = await corpusService.create({
      type: "plan",
      title: "Plan With Stray Key",
      content: "# Plan",
      extra: { file_anchors: ["../whatever-invalid"] },
    } as CreateDocInput);
    // reason: taskExtraSchema's cap/format rules don't apply to plans; planExtraSchema
    // is .passthrough() so an arbitrary extra key is tolerated, and the SPEC-042
    // create-time validation block only ever fires for `data.type === "task"`.
    expect(result.ok).toBe(true);
  });
});

// ─── TaskWorkflowService anchor-mutation verbs ────────────────────────────────

describe("TaskWorkflowService.setAnchors/addAnchors/removeAnchors — read-modify-write (SPEC-042 D3)", () => {
  async function createTask(cs: CorpusService, planId: string): Promise<string> {
    const task = await mustCreate(cs, {
      type: "task",
      title: "RMW Task",
      parent_id: planId,
      content: "# Task",
      extra: { plan_id: planId },
    } as CreateDocInput);
    return task.id;
  }

  // HAPPY — setAnchors replaces wholesale
  it("setAnchors declaratively replaces the anchor list", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.setAnchors(taskId, ["src/a", "src/b"], { by: "alice" });
    const second = await taskWorkflowService.setAnchors(taskId, ["src/c"], { by: "alice" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.extra["file_anchors"]).toEqual(["src/c"]);
  });

  // HAPPY — addAnchors unions + normalizes + dedupes
  it("addAnchors unions new anchors onto the existing set, normalized + deduped", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.setAnchors(taskId, ["src/a"], { by: "alice" });
    const result = await taskWorkflowService.addAnchors(taskId, ["src/a", "./src/b"], { by: "alice" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["file_anchors"]).toEqual(["src/a", "src/b"]);
  });

  // HAPPY — removeAnchors difference
  it("removeAnchors removes matching (normalized) entries", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.setAnchors(taskId, ["src/a", "src/b"], { by: "alice" });
    const result = await taskWorkflowService.removeAnchors(taskId, ["./src/a"], { by: "alice" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["file_anchors"]).toEqual(["src/b"]);
  });

  // BOUNDARY — removeAnchors of a non-present anchor is a no-op
  it("removeAnchors of an anchor not currently present is a no-op (no error)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.setAnchors(taskId, ["src/a"], { by: "alice" });
    const result = await taskWorkflowService.removeAnchors(taskId, ["src/never-there"], { by: "alice" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["file_anchors"]).toEqual(["src/a"]);
  });

  // NEGATIVE — malformed entries reject on every verb
  it("addAnchors rejects a malformed new entry ('..')", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addAnchors(taskId, ["../escape"], { by: "alice" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("removeAnchors rejects a malformed removal candidate rather than silently matching nothing", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.setAnchors(taskId, ["src/a"], { by: "alice" });
    const result = await taskWorkflowService.removeAnchors(taskId, ["/absolute"], { by: "alice" });
    expect(result.ok).toBe(false);
  });

  it("setAnchors rejects >50 entries", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const anchors = Array.from({ length: MAX_FILE_ANCHORS + 1 }, (_, i) => `src/f-${i}.ts`);
    const result = await taskWorkflowService.setAnchors(taskId, anchors, { by: "alice" });
    expect(result.ok).toBe(false);
  });

  // ERROR — a failed normalization aborts the write before any store call (version unchanged)
  it("a rejected anchor mutation leaves the task's version UNCHANGED (no partial write)", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const before = await taskWorkflowService.setAnchors(taskId, ["src/a"], { by: "alice" });
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const versionBefore = before.value.version;

    const rejected = await taskWorkflowService.addAnchors(taskId, ["../escape"], { by: "alice" });
    expect(rejected.ok).toBe(false);

    const afterResult = await store.find(taskId);
    expect(afterResult.ok).toBe(true);
    if (!afterResult.ok || afterResult.value === null) return;
    expect(afterResult.value.version).toBe(versionBefore);
    expect(afterResult.value.extra["file_anchors"]).toEqual(["src/a"]);
  });

  // STATE / REGRESSION — mutating anchors on a task holding an active claim AND
  // evidence preserves BOTH untouched (review S2)
  it("mutating anchors preserves an active claim AND recorded evidence untouched", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice", branch: "wt-a" });
    expect(claimResult.ok).toBe(true);

    // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
    // predicate-to-its-own) — "tsc" self-report is now refused regardless of
    // tail content; "manual" is the one oracle that still lets a genuinely
    // non-empty self-reported tail succeed. This test only checks anchor
    // read-modify-write preserves evidence, not capture_source semantics.
    const evidenceResult = await taskWorkflowService.addEvidence(taskId, {
      oracle: "manual",
      command: "bun run typecheck",
      result: "pass",
      recorded_by: "alice",
      output_tail: "ok",
      capture_source: "self-report",
    });
    expect(evidenceResult.ok).toBe(true);

    const anchorResult = await taskWorkflowService.setAnchors(taskId, ["src/a"], { by: "alice" });
    expect(anchorResult.ok).toBe(true);
    if (!anchorResult.ok) return;

    expect(anchorResult.value.extra["claim"]).toMatchObject({ by: "alice", branch: "wt-a" });
    const evidenceArr = anchorResult.value.extra["verification_evidence"];
    expect(Array.isArray(evidenceArr)).toBe(true);
    expect((evidenceArr as unknown[]).length).toBe(1);
    expect(anchorResult.value.extra["file_anchors"]).toEqual(["src/a"]);
  });
});
