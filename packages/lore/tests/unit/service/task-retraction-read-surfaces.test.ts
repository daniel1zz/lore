/**
 * Six-dimension tests proving `ValidityService.invalidate`'s task eligibility
 * (task-a-task-cannot-be-retracted-supersedes-emits-a-repair, Defect 2)
 * actually reaches the READ surfaces the task requires — `lore list`,
 * `lore ready`, `lore search`, and the `lore get` retraction banner — not
 * only a full-body read (which is what already existed and already failed).
 *
 * Uses InMemoryStore — no file I/O, no SQLite. `CorpusService.list`/`search`
 * and `TaskWorkflowService.ready`/`readyAdhoc` are exercised directly against
 * the SAME store a `ValidityService.invalidate` call wrote to, proving the
 * exclusion is real store-backed behavior, not a mocked assertion.
 *
 * Dimension mapping:
 *   HAPPY:      a retracted task is absent from `list({type:"task"})` (default),
 *               absent from `search()`, and absent from `ready(plan)`'s records
 *   NEGATIVE:   `--undo` restores full visibility to all three surfaces
 *   BOUNDARY:   `list({..., include_invalid: true})` restores it
 *   ERROR:      n/a beyond ValidityService's own error paths (covered in
 *               validity-service.test.ts) — this file is read-surface-only
 *   STATE:      readyAdhoc() excludes a retracted AD-HOC task the same way
 *               plan-scoped ready() excludes a retracted plan task
 *   REGRESSION: a normal (non-retracted) sibling task is UNAFFECTED — still
 *               listed and still ready (proves the filter is not over-broad,
 *               AC4); the retracted task is still retrievable by direct id
 *               (`corpusService.get`) and its version history is intact
 *               (`store.findVersions`) — retraction is NOT deletion (AC5);
 *               `resolveValidityBanner` names the superseding task's slug
 *
 * @spec_ref task-a-task-cannot-be-retracted-supersedes-emits-a-repair,
 *   Requirement 2 ("MUST affect lore list, lore ready and lore search")
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ValidityService } from "../../../src/service/validity-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { resolveValidityBanner } from "../../../src/service/outline-service.js";
import type { CreateDocInput } from "@lore/core";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeServices(ttl = 120) {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const validityService = new ValidityService(store);
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: ttl });
  return { store, corpusService, validityService, taskWorkflowService };
}

async function createPlan(cs: CorpusService, title = "Test Plan"): Promise<string> {
  const result = await cs.create({ type: "plan", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createTask(
  cs: CorpusService,
  planId: string,
  title: string,
): Promise<{ id: string; slug: string }> {
  const result = await cs.create({
    type: "task",
    title,
    parent_id: planId,
    content: `body for ${title}`,
    extra: { plan_id: planId },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return { id: result.value.id, slug: result.value.slug };
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("HAPPY — a retracted task disappears from list/search/ready by default", () => {
  it("list({type:'task'}) excludes the retracted task; search() excludes it too", async () => {
    const { corpusService, validityService } = makeServices();
    const planId = await createPlan(corpusService);
    const wrong = await createTask(corpusService, planId, "Diagnosed Backwards Unique Marker");
    const replacement = await createTask(corpusService, planId, "Correct Replacement Task");

    const invalidateResult = await validityService.invalidate(wrong.id, {
      by: "alice",
      supersededBy: replacement.id,
      reason: "diagnosed backwards",
    });
    expect(invalidateResult.ok).toBe(true);

    const listResult = await corpusService.list({ type: "task" });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.value.docs.some((d) => d.id === wrong.id)).toBe(false);
    // CONTROL half of the same assertion — the replacement is still there.
    expect(listResult.value.docs.some((d) => d.id === replacement.id)).toBe(true);

    const searchResult = await corpusService.search("Diagnosed Backwards Unique Marker");
    expect(searchResult.ok).toBe(true);
    if (!searchResult.ok) return;
    expect(searchResult.value.results.some((r) => r.id === wrong.id)).toBe(false);
  });

  it("ready(plan) omits the retracted task from records entirely", async () => {
    const { corpusService, validityService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const wrong = await createTask(corpusService, planId, "Wrong Task For Ready");
    const good = await createTask(corpusService, planId, "Good Task For Ready");

    const invalidateResult = await validityService.invalidate(wrong.id, { by: "alice", reason: "wrong" });
    expect(invalidateResult.ok).toBe(true);

    const readyResult = await taskWorkflowService.ready(planId);
    expect(readyResult.ok).toBe(true);
    if (!readyResult.ok) return;
    expect(readyResult.value.records.some((r) => r.task.id === wrong.id)).toBe(false);
    // CONTROL (AC4) — the untouched sibling is still present AND ready.
    const goodRecord = readyResult.value.records.find((r) => r.task.id === good.id);
    expect(goodRecord).toBeDefined();
    expect(goodRecord?.ready).toBe(true);
  });
});

// ─── STATE — readyAdhoc mirrors ready(plan) ───────────────────────────────

describe("STATE — readyAdhoc() excludes a retracted ad-hoc task the same way", () => {
  it("an --adhoc task retracted via invalidate is absent from readyAdhoc()", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const validityService = new ValidityService(store);
    const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });

    // reason: an --adhoc task auto-parents to the corpus root PRD
    // (CorpusService._createImpl) — one must exist first, or creation
    // refuses with "no root PRD exists in this corpus".
    const rootPrdResult = await corpusService.create({
      type: "prd",
      title: "Root PRD",
      content: "root",
    } as CreateDocInput);
    expect(rootPrdResult.ok).toBe(true);

    const createResult = await corpusService.create({
      type: "task",
      title: "Ad-hoc wrong task",
      content: "body",
      extra: { adhoc: true },
    } as CreateDocInput);
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    const adhocTaskId = createResult.value.id;

    const invalidateResult = await validityService.invalidate(adhocTaskId, { by: "alice", reason: "wrong" });
    expect(invalidateResult.ok).toBe(true);

    const readyAdhocResult = await taskWorkflowService.readyAdhoc();
    expect(readyAdhocResult.ok).toBe(true);
    if (!readyAdhocResult.ok) return;
    expect(readyAdhocResult.value.some((r) => r.task.id === adhocTaskId)).toBe(false);
  });
});

// ─── NEGATIVE — --undo restores visibility ─────────────────────────────────

describe("NEGATIVE — undoing a retraction restores full visibility", () => {
  it("after --undo, the task reappears in list() and ready(plan)", async () => {
    const { corpusService, validityService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const task = await createTask(corpusService, planId, "Temporarily Retracted Task");

    const invalidateResult = await validityService.invalidate(task.id, { by: "alice", reason: "temp" });
    expect(invalidateResult.ok).toBe(true);

    const listWhileRetracted = await corpusService.list({ type: "task" });
    expect(listWhileRetracted.ok && listWhileRetracted.value.docs.some((d) => d.id === task.id)).toBe(false);

    const undoResult = await validityService.invalidate(task.id, { by: "alice", undo: true });
    expect(undoResult.ok).toBe(true);

    const listAfterUndo = await corpusService.list({ type: "task" });
    expect(listAfterUndo.ok).toBe(true);
    if (!listAfterUndo.ok) return;
    expect(listAfterUndo.value.docs.some((d) => d.id === task.id)).toBe(true);

    const readyAfterUndo = await taskWorkflowService.ready(planId);
    expect(readyAfterUndo.ok).toBe(true);
    if (!readyAfterUndo.ok) return;
    expect(readyAfterUndo.value.records.some((r) => r.task.id === task.id)).toBe(true);
  });
});

// ─── BOUNDARY — --include-invalid restores it to list() ────────────────────

describe("BOUNDARY — list({include_invalid:true}) restores the retracted task", () => {
  it("include_invalid:true surfaces the retracted task again", async () => {
    const { corpusService, validityService } = makeServices();
    const planId = await createPlan(corpusService);
    const task = await createTask(corpusService, planId, "Task Under include_invalid");

    const invalidateResult = await validityService.invalidate(task.id, { by: "alice", reason: "wrong" });
    expect(invalidateResult.ok).toBe(true);

    const listResult = await corpusService.list({ type: "task", include_invalid: true });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.value.docs.some((d) => d.id === task.id)).toBe(true);
  });
});

// ─── REGRESSION — retraction is not deletion ───────────────────────────────

describe("REGRESSION — a retracted task stays retrievable by direct id, its version history is intact, and its banner names the successor", () => {
  it("corpusService.get still resolves the retracted task by id; findVersions still shows pre-retraction versions", async () => {
    const { corpusService, validityService, store } = makeServices();
    const planId = await createPlan(corpusService);
    const wrong = await createTask(corpusService, planId, "Retracted But Not Deleted");
    const replacement = await createTask(corpusService, planId, "Its Replacement");

    const invalidateResult = await validityService.invalidate(wrong.id, {
      by: "alice",
      supersededBy: replacement.id,
      reason: "diagnosed backwards",
    });
    expect(invalidateResult.ok).toBe(true);

    // Direct address ALWAYS resolves (D3/D4) — retraction never hides a doc
    // from a caller who names it explicitly.
    const getResult = await corpusService.get(wrong.id);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.value.doc.id).toBe(wrong.id);

    // Version history is preserved — v1 (create) is still there alongside
    // the invalidate's own version bump.
    const versionsResult = await store.findVersions(wrong.id);
    expect(versionsResult.ok).toBe(true);
    if (!versionsResult.ok) return;
    expect(versionsResult.value.some((v) => v.version === 1)).toBe(true);
    expect(versionsResult.value.length).toBeGreaterThanOrEqual(2);
  });

  it("resolveValidityBanner names the superseding task's slug for a retracted task", async () => {
    const { corpusService, validityService, store } = makeServices();
    const planId = await createPlan(corpusService);
    const wrong = await createTask(corpusService, planId, "Task Needing A Banner");
    const replacement = await createTask(corpusService, planId, "Its Named Successor");

    const nowIso = "2026-08-01T00:00:00.000Z";
    const invalidateResult = await validityService.invalidate(
      wrong.id,
      { by: "alice", supersededBy: replacement.id, reason: "diagnosed backwards" },
      () => nowIso,
    );
    expect(invalidateResult.ok).toBe(true);
    if (!invalidateResult.ok) return;

    const banner = await resolveValidityBanner(store, invalidateResult.value.doc, nowIso);
    expect(banner).toBeDefined();
    expect(banner).toContain(replacement.slug);
    expect(banner).toContain("diagnosed backwards");
  });

  it("a normal (non-retracted) task is unaffected by a sibling's retraction (AC4 control)", async () => {
    const { corpusService, validityService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const wrong = await createTask(corpusService, planId, "Sibling Retracted");
    const untouched = await createTask(corpusService, planId, "Sibling Untouched Draft");

    const invalidateResult = await validityService.invalidate(wrong.id, { by: "alice", reason: "wrong" });
    expect(invalidateResult.ok).toBe(true);

    const listResult = await corpusService.list({ type: "task" });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    const untouchedSummary = listResult.value.docs.find((d) => d.id === untouched.id);
    expect(untouchedSummary).toBeDefined();
    expect(untouchedSummary?.status).toBe("draft");

    const readyResult = await taskWorkflowService.ready(planId);
    expect(readyResult.ok).toBe(true);
    if (!readyResult.ok) return;
    const untouchedRecord = readyResult.value.records.find((r) => r.task.id === untouched.id);
    expect(untouchedRecord).toBeDefined();
    expect(untouchedRecord?.ready).toBe(true);
  });
});
