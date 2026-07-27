/**
 * Six-dimension tests for TaskWorkflowService (SPEC-025).
 * Uses InMemoryStore — no file I/O, no SQLite.
 *
 * Dimension mapping (SPEC-025 §7):
 *   HAPPY:      claim → evidence → release → ready round-trip
 *   NEGATIVE:   foreign fresh claim → CLAIM_CONFLICT; non-holder release; steal
 *               succeeds + records previous holder in version history
 *   BOUNDARY:   51st evidence entry → VALIDATION_ERROR, doc unchanged; TTL
 *               boundary via injected `now`
 *   ERROR:      STALE_VERSION via the sequential-CAS recipe (SPEC-025 §7) —
 *               NOT Promise.all (InMemoryStore.update has no internal await,
 *               so "races" resolve in call order and never interleave).
 *               Deterministic technique used here: the D10 `now()` time seam
 *               is invoked by the service AFTER it has read the doc (captured
 *               expected_version) but BEFORE it writes — a side effect inside
 *               the injected `now()` callback bumps the doc's version via a
 *               direct, un-awaited (but synchronously-executing, per
 *               InMemoryStore's no-internal-await contract) store.update()
 *               call, simulating a concurrent writer without any timing
 *               flakiness.
 *   STATE:      claim → stale via `now` injection; ready flips when a blocker
 *               transitions to archived; ready()'s upstream_unapproved advisory
 *               over an unapproved/approved/prd-parented/top-level plan parent
 *               (SPEC-032 §3.4, AC-6)
 *   REGRESSION: legacy `task_status` doc still validates (AC-WF-12); existing
 *               phase validation untouched; telemetry emits exactly one event
 *               per successful write (AC-WF-11) and zero on failure
 *
 * @spec_ref AC-WF-1 AC-WF-2 AC-WF-3 AC-WF-4 AC-WF-5 AC-WF-6 AC-WF-7 AC-WF-9
 *           AC-WF-11 AC-WF-12, SPEC-032 §3.4 AC-6
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { PhaseService } from "../../../src/service/phase-service.js";
import { TaskWorkflowService, type EvidenceInput } from "../../../src/service/task-workflow-service.js";
import { taskExtraSchema, ok, err } from "@lore/core";
import type { Telemetry, TelemetryEvent, CreateDocInput, Result, LoreError } from "@lore/core";

// ─── Capturing telemetry spy (mirrors corpus-service-telemetry.test.ts) ──────

class CapturingTelemetry implements Telemetry {
  readonly events: TelemetryEvent[] = [];
  private closed = false;
  record(event: TelemetryEvent): void {
    if (this.closed) return;
    this.events.push(event);
  }
  // reason: Telemetry requires emit() for ai.generation events — TaskWorkflowService
  // never calls it, but the interface must be fully implemented. No-op is correct here.
  emit(): void {
    /* not exercised by TaskWorkflowService */
  }
  close(): void {
    this.closed = true;
  }
  get last(): TelemetryEvent | undefined {
    return this.events[this.events.length - 1];
  }
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeServices(ttl = 120) {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const telemetry = new CapturingTelemetry();
  const taskWorkflowService = new TaskWorkflowService(store, telemetry, { claimTtlMinutes: ttl });
  return { store, corpusService, taskWorkflowService, telemetry };
}

/**
 * SPEC-038 §7 D4 — constructs TaskWorkflowService with an injected
 * `resolveDeclaredAcIds` stub port instead of a real CorpusService 3-hop
 * (plan → spec → acceptance_criteria) fixture. The stub is wrapped so tests can
 * assert how many times (if ever) it was actually invoked — proving the
 * no-ac_ref backward-compatibility path never touches the port at all.
 */
function makeServicesWithAcPort(
  resolveDeclaredAcIds: (planId: string) => Promise<Result<Set<string> | null, LoreError>>,
  ttl = 120,
) {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const telemetry = new CapturingTelemetry();
  let callCount = 0;
  const spiedPort = async (planId: string): Promise<Result<Set<string> | null, LoreError>> => {
    callCount++;
    return resolveDeclaredAcIds(planId);
  };
  const taskWorkflowService = new TaskWorkflowService(store, telemetry, { claimTtlMinutes: ttl }, spiedPort);
  return {
    store,
    corpusService,
    taskWorkflowService,
    telemetry,
    getAcPortCallCount: () => callCount,
  };
}

