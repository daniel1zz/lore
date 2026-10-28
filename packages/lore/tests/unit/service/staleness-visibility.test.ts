/**
 * Tests for SPEC-044 §Design Decisions D14 — session-surface visibility
 * (`lore status`/`lore bootstrap` gain `open_stale_candidates`, computed by the SAME
 * `listFreshStalenessEscalates` query `--list` uses — ONE derivation site, mirroring
 * SPEC-043's `computeArmedGates` precedent).
 *
 * @spec_ref SPEC-044 §Design Decisions D14; AC-SP-12
 *
 * This suite tests `listFreshStalenessEscalates` (`flows/staleness-flow.ts`) directly —
 * the single derivation site `commands/status.ts`, `commands/bootstrap.ts`, and the
 * `lore_status`/`lore_bootstrap` MCP tools all call — rather than re-testing CLI/MCP
 * wiring (that plumbing is a thin `.length` splice, covered structurally by the
 * cli-staleness.bun.test.ts spawned-CLI suite for the CLI side).
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a fresh stale_candidate escalate is counted
 *   NEGATIVE:   a doc with no staleness judgment at all is NOT counted
 *   BOUNDARY:   a `holds` (approve) judgment is NOT counted (only `escalate` counts)
 *   ERROR:      a store failure during listByType propagates as err(), never silently
 *               drops to a false-zero count
 *   STATE:      count DROPS to zero after the flagged doc is edited (version bump via
 *               a plain corpus update) — the judgment's doc_version now trails
 *   REGRESSION: count ALSO drops to zero after a re-probe records a fresh `holds`
 *               verdict (a later "holds" naturally supersedes the earlier escalate as
 *               the doc's LATEST staleness judgment) — single-derivation-site parity
 *               with `--list`'s own freshness rule, not a second reimplementation
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { NoOpTelemetry, ok, err } from "@lore/core";
import type { CreateDocInput, DocId, DocRecord, DocType, LoreError, NewReviewJudgment, Result, ReviewJudgment } from "@lore/core";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { listFreshStalenessEscalates, type StalenessFlowDeps } from "../../../src/flows/staleness-flow.js";
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

async function recordStalenessJudgment(
  judgmentService: JudgmentService,
  docId: DocId,
  docVersion: number,
  decision: "approve" | "escalate",
): Promise<ReviewJudgment> {
  const newJudgment: NewReviewJudgment = {
    doc_id: docId,
    doc_version: docVersion,
    decision,
    confidence: 0.8,
    reasons: [{ dimension: "staleness", finding: decision === "escalate" ? "possibly stale" : "still holds" }],
    checks: [],
    blocking_questions: decision === "escalate" ? ["confirm?"] : [],
    kind: "staleness",
    judge: { provider: "fake", model: "fake", prompt_version: "v1" },
  };
  const result = await judgmentService.record(newJudgment);
  if (!result.ok) throw new Error(`record failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

// ─── HAPPY / NEGATIVE / BOUNDARY ──────────────────────────────────────────────

describe("listFreshStalenessEscalates — HAPPY/NEGATIVE/BOUNDARY", () => {
  it("counts a fresh stale_candidate escalate; ignores docs with no judgment; ignores holds verdicts", async () => {
    const { corpusService, judgmentService } = await setup();

    const escalated = await corpusService.create({
      parent_id: await ensureRequirementsDocId(corpusService), type: "knowledge",
      title: "ZzzVisibilityEscalated",
      content: "body",
      extra: { sub_type: "reference" },
    } as CreateDocInput);
    const unprobed = await corpusService.create({
      parent_id: await ensureRequirementsDocId(corpusService), type: "knowledge",
      title: "ZzzVisibilityUnprobed",
      content: "body",
      extra: { sub_type: "reference" },
    } as CreateDocInput);
    const heldDoc = await corpusService.create({
      parent_id: await ensureRequirementsDocId(corpusService), type: "adr",
      title: "ZzzVisibilityHolds",
      content: "body",
      extra: { decision_status: "accepted" },
    } as CreateDocInput);
    expect(escalated.ok && unprobed.ok && heldDoc.ok).toBe(true);
    if (!escalated.ok || !unprobed.ok || !heldDoc.ok) return;

    await recordStalenessJudgment(judgmentService, escalated.value.id, escalated.value.version, "escalate");
    await recordStalenessJudgment(judgmentService, heldDoc.value.id, heldDoc.value.version, "approve");
    // unprobed: no staleness judgment at all.

    const deps = buildTestFlowDeps(corpusService, judgmentService);
    const result = await listFreshStalenessEscalates(deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.doc.id).toBe(escalated.value.id);
  });
});

// ─── ERROR: store failure propagates ─────────────────────────────────────────

describe("listFreshStalenessEscalates — ERROR (store failure propagates, never a silent false-zero)", () => {
  it("a listByType failure returns err(), not an empty ok([])", async () => {
    const forcedError: LoreError = { code: "STORE_ERROR", message: "forced failure (test)" };
    const deps: StalenessFlowDeps = {
      listByType: async (_type: DocType): Promise<Result<DocRecord[], LoreError>> => err(forcedError),
      latestStalenessJudgment: async () => ok(null),
      resolveSlug: async () => err({ code: "DOC_NOT_FOUND", id: "x", suggestions: [] }),
    };

    const result = await listFreshStalenessEscalates(deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");
  });
});

// ─── STATE: count drops after the flagged doc is edited ─────────────────────

describe("listFreshStalenessEscalates — STATE (count drops on edit, D14)", () => {
  it("an edit bumps the doc's version past the escalate judgment's doc_version, dropping it off the list", async () => {
    const { store, corpusService, judgmentService } = await setup();

    const doc = await corpusService.create({
      parent_id: await ensureRequirementsDocId(corpusService), type: "knowledge",
      title: "ZzzVisibilityEditDrops",
      content: "body",
      extra: { sub_type: "reference" },
    } as CreateDocInput);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;

    await recordStalenessJudgment(judgmentService, doc.value.id, doc.value.version, "escalate");

    const deps = buildTestFlowDeps(corpusService, judgmentService);
    const before = await listFreshStalenessEscalates(deps);
    expect(before.ok).toBe(true);
    if (before.ok) expect(before.value).toHaveLength(1);

    // Bump the doc's version directly (mirrors CorpusService.set's own version-bump
    // mechanics, without needing the full set() lifecycle machinery here).
    const bumped = await store.update(doc.value.id, { version: doc.value.version + 1 });
    expect(bumped.ok).toBe(true);

    const after = await listFreshStalenessEscalates(deps);
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value).toHaveLength(0);
  });
});

// ─── REGRESSION: count drops after a re-probe records a fresh holds ─────────

describe("listFreshStalenessEscalates — REGRESSION (re-probe to holds also drops the count, single-derivation-site parity)", () => {
  it("a later 'holds' verdict becomes the doc's LATEST staleness judgment, dropping the earlier escalate off the list", async () => {
    const { corpusService, judgmentService } = await setup();

    const doc = await corpusService.create({
      parent_id: await ensureRequirementsDocId(corpusService), type: "adr",
      title: "ZzzVisibilityReprobeDrops",
      content: "body",
      extra: { decision_status: "accepted" },
    } as CreateDocInput);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;

    await recordStalenessJudgment(judgmentService, doc.value.id, doc.value.version, "escalate");

    const deps = buildTestFlowDeps(corpusService, judgmentService);
    const before = await listFreshStalenessEscalates(deps);
    expect(before.ok).toBe(true);
    if (before.ok) expect(before.value).toHaveLength(1);

    // reason: JudgmentService.record stamps created_at from the wall clock with no
    // nowIso injection seam — a 2ms gap guarantees the second row's created_at strictly
    // exceeds the first's, so "latest" ordering is unambiguous (millisecond-resolution
    // ISO timestamps can otherwise tie within the same test tick).
    await new Promise((resolve) => setTimeout(resolve, 2));

    // Re-probe to "holds" — SAME doc_version (no edit happened), but this judgment is
    // now the LATEST kind="staleness" row, and its decision is "approve".
    await recordStalenessJudgment(judgmentService, doc.value.id, doc.value.version, "approve");

    const after = await listFreshStalenessEscalates(deps);
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value).toHaveLength(0);
  });
});
