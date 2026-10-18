// @reads packages/core/src/config.ts
/**
 * Tests for `spec-an-escalate-blocks-approval-for-every-doc-type-and-the` (D1-D5):
 * the `escalate` VERDICT escapes `workflow.review.judgment_required_types` and blocks
 * approval for EVERY doc type, while `reject` / `NO_JUDGMENT` /
 * `JUDGMENT_PROVENANCE_COLLISION` stay scoped to the listed types — and the escalate
 * denial renders the judgment's `blocking_questions` so the writer learns what to
 * answer from the refusal itself.
 *
 * InMemoryStore only — no bun:sqlite, no CLI spawn, and (per this repo's standing rule)
 * never a write against the repo's own `.lore/` corpus.
 *
 * Six-dimension coverage:
 *   HAPPY:      an ungated (knowledge) doc carrying an escalate is refused; a gated
 *               spec carrying an approve-judgment still approves
 *   NEGATIVE:   a reject on an ungated type still APPROVES (the reject scoping is
 *               preserved, not quietly universalised)
 *   BOUNDARY:   `judgment_required_types: []` still approves an escalate (the total
 *               kill switch short-circuits BEFORE the escalate path); a reject+escalate
 *               pair on an ungated type BLOCKS on the escalate (D5), in either
 *               recording order
 *   ERROR:      an escalating judgment carrying ZERO blocking_questions renders an
 *               explicit "none recorded" denial rather than an empty section
 *   STATE:      an ungated doc with NO judgment at all, and one whose only judgment
 *               collided with `extra.ai_provenance`, both still approve
 *   REGRESSION: gated types unaffected in both directions (incl. the reject+escalate
 *               pair, which still blocks on the REJECT — the anti-lottery rule); the
 *               `config.ts` @invariant prose no longer claims the key governs M2 for
 *               ANY type
 *
 * @spec_ref spec-an-escalate-blocks-approval-for-every-doc-type-and-the
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { LIVE_RULE_ID, seedLiveRule } from "../../helpers/live-rule-fixture.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import type {
  CreateDocInput,
  DocRecord,
  JudgeIdentity,
  NewReviewJudgment,
  ReviewDecision,
  ReviewJudgment,
  Telemetry,
} from "@lore/core";
import { actedStore } from "../../live-invocation.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeTelemetry(): Telemetry {
  return { record: vi.fn(), emit: vi.fn(), close: vi.fn() };
}

/**
 * Full app slice wired the way `app.ts` composes it (gate + judgmentService +
 * judgmentRequiredTypes all threaded), so these tests exercise the GATED production
 * path rather than the ungated bare-construction default the constructors document.
 */
async function makeApp(opts: { judgmentRequiredTypes?: readonly string[] } = {}) {
  const store = actedStore(new InMemoryStore());
  await seedLiveRule(store);
  const telemetry = makeTelemetry();
  const enforcer = new GateEnforcer(undefined);
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), telemetry, undefined, enforcer, undefined, true);
  const judgmentService = new JudgmentService(store, telemetry);
  const reviewService = new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined)),
    undefined,
    { enforcer, getPlanBundle: corpusService.getPlanBundle.bind(corpusService) },
    judgmentService,
    opts.judgmentRequiredTypes ?? ["spec", "adr"],
  );
  return { store, corpusService, judgmentService, reviewService };
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

const INDEPENDENT_JUDGE: JudgeIdentity = {
  provider: "claude-cli",
  model: "claude-opus-5",
  prompt_version: "v1",
};

function makeNewJudgment(overrides: Partial<NewReviewJudgment> = {}): NewReviewJudgment {
  return {
    doc_id: "01ARZ3DOC00000000000001",
    doc_version: 1,
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "All good" }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: [],
    judge: INDEPENDENT_JUDGE,
    ...overrides,
  };
}

/** A root PRD every other fixture doc parents onto. */
async function makeRootPrd(cs: CorpusService): Promise<DocRecord> {
  return mustCreate(cs, { type: "prd", title: "Root", content: "# PRD" } as CreateDocInput);
}

/**
 * A knowledge doc with an UNGATED sub_type — `reference` is deliberately NOT one of the
 * SPEC-103 M1 ledger sub_types (assessment/retro/handoff/uat), so it lands `draft` and
 * `approve()` is genuinely reachable for it.
 */