async function createPlan(cs: CorpusService, title = "Test Plan"): Promise<string> {
  const result = await cs.create({ type: "plan", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createTask(
  cs: CorpusService,
  planId: string,
  title = "Test Task",
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
    ...overrides,
  };
}

// ─── HAPPY — claim → evidence → release → ready round-trip ──────────────────

describe("HAPPY — claim → evidence → release → ready round-trip (AC-WF-1, AC-WF-3, AC-WF-6, AC-WF-7)", () => {
  it("full lifecycle: acquire lease, log oracle evidence, release, then read a clean ready report", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice" });
    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) return;
    expect(claimResult.value.extra["claim"]).toMatchObject({ by: "alice" });
    expect(claimResult.value.version).toBe(2); // v1 create, v2 claim

    const evidenceResult = await taskWorkflowService.addEvidence(taskId, evidence({ recorded_by: "alice" }));
    expect(evidenceResult.ok).toBe(true);
    if (!evidenceResult.ok) return;
    const evidenceArr = evidenceResult.value.extra["verification_evidence"];
    expect(Array.isArray(evidenceArr)).toBe(true);
    expect((evidenceArr as unknown[]).length).toBe(1);
    expect(evidenceResult.value.version).toBe(3);

    const releaseResult = await taskWorkflowService.release(taskId, { by: "alice" });
    expect(releaseResult.ok).toBe(true);
    if (!releaseResult.ok) return;
    expect(releaseResult.value.extra["claim"]).toBeUndefined();
    expect(releaseResult.value.version).toBe(4);

    const readyResult = await taskWorkflowService.ready(planId);
    expect(readyResult.ok).toBe(true);
    if (!readyResult.ok) return;
    expect(readyResult.value.records).toHaveLength(1);
    const record = readyResult.value.records[0];
    expect(record?.ready).toBe(true);
    expect(record?.claim).toBeUndefined();
    expect(record?.evidence_count).toBe(1);
    expect(record?.latest_evidence?.result).toBe("pass");
  });

  it("addEvidence records the exact oracle/command/result fields passed in (defeats a hardcoded-return stub)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const r1 = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ oracle: "lint", command: "bun run lint", result: "fail", output_tail: "3 errors" }),
    );
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const entries = r1.value.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(entries[0]).toMatchObject({
      oracle: "lint",
      command: "bun run lint",
      result: "fail",
      output_tail: "3 errors",
    });

    const r2 = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ oracle: "e2e", command: "playwright test", result: "pass" }),
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const entries2 = r2.value.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(entries2).toHaveLength(2);
    expect(entries2[1]).toMatchObject({ oracle: "e2e", command: "playwright test", result: "pass" });
  });
});

// ─── HAPPY — expected-fail evidence result (AC-WH-1) ────────────────────────
// spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M1: a
// deliberate RED-phase oracle run (fails by design, before its implementation
// lands) must be recordable without laundering it into a dishonest "pass" or
// an indistinguishable-from-a-real-regression "fail".

describe("HAPPY — expected-fail evidence result accepted, stored verbatim (AC-WH-1)", () => {
  it("addEvidence accepts result: \"expected-fail\" (no special guard, unlike runner-only \"inconclusive\") and stores it verbatim", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({
        oracle: "test",
        command: "bunx vitest run new-feature.test.ts",
        result: "expected-fail",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entries = result.value.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    // Verbatim — not coerced toward "pass" or "fail".
    expect(entries[0]?.["result"]).toBe("expected-fail");
  });

  it("ready()'s latest_evidence.result reports expected-fail verbatim and never affects the ready boolean (D3: blocker-status-driven only)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const added = await taskWorkflowService.addEvidence(taskId, evidence({ result: "expected-fail" }));
    expect(added.ok).toBe(true);

    const readyResult = await taskWorkflowService.ready(planId);
    expect(readyResult.ok).toBe(true);
    if (!readyResult.ok) return;
    const record = readyResult.value.records.find((r) => r.task.id === taskId);
    expect(record?.latest_evidence?.result).toBe("expected-fail");
    // No blockers on this task — readiness is unaffected by the evidence result value.
    expect(record?.ready).toBe(true);
  });

  it("REGRESSION: a mixed pass-then-expected-fail evidence log still reports the LAST entry's result verbatim in latest_evidence", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));
    const second = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ command: "bunx vitest run red.test.ts", result: "expected-fail" }),
    );
    expect(second.ok).toBe(true);

    const readyResult = await taskWorkflowService.ready(planId);
    expect(readyResult.ok).toBe(true);
    if (!readyResult.ok) return;
    const record = readyResult.value.records.find((r) => r.task.id === taskId);
    expect(record?.latest_evidence?.result).toBe("expected-fail");
    expect(record?.evidence_count).toBe(2);
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("NEGATIVE — foreign fresh claim → CLAIM_CONFLICT (AC-WF-3)", () => {
  it("a fresh claim held by a different actor rejects a second claimant without --steal", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const first = await taskWorkflowService.claim(taskId, { by: "alice" });
    expect(first.ok).toBe(true);

    const second = await taskWorkflowService.claim(taskId, { by: "bob" });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("CLAIM_CONFLICT");
    if (second.error.code !== "CLAIM_CONFLICT") return;
    expect(second.error.holder).toBe("alice");
    expect(second.error.age_minutes).toBeGreaterThanOrEqual(0);
  });

  it("re-claiming with the SAME actor refreshes the lease instead of conflicting", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.claim(taskId, { by: "alice" });
    const second = await taskWorkflowService.claim(taskId, { by: "alice" });
    expect(second.ok).toBe(true);
  });
});

