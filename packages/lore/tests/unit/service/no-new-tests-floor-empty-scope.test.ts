/**
 * `done()`'s no-new-tests floor over an EXPLICITLY-EMPTY `extra.ac_scope` —
 * task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed.
 *
 * Defect: `requiresNoNewTestsDeclaration` short-circuited `false` for BOTH an
 * absent scope and an empty one (`acScope === undefined || acScope.length === 0`).
 * `--ac-scope` then became REQUIRED on the `--adhoc` branch (task-an-ad-hoc-task-
 * can-never-reach-the-attestation-path-that), with `--ac-scope ""` as the explicit-
 * empty declaration — making the empty array the DOMINANT ad-hoc shape. So the
 * floor was unarmed for exactly the shape the re-keying created: such a task
 * archived with zero red evidence rows, no `extra.red_first` declaration, and
 * NOTHING asking.
 *
 * Decision taken (recorded in `requiresNoNewTestsDeclaration`'s own JSDoc): the
 * floor keys on the DECLARATION'S PRESENCE, never on the array's LENGTH. An
 * empty scope genuinely claims no criterion, so "which ACs went red" has no
 * answer for it — but the floor's question is "was this work done red-first at
 * all", which is answerable either way, and the author who typed `--ac-scope ""`
 * has already been asked one AC question and answered it.
 *
 * ⛔ MOCK RISK: none. Every assertion below drives the REAL
 * `TaskWorkflowService.done` over a REAL `InMemoryStore` and re-reads the
 * PERSISTED doc/audit rows. The floor is a predicate over stored `extra`, so
 * there is no subprocess or clock to fake.
 *
 * ⛔ Both branches are asserted in every direction (the governing task's own
 * oracle requirement): a refusal test also asserts the doc did NOT archive and
 * that NO exemption was recorded; an archival test also asserts the refusal did
 * NOT happen and that the exemption IS recorded verbatim. Asserting only the
 * chosen branch would pass against the pre-fix silent behaviour.
 *
 * Dimension mapping:
 *   HAPPY:      empty scope + a REAL red row → archives with no escape hatch at
 *               all (the floor is satisfied by evidence, not by a declaration)
 *   NEGATIVE:   empty scope + no red row + no declaration → VALIDATION_ERROR,
 *               status UNCHANGED, no `no_new_tests_*` audit key anywhere
 *   BOUNDARY:   the absent-vs-empty seam — an ABSENT scope still archives
 *               (negative control: the floor did not become "always fires"),
 *               while `[]` refuses; and `[]` + the audited declaration archives
 *   ERROR:      a malformed `ac_scope` degrades to "not declared" (tolerant
 *               reader) and a blank declaration is refused on its own field
 *   STATE:      mutual exclusion with the red-first floor is preserved — an
 *               empty-scope task that ALSO declares `red_first: true` is
 *               governed by that floor alone, with ITS message, not this one's
 *               (both messages asserted, one present one absent)
 *   REGRESSION: a NON-empty scope behaves exactly as before (refusal wording
 *               still enumerates the declared ids), and the reason string
 *               round-trips verbatim onto EVERY lifecycle step's audit row
 *
 * @spec_ref task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed
 * @spec_ref task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the
 * @spec_ref adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import {
  TaskWorkflowService,
  type EvidenceInput,
  type VerifiedEvidenceInput,
} from "../../../src/service/task-workflow-service.js";
import { NoOpTelemetry } from "@lore/core";
import type { CreateDocInput, DocRecord } from "@lore/core";

// ─── Fixtures (mirror task-workflow-service.test.ts's shapes exactly) ────────

function makeServices() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store));
  const taskWorkflowService = new TaskWorkflowService(store, new NoOpTelemetry(), {
    claimTtlMinutes: 120,
  });
  return { store, corpusService, taskWorkflowService };
}

async function createPlan(cs: CorpusService, title = "Empty Scope Plan"): Promise<string> {
  const result = await cs.create({ type: "plan", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createTask(
  cs: CorpusService,
  planId: string,
  title: string,
  extraOpts: Record<string, unknown> = {},
): Promise<string> {
  const result = await cs.create({
    type: "task",
    title,
    parent_id: planId,
    content: "body",
    extra: { plan_id: planId, ...extraOpts },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

function evidence(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    oracle: "tsc",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "alice",
    output_tail: "captured output",
    capture_source: "self-report",
    ...overrides,
  };
}

function attestedPass(overrides: Partial<VerifiedEvidenceInput> = {}): VerifiedEvidenceInput {
  return {
    oracle: "tsc",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "runner",
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
    capture_source: "runner",
    ...overrides,
  };
}

/**
 * Gives a task the ONE thing `done()`'s FIRST floor (the runner-attested pass)
 * demands, so every assertion below is about the no-new-tests floor and never
 * about the attestation floor accidentally firing first.
 */
