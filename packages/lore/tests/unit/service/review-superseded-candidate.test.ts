/**
 * Tests for SPEC-044 §Design Decisions D11 — the `superseded_candidate` byproduct on
 * REGULAR (kind="review") review judgments, and its rendering
 * (`adapters/cli/review-render.ts`).
 *
 * @spec_ref SPEC-044 §Design Decisions D5, D11; AC-SP-8
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a review judgment with a RESOLVABLE superseded_candidate persists
 *               (migration-005 column round-trips through JudgmentService/InMemoryStore)
 *               and renders the `lore invalidate <old> --superseded-by <X>` nudge
 *   NEGATIVE:   n/a (covered by ERROR below)
 *   BOUNDARY:   n/a — reason-length capping is D5/D6's own concern
 *               (staleness-escalation.test.ts), not this D11 byproduct's
 *   ERROR:      an unresolvable ref renders a note, never a broken command (note-not-
 *               command — the WHOLE nudge degrades to a note, unlike D6's always-a-
 *               command shape, since ref IS the primary invalidation target here)
 *   STATE:      the persisted judgment is retrievable via judgmentService.latestFor
 *               with its superseded_candidate field intact
 *   REGRESSION: a judgment with NO superseded_candidate renders BYTE-IDENTICAL output
 *               to formatJudgmentSummary alone (renderSupersededCandidateNudgeBlock
 *               returns "" — concatenation is a true no-op)
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { NoOpTelemetry } from "@lore/core";
import type { CreateDocInput, NewReviewJudgment } from "@lore/core";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { formatJudgmentSummary, renderSupersededCandidateNudgeBlock } from "../../../src/adapters/cli/review-render.js";
import type { StalenessFlowDeps } from "../../../src/flows/staleness-flow.js";
import { ok } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
function buildTestFlowDeps(corpusService: CorpusService, judgmentService: JudgmentService): StalenessFlowDeps {
  return {
    listByType: async (type) => {
      const r = await corpusService.listFull({ type });
      return r.ok ? ok(r.value.docs) : r;
    },
    latestStalenessJudgment: (docId) => judgmentService.latestFor(docId, "staleness"),
    resolveSlug: async (idOrSlug) => {
      const r = await corpusService.get(idOrSlug);
      return r.ok ? ok({ slug: r.value.doc.slug }) : r;
    },
  };
}

async function setup() {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const judgmentService = new JudgmentService(store, new NoOpTelemetry());
  return { store, corpusService, judgmentService };
}

// ─── HAPPY + STATE: resolvable superseded_candidate persists and renders ────

describe("HAPPY/STATE — a regular review judgment with a resolvable superseded_candidate (D11)", () => {
  it("persists via migration-005's column and renders the invalidate nudge with the resolved ref", async () => {
    const { corpusService, judgmentService } = await setup();

    const oldDoc = await corpusService.create({
      parent_id: await ensureRequirementsDocId(corpusService), type: "adr",
      title: "ZzzD11OldDecision",
      content: "body",
      extra: { decision_status: "accepted" },
    } as CreateDocInput);
    const newDoc = await corpusService.create({
      parent_id: await ensureRequirementsDocId(corpusService), type: "adr",
      title: "ZzzD11NewDecision",
      content: "body",
      extra: { decision_status: "accepted" },
    } as CreateDocInput);
    expect(oldDoc.ok && newDoc.ok).toBe(true);
    if (!oldDoc.ok || !newDoc.ok) return;

    // kind is OMITTED entirely — a regular review judgment, defaults to "review"
    // (D3's `?? "review"` invariant), never "staleness".
    const newJudgment: NewReviewJudgment = {
      doc_id: newDoc.value.id,
      doc_version: newDoc.value.version,
      decision: "approve",
      confidence: 0.91,
      reasons: [{ dimension: "completeness", finding: "supersedes the prior decision" }],
      checks: [],
      blocking_questions: [],
      superseded_candidate: { ref: oldDoc.value.slug, reason: "the prior decision no longer applies" },
      judge: { provider: "in-memory", model: "in-memory", prompt_version: "v1" },
    };
    const recordResult = await judgmentService.record(newJudgment);
    expect(recordResult.ok).toBe(true);
    if (!recordResult.ok) return;
    // reason: JudgmentService._recordImpl resolves the OMITTED `kind` to "review"
    // explicitly before persisting (D3's `?? "review"` invariant) — the CANDIDATE this
    // test submitted had no `kind` field at all, but the PERSISTED row always does.
    expect(recordResult.value.kind).toBe("review");

    // STATE — retrievable, superseded_candidate intact.
    const latestResult = await judgmentService.latestFor(newDoc.value.id);
    expect(latestResult.ok).toBe(true);
    if (!latestResult.ok) return;
    const judgment = latestResult.value;
    expect(judgment).not.toBeNull();
    if (judgment === null) return;
    expect(judgment.superseded_candidate).toEqual({ ref: oldDoc.value.slug, reason: "the prior decision no longer applies" });

    // Rendering: formatJudgmentSummary UNCHANGED + the D11 nudge appended.
    const base = formatJudgmentSummary(judgment);
    const flowDeps = buildTestFlowDeps(corpusService, judgmentService);
    const nudgeBlock = await renderSupersededCandidateNudgeBlock(flowDeps, newDoc.value.slug, judgment);

    expect(nudgeBlock).toBe(`\n\nSuggested: lore invalidate ${oldDoc.value.slug} --superseded-by ${newDoc.value.slug}`);
    expect(base + nudgeBlock).toContain(`lore invalidate ${oldDoc.value.slug} --superseded-by ${newDoc.value.slug}`);
  });
});

// ─── ERROR: unresolvable ref → note-not-command ──────────────────────────────

describe("ERROR — an unresolvable superseded_candidate.ref renders a note, never a broken command", () => {
  it("the WHOLE nudge degrades to a note (ref IS the primary target, unlike D6)", async () => {
    const { corpusService, judgmentService } = await setup();

    const doc = await corpusService.create({
      parent_id: await ensureRequirementsDocId(corpusService), type: "knowledge",
      title: "ZzzD11UnresolvableTarget",
      content: "body",
      extra: { sub_type: "reference" },
    } as CreateDocInput);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;

    const newJudgment: NewReviewJudgment = {
      doc_id: doc.value.id,
      doc_version: doc.value.version,
      decision: "approve",
      confidence: 0.8,
      reasons: [{ dimension: "completeness", finding: "believed to supersede an untracked doc" }],
      checks: [],
      blocking_questions: [],
      superseded_candidate: { ref: "knowledge-nowhere-to-be-found", reason: "guessed" },
      judge: { provider: "in-memory", model: "in-memory", prompt_version: "v1" },
    };
    const recordResult = await judgmentService.record(newJudgment);
    expect(recordResult.ok).toBe(true);
    if (!recordResult.ok) return;
    const judgment = recordResult.value;

    const flowDeps = buildTestFlowDeps(corpusService, judgmentService);
    const nudgeBlock = await renderSupersededCandidateNudgeBlock(flowDeps, doc.value.slug, judgment);

    expect(nudgeBlock.startsWith("\n\nNote: ")).toBe(true);
    expect(nudgeBlock).not.toContain("lore invalidate");
    expect(nudgeBlock).toContain("knowledge-nowhere-to-be-found");
  });
});

// ─── REGRESSION: absent field → byte-identical rendering ────────────────────

describe("REGRESSION — a judgment with NO superseded_candidate renders byte-identical to formatJudgmentSummary alone", () => {
  it("renderSupersededCandidateNudgeBlock returns '' (true no-op concatenation)", async () => {
    const { corpusService, judgmentService } = await setup();

    const doc = await corpusService.create({
      parent_id: await ensureRequirementsDocId(corpusService), type: "adr",
      title: "ZzzD11RegressionTarget",
      content: "body",
      extra: { decision_status: "accepted" },
    } as CreateDocInput);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;

    // No superseded_candidate at all — the pre-SPEC-044 shape.
    const newJudgment: NewReviewJudgment = {
      doc_id: doc.value.id,
      doc_version: doc.value.version,
      decision: "reject",
      confidence: 1.0,
      reasons: [{ dimension: "schema", finding: "missing required field" }],
      checks: [{ check: "schema", outcome: "fail", detail: "missing required field" }],
      blocking_questions: [],
      judge: { provider: "deterministic-checks", model: "n/a", prompt_version: "v1" },
    };
    const recordResult = await judgmentService.record(newJudgment);
    expect(recordResult.ok).toBe(true);
    if (!recordResult.ok) return;
    const judgment = recordResult.value;
    expect(judgment.superseded_candidate).toBeUndefined();

    const base = formatJudgmentSummary(judgment);
    const flowDeps = buildTestFlowDeps(corpusService, judgmentService);
    const nudgeBlock = await renderSupersededCandidateNudgeBlock(flowDeps, doc.value.slug, judgment);

    expect(nudgeBlock).toBe("");
    expect(base + nudgeBlock).toBe(base);
  });
});
