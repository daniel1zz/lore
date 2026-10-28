// @reads packages/lore/src/service/task-workflow-service.ts
// @reads packages/lore/tests/unit/service/capture-source-required.type-fixture.ts
// @layer service-task-workflow-evidence AC-EH-2
/**
 * Six-dimension tests closing task-capture-source-is-optional-at-the-evidence-
 * write-boundary — `capture_source` becomes REQUIRED on both `EvidenceInput`
 * (self-reported, `addEvidence`) and `VerifiedEvidenceInput` (runner-attested,
 * `recordVerifiedEvidence`/`recordChecklistVerifiedEvidence`), and the write
 * boundary's `?? "self-report"` fallback is deleted — the type makes omission
 * unrepresentable instead of defaulting it to a value that LOOKS honest.
 *
 * Dimension mapping:
 *   HAPPY:      addEvidence (TaskWorkflowService AND PhaseWorkflowService) with
 *               an explicit capture_source persists the field verbatim;
 *               VerifyRunnerService.verifyPlan's recorded entry carries
 *               capture_source: "runner" — the value it can PROVE (AC-3, both
 *               remaining callers named in the task's Required Fix step 3)
 *   NEGATIVE:   AC-1 — the type-fixture pinning omission as a compile error
 *               still exists; AC-2 — the nullish-coalescing self-report
 *               fallback string is fully gone from task-workflow-service.ts
 *   BOUNDARY:   an attested entry that LIES about capture_source (says
 *               "self-report" while attestation is present) is still forced to
 *               "runner" by the shared appendEvidenceEntry override — on BOTH
 *               TaskWorkflowService and PhaseWorkflowService's own copy
 *   ERROR:      a capture_source value outside the CAPTURE_SOURCES vocabulary,
 *               smuggled past the compile-time type via an `as` cast, is still
 *               rejected VALIDATION_ERROR by the shared runtime schema —
 *               defense in depth beyond the type layer
 *   STATE:      AC-5 — a self-reported pass still cannot satisfy done()'s
 *               runner-attested floor; a runner-attested pass still can.
 *               Asserted in BOTH directions, unchanged by this refactor
 *   REGRESSION: AC-4 — a task doc whose stored verification_evidence entry
 *               entirely lacks capture_source (simulating data written before
 *               this task) still reads back fine; the write boundary changed,
 *               not the read tolerance
 *
 * @spec_ref task-capture-source-is-optional-at-the-evidence-write-boundary AC-1
 *   AC-2 AC-3 AC-4 AC-5 AC-6
 */

import { tmpdir } from "node:os";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { ok } from "@lore/core";
import type {
  AcceptanceCriterion,
  CreateDocInput,
  DocRecord,
  DocType,
  LoreError,
  PlanBundle,
  Result,
} from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import {
  TaskWorkflowService,
  type EvidenceInput,
  type VerifiedEvidenceInput,
} from "../../../src/service/task-workflow-service.js";
import { PhaseWorkflowService } from "../../../src/service/phase-workflow-service.js";
import { VerifyRunnerService } from "../../../src/service/verify-runner-service.js";
import type { VerifySpawnSpec, VerifyExecutionResult } from "../../../src/service/verify-spawn.js";
import { actedStore } from "../../live-invocation.js";

import { fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
// ─── Shared fixtures (TaskWorkflowService) ─────────────────────────────────────

function makeServices() {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe());
  return { store, corpusService, taskWorkflowService };
}

