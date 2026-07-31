/**
 * Tests for SPEC-069 §Design Decisions D1 — the `attestationFloor` predicate on the
 * existing `plan-close` checkpoint (SPEC-054's home): a plan's → archived TRANSITION
 * (`CorpusService.set`) is DENIED when any of its tasks carries `verification_evidence`
 * but zero runner-attested entries, OR (spec-plan-close-predicates-measure-invariants-
 * an-applicability §D3) a claimed script-mode acceptance criterion has zero attested
 * evidence, OR (§D4, opt-in only) the plan-wide attested-evidence ratio falls below an
 * EXPLICITLY configured `workflow.attestation.min_ratio` — unless the plan is exempted
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
 *   §Acceptance Criteria AC-069-1..AC-069-4, §Design Decisions D1;
 *   spec-plan-close-predicates-measure-invariants-an-applicability §D3/§D4,
 *   §Acceptance Criteria AC-PCI-7, AC-PCI-8.
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import type {
  AcceptanceCriterion,
  CreateDocInput,
  DocRecord,
  EvidenceEntry,
  LoreConfig,
} from "@lore/core";
import {
  buildTaskAttestationInfos,
  computeAcCoverage,
  deriveAttestationSummary,
  deriveDeclaredScopeCoverage,
  resolveAttestationMinRatio,
} from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A self-reported (never attested) `pass` evidence entry — the fabrication-risk shape.
 *  Accepts `opts` (e.g. `ac_ref`) so callers can attribute an entry to a declared AC
 *  without a second helper — mirrors `verification-projection-service.test.ts`'s shape. */
function selfReportedEntry(command: string, opts: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    oracle: "test",
    command,
    result: "pass",
    recorded_at: "2026-07-23T00:00:00.000Z",
    recorded_by: "agent:t",
    ...opts,
  };
}

/** A runner-issued (attested) `pass` evidence entry — the SPEC-039 §2 D1 sole-injection shape. */
function attestedEntry(command: string, opts: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    oracle: "test",
    command,
    result: "pass",
    recorded_at: "2026-07-23T00:00:00.000Z",
    recorded_by: "agent:t",
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 100, timed_out: false },
    ...opts,
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

/** Root PRD — the ancestor a governing spec is parented under. */
async function makePrd(cs: CorpusService): Promise<DocRecord> {
  return mustCreate(cs, { type: "prd", title: "Root PRD", content: "# PRD\n\nroot" } as CreateDocInput);
}

/** A governing spec declaring the given criteria — the plan's ancestor for per-claimed-AC coverage. */
async function makeSpecWithAc(
  cs: CorpusService,
  prd: DocRecord,
  criteria: AcceptanceCriterion[],
): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "spec",
    title: "Governing spec",
    parent_id: prd.id,
    content: "## Spec\n\nbody",
    extra: { acceptance_criteria: criteria },
  } as CreateDocInput);
}

/** Creates a plan parented under `spec` (its ancestor for per-claimed-AC coverage),
 *  fast-tracked straight to `approved`. */
async function makeApprovedPlanUnderSpec(
  cs: CorpusService,
  spec: DocRecord,
  extra: Record<string, unknown> = {},
): Promise<DocRecord> {
  const created = await mustCreate(cs, {
    type: "plan",
    title: "Test plan",
    parent_id: spec.id,
    content: "## Plan\n\nbody",
    extra,
  } as CreateDocInput);
  const approved = await cs.set(created.id, { status: "approved" });
  if (!approved.ok) throw new Error(`plan approve failed (setup): ${JSON.stringify(approved.error)}`);
  return approved.value;
}

/** A single declared script-mode AC, and a fixture evidence log achieving EXACTLY a
 *  0.36 plan-wide attested ratio (9/25) while (a) the one task carrying evidence has
 *  >=1 attested entry (condition 1 passes) and (b) the AC is claimed with >=1 attested
 *  ref (condition 2 passes) — isolating the ratio conjunct (condition 3) as the ONLY
 *  one an explicit `min_ratio` can trip. Matches the motivating measurement recorded
 *  in the task packet: a plan with honest red->green self-reported entries dominating
 *  its trail, but every claimed AC fully attested. */
const AC_X1: AcceptanceCriterion = {
  id: "AC-X-1",
  statement: "the export command writes a file to the target path",
  verify: { mode: "script", oracle: "test", command: "bun test export" },
};

