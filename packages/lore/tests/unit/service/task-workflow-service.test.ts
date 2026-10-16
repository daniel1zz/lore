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

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { AC_REF_NOT_ON_RESOLVED_GOVERNING_SPEC } from "../../../src/service/ac-ref-messages.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { approveCitedSpec } from "../../helpers/live-rule-fixture.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { PhaseService } from "../../../src/service/phase-service.js";
import {
  TaskWorkflowService,
  type EvidenceInput,
  type VerifiedEvidenceInput,
} from "../../../src/service/task-workflow-service.js";
import { taskExtraSchema, ok, err } from "@lore/core";
import type {
  Telemetry,
  TelemetryEvent,
  CreateDocInput,
  Result,
  LoreError,
  AcceptanceCriterion,
} from "@lore/core";

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
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
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
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
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

/**
 * Default `output_tail: "captured output"` (task-a-non-empty-output-tail-can-
 * be-hand-authored-prose-and-the) — every self-reported `result: "pass"` row
 * now requires a genuinely non-empty tail (`rejectMissingPassOutputTail`,
 * mirroring the pre-existing non-pass requirement this same fixture already
 * satisfied via callers explicitly overriding `result`). Tests exercising
 * OTHER concerns (cap, ac_ref, placeholder-command, telemetry, …) never cared
 * about tail CONTENT — this default keeps them green without changing their
 * intent. Tests that specifically exercise the pass-tail guard itself
 * construct their own candidate object (see the `rejectMissingPassOutputTail`/
 * `capture_source` describe blocks below) rather than relying on this helper.
 *
 * ⛔ SUPERSEDED default `oracle` (task-raise-the-evidence-tail-guard-s-
 * predicate-to-its-own, D5): was `"tsc"`, now `"manual"`. `rejectMissingPass
 * OutputTail`'s D5 raise refuses a self-reported `"pass"` for EVERY oracle
 * kind except `"manual"` (the one kind `--capture` structurally can never
 * reach), regardless of tail content — so a self-reported default row for any
 * OTHER oracle would now be refused outright, breaking every test below that
 * relies on this helper purely as SETUP (not testing the tail guard itself).
 * `"manual"` keeps `capture_source: "self-report"` genuinely self-reported
 * (load-bearing for the "done() refuses a self-reported-only pass" describe
 * block below, which asserts on the word "self-report" in done()'s refusal
 * message) while still satisfying the raised guard's one surviving escape.
 */
function evidence(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    oracle: "manual",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "alice",
    output_tail: "captured output",
    // reason: task-capture-source-is-optional-at-the-evidence-write-boundary —
    // now a compile-time-required field on EvidenceInput; "self-report" mirrors
    // this fixture's pre-existing implicit behaviour (a hand-typed, non-captured
    // tail) byte-for-byte. Tests exercising the discriminator itself override it.
    capture_source: "self-report",
    ...overrides,
  };
}

/**
 * A runner-attested `result: "pass"` evidence row (SPEC-039 §2 D2) — the shape
 * `done()`'s attestation floor (adr-lore-done-requires-a-runner-attested-pass-
 * the-sixth-false) requires at least one of, going forward. Distinct from
 * `evidence()` (self-reported, `addEvidence`-shaped, structurally excludes
 * `attestation`) — written via `recordVerifiedEvidence`, the SOLE method that
 * may carry it. Default `oracle: "tsc"` is deliberately DIFFERENT from the
 * `oracle: "test"` rows the unfiltered-test-file-run floor's own tests use, and
 * `result: "pass"` is never a "red" result the red-first floor's own tests use
 * — so adding one of these alongside a test's EXISTING self-reported evidence
 * never interferes with either of those two independent floors, only unblocks
 * this one.
 */
function attestedPass(overrides: Partial<VerifiedEvidenceInput> = {}): VerifiedEvidenceInput {
  return {
    oracle: "tsc",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "runner",
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
    // reason: task-capture-source-is-optional-at-the-evidence-write-boundary —
    // now a compile-time-required field on VerifiedEvidenceInput; "runner" is
    // the value this fixture's real-world caller (VerifyRunnerService, which
    // always spawns its own commands) actually proves — appendEvidenceEntry
    // would also force "runner" from `attestation` alone, but this documents
    // the caller's own provenance claim rather than leaning on that override.
    capture_source: "runner",
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
      // reason: SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-
      // its-own) — oracle "e2e" self-report is now refused by the D5 raise;
      // this test only checks field fidelity, not capture_source, so an
      // explicit "runner" override is the cheaper correct fix (not testing
      // the guard itself, not the self-report-only done() test below).
      evidence({ oracle: "e2e", command: "playwright test", result: "pass", capture_source: "runner" }),
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
        output_tail: "AssertionError: expected 1 to equal 2",
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

    const added = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ result: "expected-fail", output_tail: "AssertionError: expected 1 to equal 2" }),
    );
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
      evidence({
        command: "bunx vitest run red.test.ts",
        result: "expected-fail",
        output_tail: "AssertionError: expected 1 to equal 2",
      }),
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

// ─── NEGATIVE/REGRESSION — claim --worktree blank rejection (AC-WH-2) ────────
// spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M2: an empty
// or whitespace-only `--worktree` satisfies "the flag was explicitly passed"
// while persisting a value that defeats SPEC-042 D1 session derivation and
// `noAnchorOverlap` grouping (`(by, machine, worktree)`) — must fail loud
// BEFORE any write, naming the flag. Omitted/non-empty values are unchanged.

