/**
 * Tests for SPEC-069 §Design Decisions D1 — the `attestationFloor` predicate on the
 * existing `plan-close` checkpoint (SPEC-054's home): a plan's → archived TRANSITION
 * (`CorpusService.set`) is DENIED when any of its tasks carries `verification_evidence`
 * but zero runner-attested entries, OR the plan-wide attested-evidence ratio falls
 * below `workflow.attestation.min_ratio` (default 0.5) — unless the plan is exempted
 * (`extra.attestation_exempt: true` + a non-empty `extra.attestation_exempt_reason`).
 *
 * Deterministic, zero-LLM — no AI provider anywhere on this path. Mirrors
 * `requires-uat-gate.test.ts` / `uat-service.test.ts`'s harness shape (InMemoryStore +
 * GateEnforcer + CorpusService, real service-layer gating — no bare-predicate-only
 * shortcuts) so the plan-close gate wiring itself (not just the pure predicate) is
 * exercised end-to-end.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / STATE / REGRESSION.
 *
 * Source: spec-spec-068-execution-time-attestation-floor-ad-hoc-task-chann
 *   §Acceptance Criteria AC-069-1..AC-069-4, §Design Decisions D1.
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import type { CreateDocInput, DocRecord, EvidenceEntry, LoreConfig } from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A self-reported (never attested) `pass` evidence entry — the fabrication-risk shape. */
function selfReportedEntry(command: string): EvidenceEntry {
  return {
    oracle: "test",
    command,
    result: "pass",
    recorded_at: "2026-07-23T00:00:00.000Z",
    recorded_by: "agent:t",
  };
}

/** A runner-issued (attested) `pass` evidence entry — the SPEC-039 §2 D1 sole-injection shape. */
function attestedEntry(command: string): EvidenceEntry {
  return {
    oracle: "test",
    command,
    result: "pass",
    recorded_at: "2026-07-23T00:00:00.000Z",
    recorded_by: "agent:t",
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 100, timed_out: false },
  };
}

function makeHarness(config?: LoreConfig) {
  const store = new InMemoryStore();
  const enforcer = new GateEnforcer(config);
  const corpusService = new CorpusService(store, undefined, undefined, enforcer);
  return { store, corpusService };
}

function attestationConfig(minRatio?: number): LoreConfig {
  return {
    project: { name: "t", author: "t" },
    ...(minRatio !== undefined ? { workflow: { attestation: { min_ratio: minRatio } } } : {}),
  } as unknown as LoreConfig;
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Creates a plan, already promoted to `approved` (fast-track draft->approved is a
 *  valid single-hop transition — `approved -> archived` is ALSO directly valid, so no
 *  intermediate `active` hop is needed for this suite's plan-close-only scenarios). */
async function makeApprovedPlan(cs: CorpusService, extra: Record<string, unknown> = {}): Promise<DocRecord> {
  const created = await mustCreate(cs, {
    type: "plan",
    title: "Test plan",
    content: "## Plan\n\nbody",
    extra,
  } as CreateDocInput);
  const approved = await cs.set(created.id, { status: "approved" });
  if (!approved.ok) throw new Error(`plan approve failed (setup): ${JSON.stringify(approved.error)}`);
  return approved.value;
}

async function makeTask(
  cs: CorpusService,
  plan: DocRecord,
  title: string,
  evidence: EvidenceEntry[],
): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "task",
    title,
    parent_id: plan.id,
    content: "## Task\n\nbody",
    extra: { plan_id: plan.id, verification_evidence: evidence },
  } as CreateDocInput);
}

// ─── AC-069-1: zero attested evidence on an evidence-bearing task → DENY ─────

describe("attestationFloor — AC-069-1: zero attested entries blocks plan-close", () => {
  it("AC-069-1: a plan whose only task carries self-reported-only evidence is DENIED at archive; message names the task and contains lore verify", async () => {
    const { corpusService } = makeHarness(attestationConfig());
    const plan = await makeApprovedPlan(corpusService);
    const task = await makeTask(corpusService, plan, "Fabrication-risk task", [
      selfReportedEntry("bun test"),
      selfReportedEntry("bun test again"),
    ]);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect((result.error as { field?: string }).field).toBe("gate:plan-close:attestation-floor");
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain(task.slug);
      expect(message).toContain("lore verify");
    }
  });
});

// ─── Regression (2026-07-26 fix): the feeding pack states the PLAN-level repair,
// never a task-level one — task-attestation-floor-feeding-pack-names-tasks-but-the ──