async function makeUngatedKnowledge(cs: CorpusService, prd: DocRecord, title = "A reference"): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "knowledge",
    title,
    parent_id: prd.id,
    content: "# K",
    extra: { sub_type: "reference" },
  } as CreateDocInput);
}

async function makeSpec(cs: CorpusService, prd: DocRecord, extra: Record<string, unknown> = {}): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "spec",
    title: "A spec",
    content: "## Overview\n\nBody.",
    extra: { spec_kind: "feature", acceptance_criteria: [SCRIPT_AC], ...extra },
  } as CreateDocInput);
}

function judgmentField(error: unknown): string {
  return (error as { field?: string }).field ?? "";
}

function judgmentMessage(error: unknown): string {
  return (error as { message?: string }).message ?? "";
}

// ─── AC-ESC-1: escalate blocks an ungated type ────────────────────────────────

describe("AC-ESC-1 escalate blocks an ungated type", () => {
  it("a knowledge doc whose current version carries an escalate is refused under the default spec+adr scoping", async () => {
    const { corpusService, judgmentService, reviewService } = await makeApp();
    const prd = await makeRootPrd(corpusService);
    const doc = await makeUngatedKnowledge(corpusService, prd);
    expect(doc.status).toBe("draft");

    const recorded = await judgmentService.record(
      makeNewJudgment({
        doc_id: doc.id,
        doc_version: doc.version,
        decision: "escalate",
        blocking_questions: ["Is the retention window a PRD commitment?"],
      }),
    );
    if (!recorded.ok) throw new Error(`record judgment failed: ${JSON.stringify(recorded.error)}`);

    const approveResult = await reviewService.approve(doc.id);
    expect(approveResult.ok).toBe(false);
    if (approveResult.ok) return;
    expect(approveResult.error.code).toBe("VALIDATION_ERROR");
    expect(judgmentField(approveResult.error)).toContain("review-judgment");
    expect(judgmentMessage(approveResult.error)).toContain("JUDGMENT_ESCALATED");
  });

  it("the escalate still blocks a knowledge doc when the type list names only spec", async () => {
    const { corpusService, judgmentService, reviewService } = await makeApp({ judgmentRequiredTypes: ["spec"] });
    const prd = await makeRootPrd(corpusService);
    const doc = await makeUngatedKnowledge(corpusService, prd);

    const recorded = await judgmentService.record(
      makeNewJudgment({
        doc_id: doc.id,
        doc_version: doc.version,
        decision: "escalate",
        blocking_questions: ["Who owns the sunset decision?"],
      }),
    );
    if (!recorded.ok) throw new Error("record judgment failed");

    const approveResult = await reviewService.approve(doc.id);
    expect(approveResult.ok).toBe(false);
    if (approveResult.ok) return;
    expect(judgmentMessage(approveResult.error)).toContain("JUDGMENT_ESCALATED");
  });
});

// ─── AC-ESC-2: reject on an ungated type still approves ───────────────────────

describe("AC-ESC-2 reject on an ungated type still approves", () => {
  it("a knowledge doc carrying a reject judgment approves (reject keeps its type scoping)", async () => {
    const { corpusService, judgmentService, reviewService } = await makeApp();
    const prd = await makeRootPrd(corpusService);
    const doc = await makeUngatedKnowledge(corpusService, prd);

    const recorded = await judgmentService.record(
      makeNewJudgment({ doc_id: doc.id, doc_version: doc.version, decision: "reject", confidence: 0.72 }),
    );
    if (!recorded.ok) throw new Error("record judgment failed");

    const approveResult = await reviewService.approve(doc.id);
    expect(approveResult.ok).toBe(true);
    if (!approveResult.ok) return;
    expect(approveResult.value.status).toBe("approved");
  });

});

// ─── AC-ESC-3: the [] kill switch survives ────────────────────────────────────