describe("NEGATIVE — claim --worktree empty or whitespace-only rejected (AC-WH-2)", () => {
  it("empty string worktree → VALIDATION_ERROR naming the flag, doc unchanged", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice", worktree: "" });
    expect(claimResult.ok).toBe(false);
    if (claimResult.ok) return;
    expect(claimResult.error.code).toBe("VALIDATION_ERROR");
    if (claimResult.error.code !== "VALIDATION_ERROR") return;
    expect(claimResult.error.field).toBe("worktree");

    const doc = await corpusService.get(taskId);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    expect(doc.value.doc.extra["claim"]).toBeUndefined();
    expect(doc.value.doc.version).toBe(1); // create only — no claim write landed
  });

  it("whitespace-only worktree (spaces/tabs) → VALIDATION_ERROR naming the flag, doc unchanged", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice", worktree: "   \t  " });
    expect(claimResult.ok).toBe(false);
    if (claimResult.ok) return;
    expect(claimResult.error.code).toBe("VALIDATION_ERROR");
    if (claimResult.error.code !== "VALIDATION_ERROR") return;
    expect(claimResult.error.field).toBe("worktree");

    const doc = await corpusService.get(taskId);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    expect(doc.value.doc.extra["claim"]).toBeUndefined();
    expect(doc.value.doc.version).toBe(1);
  });

  it("REGRESSION — omitted worktree still claims successfully with no worktree key stored", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice" });
    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) return;
    const claim = claimResult.value.extra["claim"] as Record<string, unknown>;
    expect(claim.by).toBe("alice");
    expect("worktree" in claim).toBe(false);
  });

  it("REGRESSION — non-empty worktree still claims successfully and stores the value verbatim", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice", worktree: "feature-branch" });
    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) return;
    const claim = claimResult.value.extra["claim"] as Record<string, unknown>;
    expect(claim.worktree).toBe("feature-branch");
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
    const { corpusService, taskWorkflowService, store } = makeServices();

    const prdResult = await corpusService.create({
      type: "prd",
      title: "Approved-Path PRD",
      content: "root",
    } as CreateDocInput);
    if (!prdResult.ok) throw new Error("prd create failed");

    const specResult = await corpusService.create({
      type: "spec",
      title: "Approved-Path Spec",
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

    const approveResult = await approveCitedSpec(store, corpusService, specId);
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
    const phaseService = new PhaseService(store, new RecordLockService(store, new GateEnforcer(undefined)));
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
    const phaseService = new PhaseService(store, new RecordLockService(store, new GateEnforcer(undefined)));
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

// ─── ac_ref cross-entity validation for an --adhoc task ──────────────────────
// (task-an-ad-hoc-task-s-attested-evidence-cannot-carry-ac-ref)
//
// Unlike the stub-port blocks above, these wire REAL CorpusService ports (both
// resolveDeclaredAcIds AND resolveDeclaredAcIdsForAdhocTask), mirroring app.ts's
// production wiring exactly — the whole point of this fix is genuine cross-
// service resolution (the shared `resolveGoverningSpecByAcScope` search), not
// just how appendEvidenceEntry reacts to an arbitrary port Result.

function makeServicesWithRealAcPorts(ttl = 120) {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const acService = new AcService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const telemetry = new CapturingTelemetry();
  const taskWorkflowService = new TaskWorkflowService(
    store,
    telemetry,
    { claimTtlMinutes: ttl },
    corpusService.resolveDeclaredAcIds.bind(corpusService),
    undefined,
    corpusService.resolveDeclaredAcIdsForAdhocTask.bind(corpusService),
  );
  return { store, corpusService, acService, taskWorkflowService, telemetry };
}

async function createRootPrd(cs: CorpusService, title = "Root PRD"): Promise<string> {
  const result = await cs.create({ type: "prd", title, content: "root" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create prd: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

function aiAc(id: string, statement = `${id} statement`): AcceptanceCriterion {
  return { id, statement, verify: { mode: "ai", rubric: "manual check" } };
}

async function createSpecWithCriteria(
  cs: CorpusService,
  parentId: string,
  criteria: AcceptanceCriterion[],
  title = "Spec",
): Promise<string> {
  const result = await cs.create({
    type: "spec",
    title,
    content: "spec body",
    extra: { acceptance_criteria: criteria },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create spec: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createAdhocTask(
  cs: CorpusService,
  acScope: string[],
  title = "Ad-hoc task",
): Promise<string> {
  const result = await cs.create({
    type: "task",
    title,
    content: "found mid-plan",
    extra: { adhoc: true, ac_scope: acScope },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create adhoc task: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

describe("REGRESSION — the pre-fix unconditional plan-only walk no longer reproduces for an --adhoc task", () => {
  it("an --adhoc task's ac_ref no longer fails with 'Expected a plan document' — the ad-hoc branch resolves via ac_scope instead", async () => {
    // reason: pre-fix, appendEvidenceEntry called resolveDeclaredAcIds(task.parent_id)
    // UNCONDITIONALLY whenever ac_ref was supplied — an ad-hoc task's parent_id is
    // the root PRD, so that call always refused `Expected a plan document; got type
    // 'prd'` (measured via a git-stash repro against the pre-fix source: real CLI
    // invocation `lore evidence <adhoc-task> --ac AC-RED-1` exited 4 with exactly
    // this message). This test pins the OLD message is GONE for an ad-hoc task with
    // no declared ac_scope — the refusal is now the ac_scope-absent one instead.
    const { corpusService, taskWorkflowService } = makeServicesWithRealAcPorts();
    await createRootPrd(corpusService);
    const taskId = await createAdhocTask(corpusService, []); // no ac_scope declared

    const result = await taskWorkflowService.addEvidence(taskId, evidence({ ac_ref: "AC-ANY-1" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.message).not.toMatch(/Expected a plan document/);
    expect(result.error.field).toBe("ac_scope");
  });
});

describe("HAPPY — an --adhoc task's ac_ref resolves via its declared ac_scope and is stored (AC-2)", () => {
  it("ac_ref is written to extra.verification_evidence when ac_scope resolves to exactly one spec", async () => {
    const { corpusService, acService, taskWorkflowService } = makeServicesWithRealAcPorts();
    const prdId = await createRootPrd(corpusService);
    const specId = await createSpecWithCriteria(corpusService, prdId, [aiAc("AC-ADHOC-1")]);
    const taskId = await createAdhocTask(corpusService, ["AC-ADHOC-1"]);

    const result = await taskWorkflowService.addEvidence(taskId, evidence({ ac_ref: "AC-ADHOC-1" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entries = result.value.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(entries[0]?.["ac_ref"]).toBe("AC-ADHOC-1");

    // GREEN (AC-2): lore ac list <spec> (AcService.listCriteria) counts it.
    const listResult = await acService.listCriteria(specId);
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.value.coverage).not.toBeNull();
    const fact = listResult.value.coverage?.find((f) => f.ac_id === "AC-ADHOC-1");
    expect(fact?.pass).toBe(1);
  });
});

describe("NEGATIVE — CONTROL (a): an --ac id belonging to no spec is refused loud, never guessed (AC-3)", () => {
  it("ac_scope matching zero specs fails VALIDATION_ERROR field 'ac_scope'", async () => {
    const { corpusService, taskWorkflowService } = makeServicesWithRealAcPorts();
    const prdId = await createRootPrd(corpusService);
    await createSpecWithCriteria(corpusService, prdId, [aiAc("AC-UNRELATED-1")]);
    const taskId = await createAdhocTask(corpusService, ["AC-NOWHERE-1"]);

    const result = await taskWorkflowService.addEvidence(taskId, evidence({ ac_ref: "AC-NOWHERE-1" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("ac_scope");
    expect(result.error.message).toContain("matches no");
  });
});

describe("ERROR — CONTROL (b): an --ac id matching MULTIPLE specs is ambiguous and refused (AC-3)", () => {
  it("ac_scope matching two specs fails VALIDATION_ERROR field 'ac_scope', naming both spec slugs", async () => {
    const { corpusService, taskWorkflowService } = makeServicesWithRealAcPorts();
    const prdId = await createRootPrd(corpusService);
    const specAId = await createSpecWithCriteria(
      corpusService,
      prdId,
      [aiAc("AC-SHARED-1")],
      "Spec A",
    );
    const specBId = await createSpecWithCriteria(
      corpusService,
      prdId,
      [aiAc("AC-SHARED-1")],
      "Spec B",
    );
    const taskId = await createAdhocTask(corpusService, ["AC-SHARED-1"]);

    const result = await taskWorkflowService.addEvidence(taskId, evidence({ ac_ref: "AC-SHARED-1" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("ac_scope");
    expect(result.error.message).toContain("ambiguous");

    const specA = await corpusService.get(specAId);
    const specB = await corpusService.get(specBId);
    if (specA.ok) expect(result.error.message).toContain(specA.value.doc.slug);
    if (specB.ok) expect(result.error.message).toContain(specB.value.doc.slug);
  });
});

describe("BOUNDARY — an --adhoc task with absent/empty ac_scope refuses before touching any spec (AC-3 support)", () => {
  it("no ac_scope declared at all fails VALIDATION_ERROR field 'ac_scope', names the repair command", async () => {
    const { corpusService, taskWorkflowService } = makeServicesWithRealAcPorts();
    await createRootPrd(corpusService);
    const result0 = await corpusService.create({
      type: "task",
      title: "No-scope adhoc",
      content: "x",
      extra: { adhoc: true },
    } as CreateDocInput);
    if (!result0.ok) throw new Error("adhoc create failed");

    const result = await taskWorkflowService.addEvidence(
      result0.value.id,
      evidence({ ac_ref: "AC-ANY-1" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("ac_scope");
    expect(result.error.message).toContain("no declared ac_scope");
  });

  it("an EMPTY ac_scope array fails VALIDATION_ERROR field 'ac_scope', distinct message from absent", async () => {
    const { corpusService, taskWorkflowService } = makeServicesWithRealAcPorts();
    await createRootPrd(corpusService);
    const taskId = await createAdhocTask(corpusService, []);

    const result = await taskWorkflowService.addEvidence(taskId, evidence({ ac_ref: "AC-ANY-1" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("ac_scope");
    expect(result.error.message).toContain("declares no acceptance criterion");
  });
});

describe("STATE — an ac_ref not declared on the correctly-resolved governing spec is rejected (AC-3 support)", () => {
  it("ac_scope resolves unambiguously, but the supplied --ac id isn't among that spec's declared ids", async () => {
    const { corpusService, taskWorkflowService } = makeServicesWithRealAcPorts();
    const prdId = await createRootPrd(corpusService);
    await createSpecWithCriteria(corpusService, prdId, [aiAc("AC-ADHOC-2")]);
    const taskId = await createAdhocTask(corpusService, ["AC-ADHOC-2"]);

    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ ac_ref: "AC-NOT-DECLARED" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("ac_ref");
    expect(result.error.message).toContain(AC_REF_NOT_ON_RESOLVED_GOVERNING_SPEC);
  });
});

describe("REGRESSION — a normal plan-owned task's ac_ref validation path is byte-identical (AC-4)", () => {
  it("a declared ac_ref on a plan-owned task still succeeds via resolveDeclaredAcIds (never the adhoc port)", async () => {
    const { corpusService, taskWorkflowService } = makeServicesWithRealAcPorts();
    const prdId = await createRootPrd(corpusService);
    const specId = await createSpecWithCriteria(corpusService, prdId, [aiAc("AC-PLAN-1")]);
    const planResult = await corpusService.create({
      type: "plan",
      title: "Plan",
      parent_id: specId,
      content: "plan body",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error("plan create failed");
    const taskId = await createTask(corpusService, planResult.value.id);

    const result = await taskWorkflowService.addEvidence(taskId, evidence({ ac_ref: "AC-PLAN-1" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entries = result.value.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(entries[0]?.["ac_ref"]).toBe("AC-PLAN-1");
  });

  it("an unknown ac_ref on a plan-owned task fails with the EXACT pre-existing message (byte-identical wording)", async () => {
    const { corpusService, taskWorkflowService } = makeServicesWithRealAcPorts();
    const prdId = await createRootPrd(corpusService);
    const specId = await createSpecWithCriteria(corpusService, prdId, [aiAc("AC-PLAN-2")]);
    const planResult = await corpusService.create({
      type: "plan",
      title: "Plan",
      parent_id: specId,
      content: "plan body",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error("plan create failed");
    const taskId = await createTask(corpusService, planResult.value.id);

    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ ac_ref: "AC-UNKNOWN-XYZ" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("ac_ref");
    expect(result.error.message).toBe(
      `ac_ref "AC-UNKNOWN-XYZ" is not declared on the parent spec. Available ids: AC-PLAN-2`,
    );
  });

  it("a plan-owned task's parent_id forced to null still refuses with the EXACT pre-existing 'no parent plan' message", async () => {
    const { store, corpusService, taskWorkflowService } = makeServicesWithRealAcPorts();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    await store.update(taskId, { parent_id: null });

    const result = await taskWorkflowService.addEvidence(taskId, evidence({ ac_ref: "AC-X-1" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.message).toBe(
      `ac_ref "AC-X-1" cannot be validated — task has no parent plan`,
    );
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
        capture_source: "runner",
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
        capture_source: "runner",
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
          capture_source: "runner",
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
        capture_source: "runner",
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
        capture_source: "runner",
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
        capture_source: "runner",
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
        capture_source: "runner",
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

// ─── done() — atomic evidence-validated lifecycle walk (AC-WH-3) ────────────
// spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3: `lore done`
// validates ≥1 result:pass evidence + no fresh foreign claim, then walks
// VALID_TRANSITIONS to archived — one audited step at a time — and flips
// dependent blocks-link readiness in the SAME corpus state. Idempotent on an
// already-terminal doc.

describe("HAPPY — done() walks a released task to archived, one audit row per step (AC-WH-3)", () => {
  it("claim → evidence(pass) → release → done archives the task via draft -> approved -> active -> archived", async () => {
    const { corpusService, taskWorkflowService, store } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.claim(taskId, { by: "alice" });
    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");
    await taskWorkflowService.release(taskId, { by: "alice" });

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;
    expect(doneResult.value.already_done).toBe(false);
    expect(doneResult.value.transitions).toEqual(["approved", "active", "archived"]);
    expect(doneResult.value.task.status).toBe("archived");

    const doc = await corpusService.get(taskId);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    expect(doc.value.doc.status).toBe("archived");

    // one audit row per lifecycle step (3 steps: draft->approved, approved->active,
    // active->archived) — each carries the step's from/to in `details`.
    const auditResult = await store.queryAudit({ doc_id: taskId });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    const doneSteps = auditResult.value.filter((e) => e.details?.["done"] === true);
    expect(doneSteps).toHaveLength(3);
    expect(doneSteps.map((e) => e.details?.["status_to"])).toEqual(["approved", "active", "archived"]);
    expect(doneSteps.every((e) => e.action === "update")).toBe(true);
  });

  it("a dependent blocks-linked task flips to ready:true in the same corpus state", async () => {
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

    await taskWorkflowService.addEvidence(blockerId, evidence({ result: "pass" }));
    await taskWorkflowService.recordVerifiedEvidence(blockerId, attestedPass(), "2026-07-27T09:00:00.000Z");
    const doneResult = await taskWorkflowService.done(blockerId, { by: "alice" });
    expect(doneResult.ok).toBe(true);

    const after = await taskWorkflowService.ready(planId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const blockedAfter = after.value.records.find((r) => r.task.id === blockedId);
    expect(blockedAfter?.ready).toBe(true);
    expect(blockedAfter?.unmet_blockers).toEqual([]);
  });

  it("a task already at approved (skipping draft) walks only active -> archived (2 steps)", async () => {
    const { corpusService, taskWorkflowService, store } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    await corpusService.set(taskId, { status: "approved" });
    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;
    expect(doneResult.value.transitions).toEqual(["active", "archived"]);

    const auditResult = await store.queryAudit({ doc_id: taskId });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    expect(auditResult.value.filter((e) => e.details?.["done"] === true)).toHaveLength(2);
  });
});

describe("NEGATIVE — done() refuses without a result:pass evidence entry (AC-WH-3)", () => {
  it("no evidence at all → VALIDATION_ERROR, doc status unchanged", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");

    const doc = await corpusService.get(taskId);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    expect(doc.value.doc.status).toBe("draft");
  });

  it("only an expected-fail evidence entry (M1 vocabulary) → VALIDATION_ERROR, never counted as passing", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const written = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ result: "expected-fail", output_tail: "AssertionError: expected 1 to equal 2" }),
    );
    expect(written.ok).toBe(true);

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");

    const doc = await corpusService.get(taskId);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    expect(doc.value.doc.status).toBe("draft");
  });

  it("only a fail evidence entry → VALIDATION_ERROR", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const written = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ result: "fail", output_tail: "AssertionError: expected 1 to equal 2" }),
    );
    expect(written.ok).toBe(true);

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
  });

  it("a mix of expected-fail/fail entries with no pass among them → VALIDATION_ERROR", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const w1 = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ result: "expected-fail", output_tail: "AssertionError: expected 1 to equal 2" }),
    );
    expect(w1.ok).toBe(true);
    const w2 = await taskWorkflowService.addEvidence(
      taskId,
      evidence({
        result: "fail",
        command: "run 2",
        output_tail: "AssertionError: expected 3 to equal 4",
      }),
    );
    expect(w2.ok).toBe(true);

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("NEGATIVE — done() refuses under a fresh foreign claim (AC-WH-3)", () => {
  it("a fresh claim held by a DIFFERENT actor refuses done with VALIDATION_ERROR naming the holder", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");
    await taskWorkflowService.claim(taskId, { by: "bob" });

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
    if (doneResult.error.code !== "VALIDATION_ERROR") return;
    expect(doneResult.error.value).toBe("bob");

    const doc = await corpusService.get(taskId);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    expect(doc.value.doc.status).toBe("draft");
  });

  it("a fresh claim held by the SAME actor calling done does NOT block", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");
    await taskWorkflowService.claim(taskId, { by: "alice" });

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
  });

  it("a STALE foreign claim does NOT block done (freshness via injected now)", async () => {
    const { corpusService, taskWorkflowService } = makeServices(1); // 1-minute TTL
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const t0 = () => "2026-07-27T10:00:00.000Z";
    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }), t0);
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), t0());
    await taskWorkflowService.claim(taskId, { by: "bob" }, t0);

    // 5 minutes later — well past the 1-minute TTL, so bob's claim is stale.
    const tLater = () => "2026-07-27T10:05:00.000Z";
    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" }, tLater);
    expect(doneResult.ok).toBe(true);
  });
});

describe("STATE — done() is an idempotent no-op once terminal (AC-WH-3)", () => {
  it("a second done() call after archival returns already_done:true, empty transitions, unchanged doc", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");
    const first = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const versionAfterFirst = first.value.task.version;

    const second = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.already_done).toBe(true);
    expect(second.value.transitions).toEqual([]);
    expect(second.value.task.status).toBe("archived");
    expect(second.value.task.version).toBe(versionAfterFirst); // no write happened
  });

  it("a doc already at deprecated (a different terminal status) is also a no-op naming 'deprecated'", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    // deprecated is only reachable from approved (VALID_TRANSITIONS) — route legally.
    await corpusService.set(taskId, { status: "approved" });
    await corpusService.set(taskId, { status: "deprecated" });

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;
    expect(doneResult.value.already_done).toBe(true);
    expect(doneResult.value.transitions).toEqual([]);
    expect(doneResult.value.task.status).toBe("deprecated");
  });
});

describe("REGRESSION — done() telemetry emits exactly one task.done event per call (AC-WH-3)", () => {
  it("emits task.done on success, with already_done in meta", async () => {
    const { corpusService, taskWorkflowService, telemetry } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");
    telemetry.events.length = 0;

    await taskWorkflowService.done(taskId, { by: "alice", source: "cli" });
    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.last?.method).toBe("task.done");
    expect(telemetry.last?.meta).toMatchObject({ already_done: false, source: "cli" });
  });

  it("a failed done() (no passing evidence) emits no telemetry event", async () => {
    const { corpusService, taskWorkflowService, telemetry } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    telemetry.events.length = 0;

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    expect(telemetry.events).toHaveLength(0);
  });
});

// ─── done()'s red-first discipline floor ─────────────────────────────────────
// (task-red-first-discipline-is-asked-for-in-prose-but-never)
//
// A task carrying `extra.red_first: true` claims its tests were written RED
// FIRST. `done()` now demands ≥1 "expected-fail"/"fail" evidence row on such a
// task — the SAME `result:pass` floor above still applies independently, so a
// red_first task needs BOTH a passing row AND a red row; a task that never
// sets the flag is completely unaffected (zero new friction).

describe("HAPPY — done() accepts a red_first task carrying both a pass AND a red row", () => {
  it("red_first:true + pass + expected-fail rows → done succeeds", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Red First Task", { red_first: true });

    await taskWorkflowService.addEvidence(
      taskId,
      evidence({ result: "expected-fail", output_tail: "AssertionError: expected 1 to equal 2" }),
    );
    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass", command: "second run" }));
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;
    expect(doneResult.value.already_done).toBe(false);
    expect(doneResult.value.task.status).toBe("archived");
  });

  it("red_first:true + pass + a plain 'fail' row (not just expected-fail) also satisfies the floor", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Red First Task Fail Row", { red_first: true });

    await taskWorkflowService.addEvidence(
      taskId,
      evidence({ result: "fail", output_tail: "AssertionError: expected 1 to equal 2" }),
    );
    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass", command: "second run" }));
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
  });
});

describe("NEGATIVE — done() refuses a red_first task holding only result:pass evidence (AC1)", () => {
  it("red_first:true + pass only (no red row) → VALIDATION_ERROR naming the task and the missing row", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Unproven Red First Task", { red_first: true });

    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");
    const before = await corpusService.get(taskId);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const slug = before.value.doc.slug;

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
    if (doneResult.error.code !== "VALIDATION_ERROR") return;
    expect(doneResult.error.message).toContain(slug);
    expect(doneResult.error.message).toMatch(/expected-fail|"fail"/);

    const doc = await corpusService.get(taskId);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    expect(doc.value.doc.status).toBe("draft");
  });
});

describe("BOUNDARY — the pre-existing result:pass floor and the new red-first floor are independent (AC4)", () => {
  it("red_first:true + only an expected-fail row (NO pass) is still refused, by the PRE-EXISTING pass floor", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Red Only Task", { red_first: true });

    const written = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ result: "expected-fail", output_tail: "AssertionError: expected 1 to equal 2" }),
    );
    expect(written.ok).toBe(true);

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
    if (doneResult.error.code !== "VALIDATION_ERROR") return;
    // The PASS floor's own message — proves it, not the new floor, is what fired.
    // UPDATED (task-lore-done-s-attestation-refusal-calls-a-capture-source): the
    // single remembered sentence this used to match was reflowed by that wording
    // fix. Re-keyed on TWO independent lone tokens PLUS a negative condition (the
    // red-first floor's own marker must be ABSENT), which is what actually
    // establishes WHICH floor fired — a contiguous-substring match on one
    // sentence could only ever degrade to a silent no-match.
    expect(doneResult.error.message).toContain("evidence row at all");
    expect(doneResult.error.message).toContain("runner-issued provenance record");
    expect(doneResult.error.message).not.toContain("extra.red_first");
  });
});

describe("ERROR — a malformed extra.red_first value degrades to 'not declared', never crashes (defensive read)", () => {
  it("extra.red_first stored as a non-boolean string ('yes') is treated as undeclared — done succeeds on pass alone", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Malformed Flag Task");
    // Bypasses the Zod write-time gate on purpose — simulates a legacy/corrupted
    // row, mirroring readClaim/readEvidence's "malformed → safe default" contract.
    await corpusService.set(taskId, { extra: { plan_id: planId, red_first: "yes" } });

    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
  });
});

describe("STATE — a task that never declares red_first is completely unaffected (AC3, no new friction)", () => {
  it("no extra.red_first at all + only a result:pass row → done succeeds exactly as before", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
  });

  it("extra.red_first explicitly false + only a result:pass row → done succeeds (false behaves like absent)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Explicit False Task", { red_first: false });

    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
  });
});

describe("REGRESSION — pre-existing done() behavior over legacy (no red_first field) tasks is byte-identical", () => {
  it("a plain task with pass-only evidence archives via the same transitions as before this change", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");
    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;
    expect(doneResult.value.transitions).toEqual(["approved", "active", "archived"]);
  });
});

// ─── TaskWorkflowService.declareRedFirst — the dedicated write-time verb ────
// (task-red-first-discipline-is-asked-for-in-prose-but-never, Q2)
// `lore red-first <task>`'s service-layer implementation. Read-modify-write,
// never through `lore set` (wholesale extra replace) — same reason
// `file_anchors`/`ac_scope`/`claim`/`verification_evidence` each have a
// dedicated writer.

describe("HAPPY — declareRedFirst sets extra.red_first: true and preserves sibling extra keys", () => {
  it("declares true on a fresh task, bumps version, appends an audit row", async () => {
    const { corpusService, taskWorkflowService, store } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Declare Target", { linkage: "kept" });

    const result = await taskWorkflowService.declareRedFirst(taskId, { by: "alice" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["red_first"]).toBe(true);
    expect(result.value.extra["linkage"]).toBe("kept");
    expect(result.value.version).toBe(2); // v1 create, v2 declare

    const auditResult = await store.queryAudit({ doc_id: taskId });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    expect(auditResult.value.some((e) => e.details?.["red_first"] === true)).toBe(true);
  });
});

describe("NEGATIVE — declareRedFirst refuses a non-task target", () => {
  it("a plan target → VALIDATION_ERROR naming the type", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);

    const result = await taskWorkflowService.declareRedFirst(planId, { by: "alice" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("BOUNDARY — declareRedFirst is idempotent on an already-declared task", () => {
  it("declaring twice leaves red_first true both times, second call still succeeds", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const first = await taskWorkflowService.declareRedFirst(taskId, { by: "alice" });
    expect(first.ok).toBe(true);
    const second = await taskWorkflowService.declareRedFirst(taskId, { by: "alice" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.extra["red_first"]).toBe(true);
  });
});

describe("ERROR — declareRedFirst on a nonexistent target", () => {
  it("an unknown id/slug → DOC_NOT_FOUND", async () => {
    const { taskWorkflowService } = makeServices();
    const result = await taskWorkflowService.declareRedFirst("task-does-not-exist", { by: "alice" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });
});

describe("STATE — declareRedFirst never touches claim/verification_evidence (AC-S3-5-style)", () => {
  it("a claimed task with evidence keeps both byte-identical after declareRedFirst", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    await taskWorkflowService.claim(taskId, { by: "alice" });
    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));

    const before = await corpusService.get(taskId);
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    const result = await taskWorkflowService.declareRedFirst(taskId, { by: "alice" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(JSON.stringify(result.value.extra["claim"])).toBe(JSON.stringify(before.value.doc.extra["claim"]));
    expect(JSON.stringify(result.value.extra["verification_evidence"])).toBe(
      JSON.stringify(before.value.doc.extra["verification_evidence"]),
    );
  });
});

describe("REGRESSION — declareRedFirst + a red row together satisfy done()'s new floor end to end", () => {
  it("declareRedFirst then evidence(expected-fail) then evidence(pass) then done() succeeds", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.declareRedFirst(taskId, { by: "alice" });
    await taskWorkflowService.addEvidence(
      taskId,
      evidence({ result: "expected-fail", output_tail: "AssertionError: expected 1 to equal 2" }),
    );
    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass", command: "second" }));
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
  });
});

// ─── done()'s unfiltered-test-file-run floor ─────────────────────────────────
// (task-every-ac-oracle-is-t-scoped-so-the-file-passes-is-attested)
//
// A `-t`-scoped AC oracle attests only the ONE assertion it binds to — never
// that the test FILE, taken as a whole, passes together. This is a THIRD,
// independent `done()` floor (beside the pre-existing result:pass floor and
// the red-first floor immediately above): for EACH declared test-file
// anchor (SPEC-042 `file_anchors`, filtered to a specific file — a
// directory-scoped anchor names no single file and is unaffected), at least
// one `oracle:"test"` `result:"pass"` evidence row must run that file with
// no case-name filter.

describe("HAPPY — done() accepts a test-file anchor with a genuine unfiltered pass row (AC-2 CONTROL)", () => {
  it("a -t-scoped pass row PLUS an unfiltered pass row for the same file → done succeeds", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const FILE = "packages/core/tests/attestation-completeness.test.ts";
    const taskId = await createTask(corpusService, planId, "Anchored Task", { file_anchors: [FILE] });

    await taskWorkflowService.addEvidence(
      taskId,
      // SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-own): oracle
      // "test" self-report is now refused by the D5 raise regardless of tail content;
      // this describe block tests done()'s UNFILTERED-file floor, not capture_source,
      // so an explicit "runner" override is the cheaper correct fix.
      evidence({ oracle: "test", command: `bunx vitest run ${FILE} -t "AC-1"`, result: "pass", capture_source: "runner" }),
    );
    await taskWorkflowService.addEvidence(
      taskId,
      evidence({ oracle: "test", command: `bunx vitest run ${FILE}`, result: "pass", capture_source: "runner" }),
    );
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;
    expect(doneResult.value.transitions).toEqual(["approved", "active", "archived"]);
  });
});

describe("NEGATIVE — done() refuses a test-file anchor backed ONLY by -t-scoped evidence (AC-1)", () => {
  it("only a -t-scoped pass row for the anchored file → VALIDATION_ERROR naming the file", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const FILE = "packages/core/tests/attestation-completeness.test.ts";
    const taskId = await createTask(corpusService, planId, "Anchored Task", { file_anchors: [FILE] });

    await taskWorkflowService.addEvidence(
      taskId,
      // SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-own): oracle
      // "test" self-report is now refused by the D5 raise regardless of tail content;
      // this describe block tests done()'s UNFILTERED-file floor, not capture_source,
      // so an explicit "runner" override is the cheaper correct fix.
      evidence({ oracle: "test", command: `bunx vitest run ${FILE} -t "AC-1"`, result: "pass", capture_source: "runner" }),
    );
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
    if (doneResult.error.code !== "VALIDATION_ERROR") return;
    expect(doneResult.error.message).toContain(FILE);
    expect(doneResult.error.message).toContain("UNFILTERED");

    const doc = await corpusService.get(taskId);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    expect(doc.value.doc.status).toBe("draft");
  });

  it("an unfiltered run of a DIFFERENT anchored file does not satisfy this one — names only the unmet file", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const FILE_A = "packages/core/tests/attestation-completeness.test.ts";
    const FILE_B = "packages/lore/tests/unit/service/task-workflow-service.test.ts";
    const taskId = await createTask(corpusService, planId, "Two-Anchor Task", {
      file_anchors: [FILE_A, FILE_B],
    });

    // FILE_A gets a genuine unfiltered pass; FILE_B only ever gets a -t-scoped one.
    await taskWorkflowService.addEvidence(
      taskId,
      evidence({ oracle: "test", command: `bunx vitest run ${FILE_A}`, result: "pass", capture_source: "runner" }),
    );
    await taskWorkflowService.addEvidence(
      taskId,
      evidence({ oracle: "test", command: `bunx vitest run ${FILE_B} -t "some case"`, result: "pass", capture_source: "runner" }),
    );
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
    if (doneResult.error.code !== "VALIDATION_ERROR") return;
    expect(doneResult.error.message).toContain(FILE_B);
    expect(doneResult.error.message).not.toContain(FILE_A);
  });

  it("a case filter present alongside the exact file token still refuses (a -t run is never 'unfiltered')", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const FILE = "packages/core/tests/attestation-completeness.test.ts";
    const taskId = await createTask(corpusService, planId, "Anchored Task", { file_anchors: [FILE] });

    await taskWorkflowService.addEvidence(
      taskId,
      evidence({ oracle: "test", command: `bunx vitest run ${FILE} --test-name-pattern=alpha`, result: "pass", capture_source: "runner" }),
    );
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
    if (doneResult.error.code !== "VALIDATION_ERROR") return;
    // Proves the UNFILTERED-run floor (not the attestation floor) is what fired.
    expect(doneResult.error.message).toContain(FILE);
    expect(doneResult.error.message).toContain("UNFILTERED");
  });
});

describe("BOUNDARY — a directory-scoped anchor names no specific file, so it never blocks (D3/D4 trailing '/')", () => {
  it("a task declaring ONLY a directory-scoped anchor is unaffected by this floor", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Dir-Anchored Task", {
      file_anchors: ["packages/core/tests/"],
    });

    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
  });
});

describe("STATE — a task with no test-file anchors at all is completely unaffected (AC3, no new friction)", () => {
  it("no file_anchors declared + only a result:pass row → done succeeds exactly as before", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
  });

  it("file_anchors declared but naming only non-test source files → done succeeds (nothing to attest)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Source-Only Anchors", {
      file_anchors: ["packages/core/src/attestation-completeness.ts"],
    });

    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
  });
});

describe("ERROR — a malformed extra.file_anchors value degrades to 'no anchors', never crashes (defensive read)", () => {
  it("extra.file_anchors stored as a non-array value is treated as empty — done succeeds on pass alone", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Malformed Anchors Task");
    // Bypasses the create-time normalizeFileAnchors gate on purpose — simulates a
    // corrupted row, mirroring extractFileAnchors's own "malformed → []" contract.
    await corpusService.set(taskId, { extra: { plan_id: planId, file_anchors: "not-an-array" } });

    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
  });
});

describe("BOUNDARY — the three done() evidence floors are independent; none masks another (AC3)", () => {
  it("red_first:true + an unmet unfiltered-file floor + only an expected-fail row → the PRE-EXISTING pass floor fires first", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const FILE = "packages/core/tests/attestation-completeness.test.ts";
    const taskId = await createTask(corpusService, planId, "Triple-Floor Task", {
      red_first: true,
      file_anchors: [FILE],
    });

    await taskWorkflowService.addEvidence(
      taskId,
      evidence({
        oracle: "test",
        command: `bunx vitest run ${FILE} -t "AC-1"`,
        result: "expected-fail",
        output_tail: "AssertionError: expected 1 to equal 2",
      }),
    );

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
    if (doneResult.error.code !== "VALIDATION_ERROR") return;
    // The result:pass floor's own message — proves it fired, not red-first or the
    // new floor. Same re-keying as the AC4 case above (task-lore-done-s-
    // attestation-refusal-calls-a-capture-source): two lone tokens + the
    // ABSENCE of the other two floors' markers.
    expect(doneResult.error.message).toContain("evidence row at all");
    expect(doneResult.error.message).toContain("runner-issued provenance record");
    expect(doneResult.error.message).not.toContain("extra.red_first");
    expect(doneResult.error.message).not.toContain("UNFILTERED");
  });

  it("red_first:true + a pass row + an unmet unfiltered-file floor, NO red row → the red-first floor fires (not the new floor)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const FILE = "packages/core/tests/attestation-completeness.test.ts";
    const taskId = await createTask(corpusService, planId, "Triple-Floor Task 2", {
      red_first: true,
      file_anchors: [FILE],
    });

    // A -t-scoped pass — satisfies neither red-first (no red row) nor the new
    // unfiltered-file floor (still -t-scoped), so BOTH would refuse; the
    // red-first floor is evaluated first and must be the one that actually fires.
    // An attested pass is added so the ATTESTATION floor (evaluated before
    // red-first) is satisfied too — otherwise IT would fire first instead.
    await taskWorkflowService.addEvidence(
      taskId,
      // SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-own): oracle
      // "test" self-report is now refused by the D5 raise regardless of tail content;
      // this describe block tests done()'s UNFILTERED-file floor, not capture_source,
      // so an explicit "runner" override is the cheaper correct fix.
      evidence({ oracle: "test", command: `bunx vitest run ${FILE} -t "AC-1"`, result: "pass", capture_source: "runner" }),
    );
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
    if (doneResult.error.code !== "VALIDATION_ERROR") return;
    expect(doneResult.error.message).toContain("declares extra.red_first");
  });

  it("red_first satisfied + pass:result satisfied + unfiltered-file floor UNMET → the new floor fires distinctly", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const FILE = "packages/core/tests/attestation-completeness.test.ts";
    const taskId = await createTask(corpusService, planId, "Triple-Floor Task 3", {
      red_first: true,
      file_anchors: [FILE],
    });

    await taskWorkflowService.addEvidence(
      taskId,
      evidence({
        oracle: "test",
        command: `bunx vitest run ${FILE} -t "AC-1"`,
        result: "expected-fail",
        output_tail: "AssertionError: expected 1 to equal 2",
      }),
    );
    await taskWorkflowService.addEvidence(
      taskId,
      // SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-own): oracle
      // "test" self-report is now refused by the D5 raise regardless of tail content;
      // this describe block tests done()'s UNFILTERED-file floor, not capture_source,
      // so an explicit "runner" override is the cheaper correct fix.
      evidence({ oracle: "test", command: `bunx vitest run ${FILE} -t "AC-1"`, result: "pass", capture_source: "runner" }),
    );
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
    if (doneResult.error.code !== "VALIDATION_ERROR") return;
    // Neither the pass floor nor the red-first floor's own message — proves
    // the NEW floor, and only it, is what refused this call.
    expect(doneResult.error.message).not.toContain("holds no result:pass evidence entry");
    expect(doneResult.error.message).not.toContain("declares extra.red_first");
    expect(doneResult.error.message).toContain(FILE);
  });
});