describe("feedAttestationFloor — the pack's exemption instruction is PLAN-level only", () => {
  it("names the plan-level extra.attestation_exempt field, a fetch-merge-set recovery flow, and explicitly forbids writing the exempt fields onto a task", async () => {
    const { corpusService } = makeHarness(attestationConfig());
    const plan = await makeApprovedPlan(corpusService);
    const task = await makeTask(corpusService, plan, "Fabrication-risk task", [
      selfReportedEntry("bun test"),
    ]);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const message = (result.error as { message?: string }).message ?? "";

    // AC-069-1 REGRESSION — diagnostic task naming + the `lore verify` recovery
    // command are both retained unchanged by this fix.
    expect(message).toContain(task.slug);
    expect(message).toContain("lore verify");

    // The pack still names the plan-level field literally...
    expect(message).toContain("extra.attestation_exempt");
    expect(message).toContain("extra.attestation_exempt_reason");
    // ...declared "on the PLAN ITSELF, never on a task" — the exemption target is
    // unambiguous, not merely implied by proximity to the offending-task list.
    expect(message).toContain("on the PLAN ITSELF, never on a task");

    // ...via a fetch-merge-set flow (SPEC-076 wholesale-replace guard precedent,
    // mirrors feedRequiresUat's fixed shape in the same file) — never a bare
    // `lore set --extra` literal that would clobber the plan's other extra keys.
    expect(message).toContain("does NOT merge");
    expect(message).toContain("lore get");
    expect(message).toContain("--json");
    expect(message).toContain("KEEPING every existing key");

    // The pack MUST NOT instruct the operator to write the exempt fields onto a
    // task — it explicitly says the opposite, naming the task list as
    // diagnostic-only and stating this gate never reads an exempt field there.
    expect(message).toContain("do NOT write");
    expect(message).toContain("never reads it there");
    expect(message).not.toMatch(/set\s+`?extra\.attestation_exempt`?[^.]*\bon(to)?\b[^.]*\btask/i);

    // Names RED/TDD tasks' time-bound (red-before-green) oracles as the canonical
    // "genuinely no oracle to attest against" exemption rationale class.
    expect(message).toContain("RED/TDD");
    expect(message).toContain("time-bound");
  });
});

// ─── AC-069-2: attested evidence meeting the floor → SUCCEED ─────────────────

describe("attestationFloor — AC-069-2: attested evidence meeting the floor unblocks the same transition", () => {
  it("AC-069-2: the same plan archives once its task's evidence is fully attested", async () => {
    const { corpusService } = makeHarness(attestationConfig());
    const plan = await makeApprovedPlan(corpusService);
    await makeTask(corpusService, plan, "Now-attested task", [attestedEntry("bun test")]);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("archived");
    }
  });
});

// ─── AC-069-3: workflow.attestation.min_ratio is honored ─────────────────────

describe("attestationFloor — AC-069-3: workflow.attestation.min_ratio is honored", () => {
  it("AC-069-3: a plan-wide ratio of 0.4 fails the default 0.5 floor (every task individually attested at least once)", async () => {
    const { corpusService } = makeHarness(attestationConfig());
    const plan = await makeApprovedPlan(corpusService);
    // Task A: 4 entries, 1 attested. Task B: 1 entry, 1 attested. Total 5/2 => ratio 0.4.
    // Every task carries >=1 attested entry, so ONLY the ratio condition trips this case.
    await makeTask(corpusService, plan, "Task A", [
      attestedEntry("bun test a"),
      selfReportedEntry("bun test a2"),
      selfReportedEntry("bun test a3"),
      selfReportedEntry("bun test a4"),
    ]);
    await makeTask(corpusService, plan, "Task B", [attestedEntry("bun test b")]);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { field?: string }).field).toBe("gate:plan-close:attestation-floor");
    }
  });

  it("AC-069-3: the identical ratio-0.4 plan archives once workflow.attestation.min_ratio is configured to 0.3", async () => {
    const { corpusService } = makeHarness(attestationConfig(0.3));
    const plan = await makeApprovedPlan(corpusService);
    await makeTask(corpusService, plan, "Task A", [
      attestedEntry("bun test a"),
      selfReportedEntry("bun test a2"),
      selfReportedEntry("bun test a3"),
      selfReportedEntry("bun test a4"),
    ]);
    await makeTask(corpusService, plan, "Task B", [attestedEntry("bun test b")]);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
  });
});

// ─── AC-069-4: extra.attestation_exempt bypasses the floor entirely ──────────