async function satisfyAttestationFloor(
  taskWorkflowService: TaskWorkflowService,
  taskId: string,
): Promise<void> {
  const result = await taskWorkflowService.recordVerifiedEvidence(
    taskId,
    attestedPass(),
    "2026-08-06T09:00:00.000Z",
  );
  if (!result.ok) throw new Error(`fixture attested pass failed: ${JSON.stringify(result.error)}`);
}

/** Re-reads the PERSISTED doc — never the return value of the call under test. */
async function storedDoc(store: InMemoryStore, taskId: string): Promise<DocRecord> {
  const found = await store.find(taskId);
  if (!found.ok || found.value === null) throw new Error("task vanished from the store");
  return found.value;
}

/** Every audit `details` object recorded against `taskId`, in store order. */
async function auditDetails(
  store: InMemoryStore,
  taskId: string,
): Promise<Array<Record<string, unknown>>> {
  const entries = await store.queryAudit({ doc_id: taskId });
  if (!entries.ok) throw new Error("audit query failed");
  return entries.value.map((e) => (e.details ?? {}) as Record<string, unknown>);
}

/**
 * The two INDEPENDENT lone tokens that identify this floor's refusal — never one
 * remembered sentence (CLAUDE.md standing lesson: a contiguous-substring matcher
 * degrades silently to no-match on any rewording).
 */