describe("REGRESSION — the interaction the floor exists to catch: two tests, each green under -t, red together (AC-4)", () => {
  // Real, independently-observed transcripts (not fabricated): a throwaway
  // fixture file with two tests sharing mutable module state —
  //   let counter = 0;
  //   test("first bumps the shared counter to one", () => { counter += 1; expect(counter).toBe(1); });
  //   test("second assumes it is the only test touching the counter", () => {
  //     expect(counter).toBe(0); counter += 1;
  //   });
  // — run three times with `bunx vitest run`:
  //   -t "first bumps the shared counter to one"                  -> exit 0 (1 passed | 1 skipped)
  //   -t "second assumes it is the only test touching the counter" -> exit 0 (1 passed | 1 skipped)
  //   (unfiltered)                                                  -> exit 1 (1 failed | 1 passed):
  //     AssertionError: expected 1 to be +0 // Object.is equality
  // Both per-test -t runs are green; only the unfiltered run exposes the
  // ordering-dependent interaction. This is exactly the false-green shape
  // this task exists to close: per-AC -t-scoped evidence alone would leave
  // it undetected.
  const FIXTURE = "packages/core/tests/fixtures/counter-interaction.test.ts";

  it("two -t-scoped PASS rows (one per test) with NO unfiltered row at all → refused, naming the fixture", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Interaction Fixture Task", {
      file_anchors: [FIXTURE],
    });

    await taskWorkflowService.addEvidence(
      taskId,
      // SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-own): oracle
      // "test" self-report is now refused by the D5 raise regardless of tail content;
      // this describe block tests done()'s UNFILTERED-file floor, not capture_source.
      evidence({
        oracle: "test",
        command: `bunx vitest run ${FIXTURE} -t "first bumps the shared counter to one"`,
        result: "pass",
        capture_source: "runner",
      }),
    );
    await taskWorkflowService.addEvidence(
      taskId,
      evidence({
        oracle: "test",
        command: `bunx vitest run ${FIXTURE} -t "second assumes it is the only test touching the counter"`,
        result: "pass",
        capture_source: "runner",
      }),
    );
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
    if (doneResult.error.code !== "VALIDATION_ERROR") return;
    expect(doneResult.error.message).toContain(FIXTURE);
  });

  it("the REAL unfiltered run, recorded verbatim as result:fail (RED), still does not satisfy the floor", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Interaction Fixture Task Red", {
      file_anchors: [FIXTURE],
    });

    await taskWorkflowService.addEvidence(
      taskId,
      // SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-own): oracle
      // "test" self-report is now refused by the D5 raise regardless of tail content;
      // this describe block tests done()'s UNFILTERED-file floor, not capture_source.
      evidence({
        oracle: "test",
        command: `bunx vitest run ${FIXTURE} -t "first bumps the shared counter to one"`,
        result: "pass",
        capture_source: "runner",
      }),
    );
    await taskWorkflowService.addEvidence(
      taskId,
      evidence({
        oracle: "test",
        command: `bunx vitest run ${FIXTURE} -t "second assumes it is the only test touching the counter"`,
        result: "pass",
        capture_source: "runner",
      }),
    );
    // The genuine unfiltered run, recorded verbatim as observed — real exit
    // code 1, real AssertionError tail. Proof this floor requires an
    // UNFILTERED PASS, not merely an unfiltered ATTEMPT.
    await taskWorkflowService.addEvidence(
      taskId,
      evidence({
        oracle: "test",
        command: `bunx vitest run ${FIXTURE}`,
        result: "fail",
        output_tail: "AssertionError: expected 1 to be +0 // Object.is equality",
      }),
    );
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
    if (doneResult.error.code !== "VALIDATION_ERROR") return;
    expect(doneResult.error.message).toContain(FIXTURE);
  });
});