describe("AC-ESC-3 empty judgment_required_types remains a total kill switch", () => {
  it("an ESCALATE on an empty type list still approves (short-circuits before the escalate path)", async () => {
    const { corpusService, judgmentService, reviewService } = await makeApp({ judgmentRequiredTypes: [] });
    const prd = await makeRootPrd(corpusService);
    const doc = await makeUngatedKnowledge(corpusService, prd);

    const recorded = await judgmentService.record(
      makeNewJudgment({
        doc_id: doc.id,
        doc_version: doc.version,
        decision: "escalate",
        blocking_questions: ["Does the operator still want M2 off?"],
      }),
    );
    if (!recorded.ok) throw new Error("record judgment failed");

    const approveResult = await reviewService.approve(doc.id);
    expect(approveResult.ok).toBe(true);
    if (!approveResult.ok) return;
    expect(approveResult.value.status).toBe("approved");
  });

  it("an ESCALATE on a spec — a type the DEFAULT list gates — still approves when the list is empty", async () => {
    const { corpusService, judgmentService, reviewService } = await makeApp({ judgmentRequiredTypes: [] });
    const prd = await makeRootPrd(corpusService);
    const spec = await makeSpec(corpusService, prd);

    const recorded = await judgmentService.record(
      makeNewJudgment({
        doc_id: spec.id,
        doc_version: spec.version,
        decision: "escalate",
        blocking_questions: ["Is AC-1 in scope for this slice?"],
      }),
    );
    if (!recorded.ok) throw new Error("record judgment failed");

    const approveResult = await reviewService.approve(spec.id);
    expect(approveResult.ok).toBe(true);
    if (!approveResult.ok) return;
    expect(approveResult.value.status).toBe("approved");
  });
});

// ─── AC-ESC-4: the denial renders the questions ───────────────────────────────

describe("AC-ESC-4 denial renders the blocking questions", () => {
  const QUESTIONS = [
    "Does the PRD commit to a 90-day retention window?",
    "Who signs off on the sunset path for existing rows?",
    "Is the migration reversible without operator downtime?",
  ];

  it("every blocking_questions entry appears verbatim on its own line for an UNGATED type", async () => {
    const { corpusService, judgmentService, reviewService } = await makeApp();
    const prd = await makeRootPrd(corpusService);
    const doc = await makeUngatedKnowledge(corpusService, prd);

    const recorded = await judgmentService.record(
      makeNewJudgment({
        doc_id: doc.id,
        doc_version: doc.version,
        decision: "escalate",
        blocking_questions: QUESTIONS,
      }),
    );
    if (!recorded.ok) throw new Error("record judgment failed");

    const approveResult = await reviewService.approve(doc.id);
    expect(approveResult.ok).toBe(false);
    if (approveResult.ok) return;
    const lines = judgmentMessage(approveResult.error).split("\n").map((l) => l.trim());
    for (const question of QUESTIONS) {
      expect(lines).toContain(`- ${question}`);
    }
  });

  it("every blocking_questions entry appears verbatim on its own line for a GATED type too", async () => {
    const { corpusService, judgmentService, reviewService } = await makeApp();
    const prd = await makeRootPrd(corpusService);
    const spec = await makeSpec(corpusService, prd);

    const recorded = await judgmentService.record(
      makeNewJudgment({
        doc_id: spec.id,
        doc_version: spec.version,
        decision: "escalate",
        blocking_questions: QUESTIONS,
      }),
    );
    if (!recorded.ok) throw new Error("record judgment failed");

    const approveResult = await reviewService.approve(spec.id);
    expect(approveResult.ok).toBe(false);
    if (approveResult.ok) return;
    const lines = judgmentMessage(approveResult.error).split("\n").map((l) => l.trim());
    for (const question of QUESTIONS) {
      expect(lines).toContain(`- ${question}`);
    }
  });

  it("ERROR: an escalate carrying ZERO questions says so explicitly instead of printing an empty section", async () => {
    const { corpusService, store, reviewService } = await makeApp();
    const prd = await makeRootPrd(corpusService);
    const spec = await makeSpec(corpusService, prd);

    // `reviewJudgmentSchema` forbids `escalate` + empty `blocking_questions`, so
    // `JudgmentService.record` can never author this row — only a direct
    // `store.insertJudgment` (a legacy/migrated row, or a future writer that skips the
    // service) can. D4 requires the denial to name that defect rather than render an
    // empty section, so the fixture is injected at the store layer on purpose.
    const malformed: ReviewJudgment = {
      id: "01ARZ3JUDGMENT000000001",
      doc_id: spec.id,
      doc_version: spec.version,
      kind: "review",
      decision: "escalate",
      confidence: 0.68,
      reasons: [{ dimension: "completeness", finding: "Needs a human call." }],
      checks: [{ check: "schema", outcome: "pass" }],
      blocking_questions: [],
      judge: INDEPENDENT_JUDGE,
      created_at: "2026-07-31T00:00:00.000Z",
      created_by: "ai:claude-cli:claude-opus-5:v1",
    };
    const inserted = await store.insertJudgment(malformed);
    if (!inserted.ok) throw new Error("insertJudgment failed (test setup)");

    const approveResult = await reviewService.approve(spec.id);
    expect(approveResult.ok).toBe(false);
    if (approveResult.ok) return;
    const message = judgmentMessage(approveResult.error);
    expect(message).toContain("JUDGMENT_ESCALATED");
    expect(message).toContain("no blocking questions");
    // The empty case must NOT render a dangling bullet section.
    expect(message.split("\n").map((l) => l.trim())).not.toContain("-");
  });
});

