/**
 * Tests for SPEC-103 tiered review — M1 ledger fast-track, M2 judgment-required
 * promote (worst-decision-wins anti-lottery + I1 provenance collision), M3
 * pending-queue filter, and the two kill-switches. InMemoryStore only — no
 * bun:sqlite, no CLI spawn (see tiered-review-gate.bun.test.ts for the
 * CLI-integration half of AC-TIER-4/5/8).
 *
 * Six-dimension coverage:
 *   HAPPY:      ledger create fast-track (assessment/retro/handoff/uat); edit-reset
 *               atomic re-fast-track; judgment-required approve with a fresh
 *               approve-judgment; pending default filter + --all restore
 *   NEGATIVE:   non-ledger types (spec/adr/prd, knowledge reference/research/ideation)
 *               land draft on create; a spec approve with a provenance-colliding-only
 *               judgment denies
 *   BOUNDARY:   a provenance-less doc passes on judgment-required alone (no
 *               ai_provenance to compare against at all); generate() omits
 *               ai_provenance entirely when the active provider exposes no real
 *               model id (task-t3-hardening — no silent fallback to provider name)
 *   ERROR:      approve() denies (VALIDATION_ERROR, exit-4-mapped) with zero
 *               judgments for the current version
 *   STATE:      editing an approved spec (non-ledger) still resets to draft
 *               (regression-shape, unaffected by M1)
 *   REGRESSION: kill-switches (ledger_auto_approve=false, judgment_required_types=[])
 *               reproduce legacy (pre-SPEC-103) behavior byte-for-byte
 *
 * @spec_ref SPEC-103
 */

import { describe, it, expect, vi } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { LIVE_RULE_ID, seedLiveRule } from "../../helpers/live-rule-fixture.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { GENERATE_PROMPT_VERSION } from "../../../src/ai/templates.js";
import type {
  AIProvider,
  CreateDocInput,
  DocRecord,
  GenerateInput,
  GenerateOutput,
  LoreError,
  NewReviewJudgment,
  Result,
  Telemetry,
  TelemetryEvent,
} from "@lore/core";
import { ok } from "@lore/core";

/**
 * task-t3-hardening-reachable-override-escape-real-ai-provenance — a minimal AIProvider
 * test double that ALSO exposes a real `modelId` (the structural `ModelAwareProvider`
 * capability `AIProviderService` duck-types against, see its own JSDoc). Deliberately
 * NOT added to `InMemoryAIProvider` itself — that file is outside this task's declared
 * anchors; this is a narrow, test-local object satisfying `AIProvider` structurally.
 */