// ─── done()'s attested-pass floor + its audited escape hatch ────────────────
// (adr-lore-done-requires-a-runner-attested-pass-the-sixth-false,
//  task-lore-done-accepts-an-unattested-self-reported-pass-as)
//
// The pre-existing `result:pass` floor now ALSO requires `attestation !==
// undefined` — a self-reported-only pass (the ONLY shape any CLI/MCP `lore
// evidence` write can produce) no longer suffices to archive. The ONE audited
// bypass is `opts.overrideReason` (`commands/done.ts`'s `--override-attestation
// "<reason>"`), which never relaxes the independent red-first / unfiltered-
// test-file-run floors below it.

describe("HAPPY — done() accepts a task whose ONLY evidence is a runner-attested pass", () => {
  it("an attested pass with NO self-reported evidence at all archives normally", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;
    expect(doneResult.value.transitions).toEqual(["approved", "active", "archived"]);
  });
});

describe("NEGATIVE — done() refuses a self-reported-only pass, naming both repairs (AC1)", () => {
  it("only a self-reported result:pass row → VALIDATION_ERROR naming lore verify AND the escape hatch", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
    if (doneResult.error.code !== "VALIDATION_ERROR") return;
    // UPDATED (task-lore-done-s-attestation-refusal-calls-a-capture-source): the
    // shouted "SELF-REPORTED" was retired because it was applied to EVERY
    // unattested row, including `capture_source:"runner"` ones it demonstrably
    // misdescribed. THIS fixture's row genuinely IS self-reported, so the word
    // must still appear for it — with the discriminating FIELD named, and without
    // the other population's label. Full population/mix coverage lives in
    // `done-attestation-refusal-wording.test.ts`.
    expect(doneResult.error.message.toLowerCase()).toContain("self-report");
    expect(doneResult.error.message).toContain("capture_source");
    expect(doneResult.error.message).not.toContain("runner-captured");
    expect(doneResult.error.message).toContain("lore verify");
    expect(doneResult.error.message).toContain("--override-attestation");

    const doc = await corpusService.get(taskId);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    expect(doc.value.doc.status).toBe("draft"); // unchanged — refusal never partially writes
  });

  it("a blank overrideReason passed directly to the service is refused (belt-and-suspenders, mirrors the CLI's own exit-2 usage check)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice", overrideReason: "   " });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
    if (doneResult.error.code !== "VALIDATION_ERROR") return;
    expect(doneResult.error.field).toBe("overrideReason");
  });
});