function buildRatio036Evidence(): EvidenceEntry[] {
  return [
    attestedEntry("bun test export", { ac_ref: "AC-X-1" }),
    ...Array.from({ length: 8 }, (_, i) => attestedEntry(`bun test misc ${i}`)),
    ...Array.from({ length: 16 }, (_, i) => selfReportedEntry(`bun test filler ${i}`)),
  ];
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

/** Creates a task under `plan`. `acScope` — when supplied — authors
 *  `extra.ac_scope`, the DECLARED half of the coverage conjunct
 *  (spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts). Omitted
 *  means the legacy shape: evidence with NO declaration, which makes the
 *  coverage conjunct report `notApplicable(scope-undeclared)` rather than pass. */
async function makeTask(
  cs: CorpusService,
  plan: DocRecord,
  title: string,
  evidence: EvidenceEntry[],
  acScope?: string[],
): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "task",
    title,
    parent_id: plan.id,
    content: "## Task\n\nbody",
    extra: {
      plan_id: plan.id,
      verification_evidence: evidence,
      ...(acScope !== undefined ? { ac_scope: acScope } : {}),
    },
  } as CreateDocInput);
}

// ─── AC-069-1: zero attested evidence on an evidence-bearing task → DENY ─────

describe("attestationFloor — AC-069-1: zero attested entries blocks plan-close", () => {
  // reason: spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts
  // D5 demoted the per-task zero-attested condition, so a task's unattested
  // evidence ALONE no longer denies the close. This scenario's INTENT — "a
  // self-reported-only trail is denied, and the pack names the offending task
  // plus `lore verify`" — is preserved by making the task DECLARE the AC it
  // claims (`ac_scope`), which is the conjunct that blocks post-D4. Without the
  // declaration the plan is `notApplicable(scope-undeclared)`: visible, audited,
  // and deliberately non-blocking.
  it("AC-069-1: a plan whose only task carries self-reported-only evidence for its DECLARED AC is DENIED at archive; message names the task and contains lore verify", async () => {
    const { corpusService } = makeHarness(attestationConfig());
    const prd = await makePrd(corpusService);
    const spec = await makeSpecWithAc(corpusService, prd, [AC_X1]);
    const plan = await makeApprovedPlanUnderSpec(corpusService, spec);
    const task = await makeTask(
      corpusService,
      plan,
      "Fabrication-risk task",
      [selfReportedEntry("bun test", { ac_ref: "AC-X-1" }), selfReportedEntry("bun test again")],
      ["AC-X-1"],
    );

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
    // reason: post-§Facts D4 the pack only renders when something BLOCKS — the
    // declared-but-unattested AC below is that cause (see AC-069-1's own comment).
    const prd = await makePrd(corpusService);
    const spec = await makeSpecWithAc(corpusService, prd, [AC_X1]);
    const plan = await makeApprovedPlanUnderSpec(corpusService, spec);
    const task = await makeTask(
      corpusService,
      plan,
      "Fabrication-risk task",
      [selfReportedEntry("bun test", { ac_ref: "AC-X-1" })],
      ["AC-X-1"],
    );

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
//
// reason: spec-plan-close-predicates-measure-invariants-an-applicability §D4
// flips `min_ratio`'s default from an always-on 0.5 to UNCONFIGURED (`null`,
// the ratio conjunct does not run at all) — an UNCONFIGURED config no longer
// implies a 0.5 floor, so this scenario's floor is now EXPLICITLY configured
// (`attestationConfig(0.5)`) rather than relying on the old "default" to
// supply it. AC-PCI-7's own suite below covers the NEW unconfigured-means-
// disabled behavior for this exact fixture shape.

describe("attestationFloor — AC-069-3: workflow.attestation.min_ratio is honored", () => {
  it("AC-069-3: a plan-wide ratio of 0.4 fails an EXPLICITLY configured 0.5 floor (every task individually attested at least once)", async () => {
    const { corpusService } = makeHarness(attestationConfig(0.5));
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
    // reason: the blocking cause is the DECLARED-but-unattested AC (§Facts D4) —
    // this scenario is about the EXEMPTION not applying, so the floor must have a
    // live blocking condition to fall back onto.
    const prd = await makePrd(corpusService);
    const spec = await makeSpecWithAc(corpusService, prd, [AC_X1]);
    const plan = await makeApprovedPlanUnderSpec(corpusService, spec, { attestation_exempt: true });
    await makeTask(
      corpusService,
      plan,
      "Unattested task",
      [selfReportedEntry("bun test", { ac_ref: "AC-X-1" })],
      ["AC-X-1"],
    );

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { field?: string }).field).toBe("gate:plan-close:attestation-floor");
    }
  });

  // NEGATIVE — an empty-string reason is likewise not exempt (whitespace-only fails
  // the same "non-empty after trim" check).
  it("AC-069-4: attestation_exempt true with a whitespace-only reason is not treated as exempt — still blocked", async () => {
    const { corpusService } = makeHarness(attestationConfig());
    // reason: same fixture shape as the WITHOUT-a-reason scenario above — the
    // declared-but-unattested AC supplies the post-§Facts-D4 blocking cause.
    const prd = await makePrd(corpusService);
    const spec = await makeSpecWithAc(corpusService, prd, [AC_X1]);
    const plan = await makeApprovedPlanUnderSpec(corpusService, spec, {
      attestation_exempt: true,
      attestation_exempt_reason: "   ",
    });
    await makeTask(
      corpusService,
      plan,
      "Unattested task",
      [selfReportedEntry("bun test", { ac_ref: "AC-X-1" })],
      ["AC-X-1"],
    );

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

  // STATE (spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts
  // D4, the RETROACTIVE policy) — the LEGACY shape: real evidence, none of it
  // attested, and no task declaring an `ac_scope`. Post-D4 the coverage conjunct
  // has no claim to audit, so the close proceeds and the fact is surfaced as an
  // advisory + audit row (`notApplicable`, reason `scope-undeclared`) rather than
  // as a block. This is deliberate: every pre-`lore scope add` plan in the corpus
  // has this shape, and a newly-armed conjunct must not retroactively deny them.
  it("a plan whose evidence-bearing tasks declare NO ac_scope archives — the coverage conjunct is not-applicable, never a silent pass or a retroactive block", async () => {
    const { corpusService } = makeHarness(attestationConfig());
    const prd = await makePrd(corpusService);
    const spec = await makeSpecWithAc(corpusService, prd, [AC_X1]);
    const plan = await makeApprovedPlanUnderSpec(corpusService, spec);
    await makeTask(corpusService, plan, "Legacy undeclared task", [
      selfReportedEntry("bun test", { ac_ref: "AC-X-1" }),
    ]);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("archived");
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

// ─── AC-PCI-7: ratio disabled by default — per-claimed-AC coverage is the ────
// ─── new default teeth, resolveAttestationMinRatio resolves null when unset ─

describe("attestationFloor — AC-PCI-7: ratio disabled by default, per-claimed-AC coverage is the default teeth", () => {
  it("AC-PCI-7 ratio disabled: resolveAttestationMinRatio returns null for a config declaring no min_ratio, and a plan at attested ratio 0.36 with every claimed AC attested transitions to archived through the real plan-close gate with no exemption field set", async () => {
    const unconfigured = attestationConfig();
    expect(resolveAttestationMinRatio(unconfigured)).toBeNull();
    expect(resolveAttestationMinRatio(undefined)).toBeNull();

    const { corpusService } = makeHarness(unconfigured);
    const prd = await makePrd(corpusService);
    const spec = await makeSpecWithAc(corpusService, prd, [AC_X1]);
    const plan = await makeApprovedPlanUnderSpec(corpusService, spec);
    await makeTask(corpusService, plan, "Task at ratio 0.36", buildRatio036Evidence());

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("archived");
      expect(result.value.extra["attestation_exempt"]).toBeUndefined();
    }
  });
});

// ─── AC-VS-7: condition 1 (per-task zero-attested) is a REPORTED fact, not a ─
// ─── blocking conjunct — spec-declared-scope-attestation-contract-task-owned- ─
// ─── ac-scope §Facts (D5): demoted, NOT deleted (its computation is kept) ─────

describe("attestationFloor — AC-VS-7: condition one reported not blocking", () => {
  it("condition one reported not blocking: task B's zero-attested evidence no longer denies plan-close once every DECLARED-scope AC is attested (by task A), while the attestation summary still lists task B in zero_attested_tasks", async () => {
    // No `min_ratio` configured => condition 3 is not evaluated at all, so
    // condition 1 is the ONLY conjunct in question for this fixture.
    const config = attestationConfig();
    expect(resolveAttestationMinRatio(config)).toBeNull();

    const { corpusService } = makeHarness(config);
    const prd = await makePrd(corpusService);
    const spec = await makeSpecWithAc(corpusService, prd, [AC_X1]);
    const plan = await makeApprovedPlanUnderSpec(corpusService, spec);
    // Task A: the SOURCE of the attestation covering the declared scope.
    const taskA = await makeTask(
      corpusService,
      plan,
      "Task A",
      [attestedEntry("bun test export", { ac_ref: "AC-X-1" })],
      ["AC-X-1"],
    );
    // Task B: evidence of which NONE is attested — condition 1's offending shape.
    const taskB = await makeTask(
      corpusService,
      plan,
      "Task B",
      [selfReportedEntry("bun test b"), selfReportedEntry("bun test b2")],
      ["AC-X-1"],
    );

    const result = await corpusService.set(plan.id, { status: "archived" });

    // DEMOTED: the same fixture was DENIED before D5 (AC-069-1's shape).
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("archived");

    // Condition 2 is satisfied through the DECLARED set, never the exercised one.
    const coverage = computeAcCoverage([AC_X1], [taskA, taskB]);
    const declaredScope = deriveDeclaredScopeCoverage([taskA, taskB], coverage);
    expect(declaredScope.declared_acs).toEqual(["AC-X-1"]);
    expect(declaredScope.scope_undeclared).toBe(false);
    expect(declaredScope.meets_coverage).toBe(true);

    // NOT DELETED: the demoted condition's computation is still reported.
    const summary = deriveAttestationSummary(buildTaskAttestationInfos([taskA, taskB]), null, coverage);
    expect(summary.zero_attested_tasks).toEqual([taskB.slug]);
    expect(summary.total_evidence).toBe(3);
    expect(summary.attested).toBe(1);
  });

  // NEGATIVE control — the SAME two-task shape with the declared AC left
  // unattested IS still denied: AC-VS-7's pass is condition 1's demotion, not a
  // blanket relaxation of the floor.
  it("condition one reported not blocking is not a blanket relaxation: the same fixture with its DECLARED AC unattested is still denied", async () => {
    const { corpusService } = makeHarness(attestationConfig());
    const prd = await makePrd(corpusService);
    const spec = await makeSpecWithAc(corpusService, prd, [AC_X1]);
    const plan = await makeApprovedPlanUnderSpec(corpusService, spec);
    await makeTask(corpusService, plan, "Task A", [selfReportedEntry("bun test export", { ac_ref: "AC-X-1" })], [
      "AC-X-1",
    ]);
    await makeTask(corpusService, plan, "Task B", [selfReportedEntry("bun test b")], ["AC-X-1"]);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { field?: string }).field).toBe("gate:plan-close:attestation-floor");
      // The feeding pack names the blocking DECLARED id, not merely the
      // diagnostic task list.
      expect((result.error as { message?: string }).message ?? "").toContain("AC-X-1");
    }
  });
});

// ─── AC-PCI-8: an explicit ratio still enforces, AND-ed with per-claimed-AC ──
// ─── coverage — never a substitute for it ────────────────────────────────────

describe("attestationFloor — AC-PCI-8: an explicit ratio still enforces, AND-ed with per-claimed-AC coverage", () => {
  it("AC-PCI-8 explicit ratio: min_ratio 0.5 still denies the same 0.36-ratio plan (ratio conjunct AND-ed with coverage), and an explicit 0 permits it — both via the real plan-close gate, never the predicate in isolation", async () => {
    const strict = makeHarness(attestationConfig(0.5));
    const prdStrict = await makePrd(strict.corpusService);
    const specStrict = await makeSpecWithAc(strict.corpusService, prdStrict, [AC_X1]);
    const planStrict = await makeApprovedPlanUnderSpec(strict.corpusService, specStrict);
    await makeTask(strict.corpusService, planStrict, "Task at ratio 0.36", buildRatio036Evidence());

    const deniedResult = await strict.corpusService.set(planStrict.id, { status: "archived" });

    expect(deniedResult.ok).toBe(false);
    if (!deniedResult.ok) {
      expect((deniedResult.error as { field?: string }).field).toBe("gate:plan-close:attestation-floor");
    }

    const lenient = makeHarness(attestationConfig(0));
    const prdLenient = await makePrd(lenient.corpusService);
    const specLenient = await makeSpecWithAc(lenient.corpusService, prdLenient, [AC_X1]);
    const planLenient = await makeApprovedPlanUnderSpec(lenient.corpusService, specLenient);
    await makeTask(lenient.corpusService, planLenient, "Task at ratio 0.36", buildRatio036Evidence());

    const permittedResult = await lenient.corpusService.set(planLenient.id, { status: "archived" });

    expect(permittedResult.ok).toBe(true);
    if (permittedResult.ok) {
      expect(permittedResult.value.status).toBe("archived");
    }
  });
});