// ─── AC-ESC-5: gated types unchanged in both directions ───────────────────────

describe("AC-ESC-5 gated types unchanged", () => {
  it("a spec carrying a reject is still refused", async () => {
    const { corpusService, judgmentService, reviewService } = await makeApp();
    const prd = await makeRootPrd(corpusService);
    const spec = await makeSpec(corpusService, prd);

    const recorded = await judgmentService.record(
      makeNewJudgment({ doc_id: spec.id, doc_version: spec.version, decision: "reject" }),
    );
    if (!recorded.ok) throw new Error("record judgment failed");

    const approveResult = await reviewService.approve(spec.id);
    expect(approveResult.ok).toBe(false);
    if (approveResult.ok) return;
    expect(judgmentMessage(approveResult.error)).toContain("JUDGMENT_REJECTED");
  });

  it("an adr carrying a reject is still refused", async () => {
    const { corpusService, judgmentService, reviewService } = await makeApp();
    const prd = await makeRootPrd(corpusService);
    const adr = await mustCreate(corpusService, {
      type: "adr",
      title: "A decision",
      parent_id: prd.id,
      content: "# ADR",
      extra: { decision_status: "proposed" },
    } as CreateDocInput);

    const recorded = await judgmentService.record(
      makeNewJudgment({ doc_id: adr.id, doc_version: adr.version, decision: "reject" }),
    );
    if (!recorded.ok) throw new Error("record judgment failed");

    const approveResult = await reviewService.approve(adr.id);
    expect(approveResult.ok).toBe(false);
    if (approveResult.ok) return;
    expect(judgmentMessage(approveResult.error)).toContain("JUDGMENT_REJECTED");
  });

  it("a spec carrying an approve-judgment still approves", async () => {
    const { corpusService, judgmentService, reviewService } = await makeApp();
    const prd = await makeRootPrd(corpusService);
    const spec = await makeSpec(corpusService, prd);

    const recorded = await judgmentService.record(
      makeNewJudgment({ doc_id: spec.id, doc_version: spec.version, decision: "approve" }),
    );
    if (!recorded.ok) throw new Error("record judgment failed");

    const approveResult = await reviewService.approve(spec.id);
    expect(approveResult.ok).toBe(true);
    if (!approveResult.ok) return;
    expect(approveResult.value.status).toBe("approved");
  });

  it("a spec with NO judgment is still refused (the precondition stays scoped to gated types)", async () => {
    const { corpusService, reviewService } = await makeApp();
    const prd = await makeRootPrd(corpusService);
    const spec = await makeSpec(corpusService, prd);

    const approveResult = await reviewService.approve(spec.id);
    expect(approveResult.ok).toBe(false);
    if (approveResult.ok) return;
    expect(judgmentMessage(approveResult.error)).toContain("NO_JUDGMENT");
  });
});

// ─── AC-ESC-7: D1's precondition half stays scoped ────────────────────────────