describe("BOUNDARY — an ATTESTED non-pass result never satisfies the floor (AC-1 boundary)", () => {
  it.each([
    ["fail", "AssertionError: expected 1 to equal 2"] as const,
    ["expected-fail", "AssertionError: expected 1 to equal 2"] as const,
  ])("an attested result:%s is refused exactly like a self-reported one", async (result, output_tail) => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.recordVerifiedEvidence(
      taskId,
      { oracle: "test", command: "bun test", result, output_tail, recorded_by: "runner",
        capture_source: "runner",
        attestation: { runner: "lore-cli", exit_code: 1, duration_ms: 1, timed_out: false } },
      "2026-07-27T09:00:00.000Z",
    );

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
  });

  it("an attested result:inconclusive is refused too", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.recordVerifiedEvidence(
      taskId,
      {
        oracle: "test",
        command: "bun test",
        result: "inconclusive",
        recorded_by: "runner",
        capture_source: "runner",
        attestation: {
          runner: "lore-cli",
          exit_code: 0,
          duration_ms: 1,
          timed_out: false,
          completeness: "zero_match",
        },
      },
      "2026-07-27T09:00:00.000Z",
    );

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("STATE — the escape hatch archives AND writes the reason verbatim to every step's audit entry (AC-2)", () => {
  it("overrideReason supplied on a self-reported-only task archives and stamps every audit row", async () => {
    const { corpusService, taskWorkflowService, store } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));

    const REASON = "manual browser check: verified in staging, screenshot attached to PR #123";
    const doneResult = await taskWorkflowService.done(taskId, { by: "alice", overrideReason: REASON });
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;
    expect(doneResult.value.transitions).toEqual(["approved", "active", "archived"]);

    const auditResult = await store.queryAudit({ doc_id: taskId });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    const doneSteps = auditResult.value.filter((e) => e.details?.["done"] === true);
    expect(doneSteps).toHaveLength(3);
    // every step carries the reason VERBATIM, not merely a truthy marker.
    expect(doneSteps.every((e) => e.details?.["override_reason"] === REASON)).toBe(true);
    expect(doneSteps.every((e) => e.details?.["attestation_overridden"] === true)).toBe(true);
  });
});