async function createPlan(cs: CorpusService, title = "Capture Source Plan"): Promise<string> {
  const result = await cs.create({ parent_id: await ensureRequirementsDocId(cs), type: "plan", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createTask(cs: CorpusService, planId: string, title = "Capture Source Task"): Promise<string> {
  const result = await cs.create({
    type: "task",
    title,
    parent_id: planId,
    content: "body",
    extra: { plan_id: planId },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

// ─── Shared fixtures (PhaseWorkflowService — raw insert, D6a: type "phase" is
// migration-created only, never via CorpusService.create) ─────────────────────

function makePlanRecord(overrides: Partial<DocRecord> = {}): DocRecord {
  const base: DocRecord = {
    id: "01HPLAN0000000000CAPSRC01",
    slug: "capture-source-plan",
    type: "plan",
    role: "plan",
    title: "Plan",
    status: "approved",
    priority: "medium",
    content: "# Plan",
    parent_id: null,
    created_at: "2026-08-03T00:00:00.000Z",
    updated_at: "2026-08-03T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
  };
  return { ...base, ...overrides };
}

function makePhaseRecord(overrides: Partial<DocRecord> = {}): DocRecord {
  const base: DocRecord = {
    id: "01HPHASE000000000CAPSRC01",
    slug: "capture-source-phase",
    // reason: `type: "phase"` is migration-created only (D6a) — not wired into
    // schemas.ts's DocType union — same cast this repo's other raw phase
    // fixtures use (phase-workflow-service.test.ts, phase-workflow-inconclusive-
    // guard.test.ts).
    type: "phase" as unknown as DocType,
    role: "plan",
    title: "Phase",
    status: "draft",
    priority: "medium",
    content: "# Phase",
    parent_id: "01HPLAN0000000000CAPSRC01",
    created_at: "2026-08-03T00:00:00.000Z",
    updated_at: "2026-08-03T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { plan_id: "01HPLAN0000000000CAPSRC01" },
  };
  return { ...base, ...overrides, extra: { ...base.extra, ...overrides.extra } };
}

async function mustInsert(store: InMemoryStore, doc: DocRecord): Promise<DocRecord> {
  const result = await store.insert(doc);
  if (!result.ok) throw new Error(`insert failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function makePhaseServices() {
  const store = actedStore(new InMemoryStore());
  const service = new PhaseWorkflowService(store, undefined, { claimTtlMinutes: 120 });
  return { store, service };
}

// ─── Shared fixtures (VerifyRunnerService — hand-written port doubles, mirrors
// verify-runner-service.test.ts's own rationale: the PORT'S CONTRACT is under
// test here, not a callee's own logic) ──────────────────────────────────────

function makeDoc(overrides: Partial<DocRecord> & Pick<DocRecord, "id" | "type" | "title">): DocRecord {
  return {
    slug: overrides.id,
    role: "plan",
    status: "approved",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: "2026-08-03T00:00:00.000Z",
    updated_at: "2026-08-03T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

const FIXTURE_AC_SCOPE = ["AC-1"];

function scriptAc(id: string, command = "run"): AcceptanceCriterion {
  return { id, statement: `${id} statement`, verify: { mode: "script", oracle: "test", command } };
}

const VERIFY_CONFIG = {
  repoRoot: "/repo",
  defaultTimeoutMs: 300000,
  claimTtlMinutes: 120,
  requireCommandApproval: false,
  envAllowlist: [],
  envPassthroughAll: true,
  processEnv: {},
  tmpDir: tmpdir(),
};
const NOW = "2026-08-03T10:00:00.000Z";
const FRESH_CLAIM_AT = "2026-08-03T09:59:00.000Z";

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("HAPPY — capture_source persists verbatim on a self-reported write", () => {
  it("TaskWorkflowService.addEvidence stores capture_source: 'self-report' verbatim", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-predicate-
    // to-its-own) — `oracle: "tsc"` self-report is now REFUSED regardless of
    // tail content (rejectMissingPassOutputTail's D5 raise); `"manual"` is the
    // one oracle kind that can never produce capture_source "runner" (--capture
    // is refused for it — nothing to spawn), so it is the only oracle left that
    // still lets a genuinely non-empty self-reported tail succeed. This test's
    // OWN point (does "self-report" persist verbatim) is unaffected by the
    // oracle kind used to reach a successful write.
    const result = await taskWorkflowService.addEvidence(taskId, {
      oracle: "manual",
      command: "bun run typecheck",
      result: "pass",
      recorded_by: "alice",
      output_tail: "ok",
      capture_source: "self-report",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entries = result.value.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(entries[0]?.["capture_source"]).toBe("self-report");
  });

  it("AC-3: PhaseWorkflowService.addEvidence NOW stamps capture_source on the stored entry (previously always absent — a separate silence this task also closes on its declared anchor)", async () => {
    const { store, service } = makePhaseServices();
    await mustInsert(store, makePlanRecord());
    await mustInsert(store, makePhaseRecord());

    const result = await service.addEvidence("capture-source-phase", {
      oracle: "test",
      command: "bun test",
      result: "pass",
      recorded_by: "agent:p1",
      capture_source: "self-report",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entries = result.value.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.["capture_source"]).toBe("self-report");
  });

  it("AC-3: VerifyRunnerService.verifyPlan's recorded entry carries capture_source: 'runner' — the value THIS caller can prove (it spawns the command itself)", async () => {
    const ac = scriptAc("AC-1", "cmd-1");
    const plan = makeDoc({ id: "plan-1", type: "plan", title: "Plan" });
    const spec = makeDoc({
      id: "spec-1",
      type: "spec",
      title: "Spec",
      extra: { acceptance_criteria: [ac] },
    });
    const task = makeDoc({
      id: "task-1",
      type: "task",
      title: "Task",
      slug: "task-1",
      parent_id: "plan-1",
      extra: { ac_scope: FIXTURE_AC_SCOPE, claim: { by: "alice", at: FRESH_CLAIM_AT } },
    });
    const bundle: PlanBundle = { plan, spec, tasks: [task] };

    const getPlanBundle = async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle);
    const executor = async (): Promise<Result<VerifyExecutionResult, LoreError>> =>
      ok({ exitCode: 0, outputTail: "out", durationMs: 10, timedOut: false });
    const recordedEntries: VerifiedEvidenceInput[] = [];
    const recordVerifiedEvidence = async (
      _idOrSlug: string,
      entry: VerifiedEvidenceInput,
      _nowIso: string,
    ): Promise<Result<DocRecord, LoreError>> => {
      recordedEntries.push(entry);
      return ok(makeDoc({ id: "task-1", type: "task", title: "Task", version: 2 }));
    };

    const service = new VerifyRunnerService(getPlanBundle, recordVerifiedEvidence, executor, VERIFY_CONFIG);
    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });

    expect(result.ok).toBe(true);
    expect(recordedEntries).toHaveLength(1);
    expect(recordedEntries[0]?.capture_source).toBe("runner");
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("NEGATIVE — capture_source omission is a compile-time error (AC-1) and the runtime fallback is gone (AC-2)", () => {
  it("AC-1: the type-fixture pinning omission-fails-typecheck still exists (guards against silent deletion)", () => {
    const fixturePath = fileURLToPath(
      new URL("./capture-source-required.type-fixture.ts", import.meta.url),
    );
    expect(existsSync(fixturePath)).toBe(true);
    const src = readFileSync(fixturePath, "utf8");
    // reason: lone-token check (not a remembered phrase) — the fixture's own
    // discriminating property is that BOTH surfaces (EvidenceInput,
    // VerifiedEvidenceInput) carry an omission case guarded by the directive.
    expect(src.split("@ts-expect-error").length - 1).toBeGreaterThanOrEqual(2);
    expect(src).toContain("EvidenceInput");
    expect(src).toContain("VerifiedEvidenceInput");
  });

  it("AC-2: the nullish-coalescing self-report fallback is fully removed from task-workflow-service.ts", () => {
    const srcPath = fileURLToPath(
      new URL("../../../src/service/task-workflow-service.ts", import.meta.url),
    );
    const src = readFileSync(srcPath, "utf8");
    // reason: contiguous-substring check, exactly the shape AC-2 asks for
    // (`grep -c '?? "self-report"'` prints 0) — AC-1's type-fixture above is
    // the INDEPENDENT assertion this check's own caveat calls for, since a
    // reformatted fallback (e.g. split across two expressions) would evade
    // this string match but could never evade the type-fixture.
    expect(src).not.toContain('?? "self-report"');
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────────

describe("BOUNDARY — an attested entry that LIES about capture_source is still forced to 'runner'", () => {
  it("TaskWorkflowService.recordVerifiedEvidence overrides a caller-supplied 'self-report' to 'runner' whenever attestation is present", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.recordVerifiedEvidence(
      taskId,
      {
        oracle: "tsc",
        command: "bun run typecheck",
        result: "pass",
        recorded_by: "runner",
        // Deliberately WRONG — proves the override fires off `attestation`
        // alone, never trusting whatever the caller happened to pass.
        capture_source: "self-report",
        attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
      },
      "2026-08-03T10:00:00.000Z",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entries = result.value.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(entries[0]?.["capture_source"]).toBe("runner");
  });

  it("PhaseWorkflowService.recordChecklistVerifiedEvidence applies the identical override on its own copy of appendEvidenceEntry", async () => {
    const { store, service } = makePhaseServices();
    await mustInsert(store, makePlanRecord());
    await mustInsert(
      store,
      makePhaseRecord({
        extra: {
          checklist: [
            {
              id: "CHK-1",
              statement: "unit suite green",
              bind: { kind: "script", oracle: "test", command: "bun test" },
            },
          ],
        },
      }),
    );

    const result = await service.recordChecklistVerifiedEvidence(
      "capture-source-phase",
      {
        oracle: "test",
        command: "bun test",
        result: "pass",
        recorded_by: "runner",
        checklist_ref: "CHK-1",
        // Deliberately WRONG — same proof as the task-doc case above, on
        // PhaseWorkflowService's OWN candidate-building code (this file's
        // own declared anchor), not TaskWorkflowService's.
        capture_source: "self-report",
        attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
      },
      "2026-08-03T10:00:00.000Z",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entries = result.value.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(entries[0]?.["capture_source"]).toBe("runner");
  });
});

// ─── ERROR ────────────────────────────────────────────────────────────────────

describe("ERROR — a capture_source value outside the vocabulary is rejected at runtime (defense in depth)", () => {
  it("a value smuggled past the compile-time type via an `as` cast is rejected VALIDATION_ERROR by the shared schema", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-predicate-
    // to-its-own) — with `oracle: "tsc"` the NEW rejectMissingPassOutputTail
    // raise would refuse this call FIRST (field "output_tail", capture_source
    // "bogus-value" is not "runner"), never reaching the schema-level enum
    // check this test means to exercise. `"manual"` + a genuinely non-empty
    // tail satisfies that guard's one surviving escape, so the call proceeds
    // to `evidenceEntrySchema.safeParse`, which is what still rejects the
    // bogus `capture_source` value — this test's actual point.
    const bogus = {
      oracle: "manual",
      command: "bun run typecheck",
      result: "pass",
      recorded_by: "alice",
      output_tail: "ok",
      capture_source: "bogus-value",
    } as unknown as EvidenceInput;

    const result = await taskWorkflowService.addEvidence(taskId, bogus);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect((result.error as { field?: string }).field).toContain("capture_source");

    // The doc is left unchanged — no partial write.
    const after = await corpusService.get(taskId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.extra["verification_evidence"]).toBeUndefined();
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────────

describe("STATE — AC-5: done()'s runner-attested floor is unchanged by this refactor (both directions)", () => {
  it("a self-reported pass (capture_source: 'self-report', no attestation) still CANNOT satisfy done()'s floor", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-predicate-
    // to-its-own) — `oracle: "tsc"` self-report is now refused outright by
    // rejectMissingPassOutputTail's D5 raise, never reaching done() at all.
    // `"manual"` is the one oracle that still lets a genuinely non-empty
    // self-reported tail record successfully — it is STILL "self-report"
    // (no attestation), so done()'s SEPARATE runner-attested floor (this
    // test's actual point) still refuses it exactly as before.
    const evidenceResult = await taskWorkflowService.addEvidence(taskId, {
      oracle: "manual",
      command: "bun run typecheck",
      result: "pass",
      recorded_by: "alice",
      output_tail: "ok",
      capture_source: "self-report",
    });
    expect(evidenceResult.ok).toBe(true);

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
  });

  it("a runner-attested pass (capture_source: 'runner', attestation present) still CAN satisfy done()'s floor and archives", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const evidenceResult = await taskWorkflowService.recordVerifiedEvidence(
      taskId,
      {
        oracle: "tsc",
        command: "bun run typecheck",
        result: "pass",
        recorded_by: "runner",
        capture_source: "runner",
        attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
      },
      "2026-08-03T10:00:00.000Z",
    );
    expect(evidenceResult.ok).toBe(true);

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;
    expect(doneResult.value.task.status).toBe("archived");
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

describe("REGRESSION — AC-4: a stored row lacking capture_source entirely still reads back fine (write boundary only)", () => {
  it("a task doc with a verification_evidence entry that omits capture_source (simulating pre-task data) still reads back and computes readiness", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    // Bypasses the write boundary entirely (direct store.update, no
    // TaskWorkflowService involvement) — the only honest way to simulate a
    // row written before this task's requiredness armed, since every LIVE
    // write path now refuses omission at compile time.
    const current = await corpusService.get(taskId);
    expect(current.ok).toBe(true);
    if (!current.ok) return;

    const historicalEntry = {
      oracle: "tsc",
      command: "bun run typecheck",
      result: "pass",
      recorded_at: "2026-01-01T00:00:00.000Z",
      recorded_by: "alice",
      // capture_source deliberately ABSENT — the fixture's whole point.
    };
    const updateResult = await store.update(taskId, {
      extra: { ...current.value.doc.extra, verification_evidence: [historicalEntry] },
    });
    expect(updateResult.ok).toBe(true);

    const readBack = await corpusService.get(taskId);
    expect(readBack.ok).toBe(true);
    if (!readBack.ok) return;
    const entries = readBack.value.doc.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.["capture_source"]).toBeUndefined();

    const readyResult = await taskWorkflowService.ready(planId);
    expect(readyResult.ok).toBe(true);
    if (!readyResult.ok) return;
    const record = readyResult.value.records.find((r) => r.task.id === taskId);
    expect(record?.evidence_count).toBe(1);
    expect(record?.latest_evidence?.result).toBe("pass");
  });
});

// ─── runner-unattested label (issue #48, BR-1073) — AC-EH-2 b, b2, f ──────────
//
// RED against current code: today's appendEvidenceEntry (both copies) OVERRIDES
// capture_source to "runner" whenever an attestation is present, so a
// 'runner-unattested' + attestation row is silently relabelled and WRITTEN
// instead of refused. The paired implement task replaces the override with a
// refusal for this one contradictory combination.

const RUNNER_UNATTESTED_WITH_ATTESTATION = {
  oracle: "tsc",
  command: "bun run typecheck",
  result: "pass",
  recorded_by: "runner",
  // reason: cast — CAPTURE_SOURCES gains "runner-unattested" in the paired
  // implement task; until then the union does not contain it, so the contradictory
  // row (label says NOT attested, attestation says attested) is built through a cast.
  capture_source: "runner-unattested",
  attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
} as unknown as VerifiedEvidenceInput;

describe("ERROR — AC-EH-2 b: TaskWorkflowService refuses a runner-unattested row that carries an attestation", () => {
  it("recordVerifiedEvidence returns VALIDATION_ERROR and writes nothing", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.recordVerifiedEvidence(
      taskId,
      RUNNER_UNATTESTED_WITH_ATTESTATION,
      "2026-08-03T10:00:00.000Z",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");

    const after = await corpusService.get(taskId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.extra["verification_evidence"]).toBeUndefined();
  });
});

describe("ERROR — AC-EH-2 b2: PhaseWorkflowService's writer refuses the same row the same way", () => {
  it("recordChecklistVerifiedEvidence returns VALIDATION_ERROR and writes nothing", async () => {
    const { store, service } = makePhaseServices();
    await mustInsert(store, makePlanRecord());
    await mustInsert(
      store,
      makePhaseRecord({
        extra: {
          checklist: [
            {
              id: "CHK-1",
              statement: "unit suite green",
              bind: { kind: "script", oracle: "test", command: "bun test" },
            },
          ],
        },
      }),
    );

    const result = await service.recordChecklistVerifiedEvidence(
      "capture-source-phase",
      {
        ...RUNNER_UNATTESTED_WITH_ATTESTATION,
        oracle: "test",
        command: "bun test",
        checklist_ref: "CHK-1",
      } as unknown as Parameters<typeof service.recordChecklistVerifiedEvidence>[1],
      "2026-08-03T10:00:00.000Z",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");

    const stored = await store.findBySlug("capture-source-phase");
    expect(stored.ok).toBe(true);
    if (!stored.ok || stored.value === null) return;
    expect(stored.value.extra["verification_evidence"]).toBeUndefined();
  });
});

describe("STATE — AC-EH-2 f: a directly-stored pass labelled runner-unattested (no attestation) never satisfies done()'s floor", () => {
  it("done() refuses with floor 'attested-pass' and the task stays unarchived", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const current = await corpusService.get(taskId);
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    // Bypasses the writer on purpose — the writer never produces a PASS with this
    // label; this row models hand-edited or imported data, and must still not count.
    const forgedPass = {
      oracle: "tsc",
      command: "bun run typecheck",
      result: "pass",
      recorded_at: "2026-08-03T10:00:00.000Z",
      recorded_by: "alice",
      capture_source: "runner-unattested",
      // attestation deliberately ABSENT
    };
    const updateResult = await store.update(taskId, {
      extra: { ...current.value.doc.extra, verification_evidence: [forgedPass] },
    });
    expect(updateResult.ok).toBe(true);

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
    // AC-EH-2 f names `error.details.floor`. LoreError carries no `details` today
    // (field/value/message only) — see the task report; asserted verbatim, cast.
    const details = (doneResult.error as unknown as { details?: { floor?: string } }).details;
    expect(details?.floor).toBe("attested-pass");

    const after = await corpusService.get(taskId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.status).not.toBe("archived");
  });
});
