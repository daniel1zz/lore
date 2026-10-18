/**
 * Tests for the SPEC-044 §Design Decisions D3 `kind` store-contract boundary —
 * `ReviewJudgment.kind`, `StoreInterface.latestJudgment`/`findJudgments`'s kind
 * filter, `JudgmentService.latestFor`/`listFor`'s default-to-"review", and
 * `reviewJudgmentSchema`'s kind-conditioned decision refinement ordering. Uses
 * InMemoryStore — no IO, no bun:sqlite (this file MUST be a vitest `.test.ts`, not
 * `.bun.test.ts` — the actual SQL migration/`kind` column behavior is exercised by
 * `packages/lore/tests/unit/store/migration-003.bun.test.ts` +
 * `migration-004.bun.test.ts` + `sqlite-store.bun.test.ts`'s judgment round-trip test,
 * all of which pass against the live migration-005 schema, SPEC-044 T1's own
 * regression-suite evidence for the SQL-layer half of this AC).
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a kind='staleness' judgment persists and is retrievable via the
 *               kind-filtered store methods
 *   NEGATIVE:   reviewJudgmentSchema rejects kind='staleness' + decision='reject'
 *               (structurally impossible for a probe)
 *   BOUNDARY:   S6 dual-fire — a candidate that ALSO violates the shared
 *               escalate-invariant surfaces the KIND-DECISION message as issues[0]
 *               (ordering, not just presence)
 *   ERROR:      n/a — this module has no throw surface beyond Zod safeParse, already
 *               exercised under NEGATIVE/BOUNDARY
 *   STATE:      S2 corruption oracle — a doc whose newest row is a staleness "holds"
 *               still resolves to the OLDER review judgment via latestFor's
 *               default-to-"review" (the badge a `lore pending`-style caller would
 *               render never flips to the staleness row); recordCalibration's
 *               not_latest_judgment check ignores a newer staleness row when
 *               calibrating a review judgment
 *   REGRESSION: JudgmentService.record()/latestFor()/listFor() called with NO kind
 *               argument at all behave byte-identically to pre-SPEC-044 (kind defaults
 *               to "review" throughout); S10 — a legacy row with `kind: undefined`
 *               (direct store.insertJudgment bypass, simulating pre-migration-005 data)
 *               reads as "review" via `??`, never strict equality
 *
 * @spec_ref SPEC-044 §Design Decisions D3; AC-SP-2
 */

import { describe, it, expect, vi } from "vitest";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { reviewJudgmentSchema } from "@lore/core";
import type { NewReviewJudgment, ReviewJudgment, Telemetry, TelemetryEvent } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

function makeService() {
  const store = actedStore(new InMemoryStore());
  const telemetry: Telemetry = { record: vi.fn(), emit: vi.fn(), close: vi.fn() };
  return { service: new JudgmentService(store, telemetry), store };
}

function makeReviewJudgment(docId: string, overrides: Partial<NewReviewJudgment> = {}): NewReviewJudgment {
  return {
    doc_id: docId,
    doc_version: 1,
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "All good" }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: [],
    judge: { provider: "test-provider", model: "test-provider", prompt_version: "v1" },
    kind: "review",
    ...overrides,
  };
}