// The CONTROL run for the STATE test immediately above — the identical
// archive-to-terminal scenario but WITHOUT the escape hatch (a genuine
// attested pass instead) — proves the audit markers are absent when the
// escape hatch is NOT used, not merely present when it is (the exact
// "silently inert flag" shape this repo's own false-oracle catalog names).
describe("REGRESSION — the escape hatch never taints a normal attested archive (control run, AC-2)", () => {
  it("an attested-pass task archived WITHOUT overrideReason carries neither override_reason nor attestation_overridden on any audit row", async () => {
    const { corpusService, taskWorkflowService, store } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");

    const doneResult = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(doneResult.ok).toBe(true);

    const auditResult = await store.queryAudit({ doc_id: taskId });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    const doneSteps = auditResult.value.filter((e) => e.details?.["done"] === true);
    expect(doneSteps).toHaveLength(3);
    expect(doneSteps.every((e) => e.details?.["override_reason"] === undefined)).toBe(true);
    expect(doneSteps.every((e) => e.details?.["attestation_overridden"] === undefined)).toBe(true);
  });
});

describe("REGRESSION — idempotency on an already-terminal task never regresses, WITH or WITHOUT attestation (AC-4)", () => {
  it("an already-archived task (archived via the escape hatch) is still a no-op on a second call, evidence untouched", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, evidence({ result: "pass" }));
    const first = await taskWorkflowService.done(taskId, { by: "alice", overrideReason: "one-off manual check" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const versionAfterFirst = first.value.task.version;

    // Second call carries NO overrideReason at all — the idempotent short-circuit
    // must fire before any evidence/attestation re-check, so this must still succeed.
    const second = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.already_done).toBe(true);
    expect(second.value.transitions).toEqual([]);
    expect(second.value.task.version).toBe(versionAfterFirst);
  });

  it("an already-archived task (archived via a genuine attestation) is still a no-op regardless of attestation state", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-07-27T09:00:00.000Z");
    const first = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.already_done).toBe(true);
    expect(second.value.transitions).toEqual([]);
  });
});

