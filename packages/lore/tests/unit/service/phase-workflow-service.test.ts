/**
 * RED suite (TDD-Role: red, paired-impl task
 * task-skill-implement-phaseworkflowservice-rename-checkpoint-conf) for
 * `PhaseWorkflowService` (`packages/lore/src/service/phase-workflow-service.ts`
 * — does NOT exist yet). Covers AC-P-3
 * (spec-spec-056-phase-execution-model-phase-doc-type-computed-comp): claim /
 * release / evidence / ready on phase docs (`doc.type === "phase"`), field
 * shapes carried from SPEC-025/SPEC-042 verbatim, plus the legacy task
 * READ-tolerance branch (D2).
 *
 * NAMING COLLISION WARNING (T3 grep-sweep finding, repeated here per the
 * paired implement task's own doc): `packages/lore/src/service/phase-service.ts`
 * ALREADY EXISTS (SPEC-023, `lore phase add/list/rm/rename` — `plan.extra.phases`
 * CRUD, an unrelated concept). This file's subject is the NEW
 * `phase-workflow-service.ts` (the SPEC-025/042 claim/evidence/ready mechanics,
 * generalized off `TaskWorkflowService`) — do not confuse the two.
 *
 * RED mechanism (see `knowledge-spec-058-execution-learnings-init-seeding-
 * yaml-trap-co` §2 — this repo's documented technique for a RED task paired
 * with a concurrent implement task in a separate worktree): the module under
 * test is loaded via a dynamic `import()` whose specifier is a COMPUTED
 * (non-literal) string built from an array `.join("/")`. TypeScript only
 * performs static module resolution against `import()` calls with a STRING
 * LITERAL argument, so `bun run typecheck` stays green today (before
 * `phase-workflow-service.ts` exists) AND after it lands, with zero edits to
 * this file either way. At runtime today the import genuinely throws ("Cannot
 * find module") inside `beforeAll`, which vitest reports as every `it` in
 * this file failing due to a failed hook — the "import errors against
 * not-yet-existing modules" RED mode this task's AC calls for.
 *
 * CONTRACT NOTE (this file is the authoritative shape the paired implement
 * task must satisfy — resolves every ambiguity SPEC-056 §Design Decisions D2
 * leaves open; follows T1's `phase-completion.test.ts`/`phase-scope-freeze.
 * test.ts` CONTRACT NOTE precedent):
 *
 *   §1 Public surface is `TaskWorkflowService` generalized+renamed, SCOPED to
 *      claim/release/evidence/ready ONLY (checklist/track split to a separate
 *      `PhaseChecklistService`, a different task in this plan) — constructor
 *      signature `(store, telemetry?, config: {claimTtlMinutes}, resolveDeclaredAcIds?,
 *      gate?)`, byte-identical parameter shape to `TaskWorkflowService`'s
 *      existing constructor (verified by reading `task-workflow-service.ts`).
 *      Method signatures reuse the EXACT SPEC-025/042 option types
 *      (`ClaimOpts`/`ReleaseOpts`/`EvidenceInput`/`ReadyReport`/`AnchorConflict`)
 *      — this file imports those types directly from the (still-existing,
 *      pre-rename) `task-workflow-service.ts` module rather than redeclaring
 *      them, proving "field shapes carried over VERBATIM" structurally, not
 *      just by prose claim.
 *
 *   §2 `ready()`'s per-record shape stays `ReadyRecord` from `@lore/core`
 *      (`task-workflow.ts`) UNCHANGED, including the field literally named
 *      `.task` (a `DocSummary`) — `evaluateReadiness`/`deriveSessions` (the
 *      `@lore/core` pure functions both `ready()` implementations call) are
 *      themselves already doc-type-agnostic (operate on plain `DocRecord[]`,
 *      read `extra.claim`/`extra.verification_evidence` generically — verified
 *      by reading `task-workflow.ts`/`session.ts`). Renaming `.task` to
 *      `.phase` on the SHARED `@lore/core` type would ripple into every other
 *      `ReadyRecord` consumer (CLI `lore ready`, `lore tree` badges, MCP
 *      `lore_ready`) for zero behavioral gain — out of this task's scope, not
 *      assumed here.
 *
 *   §3 Legacy task READ tolerance (D2): `ready(planId)` over a plan holding a
 *      plain `type: "task"` doc (no migration has run) still returns a
 *      `ReadyRecord` for it — proving the read path tolerates the OLD type
 *      literal without requiring `PhaseMigrationService` to have run first.
 *      `claim()`/`release()`/`addEvidence()` targeting that SAME task-typed doc
 *      id are REFUSED with a typed `VALIDATION_ERROR` (write paths do NOT
 *      extend the tolerance) — this is the load-bearing asymmetry D2 names
 *      ("legacy task READ tolerance with a DEDICATED read-path unit fixture").
 *
 *   §4 Phase docs are constructed via raw `store.insert(...)` (InMemoryStore),
 *      never `CorpusService.create` — `type: "phase"` is not wired into
 *      `schemas.ts` yet (T1's documented deferral). Every raw phase
 *      `DocRecord` literal below casts `type: "phase" as unknown as DocType`.
 *
 *   §5 The service-layer anchor-overlap gate integration (mirrors
 *      `claim-anchor-gate.test.ts`'s second describe block, but end-to-end
 *      on phase docs) asserts the blocked field is literally
 *      `"gate:phase-claim:anchor-overlap"` — `GateEnforcer.enforce`'s existing
 *      `gate:<checkpoint>:<field>` composition is unchanged; only the
 *      checkpoint-id segment moves from `"task-claim"` to `"phase-claim"`
 *      (companion assertion to `phase-claim-gate.test.ts` §3, which only
 *      reaches the pure/checkpoint-agnostic layer).
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      claim → evidence → release → ready round-trip on a phase doc
 *   NEGATIVE:   foreign fresh claim on a phase doc → CLAIM_CONFLICT; claim/
 *               release/evidence write paths on a legacy TASK doc → refused
 *   BOUNDARY:   claim TTL staleness boundary (mirrors TaskWorkflowService)
 *   ERROR:      claim on a non-existent id → DOC_NOT_FOUND
 *   STATE:      ready()'s derived `sessions[]` groups a fresh phase claim
 *               (deriveSessions is doc-type-agnostic, per §2)
 *   REGRESSION: legacy task doc renders in `ready()` (READ tolerance, §3);
 *               the anchor-overlap gate's blocked field renames to
 *               "gate:phase-claim:anchor-overlap" (§5)
 *
 * Source: spec-spec-056-phase-execution-model-phase-doc-type-computed-comp
 *   §Public Interface, §Design Decisions D1, D2, D5; §Acceptance Criteria AC-P-3.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import type { GateDependencies } from "../../../src/service/gate-enforcer.js";
import type {
  ClaimOpts,
  ReleaseOpts,
  EvidenceInput,
  ReadyReport,
} from "../../../src/service/task-workflow-service.js";
import { NoOpTelemetry } from "@lore/core";
import type { DocRecord, DocType, Result, LoreError, Telemetry } from "@lore/core";

// packages/lore/tests/unit/service/ -> ../../../ -> packages/lore/ ->
// src/service/phase-workflow-service.js (does not exist yet)
const PHASE_WORKFLOW_SERVICE_MODULE_PATH = [
  "..",
  "..",
  "..",
  "src",
  "service",
  "phase-workflow-service.js",
].join("/");

interface PhaseWorkflowServiceInstance {
  claim(idOrSlug: string, opts: ClaimOpts, now?: () => string): Promise<Result<DocRecord, LoreError>>;
  release(idOrSlug: string, opts: ReleaseOpts, now?: () => string): Promise<Result<DocRecord, LoreError>>;
  addEvidence(
    idOrSlug: string,
    entry: EvidenceInput,
    now?: () => string,
  ): Promise<Result<DocRecord, LoreError>>;
  ready(planIdOrSlug: string, now?: () => string): Promise<Result<ReadyReport, LoreError>>;
}

interface PhaseWorkflowServiceCtor {
  new (
    store: StoreInterface,
    telemetry?: Telemetry,
    config?: { claimTtlMinutes: number },
    resolveDeclaredAcIds?: (planId: string) => Promise<Result<Set<string> | null, LoreError>>,
    gate?: GateDependencies,
  ): PhaseWorkflowServiceInstance;
}

interface PhaseWorkflowServiceModule {
  PhaseWorkflowService: PhaseWorkflowServiceCtor;
}

let mod: PhaseWorkflowServiceModule;

beforeAll(async () => {
  mod = (await import(PHASE_WORKFLOW_SERVICE_MODULE_PATH)) as unknown as PhaseWorkflowServiceModule;
});

// ─── Fixtures (mirrors task-workflow-service.test.ts's makeServices shape) ───

function makeServices(ttl = 120, gate?: GateDependencies) {
  const store = new InMemoryStore();
  const service = new mod.PhaseWorkflowService(store, new NoOpTelemetry(), { claimTtlMinutes: ttl }, undefined, gate);
  return { store, service };
}

/** A minimal, valid, raw `phase` DocRecord — see module CONTRACT NOTE §4. */
function makePhaseRecord(overrides: Partial<DocRecord> = {}): DocRecord {
  const base: DocRecord = {
    id: "01HPHASE00000000000000001",
    slug: "phase-one",
    type: "phase" as unknown as DocType,
    role: "plan",
    title: "Phase One",
    status: "draft",
    priority: "medium",
    content: "# Phase One",
    parent_id: "01HPLAN000000000000000000",
    created_at: "2026-07-19T00:00:00.000Z",
    updated_at: "2026-07-19T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { plan_id: "01HPLAN000000000000000000" },
  };
  return { ...base, ...overrides, extra: { ...base.extra, ...overrides.extra } };
}