function makeModelAwareProvider(name: string, modelId: string): AIProvider & { modelId: string } {
  return {
    name,
    modelId,
    async generate(_input: GenerateInput): Promise<Result<GenerateOutput, LoreError>> {
      return ok({ content: "# Generated", duration_ms: 0, exit_code: 0, provider_name: name });
    },
  };
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeTelemetry(): Telemetry {
  return { record: vi.fn(), emit: vi.fn(), close: vi.fn() };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed (test setup): ${JSON.stringify(result.error)}`);
  return result.value;
}

const SCRIPT_AC = {
  id: "AC-1",
  statement: "the parser round-trips every fixture file",
  verify: { mode: "script" as const, oracle: "test" as const, command: "bun test parser.test.ts" },
  cites: [LIVE_RULE_ID],
};

const VALID_ASSESSMENT = {
  verdict: "met" as const,
  overall_score: 90,
  ac_scores: [],
  gaps: [],
  recommendations: [],
  scope: { type: "plan" as const, id: "01ARZ3PLAN0000000000001" },
  judgment: { provider: "test", prompt_version: 1, duration_ms: 10, retried: false, truncated: [] },
};

function validHandoffPayload(): Record<string, unknown> {
  return {
    sub_type: "handoff",
    handoff: { by: "x", task_refs: [], modified_files: [], key_decisions: [], next_steps: ["a"] },
  };
}

const VALID_UAT_VERDICT = {
  verdict: "accept" as const,
  tier_results: [{ tier: "P0" as const, accepted: 5, rejected: 0, unverified: 0 }],
  requirement_coverage: { total: 5, covered: 5, uncovered_p0: [] },
  uiux: { blocker_count: 0, min_dimension_score: 4 },
  run_meta: { at: "2026-07-18T00:00:00.000Z", by: "agent:uat" },
};

/**
 * Builds a full app slice (store + corpusService + judgmentService + reviewService),
 * wired identically to `app.ts`'s production composition (gate + judgmentService +
 * judgmentRequiredTypes threaded through, `ledgerAutoApprove` threaded to
 * CorpusService) — every bare-construction default the constructors themselves
 * document is overridden here so the harness exercises the WIRED path, not the
 * ungated bare-test path.
 */
async function makeApp(
  opts: { ledgerAutoApprove?: boolean; judgmentRequiredTypes?: readonly string[] } = {},
) {
  const store = new InMemoryStore();
  await seedLiveRule(store);
  const telemetry = makeTelemetry();
  const enforcer = new GateEnforcer(undefined);
  const corpusService = new CorpusService(
    store,
    telemetry,
    undefined,
    enforcer,
    undefined,
    opts.ledgerAutoApprove ?? true,
  );
  const judgmentService = new JudgmentService(store, telemetry);
  const reviewService = new ReviewService(
    store,
    undefined,
    { enforcer, getPlanBundle: corpusService.getPlanBundle.bind(corpusService) },
    judgmentService,
    opts.judgmentRequiredTypes ?? ["spec", "adr"],
  );
  return { store, corpusService, judgmentService, reviewService, enforcer };
}

function makeNewJudgment(overrides: Partial<NewReviewJudgment> = {}): NewReviewJudgment {
  return {
    doc_id: "01ARZ3DOC00000000000001",
    doc_version: 1,
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "All good" }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: [],
    judge: { provider: "test-provider", model: "test-provider", prompt_version: "v1" },
    ...overrides,
  };
}

// ─── AC-TIER-1: ledger create fast-track ──────────────────────────────────────

describe("AC-TIER-1 ledger create fast-track", () => {
  it("creating knowledge assessment lands approved in the same write with a ledger-fast-track audit row", async () => {
    const { corpusService, store } = await makeApp();
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root", content: "# PRD" } as CreateDocInput);
    const doc = await mustCreate(corpusService, {
      type: "knowledge",
      title: "Assessment X",
      parent_id: prd.id,
      content: "# A",
      extra: { sub_type: "assessment", assessment: VALID_ASSESSMENT },
    } as CreateDocInput);

    expect(doc.status).toBe("approved");
    expect(doc.version).toBe(1);

    const auditResult = await store.queryAudit({ doc_id: doc.id });
    if (!auditResult.ok) throw new Error("queryAudit failed");
    const createEntry = auditResult.value.find((e) => e.action === "create");
    expect(createEntry).toBeDefined();
    expect((createEntry?.details as { auto?: string } | undefined)?.auto).toBe("ledger-fast-track");
  });

  it("creating knowledge retro lands approved", async () => {
    const { corpusService } = await makeApp();
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root", content: "# PRD" } as CreateDocInput);
    const doc = await mustCreate(corpusService, {
      type: "knowledge",
      title: "Retro X",
      parent_id: prd.id,
      content: "# R",
      extra: { sub_type: "retro" },
    } as CreateDocInput);
    expect(doc.status).toBe("approved");
  });

  it("creating a handoff doc (via createHandoffDoc) lands approved", async () => {
    const { corpusService } = await makeApp();
    const doc = await corpusService.createHandoffDoc({
      type: "knowledge",
      title: "Handoff X",
      content: "# H",
      extra: validHandoffPayload(),
    } as CreateDocInput);
    if (!doc.ok) throw new Error(`createHandoffDoc failed: ${JSON.stringify(doc.error)}`);
    expect(doc.value.status).toBe("approved");
  });

  it("creating a uat verdict doc (via createUatDoc) lands approved", async () => {
    const { corpusService } = await makeApp();
    const doc = await corpusService.createUatDoc({
      type: "knowledge",
      title: "UAT X",
      content: "# U",
      extra: { sub_type: "uat", uat: VALID_UAT_VERDICT },
    } as CreateDocInput);
    if (!doc.ok) throw new Error(`createUatDoc failed: ${JSON.stringify(doc.error)}`);
    expect(doc.value.status).toBe("approved");
  });

  it("creating spec/adr/prd lands draft (durable promises, not ledger records)", async () => {
    const { corpusService } = await makeApp();
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
    expect(prd.status).toBe("draft");

    const spec = await mustCreate(corpusService, {
      type: "spec",
      title: "A spec",
      content: "## Overview\n\nBody.",
      extra: { spec_kind: "feature" },
    } as CreateDocInput);
    expect(spec.status).toBe("draft");

    const adr = await mustCreate(corpusService, {
      type: "adr",
      title: "A decision",
      parent_id: prd.id,
      content: "# ADR",
      extra: { decision_status: "proposed" },
    } as CreateDocInput);
    expect(adr.status).toBe("draft");
  });

  it("creating knowledge reference/research/ideation lands draft (durable promises, not ledger records)", async () => {
    const { corpusService } = await makeApp();
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root", content: "# PRD" } as CreateDocInput);
    for (const subType of ["reference", "research", "ideation"] as const) {
      const doc = await mustCreate(corpusService, {
        type: "knowledge",
        title: `A ${subType}`,
        parent_id: prd.id,
        content: "# K",
        extra: { sub_type: subType },
      } as CreateDocInput);
      expect(doc.status).toBe("draft");
    }
  });
});

// ─── AC-TIER-2: ledger edit atomic reset + re-fast-track ──────────────────────

describe("AC-TIER-2 ledger edit atomic reset + re-fast-track", () => {
  it("editing an approved ledger doc ends approved (atomic reset + re-fast-track, both audited)", async () => {
    const { corpusService, store } = await makeApp();
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root", content: "# PRD" } as CreateDocInput);
    const doc = await mustCreate(corpusService, {
      type: "knowledge",
      title: "Retro X",
      parent_id: prd.id,
      content: "# R original",
      extra: { sub_type: "retro" },
    } as CreateDocInput);
    expect(doc.status).toBe("approved");
    expect(doc.version).toBe(1);

    const editResult = await corpusService.set(doc.id, { content: "# R updated" });
    if (!editResult.ok) throw new Error(`set failed: ${JSON.stringify(editResult.error)}`);

    expect(editResult.value.status).toBe("approved");
    expect(editResult.value.version).toBe(3); // v1 -> v2 (reset) -> v3 (re-fast-track)
    // reason: canonicaliseBody appends a trailing newline at write time (SPEC-021 §4).
    expect(editResult.value.content).toBe("# R updated\n");

    const auditResult = await store.queryAudit({ doc_id: doc.id });
    if (!auditResult.ok) throw new Error("queryAudit failed");
    const fastTrackEntry = auditResult.value.find(
      (e) => (e.details as { auto?: string } | undefined)?.auto === "ledger-fast-track" && e.action === "update",
    );
    expect(fastTrackEntry).toBeDefined();
    expect((fastTrackEntry?.details as { version?: number } | undefined)?.version).toBe(3);

    // The reset step's own audit row exists too (the pre-existing "update" audit
    // every approved-doc content edit gets) — two "update" rows total for this edit.
    const updateEntries = auditResult.value.filter((e) => e.action === "update");
    expect(updateEntries.length).toBeGreaterThanOrEqual(2);

    // History stays type-uniform: version 2's snapshot is the "draft" reset state.
    const logResult = await store.findVersions(doc.id);
    if (!logResult.ok) throw new Error("findVersions failed");
    const v2 = logResult.value.find((v) => v.version === 2);
    expect(v2?.status).toBe("draft");
    const v3 = logResult.value.find((v) => v.version === 3);
    expect(v3?.status).toBe("approved");
  });

  it("REGRESSION: editing an approved spec still resets to draft (unaffected by M1)", async () => {
    const { corpusService } = await makeApp();
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root", content: "# PRD" } as CreateDocInput);
    const specDraft = await mustCreate(corpusService, {
      type: "spec",
      title: "A spec",
      content: "## Overview\n\noriginal",
      extra: { spec_kind: "feature", acceptance_criteria: [SCRIPT_AC] },
    } as CreateDocInput);
    const approved = await corpusService.set(specDraft.id, { status: "approved" });
    if (!approved.ok) throw new Error(`approve failed: ${JSON.stringify(approved.error)}`);
    expect(approved.value.status).toBe("approved");

    const edited = await corpusService.set(specDraft.id, { content: "## Overview\n\nupdated" });
    if (!edited.ok) throw new Error(`edit failed: ${JSON.stringify(edited.error)}`);
    expect(edited.value.status).toBe("draft");
    expect(edited.value.version).toBe(approved.value.version + 1);
  });
});

// ─── AC-TIER-3: pending = promises ─────────────────────────────────────────────

describe("AC-TIER-3 pending filter — task + ledger sub_types hidden by default", () => {
  it("default lore pending excludes task type and ledger sub_types; --all restores them", async () => {
    // ledgerAutoApprove: false — so the ledger doc STAYS draft, isolating M3's own
    // filter from M1's create-time fast-track (which would otherwise also hide it,
    // just for a different reason).
    const { corpusService, reviewService } = await makeApp({ ledgerAutoApprove: false });
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root", content: "# PRD" } as CreateDocInput);
    const plan = await mustCreate(corpusService, {
      type: "plan",
      title: "A plan",
      parent_id: prd.id,
      content: "# Plan",
    } as CreateDocInput);
    const task = await mustCreate(corpusService, {
      type: "task",
      title: "A task",
      parent_id: plan.id,
      content: "# Task",
      extra: { plan_id: plan.id },
    } as CreateDocInput);
    const assessment = await mustCreate(corpusService, {
      type: "knowledge",
      title: "An assessment",
      parent_id: prd.id,
      content: "# A",
      extra: { sub_type: "assessment", assessment: VALID_ASSESSMENT },
    } as CreateDocInput);
    const ideation = await mustCreate(corpusService, {
      type: "knowledge",
      title: "An ideation",
      parent_id: prd.id,
      content: "# I",
      extra: { sub_type: "ideation" },
    } as CreateDocInput);
    const spec = await mustCreate(corpusService, {
      type: "spec",
      title: "A spec",
      content: "## Overview\n\nBody.",
      extra: { spec_kind: "feature" },
    } as CreateDocInput);

    expect(task.status).toBe("draft");
    expect(assessment.status).toBe("draft");

    const defaultResult = await reviewService.pending();
    if (!defaultResult.ok) throw new Error("pending failed");
    const defaultIds = defaultResult.value.map((d) => d.id);
    expect(defaultIds).toContain(ideation.id);
    expect(defaultIds).toContain(spec.id);
    expect(defaultIds).not.toContain(task.id);
    expect(defaultIds).not.toContain(assessment.id);

    const allResult = await reviewService.pending({ all: true });
    if (!allResult.ok) throw new Error("pending --all failed");
    const allIds = allResult.value.map((d) => d.id);
    expect(allIds).toContain(task.id);
    expect(allIds).toContain(assessment.id);
    expect(allIds).toContain(ideation.id);
    expect(allIds).toContain(spec.id);
  });
});

// ─── AC-TIER-6: I1 provenance collision + provenance-less pass ────────────────

describe("AC-TIER-6 provenance write half (AIProviderService.generate)", () => {
  const budgets = { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 };

  // task-t3-hardening-reachable-override-escape-real-ai-provenance — the honesty-gap fix:
  // when the active provider exposes a REAL modelId, it is used verbatim (never the provider
  // registry name), and prompt_version comes from the GENERATE_PROMPT_VERSION registry
  // constant imported here (not re-typed as a literal) — proving it is genuinely
  // registry-sourced, not a hardcoded string duplicated between prod and test.
  it("generate() sources a real per-provider model id and a registry-sourced prompt_version when the provider exposes one", async () => {
    const provider = makeModelAwareProvider("model-aware-fake", "test-model-x7-20260101");
    const providers = new Map([[provider.name, provider]]) as unknown as ReadonlyMap<string, AIProvider>;
    const telemetry = makeTelemetry();
    const service = new AIProviderService(providers, provider.name, {}, telemetry, false, 8000, budgets);

    const result = await service.generate({ doc_type: "knowledge", title: "x" });
    if (!result.ok) throw new Error(`generate failed: ${JSON.stringify(result.error)}`);
    expect(result.value.ai_provenance).toBeDefined();
    expect(result.value.ai_provenance?.provider).toBe("model-aware-fake");
    // The whole point of the fix: model is the REAL modelId, distinct from provider name.
    expect(result.value.ai_provenance?.model).toBe("test-model-x7-20260101");
    expect(result.value.ai_provenance?.model).not.toBe(provider.name);
    expect(result.value.ai_provenance?.prompt_version).toBe(GENERATE_PROMPT_VERSION);
  });

  // BOUNDARY/no-silent-fallback: no CURRENT provider implementation (InMemoryAIProvider
  // included) exposes modelId — generate() must OMIT ai_provenance entirely rather than
  // substitute the provider name as a fake "model" (the exact defect this task fixes).
  it("generate() omits ai_provenance when the active provider exposes no model id", async () => {
    const provider = new InMemoryAIProvider("in-memory");
    provider.setMode({ kind: "ok", content: "# Generated" });
    const providers = new Map([[provider.name, provider]]) as unknown as ReadonlyMap<string, AIProvider>;
    const telemetry = makeTelemetry();
    const service = new AIProviderService(providers, provider.name, {}, telemetry, false, 8000, budgets);

    const result = await service.generate({ doc_type: "knowledge", title: "x" });
    if (!result.ok) throw new Error(`generate failed: ${JSON.stringify(result.error)}`);
    expect(result.value.ai_provenance).toBeUndefined();
    expect("ai_provenance" in result.value).toBe(false);
  });
});

describe("AC-TIER-6 gate half — I1 provenance collision", () => {
  it("a doc with extra.ai_provenance equal to the judgment's judge tuple denies naming the collision", async () => {
    const { corpusService, judgmentService, reviewService } = await makeApp({ judgmentRequiredTypes: ["spec"] });
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root", content: "# PRD" } as CreateDocInput);
    const aiTuple = { provider: "claude-cli", model: "claude-cli", prompt_version: "v2" };
    const spec = await mustCreate(corpusService, {
      type: "spec",
      title: "A spec",
      content: "## Overview\n\nBody.",
      extra: { spec_kind: "feature", acceptance_criteria: [SCRIPT_AC], ai_provenance: aiTuple },
    } as CreateDocInput);

    const judgmentResult = await judgmentService.record(
      makeNewJudgment({ doc_id: spec.id, doc_version: spec.version, decision: "approve", judge: aiTuple }),
    );
    if (!judgmentResult.ok) throw new Error("record judgment failed");

    const approveResult = await reviewService.approve(spec.id);
    expect(approveResult.ok).toBe(false);
    if (approveResult.ok) return;
    expect(approveResult.error.code).toBe("VALIDATION_ERROR");
    const field = (approveResult.error as { field?: string }).field;
    expect(field).toContain("review-judgment");
  });

  it("a provenance-less doc passes on judgment-required alone", async () => {
    const { corpusService, judgmentService, reviewService } = await makeApp({ judgmentRequiredTypes: ["spec"] });
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root", content: "# PRD" } as CreateDocInput);
    const spec = await mustCreate(corpusService, {
      type: "spec",
      title: "A spec",
      content: "## Overview\n\nBody.",
      extra: { spec_kind: "feature", acceptance_criteria: [SCRIPT_AC] },
    } as CreateDocInput);

    const judgmentResult = await judgmentService.record(
      makeNewJudgment({
        doc_id: spec.id,
        doc_version: spec.version,
        decision: "approve",
        judge: { provider: "claude-cli", model: "claude-cli", prompt_version: "v2" },
      }),
    );
    if (!judgmentResult.ok) throw new Error("record judgment failed");

    const approveResult = await reviewService.approve(spec.id);
    expect(approveResult.ok).toBe(true);
    if (!approveResult.ok) return;
    expect(approveResult.value.status).toBe("approved");
  });

  it("approve of a spec with zero judgments for the current version exits with VALIDATION_ERROR naming lore review", async () => {
    const { corpusService, reviewService } = await makeApp({ judgmentRequiredTypes: ["spec"] });
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root", content: "# PRD" } as CreateDocInput);
    const spec = await mustCreate(corpusService, {
      type: "spec",
      title: "A spec",
      content: "## Overview\n\nBody.",
      extra: { spec_kind: "feature", acceptance_criteria: [SCRIPT_AC] },
    } as CreateDocInput);

    const approveResult = await reviewService.approve(spec.id);
    expect(approveResult.ok).toBe(false);
    if (approveResult.ok) return;
    expect(approveResult.error.code).toBe("VALIDATION_ERROR");
    const message = (approveResult.error as { message?: string }).message ?? "";
    expect(message).toContain("lore review");
  });
});

// ─── AC-TIER-5 (service-level sub-case): zero-judgment reachable override ─────
// task-t3-hardening-reachable-override-escape-real-ai-provenance — `--override-judgment`
// requires the given id to resolve to an EXISTING review_judgments row on the doc; a doc
// that has NEVER been judged (the NO_JUDGMENT denial exercised right above) has no id
// anywhere to supply, making the escape hatch structurally unreachable for the most common
// case. `overrideNoJudgment` is the sibling escape that reaches it. CLI-integration coverage
// (audit row via the compiled binary) lives in tiered-review-gate.bun.test.ts.
describe("AC-TIER-5 zero-judgment reachable override (ReviewService.approve)", () => {
  it("overrideNoJudgment approves a never-judged doc and records details.override_no_judgment", async () => {
    const { corpusService, reviewService } = await makeApp({ judgmentRequiredTypes: ["spec"] });
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root", content: "# PRD" } as CreateDocInput);
    const spec = await mustCreate(corpusService, {
      type: "spec",
      title: "A spec",
      content: "## Overview\n\nBody.",
      extra: { spec_kind: "feature", acceptance_criteria: [SCRIPT_AC] },
    } as CreateDocInput);

    // Confirm the doc is genuinely in the NO_JUDGMENT state --override-judgment cannot reach.
    const blocked = await reviewService.approve(spec.id);
    expect(blocked.ok).toBe(false);

    const approveResult = await reviewService.approve(spec.id, { overrideNoJudgment: true });
    expect(approveResult.ok).toBe(true);
    if (!approveResult.ok) return;
    expect(approveResult.value.status).toBe("approved");
  });

  it("overrideNoJudgment is rejected loud when the doc already has a judgment recorded", async () => {
    const { corpusService, judgmentService, reviewService } = await makeApp({ judgmentRequiredTypes: ["spec"] });
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root", content: "# PRD" } as CreateDocInput);
    const spec = await mustCreate(corpusService, {
      type: "spec",
      title: "A spec",
      content: "## Overview\n\nBody.",
      extra: { spec_kind: "feature", acceptance_criteria: [SCRIPT_AC] },
    } as CreateDocInput);

    const judgmentResult = await judgmentService.record(
      makeNewJudgment({ doc_id: spec.id, doc_version: spec.version, decision: "reject" }),
    );
    if (!judgmentResult.ok) throw new Error("record judgment failed");

    const approveResult = await reviewService.approve(spec.id, { overrideNoJudgment: true });
    expect(approveResult.ok).toBe(false);
    if (approveResult.ok) return;
    expect(approveResult.error.code).toBe("VALIDATION_ERROR");
    const message = (approveResult.error as { message?: string }).message ?? "";
    expect(message).toContain("--override-judgment");
  });

  it("passing both overrideJudgmentId and overrideNoJudgment is rejected loud", async () => {
    const { corpusService, reviewService } = await makeApp({ judgmentRequiredTypes: ["spec"] });
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root", content: "# PRD" } as CreateDocInput);
    const spec = await mustCreate(corpusService, {
      type: "spec",
      title: "A spec",
      content: "## Overview\n\nBody.",
      extra: { spec_kind: "feature", acceptance_criteria: [SCRIPT_AC] },
    } as CreateDocInput);

    const approveResult = await reviewService.approve(spec.id, {
      overrideJudgmentId: "some-id",
      overrideNoJudgment: true,
    });
    expect(approveResult.ok).toBe(false);
    if (approveResult.ok) return;
    expect(approveResult.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── AC-TIER-7: kill-switches reproduce legacy behavior ───────────────────────

describe("AC-TIER-7 kill-switches", () => {
  it("ledger_auto_approve=false: creating a ledger doc lands draft (legacy behavior)", async () => {
    const { corpusService } = await makeApp({ ledgerAutoApprove: false });
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root", content: "# PRD" } as CreateDocInput);
    const doc = await mustCreate(corpusService, {
      type: "knowledge",
      title: "Retro X",
      parent_id: prd.id,
      content: "# R",
      extra: { sub_type: "retro" },
    } as CreateDocInput);
    expect(doc.status).toBe("draft");
  });

  it("judgment_required_types=[]: a spec approve needs no judgment (legacy behavior)", async () => {
    const { corpusService, reviewService } = await makeApp({ judgmentRequiredTypes: [] });
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root", content: "# PRD" } as CreateDocInput);
    const spec = await mustCreate(corpusService, {
      type: "spec",
      title: "A spec",
      content: "## Overview\n\nBody.",
      extra: { spec_kind: "feature", acceptance_criteria: [SCRIPT_AC] },
    } as CreateDocInput);

    const approveResult = await reviewService.approve(spec.id);
    expect(approveResult.ok).toBe(true);
    if (!approveResult.ok) return;
    expect(approveResult.value.status).toBe("approved");
  });
});
