/**
 * Tests for StalenessProbeService (SPEC-044 §Design Decisions D4, D13) — batch
 * orchestration for `lore review --staleness`. Uses InMemoryStore + a stubbed
 * `probeStaleness` port (the AI-provider prompt/parse contract is AC-SP-4's own test
 * file, not re-tested here) + a REAL `JudgmentService.record` port (so audit-row/
 * doc-mutation invariants are exercised against the real persistence path).
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      probeBatch records ONE judgment + ONE audit row per candidate
 *               (action='staleness_probe', actor=commissioning `by`, details.version
 *               present); candidate order in the result matches the pure layer's sort
 *   NEGATIVE:   a candidate list containing zero eligible docs returns an empty
 *               probes[] with total_candidates=0, not an error
 *   BOUNDARY:   assembly issues EXACTLY ONE countLinksByToIds + ONE
 *               latestJudgmentsByDocIds call per batch regardless of candidate count
 *               (counting-subclass store oracle, FlakyLinkStore precedent)
 *   ERROR:      a per-candidate probeStaleness failure is collected into that
 *               candidate's outcome (collect-and-continue), never aborts the batch —
 *               a SUBSEQUENT candidate still gets probed and recorded
 *   STATE:      D13 — the probed doc's version AND updated_at are BYTE-IDENTICAL
 *               before/after a probe (no version bump, no extra mutation)
 *   REGRESSION: the staleness_probe audit action is excluded from
 *               VERSION_ACTION_AUDIT_FAMILY — AuditService.verify() stays clean
 *               despite the staleness_probe entry sharing a (doc_id, version) pair
 *               with a real `create` versions row
 *
 * @spec_ref SPEC-044 §Design Decisions D1, D2, D4, D9, D13; AC-SP-3
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, vi } from "vitest";
import { ok } from "@lore/core";
import type {
  DocId,
  LoreError,
  NewReviewJudgment,
  Result,
  ReviewJudgment,
  StalenessBundle,
  Telemetry,
} from "@lore/core";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { AuditService } from "../../../src/service/audit-service.js";
import { StalenessProbeService, type ProbeStalenessPort } from "../../../src/service/staleness-probe-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import type { CreateDocInput } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

// ─── Test Doubles ───────────────────────────────────────────────────────────

/** Counting subclass — asserts batch-call-count invariants (mirrors FlakyLinkStore precedent, validity-service.test.ts). */
class CountingStore extends InMemoryStore {
  countLinksByToIdsCallCount = 0;
  latestJudgmentsByDocIdsCallCount = 0;

  override async countLinksByToIds(toIds: DocId[]) {
    this.countLinksByToIdsCallCount += 1;
    return super.countLinksByToIds(toIds);
  }

  override async latestJudgmentsByDocIds(docIds: DocId[], kind: "review" | "staleness") {
    this.latestJudgmentsByDocIdsCallCount += 1;
    return super.latestJudgmentsByDocIds(docIds, kind);
  }
}

function makeNoOpTelemetry(): Telemetry {
  return { record: vi.fn(), emit: vi.fn(), close: vi.fn() };
}

/** Always-holds fake probe — deterministic, no AI call. */
function makeHoldsProbe(): ProbeStalenessPort {
  return async (bundle: StalenessBundle): Promise<Result<NewReviewJudgment, LoreError>> =>
    ok({
      doc_id: bundle.doc.id,
      doc_version: bundle.doc.version,
      decision: "approve",
      confidence: 0.9,
      reasons: [{ dimension: "staleness", finding: "still true" }],
      checks: [],
      blocking_questions: [],
      kind: "staleness",
      judge: { provider: "fake", model: "fake", prompt_version: "v1" },
    });
}

/** Fails for a specific doc id, holds for everything else — ERROR-dimension fixture. */
function makeSelectiveFailProbe(failDocId: DocId): ProbeStalenessPort {
  return async (bundle: StalenessBundle): Promise<Result<NewReviewJudgment, LoreError>> => {
    if (bundle.doc.id === failDocId) {
      return { ok: false, error: { code: "AI_PROVIDER_ERROR", provider: "fake", message: "forced failure (test)" } };
    }
    return makeHoldsProbe()(bundle);
  };
}