/** A minimal, valid, raw `plan` DocRecord (parent of the phase fixtures). */
function makePlanRecord(overrides: Partial<DocRecord> = {}): DocRecord {
  const base: DocRecord = {
    id: "01HPLAN000000000000000000",
    slug: "plan-one",
    type: "plan",
    role: "plan",
    title: "Plan One",
    status: "approved",
    priority: "medium",
    content: "# Plan One",
    parent_id: null,
    created_at: "2026-07-19T00:00:00.000Z",
    updated_at: "2026-07-19T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
  };
  return { ...base, ...overrides };
}

async function mustInsert(store: InMemoryStore, doc: DocRecord): Promise<DocRecord> {
  const result = await store.insert(doc);
  if (!result.ok) throw new Error(`insert failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

// ─── HAPPY: claim → evidence → release → ready round-trip on a phase doc ────

describe("PhaseWorkflowService — HAPPY: claim/evidence/release/ready round-trip on a phase doc", () => {
  it("claims a phase doc, records evidence, releases it, and ready() reflects the final state", async () => {
    const { store, service } = makeServices();
    await mustInsert(store, makePlanRecord());
    await mustInsert(store, makePhaseRecord());

    const claimed = await service.claim("phase-one", { by: "agent:p1" });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.value.extra["claim"]).toMatchObject({ by: "agent:p1" });

    const evidenced = await service.addEvidence("phase-one", {
      oracle: "test",
      command: "bun test",
      result: "pass",
      recorded_by: "agent:p1",
    });
    expect(evidenced.ok).toBe(true);
    if (!evidenced.ok) return;
    expect(Array.isArray(evidenced.value.extra["verification_evidence"])).toBe(true);

    const released = await service.release("phase-one", { by: "agent:p1" });
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(released.value.extra["claim"]).toBeUndefined();

    const ready = await service.ready("plan-one");
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(ready.value.records).toHaveLength(1);
    expect(ready.value.records[0]?.task.slug).toBe("phase-one");
    expect(ready.value.records[0]?.evidence_count).toBe(1);
  });
});

// ─── NEGATIVE: foreign fresh claim conflict ──────────────────────────────────

describe("PhaseWorkflowService — NEGATIVE: claim conflicts", () => {
  it("a fresh claim held by someone else is not overridable without --steal", async () => {
    const { store, service } = makeServices();
    await mustInsert(store, makePlanRecord());
    await mustInsert(store, makePhaseRecord());

    const first = await service.claim("phase-one", { by: "agent:p1" });
    expect(first.ok).toBe(true);

    const second = await service.claim("phase-one", { by: "agent:p2" });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("CLAIM_CONFLICT");
  });
});

// ─── BOUNDARY: TTL staleness boundary ────────────────────────────────────────

describe("PhaseWorkflowService — BOUNDARY: claim TTL staleness", () => {
  it("a claim exactly at the TTL boundary is still fresh; one minute past is stale and reclaimable", async () => {
    const { store, service } = makeServices(60);
    await mustInsert(store, makePlanRecord());
    await mustInsert(store, makePhaseRecord());

    await service.claim("phase-one", { by: "agent:p1" }, () => "2026-07-19T09:00:00.000Z");

    const atBoundary = await service.claim("phase-one", { by: "agent:p2" }, () => "2026-07-19T10:00:00.000Z");
    expect(atBoundary.ok).toBe(false); // exactly 60 minutes — still fresh (strict > staleness)

    const pastBoundary = await service.claim(
      "phase-one",
      { by: "agent:p2" },
      () => "2026-07-19T10:00:01.000Z",
    );
    expect(pastBoundary.ok).toBe(true); // one second past 60 minutes — stale, reclaimable
  });
});

// ─── ERROR: resolving a non-existent doc ─────────────────────────────────────

describe("PhaseWorkflowService — ERROR: unresolvable target", () => {
  it("claiming a non-existent id returns DOC_NOT_FOUND, not a throw", async () => {
    const { service } = makeServices();
    const result = await service.claim("01HNOPE00000000000000000A", { by: "agent:p1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });
});

// ─── STATE: derived sessions over phase claims ───────────────────────────────

describe("PhaseWorkflowService — STATE: ready() derives sessions over phase claims", () => {
  it("a fresh phase claim groups into ready().sessions (deriveSessions is doc-type-agnostic, §2)", async () => {
    const { store, service } = makeServices();
    await mustInsert(store, makePlanRecord());
    await mustInsert(store, makePhaseRecord());

    await service.claim(
      "phase-one",
      { by: "agent:p1", machine: "hostA", worktree: "/w1" },
      () => "2026-07-19T09:00:00.000Z",
    );

    const ready = await service.ready("plan-one", () => "2026-07-19T09:30:00.000Z");
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(ready.value.sessions).toHaveLength(1);
    expect(ready.value.sessions[0]).toMatchObject({ by: "agent:p1", machine: "hostA", worktree: "/w1" });
  });
});

// ─── REGRESSION §3: legacy task doc — READ tolerance, WRITE refusal ─────────

describe("PhaseWorkflowService — REGRESSION §3: legacy task doc read tolerance vs. write refusal", () => {
  function makeLegacyTaskRecord(overrides: Partial<DocRecord> = {}): DocRecord {
    const base: DocRecord = {
      id: "01HTASKLEGACY000000000001",
      slug: "task-legacy",
      type: "task",
      role: "plan",
      title: "Legacy Task",
      status: "draft",
      priority: "medium",
      content: "# Legacy Task",
      parent_id: "01HPLAN000000000000000000",
      created_at: "2026-07-19T00:00:00.000Z",
      updated_at: "2026-07-19T00:00:00.000Z",
      created_by: "system",
      version: 1,
      deleted_at: null,
      tags: [],
      extra: { plan_id: "01HPLAN000000000000000000" },
    };
    return { ...base, ...overrides };
  }

  it("ready() still renders a record for an un-migrated legacy task doc (READ tolerance)", async () => {
    const { store, service } = makeServices();
    await mustInsert(store, makePlanRecord());
    await mustInsert(store, makeLegacyTaskRecord());

    const ready = await service.ready("plan-one");
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(ready.value.records.map((r) => r.task.slug)).toContain("task-legacy");
  });

  it("claim() on a legacy task doc is REFUSED (write paths do not extend the read tolerance)", async () => {
    const { store, service } = makeServices();
    await mustInsert(store, makePlanRecord());
    await mustInsert(store, makeLegacyTaskRecord());

    const result = await service.claim("task-legacy", { by: "agent:p1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("addEvidence() on a legacy task doc is REFUSED", async () => {
    const { store, service } = makeServices();
    await mustInsert(store, makePlanRecord());
    await mustInsert(store, makeLegacyTaskRecord());

    const result = await service.addEvidence("task-legacy", {
      oracle: "test",
      command: "bun test",
      result: "pass",
      recorded_by: "agent:p1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("release() on a legacy task doc is REFUSED", async () => {
    const { store, service } = makeServices();
    await mustInsert(store, makePlanRecord());
    await mustInsert(store, makeLegacyTaskRecord());

    const result = await service.release("task-legacy", { by: "agent:p1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── REGRESSION §5: anchor-overlap gate field renames end-to-end ────────────

describe("PhaseWorkflowService — REGRESSION §5: anchor-overlap gate field 'gate:phase-claim:anchor-overlap'", () => {
  it("a distinct-actor overlapping claim on phase docs is blocked with the renamed field", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const enforcer = new GateEnforcer(undefined);
    const service = new mod.PhaseWorkflowService(
      store,
      new NoOpTelemetry(),
      { claimTtlMinutes: 120 },
      undefined,
      { enforcer, getPlanBundle: corpusService.getPlanBundle.bind(corpusService) },
    );

    await mustInsert(store, makePlanRecord());
    await mustInsert(store, makePhaseRecord({ extra: { file_anchors: ["src/a/"] } }));
    await mustInsert(
      store,
      makePhaseRecord({
        id: "01HPHASE00000000000000002",
        slug: "phase-two",
        title: "Phase Two",
        extra: { file_anchors: ["src/a"] },
      }),
    );

    const first = await service.claim("phase-one", { by: "agent:p1" });
    expect(first.ok).toBe(true);

    const second = await service.claim("phase-two", { by: "agent:p2" });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("VALIDATION_ERROR");
    expect((second.error as { field?: string }).field).toBe("gate:phase-claim:anchor-overlap");
  });
});