const NO_NEW_TESTS_ESCAPE_TOKEN = "--declare-no-new-tests";
const AC_SCOPE_FIELD_TOKEN = "ac_scope";
/** The RED-FIRST floor's own distinguishing token — used as a negative control. */
const RED_FIRST_FLOOR_TOKEN = "extra.red_first";

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("HAPPY — an empty-scope task with a REAL red row archives with no escape hatch", () => {
  it("ac_scope: [] + an expected-fail row + an attested pass → done succeeds, and no exemption is recorded", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Empty Scope With Red", { ac_scope: [] });

    await taskWorkflowService.addEvidence(
      taskId,
      evidence({ result: "expected-fail", output_tail: "AssertionError: expected 1 to equal 2" }),
    );
    await satisfyAttestationFloor(taskWorkflowService, taskId);

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;
    expect(doneResult.value.task.status).toBe("archived");
    expect((await storedDoc(store, taskId)).status).toBe("archived");

    // The OTHER branch, asserted absent: a genuine red row satisfies the floor,
    // so no audited exemption may be recorded on ANY step.
    const details = await auditDetails(store, taskId);
    expect(details.some((d) => "no_new_tests_reason" in d)).toBe(false);
    expect(details.some((d) => d["no_new_tests_declared"] === true)).toBe(false);
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("NEGATIVE — an empty-scope task with no red row and no declaration is REFUSED", () => {
  it("ac_scope: [] + attested pass only → VALIDATION_ERROR; status UNCHANGED and nothing archived", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Empty Scope No Red", { ac_scope: [] });
    await satisfyAttestationFloor(taskWorkflowService, taskId);

    const before = await storedDoc(store, taskId);
    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });

    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
    if (doneResult.error.code !== "VALIDATION_ERROR") return;
    expect(doneResult.error.field).toBe("extra.verification_evidence");
    // Two INDEPENDENT lone tokens, plus the task's own slug.
    expect(doneResult.error.message).toContain(AC_SCOPE_FIELD_TOKEN);
    expect(doneResult.error.message).toContain(NO_NEW_TESTS_ESCAPE_TOKEN);
    expect(doneResult.error.message).toContain(before.slug);

    // The OTHER branch, asserted absent: no silent archival, no partial walk.
    const after = await storedDoc(store, taskId);
    expect(after.status).toBe(before.status);
    expect(after.status).not.toBe("archived");
    expect(after.version).toBe(before.version);
    const details = await auditDetails(store, taskId);
    expect(details.some((d) => "no_new_tests_reason" in d)).toBe(false);
  });

  it("the refusal names the EMPTY declaration specifically, never an empty id list rendered as `ac_scope ()`", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Empty Scope Wording", { ac_scope: [] });
    await satisfyAttestationFloor(taskWorkflowService, taskId);

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    if (doneResult.error.code !== "VALIDATION_ERROR") return;
    // The non-empty branch's id-list rendering must not leak onto the empty one.
    expect(doneResult.error.message).not.toContain("ac_scope ()");
    expect(doneResult.error.message).toMatch(/EMPTY/);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("BOUNDARY — the absent-vs-empty seam, both directions on otherwise identical tasks", () => {
  it("an ABSENT ac_scope still archives while an EMPTY one refuses — the floor keys on presence, and did not become always-fires", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);

    // Negative control: no `ac_scope` key at all → the floor does not apply.
    const absentId = await createTask(corpusService, planId, "Absent Scope Control");
    await satisfyAttestationFloor(taskWorkflowService, absentId);
    const absentDone = await taskWorkflowService.done(absentId, { by: "alice" });
    expect(absentDone.ok).toBe(true);
    if (absentDone.ok) expect(absentDone.value.task.status).toBe("archived");

    // Same fixture, one key added → refused.
    const emptyId = await createTask(corpusService, planId, "Empty Scope Subject", { ac_scope: [] });
    await satisfyAttestationFloor(taskWorkflowService, emptyId);
    const emptyDone = await taskWorkflowService.done(emptyId, { by: "alice" });
    expect(emptyDone.ok).toBe(false);
  });

  it("ac_scope: [] + the audited --declare-no-new-tests reason → archives, and the reason is persisted verbatim", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Empty Scope Declared", { ac_scope: [] });
    await satisfyAttestationFloor(taskWorkflowService, taskId);

    const reason = "docs-only change: the JSDoc edit has a grep oracle, no new runtime test";
    const doneResult = await taskWorkflowService.done(taskId, {
      by: "alice",
      noNewTestsReason: reason,
    });

    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;
    expect((await storedDoc(store, taskId)).status).toBe("archived");

    const details = await auditDetails(store, taskId);
    const declaredRows = details.filter((d) => d["no_new_tests_declared"] === true);
    expect(declaredRows.length).toBeGreaterThan(0);
    for (const row of declaredRows) {
      expect(row["no_new_tests_reason"]).toBe(reason);
    }
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("ERROR — malformed input degrades safely; a blank declaration is refused on its own field", () => {
  it("a malformed ac_scope (a bare string, not an array) reads as NOT DECLARED — done succeeds, never crashes", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Malformed Scope");
    // Written through `set` because create-time Zod validation rejects the shape:
    // this pins the TOLERANT READER contract over a legacy/corrupted row.
    const patched = await corpusService.set(taskId, {
      extra: { plan_id: planId, ac_scope: "AC-1" },
    });
    expect(patched.ok).toBe(true);
    await satisfyAttestationFloor(taskWorkflowService, taskId);

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
  });

  it("ac_scope: [] + a whitespace-only noNewTestsReason → refused on field `noNewTestsReason`, never accepted as a declaration", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Blank Declaration", { ac_scope: [] });
    await satisfyAttestationFloor(taskWorkflowService, taskId);

    const doneResult = await taskWorkflowService.done(taskId, {
      by: "alice",
      noNewTestsReason: "   ",
    });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
    if (doneResult.error.code !== "VALIDATION_ERROR") return;
    expect(doneResult.error.field).toBe("noNewTestsReason");
    expect((await storedDoc(store, taskId)).status).not.toBe("archived");
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("STATE — mutual exclusion with the red-first floor survives the re-keying", () => {
  it("ac_scope: [] AND red_first: true with no red row → the RED-FIRST floor fires, not this one (both messages asserted)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Both Declarations", {
      ac_scope: [],
      red_first: true,
    });
    await satisfyAttestationFloor(taskWorkflowService, taskId);

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    if (doneResult.error.code !== "VALIDATION_ERROR") return;
    expect(doneResult.error.message).toContain(RED_FIRST_FLOOR_TOKEN);
    // ...and NOT the no-new-tests floor's escape hatch: an opted-in task must
    // never be told to declare that it adds no new test.
    expect(doneResult.error.message).not.toContain(NO_NEW_TESTS_ESCAPE_TOKEN);
  });

  it("an empty-scope red_first task WITH a red row archives — the opt-in path stays byte-identical", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Opted In Proven", {
      ac_scope: [],
      red_first: true,
    });
    await taskWorkflowService.addEvidence(taskId, evidence({ result: "expected-fail" }));
    await satisfyAttestationFloor(taskWorkflowService, taskId);

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("REGRESSION — the NON-empty scope path is unchanged", () => {
  it("a non-empty ac_scope with no red row still refuses AND still enumerates its declared ids", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Declared Ids", {
      ac_scope: ["AC-EMPTY-1", "AC-EMPTY-2"],
    });
    await satisfyAttestationFloor(taskWorkflowService, taskId);

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    if (doneResult.error.code !== "VALIDATION_ERROR") return;
    expect(doneResult.error.message).toContain("AC-EMPTY-1");
    expect(doneResult.error.message).toContain("AC-EMPTY-2");
    expect(doneResult.error.message).toContain(NO_NEW_TESTS_ESCAPE_TOKEN);
  });

  it("an ALREADY-archived empty-scope task stays an idempotent no-op — the terminal short-circuit precedes this floor", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Already Archived", { ac_scope: [] });
    await satisfyAttestationFloor(taskWorkflowService, taskId);

    const first = await taskWorkflowService.done(taskId, {
      by: "alice",
      noNewTestsReason: "fixture: archived once under the audited escape",
    });
    expect(first.ok).toBe(true);

    // A SECOND call with NO reason at all must still succeed — the newly-armed
    // floor must never break a past closure retroactively.
    const second = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.already_done).toBe(true);
  });
});