describe("AC-ESC-7 ungated type with no judgment still approves", () => {
  it("a knowledge doc with NO judgment at all approves (NO_JUDGMENT never universalises)", async () => {
    const { corpusService, reviewService } = await makeApp();
    const prd = await makeRootPrd(corpusService);
    const doc = await makeUngatedKnowledge(corpusService, prd);

    const approveResult = await reviewService.approve(doc.id);
    expect(approveResult.ok).toBe(true);
    if (!approveResult.ok) return;
    expect(approveResult.value.status).toBe("approved");
  });

  it("a knowledge doc whose ONLY judgment collided with extra.ai_provenance approves", async () => {
    const { corpusService, judgmentService, reviewService } = await makeApp();
    const prd = await makeRootPrd(corpusService);
    const doc = await mustCreate(corpusService, {
      type: "knowledge",
      title: "A self-reviewed reference",
      parent_id: prd.id,
      content: "# K",
      extra: { sub_type: "reference", ai_provenance: INDEPENDENT_JUDGE },
    } as CreateDocInput);

    const recorded = await judgmentService.record(
      makeNewJudgment({
        doc_id: doc.id,
        doc_version: doc.version,
        decision: "approve",
        judge: INDEPENDENT_JUDGE,
      }),
    );
    if (!recorded.ok) throw new Error("record judgment failed");

    const approveResult = await reviewService.approve(doc.id);
    expect(approveResult.ok).toBe(true);
    if (!approveResult.ok) return;
    expect(approveResult.value.status).toBe("approved");
  });
});

// ─── AC-ESC-8: the config @invariant prose matches the shipped scoping ────────

/**
 * The stale claim, copied VERBATIM from `config.ts` as it stood before this change
 * (commit 35ee2e6, lines 485-487, whitespace-normalised). It is the live control for
 * {@link claimsAnyType}: a detector that no longer fires on this recorded text would
 * make the negative assertion below vacuous — "no match" and "prose is correct" are
 * otherwise indistinguishable.
 */
const PRE_CHANGE_INVARIANT_TEXT =
  "`judgment_required_types: []` disables M2 entirely: `ReviewService. approve` never " +
  "requires a `review_judgments` row for ANY type — pre-SPEC-103 byte-identical. A " +
  "non-empty array is the SET of `DocType` values M2 gates;";