// ─── Placeholder-command evidence write-time guard ───────────────────────────
// (task-reject-placeholder-command-strings-at-evidence-write-time)
//
// A 2026-07-29 incident recorded 3 evidence probe entries with commands
// "x"/"x3"/"x4" (all result: pass) on a real task while an agent was debugging
// shell quoting. Evidence is append-only, so those entries can never be
// removed — this guard stops NEW ones like them from landing at addEvidence
// write time, WITHOUT retroactively invalidating evidence already stored:
// `evidenceEntrySchema.command` (@lore/core) stays untouched on purpose,
// because `readEvidence`'s `z.array(evidenceEntrySchema).safeParse` is
// all-or-nothing — tightening the shared schema would silently zero an
// ENTIRE task's evidence array on next read the moment it holds one
// placeholder entry from before this guard existed.

describe("HAPPY — genuine short/real commands are accepted, not flagged as placeholders", () => {
  it("addEvidence accepts realistic command strings of varying length, including an allowlisted 2-char command", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    for (const command of ["ls", "tsc", "make", "bun test", "bun run typecheck"]) {
      const result = await taskWorkflowService.addEvidence(taskId, evidence({ command }));
      expect(result.ok).toBe(true);
    }
    const after = await corpusService.get(taskId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect((after.value.doc.extra["verification_evidence"] as unknown[]).length).toBe(5);
  });
});

