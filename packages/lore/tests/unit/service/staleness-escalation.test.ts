/**
 * Tests for SPEC-044 §Design Decisions D6/D9/D13's escalation-never-auto-invalidates
 * invariant, plus the D6 repair-command rendering (`flows/staleness-flow.ts`).
 *
 * @spec_ref SPEC-044 §Design Decisions D6, D9, D13; AC-SP-5
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a stale_candidate probe records a kind='staleness' decision='escalate'
 *               judgment row AND leaves extra.validity untouched AND the doc is still
 *               returned by search (T3 — no-op must fail this AC, positive existence
 *               oracle, not just an absence check)
 *   NEGATIVE:   n/a (covered by ERROR below)
 *   BOUNDARY:   the rendered --reason value is clipped to <=100 chars even when the
 *               judge's first reason is much longer
 *   ERROR:      an unresolvable superseded_candidate.ref never produces a broken
 *               `lore invalidate ... --superseded-by <unresolvable>` command — the base
 *               command still renders, and an unresolvedNote is returned instead
 *   STATE:      probing does NOT bump the doc's version (D13 — the escalate verdict
 *               itself is a report, not a mutation)
 *   REGRESSION: a HOLDS verdict never produces an escalate judgment / repair command
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, vi } from "vitest";
import { ok } from "@lore/core";
import type { LoreError, NewReviewJudgment, Result, StalenessBundle, Telemetry } from "@lore/core";
import type { CreateDocInput } from "@lore/core";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { StalenessProbeService, type ProbeStalenessPort } from "../../../src/service/staleness-probe-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { renderStalenessRepairCommand, type StalenessFlowDeps } from "../../../src/flows/staleness-flow.js";

function makeNoOpTelemetry(): Telemetry {
  return { record: vi.fn(), emit: vi.fn(), close: vi.fn() };
}

/** Fake probe port returning a fixed, caller-supplied verdict for every candidate. */
function makeFixedProbe(judgmentFactory: (bundle: StalenessBundle) => NewReviewJudgment): ProbeStalenessPort {
  return async (bundle: StalenessBundle): Promise<Result<NewReviewJudgment, LoreError>> => ok(judgmentFactory(bundle));
}

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
  const store = new InMemoryStore();
  const telemetry = makeNoOpTelemetry();
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const judgmentService = new JudgmentService(store, telemetry);
  return { store, corpusService, judgmentService };
}

// ─── HAPPY + STATE + REGRESSION: escalation lands without mutating the doc ──