describe("NEGATIVE — non-holder release rejected (AC-WF-6)", () => {
  it("release by a non-holder without --force → CLAIM_CONFLICT, claim remains intact", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.claim(taskId, { by: "alice" });
    const release = await taskWorkflowService.release(taskId, { by: "bob" });
    expect(release.ok).toBe(false);
    if (release.ok) return;
    expect(release.error.code).toBe("CLAIM_CONFLICT");
    if (release.error.code !== "CLAIM_CONFLICT") return;
    expect(release.error.holder).toBe("alice");

    // Claim must still be held by alice — the rejected release must not have mutated it.
    const claimAgain = await taskWorkflowService.claim(taskId, { by: "bob" });
    expect(claimAgain.ok).toBe(false); // still CLAIM_CONFLICT — proves claim wasn't cleared
  });

  it("release with --force by a non-holder succeeds and notes the forced override in history", async () => {
    const { corpusService, taskWorkflowService, store } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.claim(taskId, { by: "alice" });
    const release = await taskWorkflowService.release(taskId, { by: "bob", force: true, reason: "stale worker" });
    expect(release.ok).toBe(true);
    if (!release.ok) return;
    expect(release.value.extra["claim"]).toBeUndefined();

    const versions = await store.findVersions(taskId);
    expect(versions.ok).toBe(true);
    if (!versions.ok) return;
    const latestVersion = versions.value[0];
    expect(latestVersion?.change_summary).toContain("forced");
    expect(latestVersion?.change_summary).toContain("alice");
    expect(latestVersion?.change_summary).toContain("stale worker");
  });
});

describe("NEGATIVE — steal succeeds and records the previous holder in history (AC-WF-4)", () => {
  it("--steal overrides a fresh claim held by someone else, and version history names the previous holder", async () => {
    const { corpusService, taskWorkflowService, store } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.claim(taskId, { by: "alice" });
    const stolen = await taskWorkflowService.claim(taskId, { by: "bob", steal: true });
    expect(stolen.ok).toBe(true);
    if (!stolen.ok) return;
    expect(stolen.value.extra["claim"]).toMatchObject({ by: "bob" });

    const versions = await store.findVersions(taskId);
    expect(versions.ok).toBe(true);
    if (!versions.ok) return;
    const latestVersion = versions.value[0];
    expect(latestVersion?.change_summary).toContain("bob");
    expect(latestVersion?.change_summary).toContain("alice");
    expect(latestVersion?.change_summary).toMatch(/previous holder/i);
  });
});