describe("NEGATIVE — placeholder command strings rejected at write time (VALIDATION_ERROR, doc unchanged)", () => {
  it("addEvidence rejects \"x\", \"x3\", \"x4\" — the exact commands from the 2026-07-29 incident — each leaving its doc unchanged", async () => {
    for (const command of ["x", "x3", "x4"]) {
      const { corpusService, taskWorkflowService } = makeServices();
      const planId = await createPlan(corpusService);
      const taskId = await createTask(corpusService, planId);

      const result = await taskWorkflowService.addEvidence(taskId, evidence({ command }));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("VALIDATION_ERROR");

      const after = await corpusService.get(taskId);
      expect(after.ok).toBe(true);
      if (!after.ok) continue;
      expect(after.value.doc.version).toBe(1); // create only — evidence write never happened
      expect(after.value.doc.extra["verification_evidence"]).toBeUndefined();
    }
  });
});

describe("BOUNDARY — the 3-character floor and the short-command allowlist", () => {
  it("a trimmed 2-character non-allowlisted command is rejected", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(taskId, evidence({ command: "ab" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("a trimmed exactly-3-character command is accepted", async () => {
    const { taskWorkflowService, corpusService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(taskId, evidence({ command: "abc" }));
    expect(result.ok).toBe(true);
  });

  it("every allowlisted 2-char short command is accepted", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const allowlist = ["ls", "go", "sh", "cd", "hg", "bc", "dd", "df", "du", "ps", "rm", "cp", "mv", "ln", "id", "wc"];

    for (const command of allowlist) {
      const result = await taskWorkflowService.addEvidence(taskId, evidence({ command }));
      expect(result.ok).toBe(true);
    }
    const after = await corpusService.get(taskId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect((after.value.doc.extra["verification_evidence"] as unknown[]).length).toBe(allowlist.length);
  });

  it("a whitespace-padded placeholder (\"  x  \") is rejected — trimmed before measuring length", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(taskId, evidence({ command: "  x  " }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("ERROR — rejection names both the offending value and the rule (fail loud, never silent)", () => {
  it("VALIDATION_ERROR carries field \"command\", the exact offending value, and a message describing the rule", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(taskId, evidence({ command: "x3" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: "VALIDATION_ERROR", field: "command", value: "x3" });
    const message = (result.error as { message: string }).message;
    expect(message).toContain("x3");
    expect(message.toLowerCase()).toContain("placeholder");
  });
});

describe("STATE — a rejected placeholder command never mutates already-stored evidence", () => {
  it("existing real evidence entries and the doc version are unchanged after a rejected placeholder attempt", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, evidence({ command: "bun run typecheck" }));
    const before = await corpusService.get(taskId);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const entriesBefore = before.value.doc.extra["verification_evidence"];
    const versionBefore = before.value.doc.version;

    const rejected = await taskWorkflowService.addEvidence(taskId, evidence({ command: "x" }));
    expect(rejected.ok).toBe(false);

    const after = await corpusService.get(taskId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.version).toBe(versionBefore);
    expect(after.value.doc.extra["verification_evidence"]).toEqual(entriesBefore);
  });
});

describe("REGRESSION — historical placeholder-command evidence remains fully readable (MANDATORY oracle)", () => {
  it("a task whose stored evidence ALREADY contains command \"x\" (pre-seeded directly via the store, simulating pre-guard history) still reads back ALL entries via ready(), and new legitimate evidence still appends correctly", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    // Pre-seed historical evidence DIRECTLY through the store — bypassing
    // TaskWorkflowService.addEvidence entirely — to simulate evidence recorded
    // BEFORE this write-time guard existed. evidenceEntrySchema.command is
    // deliberately untouched by this feature, so this legacy shape still parses.
    const before = await corpusService.get(taskId);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const legacyEntries = [
      {
        oracle: "tsc",
        command: "x",
        result: "pass",
        recorded_at: "2026-07-20T00:00:00.000Z",
        recorded_by: "agent:probe",
      },
      {
        oracle: "tsc",
        command: "x3",
        result: "pass",
        recorded_at: "2026-07-20T00:01:00.000Z",
        recorded_by: "agent:probe",
      },
      {
        oracle: "tsc",
        command: "x4",
        result: "pass",
        recorded_at: "2026-07-20T00:02:00.000Z",
        recorded_by: "agent:probe",
      },
      {
        oracle: "tsc",
        command: "bun run typecheck",
        result: "pass",
        recorded_at: "2026-07-20T00:03:00.000Z",
        recorded_by: "agent:real",
      },
    ];
    const seeded = await store.update(taskId, {
      extra: { ...before.value.doc.extra, verification_evidence: legacyEntries },
    });
    expect(seeded.ok).toBe(true);

    // readEvidence is the exact function this guard's placement was chosen to
    // never break — it is exercised internally by ready() (evidence_count /
    // latest_evidence) and by addEvidence's own cap check below. This is the
    // load-bearing assertion: all 4 legacy entries (including the placeholder
    // ones) must still be visible, never silently zeroed by the all-or-nothing
    // z.array(evidenceEntrySchema).safeParse inside readEvidence.
    const readyBefore = await taskWorkflowService.ready(planId);
    expect(readyBefore.ok).toBe(true);
    if (!readyBefore.ok) return;
    const recordBefore = readyBefore.value.records.find((r) => r.task.id === taskId);
    expect(recordBefore?.evidence_count).toBe(4);
    expect(recordBefore?.latest_evidence?.result).toBe("pass");

    // A NEW legitimate addEvidence call on this task must still succeed — the
    // write-time guard screens only the INCOMING entry, it never re-validates
    // history, and readEvidence's cap check must see all 4 prior entries intact.
    const appended = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ command: "bunx vitest run x.test.ts" }),
    );
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    const entries = appended.value.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(5);
    expect(entries[0]?.["command"]).toBe("x"); // legacy entry #1 preserved verbatim
    expect(entries[1]?.["command"]).toBe("x3");
    expect(entries[2]?.["command"]).toBe("x4");

    // A NEW addEvidence call attempting a placeholder command IS still rejected —
    // the guard is live going forward even though history holds placeholders.
    const rejected = await taskWorkflowService.addEvidence(taskId, evidence({ command: "x5" }));
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.code).toBe("VALIDATION_ERROR");

    // The doc must be unchanged by the rejected attempt (still 5 entries, not 6).
    const after = await corpusService.get(taskId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect((after.value.doc.extra["verification_evidence"] as unknown[]).length).toBe(5);
  });
});