async function createAndBackdate(
  cs: CorpusService,
  store: InMemoryStore,
  type: "knowledge" | "adr",
  title: string,
  daysAgo: number,
): Promise<{ id: DocId; version: number; updated_at: string }> {
  const extra = type === "knowledge" ? { sub_type: "ideation" } : { decision_status: "accepted" };
  const created = await cs.create({ type, title, content: "body", extra } as CreateDocInput);
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created.error)}`);
  const oldIso = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const updated = await store.update(created.value.id, { updated_at: oldIso });
  if (!updated.ok) throw new Error(`backdate failed: ${JSON.stringify(updated.error)}`);
  return { id: created.value.id, version: updated.value.version, updated_at: updated.value.updated_at };
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("HAPPY — probeBatch records one judgment + one audit row per candidate", () => {
  it("action='staleness_probe', actor=commissioning by, details.version present; candidate order matches the pure layer's sort", async () => {
    const store = actedStore(new CountingStore());
    const telemetry = makeNoOpTelemetry();
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const judgmentService = new JudgmentService(store, telemetry);

    const low = await createAndBackdate(corpusService, store, "knowledge", "Low priority K", 20);
    const high = await createAndBackdate(corpusService, store, "adr", "High priority A", 20);
    // Give `high` more incoming links so it sorts first (in_degree=2 vs 0).
    await store.addLink({ from_id: low.id, to_id: high.id, link_type: "relates-to", created_at: new Date().toISOString(), created_by: "test" });
    await store.addLink({ from_id: low.id, to_id: high.id, link_type: "informs", created_at: new Date().toISOString(), created_by: "test" });

    const svc = new StalenessProbeService(store, makeHoldsProbe(), judgmentService.record.bind(judgmentService));

    const result = await svc.probeBatch({ by: "agent:commissioner", limit: 10, minAgeDays: 14 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.probes).toHaveLength(2);
    // `high` has in_degree=2, `low` has in_degree=0 -- high sorts first.
    expect(result.value.probes[0]?.doc.id).toBe(high.id);
    expect(result.value.probes[1]?.doc.id).toBe(low.id);

    for (const probe of result.value.probes) {
      expect(probe.result.ok).toBe(true);
      if (!probe.result.ok) continue;
      expect(probe.result.judgment.kind).toBe("staleness");

      const auditResult = await store.queryAudit({ doc_id: probe.doc.id, action: "staleness_probe" });
      expect(auditResult.ok).toBe(true);
      if (!auditResult.ok) continue;
      expect(auditResult.value).toHaveLength(1);
      expect(auditResult.value[0]?.actor).toBe("agent:commissioner");
      expect(auditResult.value[0]?.details?.["version"]).toBeDefined();
    }
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("NEGATIVE — no eligible docs returns an empty result, not an error", () => {
  it("an empty corpus produces probes=[] and total_candidates=0", async () => {
    const store = actedStore(new CountingStore());
    const telemetry = makeNoOpTelemetry();
    const judgmentService = new JudgmentService(store, telemetry);
    const svc = new StalenessProbeService(store, makeHoldsProbe(), judgmentService.record.bind(judgmentService));

    const result = await svc.probeBatch({ by: "agent:commissioner", limit: 10, minAgeDays: 14 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.probes).toEqual([]);
    expect(result.value.total_candidates).toBe(0);
  });
});

// ─── BOUNDARY (call-count oracle) ───────────────────────────────────────────

describe("BOUNDARY — assembly issues EXACTLY ONE countLinksByToIds + ONE latestJudgmentsByDocIds call per batch", () => {
  it("regardless of candidate count (3 candidates -> still exactly 1 + 1 calls)", async () => {
    const store = actedStore(new CountingStore());
    const telemetry = makeNoOpTelemetry();
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const judgmentService = new JudgmentService(store, telemetry);

    await createAndBackdate(corpusService, store, "knowledge", "K1", 20);
    await createAndBackdate(corpusService, store, "knowledge", "K2", 20);
    await createAndBackdate(corpusService, store, "adr", "A1", 20);

    const svc = new StalenessProbeService(store, makeHoldsProbe(), judgmentService.record.bind(judgmentService));
    const result = await svc.probeBatch({ by: "agent:commissioner", limit: 10, minAgeDays: 14 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.probes).toHaveLength(3);

    expect(store.countLinksByToIdsCallCount).toBe(1);
    expect(store.latestJudgmentsByDocIdsCallCount).toBe(1);
  });
});

// ─── ERROR (collect-and-continue) ───────────────────────────────────────────

describe("ERROR — a per-candidate probeStaleness failure is collected, never aborts the batch", () => {
  it("a failing candidate's outcome carries the error; a SUBSEQUENT candidate still gets probed and recorded", async () => {
    const store = actedStore(new CountingStore());
    const telemetry = makeNoOpTelemetry();
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const judgmentService = new JudgmentService(store, telemetry);

    const willFail = await createAndBackdate(corpusService, store, "knowledge", "Will fail K", 20);
    const willSucceed = await createAndBackdate(corpusService, store, "knowledge", "Will succeed K", 20);

    const svc = new StalenessProbeService(
      store,
      makeSelectiveFailProbe(willFail.id),
      judgmentService.record.bind(judgmentService),
    );
    const result = await svc.probeBatch({ by: "agent:commissioner", limit: 10, minAgeDays: 14 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.probes).toHaveLength(2);

    const failed = result.value.probes.find((p) => p.doc.id === willFail.id);
    const succeeded = result.value.probes.find((p) => p.doc.id === willSucceed.id);
    expect(failed?.result.ok).toBe(false);
    expect(succeeded?.result.ok).toBe(true);
  });
});

// ─── STATE (D13 — doc never mutated) ────────────────────────────────────────

describe("STATE — D13: the probed doc's version AND updated_at are byte-identical before/after a probe", () => {
  it("no version bump, no extra mutation, no status transition", async () => {
    const store = actedStore(new CountingStore());
    const telemetry = makeNoOpTelemetry();
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const judgmentService = new JudgmentService(store, telemetry);

    const doc = await createAndBackdate(corpusService, store, "knowledge", "Immutable K", 20);
    const before = await store.find(doc.id);
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    const svc = new StalenessProbeService(store, makeHoldsProbe(), judgmentService.record.bind(judgmentService));
    const result = await svc.probeBatch({ by: "agent:commissioner", limit: 10, minAgeDays: 14 });
    expect(result.ok).toBe(true);

    const after = await store.find(doc.id);
    expect(after.ok).toBe(true);
    if (!after.ok || !before.ok) return;
    expect(after.value?.version).toBe(before.value?.version);
    expect(after.value?.updated_at).toBe(before.value?.updated_at);
    expect(after.value?.status).toBe(before.value?.status);
    expect(after.value?.extra).toEqual(before.value?.extra);
  });
});

// ─── REGRESSION (audit family exclusion) ────────────────────────────────────

describe("REGRESSION — staleness_probe audit action is excluded from VERSION_ACTION_AUDIT_FAMILY", () => {
  it("AuditService.verify() stays clean despite a staleness_probe entry sharing (doc_id, version) with a real create versions row", async () => {
    const store = actedStore(new CountingStore());
    const telemetry = makeNoOpTelemetry();
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const judgmentService = new JudgmentService(store, telemetry);
    const auditService = new AuditService(store);

    await createAndBackdate(corpusService, store, "knowledge", "Audit family K", 20);

    const svc = new StalenessProbeService(store, makeHoldsProbe(), judgmentService.record.bind(judgmentService));
    const result = await svc.probeBatch({ by: "agent:commissioner", limit: 10, minAgeDays: 14 });
    expect(result.ok).toBe(true);

    const verifyResult = await auditService.verify();
    expect(verifyResult.ok).toBe(true);
    if (!verifyResult.ok) return;
    expect(verifyResult.value.clean).toBe(true);
    expect(verifyResult.value.misses).toEqual([]);
  });
});