function makeStalenessJudgment(docId: string, overrides: Partial<NewReviewJudgment> = {}): NewReviewJudgment {
  return {
    doc_id: docId,
    doc_version: 1,
    decision: "approve", // "holds"
    confidence: 0.8,
    reasons: [{ dimension: "staleness", finding: "still true" }],
    checks: [],
    blocking_questions: [],
    judge: { provider: "test-provider", model: "test-provider", prompt_version: "v1" },
    kind: "staleness",
    ...overrides,
  };
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("HAPPY — a kind='staleness' judgment persists and is retrievable via kind-filtered reads", () => {
  it("record() with kind='staleness' persists kind='staleness'; findJudgments/latestJudgment(docId,'staleness') see it", async () => {
    const { service, store } = makeService();
    const docId = "01ARZ3STALEDOCHAPPY0001";
    const recorded = await service.record(makeStalenessJudgment(docId));
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.value.kind).toBe("staleness");

    const found = await store.findJudgments(docId, "staleness");
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toHaveLength(1);

    const latest = await store.latestJudgment(docId, "staleness");
    expect(latest.ok).toBe(true);
    if (!latest.ok) return;
    expect(latest.value?.id).toBe(recorded.value.id);
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("NEGATIVE — reviewJudgmentSchema rejects kind='staleness' + decision='reject'", () => {
  it("a staleness row with decision='reject' fails validation with the kind-decision message", () => {
    const candidate = {
      id: "01ARZ3REJECTINVALID0001",
      doc_id: "01ARZ3DOCTOREJECT000001",
      doc_version: 1,
      decision: "reject" as const,
      confidence: 0.5,
      reasons: [{ dimension: "staleness", finding: "n/a" }],
      checks: [],
      blocking_questions: [],
      kind: "staleness" as const,
      judge: { provider: "p", model: "m", prompt_version: "v1" },
      created_at: "2026-07-12T00:00:00.000Z",
      created_by: "ai:p:m:v1",
    };
    const parsed = reviewJudgmentSchema.safeParse(candidate);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toMatch(/cannot have decision 'reject'/);
  });
});

// ─── BOUNDARY (S6 dual-fire) ────────────────────────────────────────────────

describe("BOUNDARY — S6 dual-fire: kind-decision message surfaces FIRST when the escalate-invariant would ALSO fire", () => {
  it("kind='staleness', decision='reject', NON-EMPTY blocking_questions violates BOTH refinements — issues[0] is the kind-decision message", () => {
    const candidate = {
      id: "01ARZ3DUALFIREINVALID01",
      doc_id: "01ARZ3DOCDUALFIRE000001",
      doc_version: 1,
      decision: "reject" as const,
      confidence: 0.5,
      reasons: [{ dimension: "staleness", finding: "n/a" }],
      checks: [],
      // NON-EMPTY blocking_questions with decision='reject' ALSO trips
      // validateEscalateInvariant ("must be empty unless decision is 'escalate'").
      blocking_questions: ["this also violates the escalate invariant"],
      kind: "staleness" as const,
      judge: { provider: "p", model: "m", prompt_version: "v1" },
      created_at: "2026-07-12T00:00:00.000Z",
      created_by: "ai:p:m:v1",
    };
    const parsed = reviewJudgmentSchema.safeParse(candidate);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    // Both refinements fire — at least 2 issues — but the KIND-DECISION one is first.
    expect(parsed.error.issues.length).toBeGreaterThanOrEqual(2);
    expect(parsed.error.issues[0]?.message).toMatch(/cannot have decision 'reject'/);
    expect(parsed.error.issues[0]?.path).toEqual(["decision"]);
  });
});

// ─── STATE (S2 corruption oracle + calibration kind-scoping) ───────────────

describe("STATE — S2 corruption oracle: latestFor's default-to-'review' survives a NEWER staleness row", () => {
  it("a doc whose NEWEST row is a staleness 'holds' still resolves latestFor(docId) to the OLDER review judgment", async () => {
    const { service } = makeService();
    const docId = "01ARZ3S2CORRUPTIONDOC01";

    const reviewJudgment = await service.record(makeReviewJudgment(docId, { decision: "approve" }));
    expect(reviewJudgment.ok).toBe(true);
    if (!reviewJudgment.ok) return;

    await new Promise((resolve) => setTimeout(resolve, 2));

    // A NEWER staleness "holds" judgment lands after the review judgment.
    const stalenessJudgment = await service.record(makeStalenessJudgment(docId));
    expect(stalenessJudgment.ok).toBe(true);
    if (!stalenessJudgment.ok) return;

    // Without the store-level kind filter, this would incorrectly return the newer
    // staleness row (the actual corruption S2 named) — `latestFor` defaults to
    // kind="review", so it must still return the OLDER review judgment.
    const latest = await service.latestFor(docId);
    expect(latest.ok).toBe(true);
    if (!latest.ok) return;
    expect(latest.value?.id).toBe(reviewJudgment.value.id);
    expect(latest.value?.kind).toBe("review");
  });
});

describe("STATE — recordCalibration's not_latest_judgment check ignores staleness rows", () => {
  it("a NEWER staleness judgment does not make an older-but-still-latest-of-its-kind REVIEW judgment look stale to the calibration check", async () => {
    const { service } = makeService();
    const docId = "01ARZ3CALIBRATIONKIND001";

    const reviewJudgment = await service.record(makeReviewJudgment(docId, { doc_version: 1 }));
    expect(reviewJudgment.ok).toBe(true);
    if (!reviewJudgment.ok) return;

    await new Promise((resolve) => setTimeout(resolve, 2));

    const stalenessJudgment = await service.record(makeStalenessJudgment(docId, { doc_version: 1 }));
    expect(stalenessJudgment.ok).toBe(true);
    if (!stalenessJudgment.ok) return;

    // Calibrating the REVIEW judgment must succeed — it is still the LATEST judgment
    // of kind="review" (the newer staleness row is a different kind entirely).
    const outcome = await service.recordCalibration({
      judgment: reviewJudgment.value,
      docType: "spec",
      currentDocVersion: 1,
      humanOutcome: "confirmed",
      deltaReasons: [],
      actor: "alice",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.recorded).toBe(true);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("REGRESSION — no-kind-argument calls default to 'review' throughout (byte-identical to pre-SPEC-044)", () => {
  it("record() with NO kind key persists kind='review'", async () => {
    const { service } = makeService();
    const { kind: _omit, ...withoutKind } = makeReviewJudgment("01ARZ3NOKINDARGUMENT001");
    const recorded = await service.record(withoutKind as NewReviewJudgment);
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.value.kind).toBe("review");
  });

  it("latestFor(docId) / listFor(docId) called with NO second argument default to kind='review'", async () => {
    const { service } = makeService();
    const docId = "01ARZ3DEFAULTKINDCALL001";
    const review = await service.record(makeReviewJudgment(docId));
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    const staleness = await service.record(makeStalenessJudgment(docId));
    expect(staleness.ok).toBe(true);

    const latest = await service.latestFor(docId);
    expect(latest.ok).toBe(true);
    if (!latest.ok) return;
    expect(latest.value?.kind).toBe("review");

    const listed = await service.listFor(docId);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(1);
    expect(listed.value[0]?.kind).toBe("review");
  });

  it("S10 — a legacy row with kind:undefined (direct store.insertJudgment bypass) reads as 'review' via ?? (never strict equality)", async () => {
    const { store } = makeService();
    const docId = "01ARZ3LEGACYUNDEFKIND01";
    // reason: simulates a pre-migration-005 row / a fixture that bypasses
    // reviewJudgmentSchema entirely — the TS type allows this because `kind` is
    // OPTIONAL on ReviewJudgment (review-judgment.ts's module @invariant), not because
    // of an `as` cast.
    const legacyJudgment: ReviewJudgment = {
      id: "01ARZ3LEGACYJUDGMENTID1",
      doc_id: docId,
      doc_version: 1,
      decision: "approve",
      confidence: 0.9,
      reasons: [{ dimension: "completeness", finding: "legacy row, no kind column yet" }],
      checks: [{ check: "schema", outcome: "pass" }],
      blocking_questions: [],
      judge: { provider: "p", model: "m", prompt_version: "v1" },
      created_at: "2026-01-01T00:00:00.000Z",
      created_by: "ai:p:m:v1",
      // kind: intentionally omitted
    };
    const insertResult = await store.insertJudgment(legacyJudgment);
    expect(insertResult.ok).toBe(true);

    // Strict-equality kind filter still finds it under "review" — the `??` fallback,
    // not a stored literal "review" string.
    const foundByReviewKind = await store.findJudgments(docId, "review");
    expect(foundByReviewKind.ok).toBe(true);
    if (!foundByReviewKind.ok) return;
    expect(foundByReviewKind.value).toHaveLength(1);

    const foundByStalenessKind = await store.findJudgments(docId, "staleness");
    expect(foundByStalenessKind.ok).toBe(true);
    if (!foundByStalenessKind.ok) return;
    expect(foundByStalenessKind.value).toHaveLength(0);

    const latestUnfiltered = await store.latestJudgment(docId);
    expect(latestUnfiltered.ok).toBe(true);
    if (!latestUnfiltered.ok) return;
    expect(latestUnfiltered.value?.kind).toBeUndefined(); // stored verbatim, undefined
  });

  it("T9 (store-contract level) — repeated reads of the same legacy-shaped data are idempotent/stable (no migration side effect at the InMemoryStore layer; SQL migration-005 idempotency itself is covered by the full bun:sqlite regression suite, see file header)", async () => {
    const { store } = makeService();
    const docId = "01ARZ3IDEMPOTENTREADS001";
    const legacyJudgment: ReviewJudgment = {
      id: "01ARZ3IDEMPOTENTJUDGMENT",
      doc_id: docId,
      doc_version: 1,
      decision: "approve",
      confidence: 0.9,
      reasons: [{ dimension: "completeness", finding: "legacy" }],
      checks: [{ check: "schema", outcome: "pass" }],
      blocking_questions: [],
      judge: { provider: "p", model: "m", prompt_version: "v1" },
      created_at: "2026-01-01T00:00:00.000Z",
      created_by: "ai:p:m:v1",
    };
    await store.insertJudgment(legacyJudgment);

    const first = await store.latestJudgment(docId, "review");
    const second = await store.latestJudgment(docId, "review");
    expect(first).toEqual(second);
  });
});
