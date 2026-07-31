/**
 * SPEC-063 execution-root correctness — `VerifyRunnerService.verifyPlan`
 * end-to-end wiring tests (D2 spawn-cwd, D3 attestation fields, D4 explicit
 * override).
 *
 * Root cause under test: pre-SPEC-063, `verifyPlan` unconditionally spawned
 * every AC command from `this.config.repoRoot` — the CORPUS root. A linked
 * git worktree carries no `.lore/` of its own, so an agent running `lore
 * verify` from its own worktree silently attested against the MAIN
 * checkout's tree, not the code it just wrote (found 2026-07-21, see
 * SPEC-063's Overview). This suite proves the fix: `opts.executionRoot`
 * (the CLI adapter's pre-resolved `resolveVerifyExecutionRoot(...)` result)
 * now drives the spawn cwd AND every recorded attestation.
 *
 * Test doubles for all three injected ports (getPlanBundle, executor,
 * recordVerifiedEvidence) — same rationale as `verify-runner-service.test.ts`:
 * this suite is about the ORCHESTRATION of the resolved execution root, not a
 * port's own internal logic.
 *
 * @spec_ref AC-063-2 (REPRO), AC-063-3 (REGRESSION), AC-063-6 (explicit override)
 */

import { describe, it, expect } from "vitest";
import { ok } from "@lore/core";
import type { AcceptanceCriterion, DocRecord, LoreError, PlanBundle, Result } from "@lore/core";
import { VerifyRunnerService } from "../../../src/service/verify-runner-service.js";
import type { VerifySpawnSpec, VerifyExecutionResult } from "../../../src/service/verify-spawn.js";
import type { VerifiedEvidenceInput } from "../../../src/service/task-workflow-service.js";

// ─── Fixture builders (mirrors verify-runner-service.test.ts) ─────────────────