describe("HAPPY/STATE/REGRESSION — stale_candidate probe escalates without auto-invalidating (D6/D13)", () => {
  it("a stale_candidate verdict persists a kind='staleness' decision='escalate' judgment; extra.validity and version are untouched; the doc is still searchable", async () => {
    const { store, corpusService, judgmentService } = await setup();

    const created = await corpusService.create({
      type: "knowledge",
      title: "ZzzStalenessTargetUnique",
      content: "This fact may no longer hold.",
      extra: { sub_type: "reference" },
    } as CreateDocInput);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const versionBefore = created.value.version;
    const updatedAtBefore = created.value.updated_at;

    const stalenessProbe = makeFixedProbe((bundle) => ({
      doc_id: bundle.doc.id,
      doc_version: bundle.doc.version,
      decision: "escalate",
      confidence: 0.72,
      reasons: [{ dimension: "staleness", finding: "the linked API changed shape in a later spec" }],
      checks: [],
      blocking_questions: ["has anyone re-confirmed this against the current schema?"],
      kind: "staleness",
      judge: { provider: "fake", model: "fake", prompt_version: "v1" },
    }));
    const svc = new StalenessProbeService(store, stalenessProbe, judgmentService.record.bind(judgmentService));

    const batchResult = await svc.probeBatch({ by: "agent:commissioner", limit: 5, minAgeDays: 0 });
    expect(batchResult.ok).toBe(true);
    if (!batchResult.ok) return;
    expect(batchResult.value.probes).toHaveLength(1);
    expect(batchResult.value.probes[0]?.result.ok).toBe(true);

    // T3 — POSITIVE existence oracle: the judgment row actually exists.
    const latestResult = await judgmentService.latestFor(created.value.id, "staleness");
    expect(latestResult.ok).toBe(true);
    if (!latestResult.ok) return;
    expect(latestResult.value).not.toBeNull();
    expect(latestResult.value?.kind).toBe("staleness");
    expect(latestResult.value?.decision).toBe("escalate");
    expect(latestResult.value?.doc_version).toBe(versionBefore);

    // D6/D13 — never auto-invalidates: extra.validity untouched, version/updated_at byte-identical.
    const afterResult = await corpusService.get(created.value.id);
    expect(afterResult.ok).toBe(true);
    if (!afterResult.ok) return;
    expect(afterResult.value.doc.extra["validity"]).toBeUndefined();
    expect(afterResult.value.doc.version).toBe(versionBefore);
    expect(afterResult.value.doc.updated_at).toBe(updatedAtBefore);

    // Escalation never removes the doc from search.
    const searchResult = await corpusService.search("ZzzStalenessTargetUnique");
    expect(searchResult.ok).toBe(true);
    if (!searchResult.ok) return;
    expect(searchResult.value.results.some((r) => r.id === created.value.id)).toBe(true);
  });

  it("REGRESSION: a HOLDS verdict never produces an escalate judgment", async () => {
    const { store, corpusService, judgmentService } = await setup();
    const created = await corpusService.create({
      type: "adr",
      title: "ZzzStalenessHoldsTarget",
      content: "Still accurate.",
      extra: { decision_status: "accepted" },
    } as CreateDocInput);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const holdsProbe = makeFixedProbe((bundle) => ({
      doc_id: bundle.doc.id,
      doc_version: bundle.doc.version,
      decision: "approve",
      confidence: 0.95,
      reasons: [{ dimension: "staleness", finding: "still holds" }],
      checks: [],
      blocking_questions: [],
      kind: "staleness",
      judge: { provider: "fake", model: "fake", prompt_version: "v1" },
    }));
    const svc = new StalenessProbeService(store, holdsProbe, judgmentService.record.bind(judgmentService));
    const batchResult = await svc.probeBatch({ by: "agent:commissioner", limit: 5, minAgeDays: 0 });
    expect(batchResult.ok).toBe(true);
    if (!batchResult.ok) return;

    const latestResult = await judgmentService.latestFor(created.value.id, "staleness");
    expect(latestResult.ok).toBe(true);
    if (!latestResult.ok) return;
    expect(latestResult.value?.decision).toBe("approve");
  });
});

// ─── D6 repair-command rendering ─────────────────────────────────────────────