/** Whitespace-normalised, comment-marker-stripped view of a JSDoc block. */
function normaliseJsDoc(block: string): string {
  return block
    .replace(/^\s*\*\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `text` still claims the key's reach extends to ANY/EVERY doc type. */
function claimsAnyType(text: string): boolean {
  return /\bany type\b/i.test(text);
}

/**
 * Every `@invariant` block in `config.ts` that mentions `judgment_required_types`,
 * normalised. Empty means the block could not be LOCATED — the control assertion
 * below turns that into a loud failure instead of a vacuous pass.
 */
function judgmentRequiredTypesInvariantBlocks(): string[] {
  const configPath = fileURLToPath(new URL("../../../../core/src/config.ts", import.meta.url));
  const source = readFileSync(configPath, "utf8");
  return source
    .split("@invariant")
    .slice(1)
    .map((block) => normaliseJsDoc(block.split("*/")[0] ?? ""))
    .filter((block) => block.includes("judgment_required_types"));
}

describe("AC-ESC-8 config invariant prose matches the shipped scoping", () => {
  it("CONTROL: the judgment_required_types @invariant block is located and the stale-claim detector is live", () => {
    const blocks = judgmentRequiredTypesInvariantBlocks();
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.join(" ")).toContain("judgment_required_types: []");
    // A detector that cannot fire proves nothing — assert it fires on the recorded
    // pre-change text before trusting its verdict on the shipped text.
    expect(claimsAnyType(PRE_CHANGE_INVARIANT_TEXT)).toBe(true);
  });

  it("the block no longer claims the key governs M2 for ANY type", () => {
    for (const block of judgmentRequiredTypesInvariantBlocks()) {
      expect(claimsAnyType(block)).toBe(false);
    }
  });

  it("the block states the reject-only scoping and the preserved empty-list kill switch", () => {
    const combined = judgmentRequiredTypesInvariantBlocks().join(" ");
    expect(combined).toMatch(/reject/i);
    expect(combined).toMatch(/escalate/i);
    expect(combined).toContain("judgment_required_types: []");
  });
});

// ─── AC-ESC-9: an escalate PRESENT blocks, even alongside a reject (D5) ───────

/**
 * D5 (spec amendment 2026-07-31). The INVERTED form of the BOUNDARY case this file
 * previously pinned as passing: an ungated type carrying BOTH a `reject` and an
 * `escalate` on the SAME version used to resolve by worst-decision-wins to the
 * (type-suppressed) `reject` and APPROVE, losing the escalate. Adding a WEAKER,
 * deliberately-suppressible signal must not destroy a STRONGER one — a control
 * defeatable by adding noise is not a control.
 *
 * Reachable, not theoretical: `lore review` does not bump the doc version, so two
 * runs against one version produce two same-version judgments that may disagree.
 *
 * The two CONTROL cases are the load-bearing half — they pin that the fix did NOT
 * become "escalate outranks reject everywhere" (gated types must still block on the
 * reject: the anti-lottery rule) and did NOT leak past the `[]` kill switch (D3).
 */
describe("AC-ESC-9 escalate present blocks even alongside a reject", () => {
  const PAIR_QUESTION = "Should this be an ADR instead?";

  /** Records `escalate` + `reject` on `doc`'s current version, in the given order. */
  async function recordPair(
    judgmentService: Awaited<ReturnType<typeof makeApp>>["judgmentService"],
    doc: DocRecord,
    order: readonly ReviewDecision[],
  ): Promise<void> {
    for (const decision of order) {
      const recorded = await judgmentService.record(
        makeNewJudgment({
          doc_id: doc.id,
          doc_version: doc.version,
          decision,
          ...(decision === "escalate" ? { blocking_questions: [PAIR_QUESTION] } : {}),
        }),
      );
      if (!recorded.ok) throw new Error(`record ${decision} failed: ${JSON.stringify(recorded.error)}`);
    }
  }

  it("an ungated type carrying BOTH a reject and an escalate is refused ON THE ESCALATE", async () => {
    const { corpusService, judgmentService, reviewService } = await makeApp();
    const prd = await makeRootPrd(corpusService);
    const doc = await makeUngatedKnowledge(corpusService, prd);
    await recordPair(judgmentService, doc, ["escalate", "reject"]);

    const approveResult = await reviewService.approve(doc.id);
    expect(approveResult.ok).toBe(false);
    if (approveResult.ok) return;
    expect(approveResult.error.code).toBe("VALIDATION_ERROR");
    expect(judgmentField(approveResult.error)).toContain("review-judgment");
    const message = judgmentMessage(approveResult.error);
    expect(message).toContain("JUDGMENT_ESCALATED");
    // D4 must not regress: the denial still carries the ESCALATING judgment's questions.
    expect(message.split("\n").map((l) => l.trim())).toContain(`- ${PAIR_QUESTION}`);
  });

  it("BOUNDARY: the block is order-independent — the reject recorded FIRST still blocks on the escalate", async () => {
    const { corpusService, judgmentService, reviewService } = await makeApp();
    const prd = await makeRootPrd(corpusService);
    const doc = await makeUngatedKnowledge(corpusService, prd);
    await recordPair(judgmentService, doc, ["reject", "escalate"]);

    const approveResult = await reviewService.approve(doc.id);
    expect(approveResult.ok).toBe(false);
    if (approveResult.ok) return;
    expect(judgmentMessage(approveResult.error)).toContain("JUDGMENT_ESCALATED");
  });

  it("CONTROL: a GATED type with the same pair still blocks on the REJECT (worst-decision-wins intact)", async () => {
    const { corpusService, judgmentService, reviewService } = await makeApp();
    const prd = await makeRootPrd(corpusService);
    const spec = await makeSpec(corpusService, prd);
    await recordPair(judgmentService, spec, ["escalate", "reject"]);

    const approveResult = await reviewService.approve(spec.id);
    expect(approveResult.ok).toBe(false);
    if (approveResult.ok) return;
    const message = judgmentMessage(approveResult.error);
    expect(message).toContain("JUDGMENT_REJECTED");
    // The anti-lottery rule: a reject on a gated type must never be out-rolled, so
    // the gated denial must NOT have flipped to the escalate reason.
    expect(message).not.toContain("JUDGMENT_ESCALATED");
  });

  it("CONTROL: an empty judgment_required_types still APPROVES the same pair (D3 short-circuits first)", async () => {
    const { corpusService, judgmentService, reviewService } = await makeApp({ judgmentRequiredTypes: [] });
    const prd = await makeRootPrd(corpusService);
    const doc = await makeUngatedKnowledge(corpusService, prd);
    await recordPair(judgmentService, doc, ["escalate", "reject"]);

    const approveResult = await reviewService.approve(doc.id);
    expect(approveResult.ok).toBe(true);
    if (!approveResult.ok) return;
    expect(approveResult.value.status).toBe("approved");
  });
});