describe("NEGATIVE — unknown oracle value rejected at write time", () => {
  it("an oracle value outside the enum fails VALIDATION_ERROR and does not write", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const bad = evidence({ oracle: "bogus" as unknown as EvidenceInput["oracle"] });
    const result = await taskWorkflowService.addEvidence(taskId, bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");

    // Doc must be unchanged — no phantom entry, no version bump.
    const after = await corpusService.get(taskId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.version).toBe(1);
    expect(after.value.doc.extra["verification_evidence"]).toBeUndefined();
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────────

describe("BOUNDARY — 51st evidence entry rejected, doc unchanged (AC-WF-2)", () => {
  it("appending a 51st entry to a full 50-entry log fails VALIDATION_ERROR without mutating the doc", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    for (let i = 0; i < 50; i++) {
      const r = await taskWorkflowService.addEvidence(taskId, evidence({ command: `run ${i}` }));
      expect(r.ok).toBe(true);
    }

    const beforeGet = await corpusService.get(taskId);
    expect(beforeGet.ok).toBe(true);
    if (!beforeGet.ok) return;
    const versionBefore = beforeGet.value.doc.version;
    expect((beforeGet.value.doc.extra["verification_evidence"] as unknown[]).length).toBe(50);

    const overflow = await taskWorkflowService.addEvidence(taskId, evidence({ command: "run 50" }));
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.error.code).toBe("VALIDATION_ERROR");

    const afterGet = await corpusService.get(taskId);
    expect(afterGet.ok).toBe(true);
    if (!afterGet.ok) return;
    expect(afterGet.value.doc.version).toBe(versionBefore); // unchanged
    expect((afterGet.value.doc.extra["verification_evidence"] as unknown[]).length).toBe(50); // unchanged
  }, 20_000);
});

describe("BOUNDARY — TTL boundary via injected now (AC-WF-4)", () => {
  it("age exactly at TTL is still a fresh (conflicting) claim, not stale", async () => {
    const { corpusService, taskWorkflowService } = makeServices(120);
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const claimedAt = "2026-07-02T08:00:00.000Z";
    await taskWorkflowService.claim(taskId, { by: "alice" }, () => claimedAt);

    const exactlyAtTtl = "2026-07-02T10:00:00.000Z"; // exactly 120 minutes later
    const attempt = await taskWorkflowService.claim(taskId, { by: "bob" }, () => exactlyAtTtl);
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.code).toBe("CLAIM_CONFLICT");
  });

  it("age one minute past TTL is stale and claimable without --steal", async () => {
    const { corpusService, taskWorkflowService } = makeServices(120);
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const claimedAt = "2026-07-02T08:00:00.000Z";
    await taskWorkflowService.claim(taskId, { by: "alice" }, () => claimedAt);

    const pastTtl = "2026-07-02T10:01:00.000Z"; // 121 minutes later
    const attempt = await taskWorkflowService.claim(taskId, { by: "bob" }, () => pastTtl);
    expect(attempt.ok).toBe(true);
    if (!attempt.ok) return;
    expect(attempt.value.extra["claim"]).toMatchObject({ by: "bob" });
  });
});

// ─── ERROR — sequential-CAS recipe for STALE_VERSION (SPEC-025 §7) ───────────

describe("ERROR — STALE_VERSION via sequential-CAS recipe (SPEC-025 §7, not Promise.all)", () => {
  it("addEvidence surfaces STALE_VERSION when the doc version changed between read and write", async () => {
    const { corpusService, taskWorkflowService, store } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    let sideEffectApplied = false;
    // reason: `now()` is invoked by _addEvidenceImpl AFTER resolveTask() has captured
    // task.version (the CAS expected_version) but BEFORE writeTaskExtra's store.update
    // call. Bumping the doc's version here — via a direct, un-awaited store.update()
    // call that InMemoryStore executes synchronously (no internal await before its CAS
    // check, per store/CLAUDE.md) — deterministically simulates a concurrent writer
    // without any Promise.all timing dependency.
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
    if (result.error.code !== "STALE_VERSION") return;
    expect(result.error.expected).toBe(1);
    expect(result.error.actual).toBe(2);

    // The "other writer's" change landed; the rejected addEvidence call must not have
    // clobbered it or partially applied its own evidence entry.
    const finalDoc = await corpusService.get(taskId);
    expect(finalDoc.ok).toBe(true);
    if (!finalDoc.ok) return;
    expect(finalDoc.value.doc.extra["injected_by_other_writer"]).toBe(true);
    expect(finalDoc.value.doc.extra["verification_evidence"]).toBeUndefined();
  });

  it("claim surfaces STALE_VERSION under the same sequential-CAS recipe", async () => {
    const { corpusService, taskWorkflowService, store } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    let sideEffectApplied = false;
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

    const result = await taskWorkflowService.claim(taskId, { by: "alice" }, now);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STALE_VERSION");
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────────

describe("STATE — claim → stale transition via now injection (AC-WF-4, D10)", () => {
  it("the SAME claim reports stale=false then stale=true purely as a function of injected now, via ready()", async () => {
    const { corpusService, taskWorkflowService } = makeServices(120);
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const claimedAt = "2026-07-02T08:00:00.000Z";
    await taskWorkflowService.claim(taskId, { by: "alice" }, () => claimedAt);

    const freshReport = await taskWorkflowService.ready(planId, () => "2026-07-02T09:00:00.000Z"); // 60 min later
    expect(freshReport.ok).toBe(true);
    if (!freshReport.ok) return;
    expect(freshReport.value.records[0]?.claim?.stale).toBe(false);

    const staleReport = await taskWorkflowService.ready(planId, () => "2026-07-02T11:00:00.000Z"); // 180 min later
    expect(staleReport.ok).toBe(true);
    if (!staleReport.ok) return;
    expect(staleReport.value.records[0]?.claim?.stale).toBe(true);
  });
});

describe("STATE — ready() flips when a blocker transitions to archived (AC-WF-7, D3)", () => {
  it("a blocked task becomes ready once its blocker's status becomes archived", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const blockerId = await createTask(corpusService, planId, "Blocker Task");
    const blockedId = await createTask(corpusService, planId, "Blocked Task");

    const linkResult = await corpusService.link(blockerId, blockedId, "blocks");
    expect(linkResult.ok).toBe(true);

    const before = await taskWorkflowService.ready(planId);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const blockedBefore = before.value.records.find((r) => r.task.id === blockedId);
    expect(blockedBefore?.ready).toBe(false);
    expect(blockedBefore?.unmet_blockers.map((b) => b.id)).toContain(blockerId);

    // reason: SPEC-002 §3 lifecycle only allows archived via approved (draft→
    // archived is illegal, enforced by CorpusService.set's INVALID_TRANSITION
    // check, B1 blocker fix) — route through the legal draft→approved→archived
    // chain rather than a direct (previously bug-permitted) jump.
    const approveResult = await corpusService.set(blockerId, { status: "approved" });
    expect(approveResult.ok).toBe(true);
    const archiveResult = await corpusService.set(blockerId, { status: "archived" });
    expect(archiveResult.ok).toBe(true);

    const after = await taskWorkflowService.ready(planId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const blockedAfter = after.value.records.find((r) => r.task.id === blockedId);
    expect(blockedAfter?.ready).toBe(true);
    expect(blockedAfter?.unmet_blockers).toEqual([]);
  });
});

describe("STATE — ready() upstream_unapproved advisory (SPEC-032 §3.4, AC-6)", () => {
  it("a plan parented under an unapproved (draft) spec → every record carries upstream_unapproved: true, readiness unaffected", async () => {
    const { corpusService, taskWorkflowService } = makeServices();

    const prdResult = await corpusService.create({
      type: "prd",
      title: "Upstream Test PRD",
      content: "root",
    } as CreateDocInput);
    if (!prdResult.ok) throw new Error("prd create failed");

    const specResult = await corpusService.create({
      type: "spec",
      title: "Upstream Test Spec",
      parent_id: prdResult.value.id,
      content: "spec body",
    } as CreateDocInput);
    if (!specResult.ok) throw new Error("spec create failed");
    expect(specResult.value.status).toBe("draft"); // sanity: not approved

    const planResult = await corpusService.create({
      type: "plan",
      title: "Upstream Test Plan",
      parent_id: specResult.value.id,
      content: "plan body",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error("plan create failed");
    const planId = planResult.value.id;
    const taskId = await createTask(corpusService, planId);

    const report = await taskWorkflowService.ready(planId);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    const record = report.value.records.find((r) => r.task.id === taskId);
    expect(record?.upstream_unapproved).toBe(true);
    expect(record?.ready).toBe(true); // never blocks — advisory only
  });

  it("once the parent spec is approved, upstream_unapproved is no longer set", async () => {
    const { corpusService, taskWorkflowService } = makeServices();

    const prdResult = await corpusService.create({
      type: "prd",
      title: "Approved-Path PRD",
      content: "root",
    } as CreateDocInput);
    if (!prdResult.ok) throw new Error("prd create failed");

    const specResult = await corpusService.create({
      type: "spec",
      title: "Approved-Path Spec",
      parent_id: prdResult.value.id,
      content: "spec body",
    } as CreateDocInput);
    if (!specResult.ok) throw new Error("spec create failed");
    const specId = specResult.value.id;

    const planResult = await corpusService.create({
      type: "plan",
      title: "Approved-Path Plan",
      parent_id: specId,
      content: "plan body",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error("plan create failed");
    const planId = planResult.value.id;
    const taskId = await createTask(corpusService, planId);

    const beforeApproval = await taskWorkflowService.ready(planId);
    expect(beforeApproval.ok).toBe(true);
    if (!beforeApproval.ok) return;
    expect(beforeApproval.value.records.find((r) => r.task.id === taskId)?.upstream_unapproved).toBe(true);

    const approveResult = await corpusService.set(specId, { status: "approved" });
    expect(approveResult.ok).toBe(true);

    const afterApproval = await taskWorkflowService.ready(planId);
    expect(afterApproval.ok).toBe(true);
    if (!afterApproval.ok) return;
    expect(afterApproval.value.records.find((r) => r.task.id === taskId)?.upstream_unapproved).toBeUndefined();
  });

  it("a plan parented directly under a prd (no spec) never carries upstream_unapproved", async () => {
    const { corpusService, taskWorkflowService } = makeServices();

    const prdResult = await corpusService.create({
      type: "prd",
      title: "Prd-Parented PRD",
      content: "root",
    } as CreateDocInput);
    if (!prdResult.ok) throw new Error("prd create failed");

    const planResult = await corpusService.create({
      type: "plan",
      title: "Prd-Parented Plan",
      parent_id: prdResult.value.id,
      content: "plan body",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error("plan create failed");
    const planId = planResult.value.id;
    const taskId = await createTask(corpusService, planId);

    const report = await taskWorkflowService.ready(planId);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.records.find((r) => r.task.id === taskId)?.upstream_unapproved).toBeUndefined();
  });

  it("a top-level plan (no parent at all) never carries upstream_unapproved", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const report = await taskWorkflowService.ready(planId);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.records.find((r) => r.task.id === taskId)?.upstream_unapproved).toBeUndefined();
  });
});

describe("STATE — ready() rejects a non-plan document (VALIDATION_ERROR)", () => {
  it("calling ready() with a task id (not a plan) fails loud instead of silently returning []", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.ready(taskId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("calling ready() with a non-existent plan id → DOC_NOT_FOUND", async () => {
    const { taskWorkflowService } = makeServices();
    const result = await taskWorkflowService.ready("plan-does-not-exist");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

describe("REGRESSION — legacy task_status doc still validates (AC-WF-12, D6)", () => {
  it("taskExtraSchema.passthrough() preserves an unrecognised legacy task_status key", () => {
    const legacyExtra = {
      plan_id: "01J5X7KZRF4AXRHX9WKE6DVP6P",
      task_status: "in-progress",
    };
    const parsed = taskExtraSchema.safeParse(legacyExtra);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // passthrough: the unknown key is preserved, not stripped or rejected.
    expect((parsed.data as Record<string, unknown>)["task_status"]).toBe("in-progress");
  });

  it("taskExtraSchema does NOT itself constrain task_status to the old enum (field is unowned now)", () => {
    // Any string value must pass — task_status is no longer schema-checked.
    const legacyExtra = { plan_id: "01J5X7KZRF4AXRHX9WKE6DVP6P", task_status: "some-future-value" };
    const parsed = taskExtraSchema.safeParse(legacyExtra);
    expect(parsed.success).toBe(true);
  });
});

describe("REGRESSION — existing phase validation untouched by claim/evidence writes", () => {
  it("claim() preserves an existing extra.phase value (spread must not drop unrelated keys)", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const phaseService = new PhaseService(store);
    const planId = await createPlan(corpusService);
    await phaseService.addPhase(planId, "Foundation");
    const taskId = await createTask(corpusService, planId, "Phased Task", { phase: "Foundation" });

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice" });
    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) return;
    expect(claimResult.value.extra["phase"]).toBe("Foundation");
  });

  it("addEvidence preserves an existing extra.phase value", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const phaseService = new PhaseService(store);
    const planId = await createPlan(corpusService);
    await phaseService.addPhase(planId, "Build");
    const taskId = await createTask(corpusService, planId, "Phased Task", { phase: "Build" });

    const result = await taskWorkflowService.addEvidence(taskId, evidence());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["phase"]).toBe("Build");
  });
});

describe("REGRESSION — telemetry emits exactly one event per successful write, zero on failure (AC-WF-11)", () => {
  it("claim / addEvidence / release each emit exactly one event with the expected method name", async () => {
    const { corpusService, taskWorkflowService, telemetry } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.claim(taskId, { by: "alice", source: "cli" });
    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.last?.method).toBe("task.claimed");
    expect(telemetry.last?.ok).toBe(true);
    expect(telemetry.last?.meta).toMatchObject({ source: "cli" });

    await taskWorkflowService.addEvidence(taskId, evidence({ source: "cli" }));
    expect(telemetry.events).toHaveLength(2);
    expect(telemetry.last?.method).toBe("task.evidence_added");

    await taskWorkflowService.release(taskId, { by: "alice", source: "cli" });
    expect(telemetry.events).toHaveLength(3);
    expect(telemetry.last?.method).toBe("task.released");
  });

  it("a failed claim (CLAIM_CONFLICT) does NOT emit a telemetry event", async () => {
    const { corpusService, taskWorkflowService, telemetry } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.claim(taskId, { by: "alice" });
    const countAfterFirstClaim = telemetry.events.length;

    const conflicting = await taskWorkflowService.claim(taskId, { by: "bob" });
    expect(conflicting.ok).toBe(false);
    expect(telemetry.events.length).toBe(countAfterFirstClaim); // no new event
  });

  it("a failed addEvidence (VALIDATION_ERROR, cap reached) does NOT emit a telemetry event", async () => {
    const { corpusService, taskWorkflowService, telemetry } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    for (let i = 0; i < 50; i++) {
      await taskWorkflowService.addEvidence(taskId, evidence({ command: `run ${i}` }));
    }
    const countAtCap = telemetry.events.length;
    expect(countAtCap).toBe(50);

    const overflow = await taskWorkflowService.addEvidence(taskId, evidence());
    expect(overflow.ok).toBe(false);
    expect(telemetry.events.length).toBe(countAtCap); // no new event on the 51st (rejected) call
  }, 20_000);

  it("ready() (a read, not a write) never emits a telemetry event — AC-WF-11 scopes it to writes", async () => {
    const { corpusService, taskWorkflowService, telemetry } = makeServices();
    const planId = await createPlan(corpusService);
    await createTask(corpusService, planId);
    telemetry.events.length = 0;

    await taskWorkflowService.ready(planId);
    expect(telemetry.events).toHaveLength(0);
  });
});

// ─── ac_ref cross-entity validation (SPEC-038 §4, §7 D4, AC-ACODE-3) ─────────
//
// These describe blocks construct TaskWorkflowService with an injected stub
// port (makeServicesWithAcPort) instead of a real CorpusService.resolveDeclaredAcIds
// 3-hop fixture — the port's CONTRACT (what addEvidence does with its Result) is
// under test here, not CorpusService's own graph-walking logic (that lives in
// corpus-service.test.ts / a dedicated resolveDeclaredAcIds suite).

describe("HAPPY — addEvidence accepts an ac_ref declared by the port (AC-ACODE-3)", () => {
  it("a declared ac_ref is written to extra.verification_evidence and bumps the doc version", async () => {
    const { corpusService, taskWorkflowService } = makeServicesWithAcPort(async () =>
      ok(new Set(["AC-X-1"])),
    );
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ ac_ref: "AC-X-1" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(2); // v1 create, v2 evidence write
    const entries = result.value.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(entries[0]?.["ac_ref"]).toBe("AC-X-1");
  });
});

describe("NEGATIVE — addEvidence rejects an ac_ref absent from the declared set (AC-ACODE-3)", () => {
  it("an ac_ref not in the port's returned Set fails VALIDATION_ERROR, doc unchanged", async () => {
    const { corpusService, taskWorkflowService } = makeServicesWithAcPort(async () =>
      ok(new Set(["AC-OTHER"])),
    );
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ ac_ref: "AC-X-1" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");

    const after = await corpusService.get(taskId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.version).toBe(1); // unchanged — write never happened
    expect(after.value.doc.extra["verification_evidence"]).toBeUndefined();
  });

  it("an ac_ref supplied when the port resolves ok(null) (no structured AC on parent spec) fails VALIDATION_ERROR", async () => {
    const { corpusService, taskWorkflowService } = makeServicesWithAcPort(async () => ok(null));
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ ac_ref: "AC-X-1" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("ERROR — port failure propagates verbatim, not wrapped (AC-ACODE-3)", () => {
  it("a LoreError from the port is returned as-is by addEvidence when an ac_ref is supplied", async () => {
    const portError: LoreError = { code: "STORE_ERROR", message: "boom" };
    const { corpusService, taskWorkflowService } = makeServicesWithAcPort(async () => err(portError));
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ ac_ref: "AC-X-1" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual(portError);
  });
});

describe("STATE / REGRESSION — evidence without ac_ref never invokes the port (backward compatibility)", () => {
  it("addEvidence with no ac_ref succeeds even against a port that would reject any ac_ref, and never calls it", async () => {
    const { corpusService, taskWorkflowService, getAcPortCallCount } = makeServicesWithAcPort(async () =>
      err({ code: "STORE_ERROR", message: "should never be called" }),
    );
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(taskId, evidence());
    expect(result.ok).toBe(true);
    expect(getAcPortCallCount()).toBe(0); // pre-SPEC-038 callers never touch the port
  });

  it("a task with parent_id forced to null + an ac_ref fails VALIDATION_ERROR mentioning the missing parent plan", async () => {
    const { store, corpusService, taskWorkflowService, getAcPortCallCount } = makeServicesWithAcPort(async () =>
      ok(new Set(["AC-X-1"])),
    );
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    // Force parent_id: null directly via the store — createDocInputSchema normally
    // requires parent_id for tasks, so this branch is only reachable via a raw
    // post-creation mutation, not through the normal create path.
    const forceResult = await store.update(taskId, { parent_id: null });
    expect(forceResult.ok).toBe(true);

    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ ac_ref: "AC-X-1" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.message).toMatch(/parent plan/i);
    expect(getAcPortCallCount()).toBe(0); // the null-parent check short-circuits before the port is ever consulted
  });
});

// ─── SPEC-039 §2 D2 — attestation is runner-issued only ─────────────────────
//
// addEvidence rejects any raw input object carrying an `attestation` key (even
// smuggled past the type system via `as EvidenceInput`); recordVerifiedEvidence
// is the SOLE method that may persist `attestation`. Both share the same append
// implementation (cap check, schema validation, ac_ref cross-entity check), so
// these blocks focus on what's NEW: the attestation gate itself, plus proving
// the shared internals (cap, ac_ref, telemetry) behave identically for the new
// method — not re-testing addEvidence's own already-covered behavior above.

describe("NEGATIVE — attestation smuggled into addEvidence rejected at write time (SPEC-039 §2 D2)", () => {
  it("an object carrying an attestation key (even via `as EvidenceInput` cast) fails VALIDATION_ERROR before any write", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const attestationPayload = {
      runner: "lore-cli" as const,
      exit_code: 0,
      duration_ms: 1,
      timed_out: false,
    };
    const smuggled = { ...evidence(), attestation: attestationPayload } as EvidenceInput;

    const result = await taskWorkflowService.addEvidence(taskId, smuggled);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("attestation");
    expect(result.error.message).toContain("lore verify");
    expect(result.error.value).toEqual(attestationPayload);

    // Doc must be completely unchanged — no version bump, no evidence array at all.
    const after = await corpusService.get(taskId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.version).toBe(1);
    expect(after.value.doc.extra["verification_evidence"]).toBeUndefined();
  });
});

describe("HAPPY — recordVerifiedEvidence persists attestation verbatim (SPEC-039 §2 D2)", () => {
  it("two calls with DIFFERENT attestation payloads land distinctly at their own array index (defeats a hardcoded-return stub)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const nowIso = "2026-07-08T10:00:00.000Z";

    const first = await taskWorkflowService.recordVerifiedEvidence(
      taskId,
      {
        oracle: "test",
        command: "bun test",
        result: "pass",
        recorded_by: "runner",
        attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1234, timed_out: false },
      },
      nowIso,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.version).toBe(2); // v1 create, v2 evidence write

    const second = await taskWorkflowService.recordVerifiedEvidence(
      taskId,
      {
        oracle: "lint",
        command: "bun run lint",
        result: "fail",
        recorded_by: "runner",
        attestation: { runner: "lore-cli", exit_code: 1, duration_ms: 5678, timed_out: false },
      },
      nowIso,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.version).toBe(3);

    const entries = second.value.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      oracle: "test",
      result: "pass",
      attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1234, timed_out: false },
    });
    expect(entries[1]).toMatchObject({
      oracle: "lint",
      result: "fail",
      attestation: { runner: "lore-cli", exit_code: 1, duration_ms: 5678, timed_out: false },
    });
  });
});

describe("BOUNDARY — recordVerifiedEvidence enforces the identical 50-entry cap (SPEC-039 §2)", () => {
  it("the 51st recordVerifiedEvidence call fails VALIDATION_ERROR without mutating the doc", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const nowIso = "2026-07-08T10:00:00.000Z";

    for (let i = 0; i < 50; i++) {
      const r = await taskWorkflowService.recordVerifiedEvidence(
        taskId,
        {
          oracle: "test",
          command: `run ${i}`,
          result: "pass",
          recorded_by: "runner",
          attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
        },
        nowIso,
      );
      expect(r.ok).toBe(true);
    }

    const beforeGet = await corpusService.get(taskId);
    expect(beforeGet.ok).toBe(true);
    if (!beforeGet.ok) return;
    const versionBefore = beforeGet.value.doc.version;
    expect((beforeGet.value.doc.extra["verification_evidence"] as unknown[]).length).toBe(50);

    const overflow = await taskWorkflowService.recordVerifiedEvidence(
      taskId,
      {
        oracle: "test",
        command: "run 50",
        result: "pass",
        recorded_by: "runner",
        attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
      },
      nowIso,
    );
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.error.code).toBe("VALIDATION_ERROR");

    const afterGet = await corpusService.get(taskId);
    expect(afterGet.ok).toBe(true);
    if (!afterGet.ok) return;
    expect(afterGet.value.doc.version).toBe(versionBefore); // unchanged
    expect((afterGet.value.doc.extra["verification_evidence"] as unknown[]).length).toBe(50); // unchanged
  }, 20_000);
});

describe("REGRESSION — recordVerifiedEvidence shares ac_ref cross-entity validation with addEvidence (SPEC-039 §2)", () => {
  it("a declared ac_ref is accepted and written alongside the attestation", async () => {
    const { corpusService, taskWorkflowService } = makeServicesWithAcPort(async () =>
      ok(new Set(["AC-VRF-1"])),
    );
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.recordVerifiedEvidence(
      taskId,
      {
        oracle: "test",
        command: "bun test",
        result: "pass",
        recorded_by: "runner",
        ac_ref: "AC-VRF-1",
        attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
      },
      "2026-07-08T10:00:00.000Z",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entries = result.value.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(entries[0]?.["ac_ref"]).toBe("AC-VRF-1");
  });

  it("an ac_ref absent from the declared set is rejected, doc unchanged", async () => {
    const { corpusService, taskWorkflowService } = makeServicesWithAcPort(async () =>
      ok(new Set(["AC-OTHER"])),
    );
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.recordVerifiedEvidence(
      taskId,
      {
        oracle: "test",
        command: "bun test",
        result: "pass",
        recorded_by: "runner",
        ac_ref: "AC-VRF-1",
        attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
      },
      "2026-07-08T10:00:00.000Z",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");

    const after = await corpusService.get(taskId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.version).toBe(1);
    expect(after.value.doc.extra["verification_evidence"]).toBeUndefined();
  });
});

describe("REGRESSION — recordVerifiedEvidence telemetry emits meta.attested === true (SPEC-039 §2)", () => {
  it("a successful call emits exactly one task.evidence_added event with attested: true", async () => {
    const { corpusService, taskWorkflowService, telemetry } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.recordVerifiedEvidence(
      taskId,
      {
        oracle: "test",
        command: "bun test",
        result: "pass",
        recorded_by: "runner",
        attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
      },
      "2026-07-08T10:00:00.000Z",
    );
    expect(result.ok).toBe(true);

    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.last?.method).toBe("task.evidence_added");
    expect(telemetry.last?.ok).toBe(true);
    expect(telemetry.last?.meta).toMatchObject({ attested: true });
  });
});