describe("D6 — renderStalenessRepairCommand", () => {
  it("HAPPY: names the probed doc's own slug and clips --reason to <=100 chars (BOUNDARY)", async () => {
    const { corpusService, judgmentService } = await setup();
    const created = await corpusService.create({
      type: "knowledge",
      title: "ZzzRepairCommandTarget",
      content: "body",
      extra: { sub_type: "reference" },
    } as CreateDocInput);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const longReason = "x".repeat(250);
    const judgment = {
      id: "j1",
      doc_id: created.value.id,
      doc_version: created.value.version,
      decision: "escalate" as const,
      confidence: 0.8,
      reasons: [{ dimension: "staleness", finding: longReason }],
      checks: [],
      blocking_questions: ["still true?"],
      kind: "staleness" as const,
      judge: { provider: "fake", model: "fake", prompt_version: "v1" },
      created_at: new Date().toISOString(),
      created_by: "ai:fake:fake:v1",
    };

    const deps = buildTestFlowDeps(corpusService, judgmentService);
    const rendering = await renderStalenessRepairCommand(deps, { slug: created.value.slug }, judgment);

    expect(rendering.command.startsWith(`lore invalidate ${created.value.slug} --reason "`)).toBe(true);
    expect(rendering.command).not.toContain(longReason);
    // 100-char budget + the "…" clip marker, per clipTextToBudget's contract.
    const reasonMatch = /--reason "([^"]*)"/.exec(rendering.command);
    expect(reasonMatch?.[1]?.length).toBeLessThanOrEqual(100);
    expect(rendering.unresolvedNote).toBeUndefined();
  });

  it("HAPPY: appends --superseded-by <slug> when the nominated ref resolves", async () => {
    const { corpusService, judgmentService } = await setup();
    const oldDoc = await corpusService.create({
      type: "knowledge",
      title: "ZzzOldFact",
      content: "body",
      extra: { sub_type: "reference" },
    } as CreateDocInput);
    const newDoc = await corpusService.create({
      type: "knowledge",
      title: "ZzzNewFact",
      content: "body",
      extra: { sub_type: "reference" },
    } as CreateDocInput);
    expect(oldDoc.ok && newDoc.ok).toBe(true);
    if (!oldDoc.ok || !newDoc.ok) return;

    const judgment = {
      id: "j2",
      doc_id: oldDoc.value.id,
      doc_version: oldDoc.value.version,
      decision: "escalate" as const,
      confidence: 0.9,
      reasons: [{ dimension: "staleness", finding: "superseded" }],
      checks: [],
      blocking_questions: ["confirm?"],
      superseded_candidate: { ref: newDoc.value.slug, reason: "replaced by the new fact" },
      kind: "staleness" as const,
      judge: { provider: "fake", model: "fake", prompt_version: "v1" },
      created_at: new Date().toISOString(),
      created_by: "ai:fake:fake:v1",
    };

    const deps = buildTestFlowDeps(corpusService, judgmentService);
    const rendering = await renderStalenessRepairCommand(deps, { slug: oldDoc.value.slug }, judgment);

    expect(rendering.command).toBe(
      `lore invalidate ${oldDoc.value.slug} --reason "superseded" --superseded-by ${newDoc.value.slug}`,
    );
    expect(rendering.unresolvedNote).toBeUndefined();
  });

  it("ERROR: an unresolvable superseded_candidate.ref never produces a broken command — base command still renders, unresolvedNote is set", async () => {
    const { corpusService, judgmentService } = await setup();
    const created = await corpusService.create({
      type: "adr",
      title: "ZzzUnresolvableRefTarget",
      content: "body",
      extra: { decision_status: "accepted" },
    } as CreateDocInput);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const judgment = {
      id: "j3",
      doc_id: created.value.id,
      doc_version: created.value.version,
      decision: "escalate" as const,
      confidence: 0.6,
      reasons: [{ dimension: "staleness", finding: "possibly superseded" }],
      checks: [],
      blocking_questions: ["confirm?"],
      superseded_candidate: { ref: "adr-does-not-exist-anywhere", reason: "guessed replacement" },
      kind: "staleness" as const,
      judge: { provider: "fake", model: "fake", prompt_version: "v1" },
      created_at: new Date().toISOString(),
      created_by: "ai:fake:fake:v1",
    };

    const deps = buildTestFlowDeps(corpusService, judgmentService);
    const rendering = await renderStalenessRepairCommand(deps, { slug: created.value.slug }, judgment);

    // Base command (naming the ALWAYS-valid probed doc) still renders, WITHOUT
    // --superseded-by (never a broken command naming a doc that doesn't exist).
    expect(rendering.command).toBe(`lore invalidate ${created.value.slug} --reason "possibly superseded"`);
    expect(rendering.command).not.toContain("--superseded-by");
    expect(rendering.unresolvedNote).toBeDefined();
    expect(rendering.unresolvedNote).toContain("adr-does-not-exist-anywhere");
  });
});