function makeDoc(overrides: Partial<DocRecord> & Pick<DocRecord, "id" | "type" | "title">): DocRecord {
  return {
    slug: overrides.id,
    role: "plan",
    status: "approved",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: "2026-07-08T00:00:00.000Z",
    updated_at: "2026-07-08T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

function makePlan(overrides: Partial<DocRecord> = {}): DocRecord {
  return makeDoc({ id: "plan-1", type: "plan", title: "Plan", ...overrides });
}

function makeSpec(acceptanceCriteria: AcceptanceCriterion[], overrides: Partial<DocRecord> = {}): DocRecord {
  return makeDoc({
    id: "spec-1",
    type: "spec",
    title: "Spec",
    status: "approved",
    extra: { acceptance_criteria: acceptanceCriteria },
    ...overrides,
  });
}

/**
 * reason: post-`spec-declared-scope-attestation-contract-task-owned-ac-scope`
 * (AC-VS-1/AC-VS-3), a DEFAULT `lore verify` run REFUSES a target task carrying
 * no `extra.ac_scope`. This file's cases are about execution-root resolution, not
 * scope selection (that is `verify-declared-scope.test.ts`), so the fixture task
 * declares a scope covering every AC id used here.
 * ⛔ Adding a new AC id to a fixture in this file REQUIRES adding it here too.
 */
const FIXTURE_AC_SCOPE = ["AC-1"];

function makeTask(id: string, overrides: Partial<DocRecord> = {}): DocRecord {
  return makeDoc({
    id,
    type: "task",
    title: `Task ${id}`,
    slug: id,
    parent_id: "plan-1",
    ...overrides,
    // Merged UNDER any caller-supplied `extra` keys; an explicit override wins.
    extra: { ac_scope: FIXTURE_AC_SCOPE, ...(overrides.extra ?? {}) },
  });
}

function scriptAc(id: string, command = "run"): AcceptanceCriterion {
  return {
    id,
    statement: `${id} statement`,
    verify: { mode: "script", oracle: "test", command },
  };
}

function makeGetPlanBundle(bundle: PlanBundle) {
  return async (planIdOrSlug: string): Promise<Result<PlanBundle, LoreError>> => {
    void planIdOrSlug;
    return ok(bundle);
  };
}

function makeExecutor(result: Result<VerifyExecutionResult, LoreError>) {
  const calls: VerifySpawnSpec[] = [];
  const fn = async (spec: VerifySpawnSpec): Promise<Result<VerifyExecutionResult, LoreError>> => {
    calls.push(spec);
    return result;
  };
  return { fn, calls };
}

function makeRecordVerifiedEvidence() {
  const calls: Array<{ idOrSlug: string; entry: VerifiedEvidenceInput; nowIso: string }> = [];
  const fn = async (
    idOrSlug: string,
    entry: VerifiedEvidenceInput,
    nowIso: string,
  ): Promise<Result<DocRecord, LoreError>> => {
    calls.push({ idOrSlug, entry, nowIso });
    return ok(makeTask(idOrSlug));
  };
  return { fn, calls };
}

const CORPUS_ROOT = "/repo";
const NOW = "2026-07-21T10:00:00.000Z";
const FRESH_CLAIM_AT = "2026-07-21T09:59:00.000Z"; // 1 minute before NOW, well within TTL

const baseConfig = {
  repoRoot: CORPUS_ROOT,
  defaultTimeoutMs: 300000,
  claimTtlMinutes: 120,
  requireCommandApproval: false,
  envAllowlist: [],
  envPassthroughAll: true,
  processEnv: {},
};

const PASS_EXECUTION: VerifyExecutionResult = {
  exitCode: 0,
  outputTail: "",
  durationMs: 5,
  timedOut: false,
};

function bundleWithOneScriptAc(): PlanBundle {
  const task = makeTask("task-1", { extra: { claim: { by: "alice", at: FRESH_CLAIM_AT } } });
  return {
    plan: makePlan(),
    spec: makeSpec([scriptAc("AC-1", "run")]),
    tasks: [task],
  };
}

// ─── AC-063-2 — REPRO ───────────────────────────────────────────────────────

describe("REPRO — a verify run whose caller cwd is a linked worktree", () => {
  it("spawns its AC command with cwd exactly equal to the worktree root, not the corpus root", async () => {
    const WORKTREE_ROOT = "/repo/.worktrees/t1";
    const bundle = bundleWithOneScriptAc();
    const executor = makeExecutor(ok(PASS_EXECUTION));
    const recordEvidence = makeRecordVerifiedEvidence();

    const service = new VerifyRunnerService(
      makeGetPlanBundle(bundle),
      recordEvidence.fn,
      executor.fn,
      baseConfig, // config.repoRoot is the CORPUS root — the pre-fix always-used value
    );

    const result = await service.verifyPlan("plan-1", {
      by: "alice",
      nowIso: NOW,
      // The CLI adapter's pre-resolved SPEC-063 execution root — this is what
      // `resolveVerifyExecutionRoot` returns when the caller is standing
      // inside `WORKTREE_ROOT` (a linked worktree whose root differs from
      // the corpus root).
      executionRoot: { root: WORKTREE_ROOT, mode: "worktree" },
    });

    expect(result.ok).toBe(true);
    expect(executor.calls).toHaveLength(1);
    // The core assertion this AC exists to prove: the spawn cwd is the
    // WORKTREE root, not the corpus root config.repoRoot carries.
    expect(executor.calls[0]!.cwd).toBe(WORKTREE_ROOT);
    expect(executor.calls[0]!.cwd).not.toBe(CORPUS_ROOT);
  });
});

// ─── AC-063-3 — REGRESSION ──────────────────────────────────────────────────

describe("REGRESSION — a verify run invoked from the main checkout", () => {
  it("spawns with cwd exactly equal to corpusRoot when opts.executionRoot is omitted (pre-SPEC-063 caller shape)", async () => {
    const bundle = bundleWithOneScriptAc();
    const executor = makeExecutor(ok(PASS_EXECUTION));
    const recordEvidence = makeRecordVerifiedEvidence();

    const service = new VerifyRunnerService(makeGetPlanBundle(bundle), recordEvidence.fn, executor.fn, baseConfig);

    // No `executionRoot` opt at all — mirrors every pre-SPEC-063 caller (and
    // every MCP caller today, which does no worktree-aware resolution).
    const result = await service.verifyPlan("plan-1", { by: "alice", nowIso: NOW });

    expect(result.ok).toBe(true);
    expect(executor.calls[0]!.cwd).toBe(CORPUS_ROOT);
  });

  it("its recorded evidence is byte-identical in every pre-existing field to a pre-change run", async () => {
    // Seeds the task's evidence history with the SAME command already recorded
    // (isolates this check from SPEC-039 §M2's orthogonal first_seen annotation,
    // which is a byproduct of an EMPTY evidence history, not of SPEC-063).
    const task = makeTask("task-1", {
      extra: {
        claim: { by: "alice", at: FRESH_CLAIM_AT },
        verification_evidence: [
          {
            oracle: "test",
            command: "run",
            result: "pass",
            recorded_at: "2026-07-01T00:00:00.000Z",
            recorded_by: "alice",
            attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 3, timed_out: false },
          },
        ],
      },
    });
    const bundle: PlanBundle = { plan: makePlan(), spec: makeSpec([scriptAc("AC-1", "run")]), tasks: [task] };
    const executor = makeExecutor(ok(PASS_EXECUTION));
    const recordEvidence = makeRecordVerifiedEvidence();

    const service = new VerifyRunnerService(makeGetPlanBundle(bundle), recordEvidence.fn, executor.fn, baseConfig);

    const result = await service.verifyPlan("plan-1", { by: "alice", nowIso: NOW });
    expect(result.ok).toBe(true);

    expect(recordEvidence.calls).toHaveLength(1);
    const { entry } = recordEvidence.calls[0]!;

    // Every field that existed BEFORE SPEC-063 — asserted as an exact,
    // hand-written expectation representing what a pre-change run recorded.
    expect(entry.oracle).toBe("test");
    expect(entry.command).toBe("run");
    expect(entry.result).toBe("pass");
    expect(entry.recorded_by).toBe("alice");
    expect(entry.ac_ref).toBe("AC-1");
    expect(entry.attestation).toMatchObject({
      runner: "lore-cli",
      exit_code: 0,
      duration_ms: 5,
      timed_out: false,
    });
    // `first_seen` is deliberately NOT asserted absent here — this test
    // seeded matching evidence history precisely so it stays orthogonally
    // false/absent (SPEC-039 §M2's concern, not SPEC-063's). `completeness`/
    // `executed_files` (SPEC-061) are independently populated for any
    // passing oracle:"test" AC regardless of execution root — also
    // orthogonal to this AC, and covered by their own suites
    // (`verify-completeness.test.ts`).

    // SPEC-063's OWN additions — additive, present alongside the untouched
    // pre-existing fields above (not a replacement of them).
    expect(entry.attestation).toMatchObject({
      execution_root: CORPUS_ROOT,
      execution_mode: "corpus_root",
    });
  });
});

// ─── AC-063-6 — explicit override ──────────────────────────────────────────

describe("explicit override — lore verify --execution-root <path>", () => {
  it("case 1 (main-checkout scenario): spawns from exactly the override path even though config.repoRoot points elsewhere", async () => {
    const OVERRIDE_PATH = "/explicit/override/path-a";
    const bundle = bundleWithOneScriptAc();
    const executor = makeExecutor(ok(PASS_EXECUTION));
    const recordEvidence = makeRecordVerifiedEvidence();

    const service = new VerifyRunnerService(
      makeGetPlanBundle(bundle),
      recordEvidence.fn,
      executor.fn,
      { ...baseConfig, repoRoot: CORPUS_ROOT }, // simulates the "main checkout" configuration
    );

    const result = await service.verifyPlan("plan-1", {
      by: "alice",
      nowIso: NOW,
      // What the CLI resolves for `--execution-root /explicit/override/path-a`
      // when the override happens to differ from the corpus root.
      executionRoot: { root: OVERRIDE_PATH, mode: "worktree" },
    });

    expect(result.ok).toBe(true);
    expect(executor.calls[0]!.cwd).toBe(OVERRIDE_PATH);
    expect(executor.calls[0]!.cwd).not.toBe(CORPUS_ROOT);
    expect(recordEvidence.calls[0]!.entry.attestation).toMatchObject({
      execution_root: OVERRIDE_PATH,
      execution_mode: "worktree",
    });
  });

  it("case 2 (worktree scenario): spawns from exactly the override path even though it differs from the worktree that would have been naturally inferred", async () => {
    const NATURALLY_INFERRED_WORKTREE = "/repo/.worktrees/t1";
    const OVERRIDE_PATH = "/explicit/override/path-b";
    const bundle = bundleWithOneScriptAc();
    const executor = makeExecutor(ok(PASS_EXECUTION));
    const recordEvidence = makeRecordVerifiedEvidence();

    const service = new VerifyRunnerService(
      makeGetPlanBundle(bundle),
      recordEvidence.fn,
      executor.fn,
      baseConfig,
    );

    // Even if the caller's ACTUAL git facts would have naturally resolved to
    // NATURALLY_INFERRED_WORKTREE, an explicit --execution-root always wins —
    // this test proves the service honors `opts.executionRoot` UNCONDITIONALLY,
    // never re-deriving or cross-checking it against anything else.
    void NATURALLY_INFERRED_WORKTREE;
    const result = await service.verifyPlan("plan-1", {
      by: "alice",
      nowIso: NOW,
      executionRoot: { root: OVERRIDE_PATH, mode: "worktree" },
    });

    expect(result.ok).toBe(true);
    expect(executor.calls[0]!.cwd).toBe(OVERRIDE_PATH);
    expect(executor.calls[0]!.cwd).not.toBe(NATURALLY_INFERRED_WORKTREE);
    expect(executor.calls[0]!.cwd).not.toBe(CORPUS_ROOT);
  });
});