describe("attestationFloor — AC-069-4: attestation_exempt with a reason bypasses the floor", () => {
  it("AC-069-4: a plan declaring attestation_exempt true plus a reason and a valid typed kind closes despite zero attested evidence", async () => {
    const { corpusService } = makeHarness(attestationConfig());
    const plan = await makeApprovedPlan(corpusService, {
      attestation_exempt: true,
      attestation_exempt_reason: "no automatable oracle exists for this plan's scope",
      // reason: spec-verify-reachability-plan-promote-early-warning §Scope M3 —
      // `attestation_exempt_kind` is now REQUIRED alongside the reason; "no-oracle"
      // is the taxonomy member matching this fixture's stated rationale.
      attestation_exempt_kind: "no-oracle",
    });
    await makeTask(corpusService, plan, "Unattested task", [selfReportedEntry("bun test")]);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("archived");
    }
  });

  // NEGATIVE (spec-verify-reachability-plan-promote-early-warning §Scope M3) — a
  // reason alone, with NO typed `attestation_exempt_kind`, no longer satisfies the
  // floor: the exemption is fail-loud-required to name its own kind.
  it("attestation_exempt true WITH a reason but WITHOUT a kind is not treated as a satisfying exemption — still blocked", async () => {
    const { corpusService } = makeHarness(attestationConfig());
    const plan = await makeApprovedPlan(corpusService, {
      attestation_exempt: true,
      attestation_exempt_reason: "no automatable oracle exists for this plan's scope",
    });
    await makeTask(corpusService, plan, "Unattested task", [selfReportedEntry("bun test")]);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { field?: string }).field).toBe("gate:plan-close:attestation-exempt-kind");
    }
  });

  // NEGATIVE — an invalid (not-a-member) kind is likewise refused.
  it("attestation_exempt true with an invalid attestation_exempt_kind is not treated as a satisfying exemption — still blocked", async () => {
    const { corpusService } = makeHarness(attestationConfig());
    const plan = await makeApprovedPlan(corpusService, {
      attestation_exempt: true,
      attestation_exempt_reason: "no automatable oracle exists for this plan's scope",
      attestation_exempt_kind: "bogus-kind",
    });
    await makeTask(corpusService, plan, "Unattested task", [selfReportedEntry("bun test")]);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { field?: string }).field).toBe("gate:plan-close:attestation-exempt-kind");
    }
  });

  // NEGATIVE — a bare `attestation_exempt: true` with NO reason is treated as NOT
  // exempt (D1's "缺 reason 视同未豁免" rule) — the floor still blocks.
  it("AC-069-4: attestation_exempt true WITHOUT a reason is not treated as exempt — still blocked", async () => {
    const { corpusService } = makeHarness(attestationConfig());
    const plan = await makeApprovedPlan(corpusService, { attestation_exempt: true });
    await makeTask(corpusService, plan, "Unattested task", [selfReportedEntry("bun test")]);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(false);
  });

  // NEGATIVE — an empty-string reason is likewise not exempt (whitespace-only fails
  // the same "non-empty after trim" check).
  it("AC-069-4: attestation_exempt true with a whitespace-only reason is not treated as exempt — still blocked", async () => {
    const { corpusService } = makeHarness(attestationConfig());
    const plan = await makeApprovedPlan(corpusService, {
      attestation_exempt: true,
      attestation_exempt_reason: "   ",
    });
    await makeTask(corpusService, plan, "Unattested task", [selfReportedEntry("bun test")]);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(false);
  });
});

// ─── REGRESSION: a plan with no evidence at all is never gated by this floor ──

describe("attestationFloor — REGRESSION: a pure-planning plan (no evidence anywhere) is unaffected", () => {
  it("a plan whose tasks carry NO verification_evidence at all archives unaffected by the floor", async () => {
    const { corpusService } = makeHarness(attestationConfig());
    const plan = await makeApprovedPlan(corpusService);
    await makeTask(corpusService, plan, "Never-executed task", []);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
  });

  it("a plan with zero tasks at all archives unaffected by the floor", async () => {
    const { corpusService } = makeHarness(attestationConfig());
    const plan = await makeApprovedPlan(corpusService);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
  });
});

// ─── REGRESSION: workflow.gates."plan-close".enabled=false disables this floor too ──

describe("attestationFloor — REGRESSION: the whole-checkpoint escape hatch still disables the floor", () => {
  it("workflow.gates.'plan-close'.enabled=false lets an unattested plan archive", async () => {
    const config = {
      project: { name: "t", author: "t" },
      workflow: { gates: { "plan-close": { enabled: false } } },
    } as unknown as LoreConfig;
    const { corpusService } = makeHarness(config);
    const plan = await makeApprovedPlan(corpusService);
    await makeTask(corpusService, plan, "Unattested task", [selfReportedEntry("bun test")]);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
  });
});
