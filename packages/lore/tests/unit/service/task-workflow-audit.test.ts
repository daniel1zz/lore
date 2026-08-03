/**
 * Focused audit-write assertions for TaskWorkflowService (SPEC-035 §2).
 * Additive to task-workflow-service.test.ts — deliberately NOT merged into that
 * file so the audit-specific dimension stays isolated and easy to locate.
 *
 * Uses InMemoryStore — no file I/O, no SQLite.
 *
 * Dimension mapping:
 *   HAPPY:      claim / release / addEvidence each append exactly one audit entry
 *               with the expected action string, actor, and details shape
 *   NEGATIVE:   a rejected write (CLAIM_CONFLICT) appends ZERO audit entries
 *   BOUNDARY:   claim with --steal records the previous holder in audit.details
 *   ERROR:      a STALE_VERSION-rejected write appends ZERO audit entries
 *   STATE:      claim → evidence → release sequence produces exactly 3 audit
 *               entries beyond the task's own create entry, queryable in order
 *   REGRESSION: n/a beyond what's covered above (full six-dim TaskWorkflowService
 *               coverage lives in task-workflow-service.test.ts)
 *
 * @spec_ref SPEC-035 §2
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService, type EvidenceInput } from "../../../src/service/task-workflow-service.js";
import type { CreateDocInput, AuditEntry } from "@lore/core";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeServices(ttl = 120) {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: ttl });
  return { store, corpusService, taskWorkflowService };
}

async function createPlan(cs: CorpusService, title = "Audit Workflow Plan"): Promise<string> {
  const result = await cs.create({ type: "plan", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createTask(cs: CorpusService, planId: string, title = "Audit Workflow Task"): Promise<string> {
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

function evidence(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    oracle: "tsc",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "alice",
    output_tail: "ok",
    // reason: task-capture-source-is-optional-at-the-evidence-write-boundary —
    // now compile-time-required on EvidenceInput.
    capture_source: "self-report",
    ...overrides,
  };
}

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("HAPPY — claim appends exactly one audit entry with the expected shape", () => {
  it("claim's audit entry has action 'claim', actor = by, details.version = new version, details.by/details.steal present", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice" });
    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) return;
    const newVersion = claimResult.value.version;
    expect(newVersion).toBe(2); // v1 create, v2 claim

    const auditResult = await store.queryAudit({ doc_id: taskId, action: "claim" });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    expect(auditResult.value).toHaveLength(1);
    const entry = auditResult.value[0] as AuditEntry;
    expect(entry.actor).toBe("alice");
    expect(entry.details?.["version"]).toBe(newVersion);
    expect(entry.details?.["by"]).toBe("alice");
    expect(entry.details?.["steal"]).toBe(false);
  });
});

describe("HAPPY — release appends one audit entry with action 'release' and details.previous_holder", () => {
  it("release's audit entry names the prior claim holder in details.previous_holder", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.claim(taskId, { by: "alice" });
    const releaseResult = await taskWorkflowService.release(taskId, { by: "alice" });
    expect(releaseResult.ok).toBe(true);
    if (!releaseResult.ok) return;

    const auditResult = await store.queryAudit({ doc_id: taskId, action: "release" });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    expect(auditResult.value).toHaveLength(1);
    const entry = auditResult.value[0] as AuditEntry;
    expect(entry.details?.["previous_holder"]).toBe("alice");
    expect(entry.details?.["version"]).toBe(releaseResult.value.version);
  });
});

describe("HAPPY — addEvidence appends one audit entry with action 'evidence' and matching oracle/command/result", () => {
  it("addEvidence's audit entry mirrors the exact oracle/command/result fields passed in (defeats a hardcoded stub)", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const evidenceResult = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ oracle: "lint", command: "bun run lint", result: "fail", output_tail: "3 errors" }),
    );
    expect(evidenceResult.ok).toBe(true);
    if (!evidenceResult.ok) return;

    const auditResult = await store.queryAudit({ doc_id: taskId, action: "evidence" });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    expect(auditResult.value).toHaveLength(1);
    const entry = auditResult.value[0] as AuditEntry;
    expect(entry.details?.["oracle"]).toBe("lint");
    expect(entry.details?.["command"]).toBe("bun run lint");
    expect(entry.details?.["result"]).toBe("fail");
    expect(entry.details?.["version"]).toBe(evidenceResult.value.version);

    // A second, differently-shaped evidence call must produce a DIFFERENT audit entry —
    // proves the details aren't a fixed/hardcoded literal.
    const second = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ oracle: "e2e", command: "playwright test", result: "pass" }),
    );
    expect(second.ok).toBe(true);
    const auditAfterSecond = await store.queryAudit({ doc_id: taskId, action: "evidence" });
    expect(auditAfterSecond.ok).toBe(true);
    if (!auditAfterSecond.ok) return;
    expect(auditAfterSecond.value).toHaveLength(2);
    const entries = auditAfterSecond.value;
    expect(entries.some((e) => e.details?.["oracle"] === "e2e" && e.details?.["result"] === "pass")).toBe(true);
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────────

describe("BOUNDARY — claim with --steal records the previous holder in audit.details", () => {
  it("a stolen claim's audit entry carries details.previous_holder = the original holder", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.claim(taskId, { by: "alice" });
    const stolen = await taskWorkflowService.claim(taskId, { by: "bob", steal: true });
    expect(stolen.ok).toBe(true);

    const auditResult = await store.queryAudit({ doc_id: taskId, action: "claim" });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    expect(auditResult.value).toHaveLength(2); // alice's initial claim + bob's steal
    const stealEntry = auditResult.value.find((e) => e.actor === "bob");
    expect(stealEntry?.details?.["steal"]).toBe(true);
    expect(stealEntry?.details?.["previous_holder"]).toBe("alice");
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("NEGATIVE — a rejected claim (CLAIM_CONFLICT) appends zero audit entries", () => {
  it("audit entry count for the task is unchanged after a rejected claim attempt", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.claim(taskId, { by: "alice" });
    const beforeResult = await store.queryAudit({ doc_id: taskId });
    expect(beforeResult.ok).toBe(true);
    if (!beforeResult.ok) return;
    const beforeCount = beforeResult.value.length;

    const conflicting = await taskWorkflowService.claim(taskId, { by: "bob" });
    expect(conflicting.ok).toBe(false);
    if (conflicting.ok) return;
    expect(conflicting.error.code).toBe("CLAIM_CONFLICT");

    const afterResult = await store.queryAudit({ doc_id: taskId });
    expect(afterResult.ok).toBe(true);
    if (!afterResult.ok) return;
    expect(afterResult.value.length).toBe(beforeCount); // no new entry from the rejected claim
  });

  it("a non-holder release without --force appends zero audit entries", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.claim(taskId, { by: "alice" });
    const beforeResult = await store.queryAudit({ doc_id: taskId });
    expect(beforeResult.ok).toBe(true);
    if (!beforeResult.ok) return;
    const beforeCount = beforeResult.value.length;

    const rejected = await taskWorkflowService.release(taskId, { by: "bob" });
    expect(rejected.ok).toBe(false);

    const afterResult = await store.queryAudit({ doc_id: taskId });
    expect(afterResult.ok).toBe(true);
    if (!afterResult.ok) return;
    expect(afterResult.value.length).toBe(beforeCount);
  });
});

// ─── ERROR ────────────────────────────────────────────────────────────────────

describe("ERROR — a STALE_VERSION-rejected write appends zero audit entries", () => {
  it("addEvidence surfacing STALE_VERSION (sequential-CAS recipe) does not append an audit entry", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const beforeResult = await store.queryAudit({ doc_id: taskId });
    expect(beforeResult.ok).toBe(true);
    if (!beforeResult.ok) return;
    const beforeCount = beforeResult.value.length; // 1 (create)

    let sideEffectApplied = false;
    // reason: mirrors the deterministic sequential-CAS recipe from
    // task-workflow-service.test.ts — now() fires after the CAS expected_version is
    // captured but before the write, letting us inject a concurrent version bump.
    const now = (): string => {
      if (!sideEffectApplied) {
        sideEffectApplied = true;
        void store.update(
          taskId,
          { extra: { plan_id: planId, injected_by_other_writer: true }, version: 2 },
          { expected_version: 1 },
        );
      }
      return "2026-07-02T10:00:00.000Z";
    };

    const result = await taskWorkflowService.addEvidence(taskId, evidence(), now);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STALE_VERSION");

    const afterResult = await store.queryAudit({ doc_id: taskId });
    expect(afterResult.ok).toBe(true);
    if (!afterResult.ok) return;
    expect(afterResult.value.length).toBe(beforeCount); // no audit entry from the rejected write
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────────

describe("STATE — claim → evidence → release produces exactly 3 audit entries beyond create", () => {
  it("querying store.queryAudit({doc_id}) after the full sequence returns 4 entries total (create + 3 workflow writes)", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const afterCreate = await store.queryAudit({ doc_id: taskId });
    expect(afterCreate.ok).toBe(true);
    if (!afterCreate.ok) return;
    expect(afterCreate.value).toHaveLength(1);
    expect(afterCreate.value[0]?.action).toBe("create");

    await taskWorkflowService.claim(taskId, { by: "alice" });
    await taskWorkflowService.addEvidence(taskId, evidence());
    await taskWorkflowService.release(taskId, { by: "alice" });

    const finalResult = await store.queryAudit({ doc_id: taskId });
    expect(finalResult.ok).toBe(true);
    if (!finalResult.ok) return;
    expect(finalResult.value).toHaveLength(4);

    const actions = finalResult.value.map((e) => e.action).sort();
    expect(actions).toEqual(["claim", "create", "evidence", "release"]);
  });
});
