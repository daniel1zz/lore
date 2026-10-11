/**
 * Tests for the omitted-section heading list appended to the SPEC-040 D8 "# Truncation
 * Notice" in `review-template.ts` (`assembleReviewPrompt`, shared by `buildReviewPromptV1`
 * and `buildReviewPromptV2`).
 *
 * Source defect (task-the-judge-truncation-notice-says-content-was-cut-but-never): the
 * pre-existing notice told a judge only that SOMETHING was cut, never WHICH sections —
 * measured to produce both a false "missing" escalation (a section was actually declared
 * past the cut) and a suppressed cross-reference gap (the judge obeyed the notice but
 * could not name what was unverifiable). The fix enumerates the FULL document's markdown
 * section headings and names precisely which ones fell outside the truncation window.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a multi-section doc, truncated, produces "Sections not shown: D7, Rollout,
 *               Appendix" — naming exactly the headings that fall past the cutoff and
 *               excluding the ones that survive (Overview, Design Decisions).
 *   NEGATIVE:   CONTROL — a doc entirely inside budget emits NO truncation notice and no
 *               heading list at all (AC2 — proves the assertion isn't vacuous).
 *   BOUNDARY:   (a) a heading whose line starts EXACTLY at the visible-char cutoff is
 *               classified OMITTED, not shown (off-by-one correctness; also the "minimal
 *               overage" edge — the document is truncated by only 15 chars and the cut
 *               heading is still named, not silently waved through as negligible);
 *               (b) a document whose entire pre-heading content alone exceeds the budget
 *               — no heading survives — produces the LOUD "NONE ... are visible" wording,
 *               not a quietly non-empty list (AC4's "first section alone exceeds it").
 *   ERROR:      a document with ZERO detected headings anywhere still gets truncated —
 *               the notice explicitly says omission cannot be named, rather than silently
 *               rendering an empty list that reads as "nothing was cut" (the false-green
 *               trap AC4 warns against).
 *   STATE:      (a) repeated calls with alternating short/long bundles never leak state
 *               between invocations (pure, stateless); (b) v1 and v2 apply the identical
 *               heading-omission mechanism for a non-spec-AC document (both delegate to
 *               the same `assembleReviewPrompt` NO_ADVISORY path).
 *   REGRESSION: (a) the pre-existing notice instruction sentence is preserved byte-for-
 *               byte and `truncated` still includes "doc"/`docTruncated` is still `true`;
 *               (b) end-to-end through `AIProviderService.judgeDoc`, the persisted
 *               judgment still gets `truncated: true` AND the prompt the judge received
 *               still carries the new heading list — the full wiring stays intact.
 *
 * CRITICAL (AC3): "the heading list is derived from the FULL document, never the
 * truncated copy" gets its own dedicated test — a heading name is placed ONLY past the
 * cutoff (absent from the first `max_doc_chars` characters of the content by construction)
 * and is still asserted present in the rendered prompt. A heading-list built from the
 * truncated copy could not have found it — this is the single most important assertion
 * in this file.
 *
 * @spec_ref task-the-judge-truncation-notice-says-content-was-cut-but-never
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { REVIEW_TEMPLATES } from "../../../src/ai/review-template.js";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { runDeterministicChecks } from "@lore/core";
import type { AIProvider, CreateDocInput, DocRecord, ReviewBundle, Telemetry, TelemetryEvent } from "@lore/core";

const BUDGET = 12000;
const BUDGETS = { max_doc_chars: BUDGET, max_context_chars: 8000 };

function makeDoc(overrides: Partial<DocRecord>): DocRecord {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" as DocRecord["id"],
    slug: "spec-truncation-headings-test" as DocRecord["slug"],
    type: "spec",
    role: "spec",
    title: "Truncation Headings Test Spec",
    status: "draft",
    priority: "medium",
    content: "short content",
    parent_id: null,
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
    created_by: "tester",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

function bundleFor(content: string): ReviewBundle {
  return { doc: makeDoc({ content }), links: [] };
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("buildOmittedSectionsNotice — HAPPY (AC1)", () => {
  it("names exactly the headings that fall past the cutoff, excluding the ones that survive", () => {
    // Overview + Design Decisions comfortably survive; D7, Rollout, Appendix all land
    // past the 12000-char cutoff — mirrors the source task's own illustrative example.
    const content =
      "## Overview\n" +
      "a".repeat(6000) +
      "\n## Design Decisions\n" +
      "b".repeat(6000) +
      "\n## D7\n" +
      "c".repeat(500) +
      "\n## Rollout\n" +
      "d".repeat(500) +
      "\n## Appendix\nend";
    expect(content.length).toBeGreaterThan(BUDGET);

    const result = REVIEW_TEMPLATES["v1"]!(bundleFor(content), [], BUDGETS);

    expect(result.docTruncated).toBe(true);
    expect(result.prompt).toContain("Sections not shown (3 of 5): D7, Rollout, Appendix.");
    // NEGATIVE-shaped assertion folded in: a heading that DID survive must never appear
    // inside the omitted-list sentence itself.
    expect(result.prompt).not.toContain("Sections not shown (3 of 5): Overview");
  });
});

// ─── CRITICAL (AC3) ─────────────────────────────────────────────────────────

describe("omitted-section heading list — CRITICAL: derived from the FULL document (AC3)", () => {
  it("names a heading that is ABSENT from the truncated copy — provable only by scanning the full doc.content", () => {
    // The first BUDGET chars are pure filler containing no "#" at all. The heading (and
    // its distinctive name) exists ONLY past the cutoff.
    const prefix = "w".repeat(BUDGET - 1) + "\n"; // exactly BUDGET chars, zero headings
    const headingName = "AC3ProofHeading";
    const content = prefix + `## ${headingName}\nBeyond the cut.`;

    // Sanity/control on the test's own construction: the heading name must genuinely be
    // absent from the naive truncated prefix, or this test would prove nothing.
    expect(content.slice(0, BUDGET).includes(headingName)).toBe(false);

    const result = REVIEW_TEMPLATES["v1"]!(bundleFor(content), [], BUDGETS);

    expect(result.docTruncated).toBe(true);
    // The ONLY way this string can appear in the prompt is if the omitted-heading scan
    // read `bundle.doc.content` (the full body), never `docSection.text` (the truncated
    // copy) — the truncated copy provably does not contain this substring.
    expect(result.prompt).toContain(headingName);
  });
});

// ─── NEGATIVE / CONTROL (AC2) ───────────────────────────────────────────────

describe("buildOmittedSectionsNotice — NEGATIVE/CONTROL (AC2)", () => {
  it("a doc entirely inside budget emits NO truncation notice and no heading list", () => {
    const content = "## Overview\nShort content, comfortably under budget.";
    expect(content.length).toBeLessThan(BUDGET);

    const result = REVIEW_TEMPLATES["v1"]!(bundleFor(content), [], BUDGETS);

    expect(result.docTruncated).toBe(false);
    expect(result.prompt).not.toContain("# Truncation Notice");
    expect(result.prompt).not.toContain("Sections not shown");
    expect(result.prompt).not.toContain("section heading");
  });
});

// ─── BOUNDARY (AC4) ─────────────────────────────────────────────────────────

describe("buildOmittedSectionsNotice — BOUNDARY (AC4)", () => {
  it("a heading starting EXACTLY at the visible-char cutoff is OMITTED, not shown (off-by-one + minimal overage)", () => {
    const prefix = "y".repeat(BUDGET - 1) + "\n"; // exactly BUDGET chars, no heading yet
    const content = prefix + "## Marginal\nend";
    // Only 15 chars over budget — a "barely truncated" document.
    expect(content.length - BUDGET).toBeLessThan(20);
    expect(content.length).toBeGreaterThan(BUDGET);

    const result = REVIEW_TEMPLATES["v1"]!(bundleFor(content), [], BUDGETS);

    expect(result.docTruncated).toBe(true);
    expect(result.prompt).toContain(
      "NONE of this document's 1 section heading(s) are visible above " +
        "— the visible window falls before the first heading or within an oversized one. " +
        "Sections not shown: Marginal.",
    );
  });

  it("a document whose pre-heading content ALONE exceeds the budget — no heading survives — is named LOUDLY, not left as a quiet non-empty list", () => {
    // Pure body text, zero "#" characters, alone bigger than the budget: even the FIRST
    // heading in the document sits past the cutoff.
    const preamble = "p".repeat(BUDGET + 500);
    const content = preamble + "\n## D7\n" + "e".repeat(100) + "\n## Rollout\nend";

    const result = REVIEW_TEMPLATES["v1"]!(bundleFor(content), [], BUDGETS);

    expect(result.docTruncated).toBe(true);
    expect(result.prompt).toContain(
      "NONE of this document's 2 section heading(s) are visible above " +
        "— the visible window falls before the first heading or within an oversized one. " +
        "Sections not shown: D7, Rollout.",
    );
  });
});

// ─── ERROR (false-green guard) ──────────────────────────────────────────────

describe("buildOmittedSectionsNotice — ERROR: zero detected headings (false-green guard)", () => {
  it("a truncated doc with NO markdown heading structure at all gets an explicit 'cannot be named' notice, never a silently-empty list", () => {
    const content = "x".repeat(BUDGET + 8000); // no "#" anywhere
    expect(content.includes("#")).toBe(false);

    const result = REVIEW_TEMPLATES["v1"]!(bundleFor(content), [], BUDGETS);

    expect(result.docTruncated).toBe(true);
    expect(result.prompt).toContain(
      "No section headings were detected anywhere in this document, so specific omitted " +
        "sections cannot be named — treat the entire region beyond the excerpt above as " +
        "structurally unknown, not as confirmed-empty.",
    );
    // The false-green form this guards against: an empty/absent list with no comment at
    // all, which would read as "nothing was omitted."
    expect(result.prompt).not.toContain("Sections not shown");
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("buildOmittedSectionsNotice — STATE", () => {
  const longContent =
    "## Overview\n" + "a".repeat(6000) + "\n## Design Decisions\n" + "b".repeat(6000) + "\n## D7\nend";
  const shortContent = "## Overview\nShort.";

  it("repeated calls with alternating short/long bundles never leak state between invocations", () => {
    const short1 = REVIEW_TEMPLATES["v1"]!(bundleFor(shortContent), [], BUDGETS);
    expect(short1.docTruncated).toBe(false);

    const long1 = REVIEW_TEMPLATES["v1"]!(bundleFor(longContent), [], BUDGETS);
    expect(long1.docTruncated).toBe(true);
    expect(long1.prompt).toContain("Sections not shown");

    // The short-doc call, re-run AFTER a long-doc call, must be byte-identical to short1 —
    // no leaked module-level state from the intervening truncated call.
    const short2 = REVIEW_TEMPLATES["v1"]!(bundleFor(shortContent), [], BUDGETS);
    expect(short2).toEqual(short1);
  });

  it("v1 and v2 apply the identical heading-omission mechanism for a non-AC document", () => {
    // `makeDoc`'s default extra={} declares no acceptance_criteria, so v2 collapses to the
    // same NO_ADVISORY assembly as v1 (see extractSpecAcceptanceCriteria) — both should
    // therefore produce a BYTE-IDENTICAL prompt, heading list included.
    const v1Result = REVIEW_TEMPLATES["v1"]!(bundleFor(longContent), [], BUDGETS);
    const v2Result = REVIEW_TEMPLATES["v2"]!(bundleFor(longContent), [], BUDGETS);

    expect(v2Result.prompt).toBe(v1Result.prompt);
    expect(v2Result.prompt).toContain("Sections not shown");
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("buildOmittedSectionsNotice — REGRESSION", () => {
  it("the pre-existing Truncation Notice instruction is preserved byte-for-byte alongside the new heading list", () => {
    const content =
      "## Overview\n" + "a".repeat(6000) + "\n## Design Decisions\n" + "b".repeat(6000) + "\n## D7\nend";

    const result = REVIEW_TEMPLATES["v1"]!(bundleFor(content), [], BUDGETS);

    expect(result.docTruncated).toBe(true);
    expect(result.truncated).toContain("doc");
    // Byte-for-byte the ORIGINAL instruction sentence — unchanged by this fix.
    expect(result.prompt).toContain(
      "The document body above was truncated to fit this prompt's character budget. Treat " +
        "the FULL document as present but unseen beyond what is shown — do NOT conclude a " +
        "section is missing, incomplete, or absent merely because it isn't visible here. Any " +
        "escalation or finding about \"unseen\" or \"missing\" content MUST cite this notice " +
        "explicitly, not silence alone.",
    );
  });
});

describe("AIProviderService.judgeDoc — REGRESSION end-to-end: truncated:true still stamped, prompt still carries the heading list", () => {
  function makeReviewService(provider: InMemoryAIProvider) {
    const telemetry: Telemetry = {
      record: (_event: TelemetryEvent) => {},
      emit: () => {},
      close: () => {},
    };
    const providers = new Map([[provider.name, provider]]) as unknown as ReadonlyMap<string, AIProvider>;
    return new AIProviderService(providers, provider.name, {}, telemetry, false, 8000, {
      max_plan_chars: 8000,
      max_spec_chars: 12000,
      max_task_chars: 4000,
      max_diff_chars: 24000,
    });
  }

  const VALID_REVIEW_JSON = JSON.stringify({
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "Looks good" }],
    blocking_questions: [],
  });

  async function makeReviewBundle(store: InMemoryStore, content: string) {
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prdResult = await corpusService.create({
      type: "prd",
      title: "Truncation Headings Test PRD",
      content: "Root PRD.",
    } as CreateDocInput);
    if (!prdResult.ok) throw new Error("prd create failed");

    const specResult = await corpusService.create({
      type: "spec",
      title: "Truncation Headings Test Spec",
      content,
    } as CreateDocInput);
    if (!specResult.ok) throw new Error("spec create failed");

    const bundleResult = await corpusService.getReviewBundle(specResult.value.id);
    if (!bundleResult.ok) throw new Error("getReviewBundle failed");
    return bundleResult.value;
  }

  it("a spec body with a heading past the cutoff: judgment.truncated===true and the judge's own prompt named the omitted heading", async () => {
    const store = new InMemoryStore();
    const content =
      "## Overview\n" + "a".repeat(6000) + "\n## Design Decisions\n" + "b".repeat(6000) + "\n## D7\nDetails here.";
    const bundle = await makeReviewBundle(store, content);
    const checks = runDeterministicChecks(bundle);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_REVIEW_JSON });
    const service = makeReviewService(provider);

    const result = await service.judgeDoc(bundle, checks, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.truncated).toBe(true);

    // The provider double records every prompt it was called with — assert the judge's
    // OWN prompt (not the template-level unit test above) still carried the heading list.
    const calls = provider.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]!.prompt).toContain("Sections not shown");
    expect(calls[0]!.prompt).toContain("D7");
  });
});
