/**
 * RED suite (TDD-Role: red, paired-impl
 * task-skill-implement-phase-feed-flow-ssot-registration) for `buildPhaseStartPack`
 * (`packages/lore/src/flows/phase-feed-flow.ts`) — a module that does NOT exist yet
 * (SPEC-056 §Design Decisions D5, §Module Boundary: "flows/phase-feed-flow.ts
 * (buildPhaseStartPack over an explicit PhaseFeedFlowDeps)").
 *
 * RED mechanism: same computed (non-literal) dynamic-`import()`-specifier technique as
 * `packages/lore/tests/unit/core/verification-profile.test.ts` /
 * `packages/lore/tests/unit/service/phase-checklist-service.test.ts` (this task's
 * sibling file) — see either file's header for the full mechanism writeup, captured
 * as a reusable pattern in
 * `knowledge-spec-058-execution-learnings-init-seeding-yaml-trap-co` §2. `bun run
 * typecheck` stays green before AND after the module lands; the `beforeAll` dynamic
 * import genuinely throws today ("Cannot find module"), which vitest reports as every
 * `it` in the `buildPhaseStartPack` describe blocks below failing due to a failed
 * hook — RED for missing-implementation reasons only.
 *
 * The `CHECKPOINT_PRODUCED_TYPE` pinning suite at the bottom is DIFFERENT: it imports
 * `../../../src/flows/feed-flow.js` STATICALLY (that module already exists) and is RED
 * because the map is MISSING the `"phase-start"` key today — also a "missing
 * implementation" reason, just at the map-entry granularity rather than the
 * whole-module granularity (SPEC-056 §Design Decisions D5: "phase-start enters
 * CHECKPOINT_PRODUCED_TYPE SSOT map — no parallel dispatch path").
 *
 * CONTRACT NOTE (this file is the authoritative shape the paired implement task must
 * satisfy — SPEC-056's D5 sketch gives `PhaseFeedFlowDeps`'s 3 methods verbatim but
 * leaves every other shape open; the choices below resolve that ambiguity, capped
 * against the `StalenessFlowDeps` precedent per the sketch's own comment):
 *
 *   - `PhaseBundle` — `{ phase: DocRecord; plan: DocRecord; specSlice: string | null;
 *     siblings: PhaseSiblingSummary[] }`. `specSlice` is `null` (not absent) when the
 *     plan has no spec ancestor — mirrors `AcListResult.coverage`'s "null means
 *     nothing to aggregate, not empty" precedent (`ac-service.ts`). `siblings` are the
 *     OTHER phase docs under the same plan, pre-summarized by the caller (never
 *     re-derived by `buildPhaseStartPack` itself — same division of labor
 *     `computePhaseCompletion` documents for `coverage`/checklist `result`).
 *   - `PhaseSiblingSummary` — `{ slug: string; title: string; state: string }` (`state`
 *     is a pre-computed `PhaseCompletionState` string, caller's job to compute via
 *     `computePhaseCompletion` — this flow module never calls it directly).
 *   - `KnowledgePointer` — `{ doc_id: string; slug: string; title: string; invalidated:
 *     boolean }`. The port doc comment (`listLinkedKnowledgePointers`, D5 sketch) says
 *     "hygiene-filtered" — resolved here as: the PORT surfaces invalidation state (the
 *     `invalidated` flag) rather than silently omitting rows, and `buildPhaseStartPack`
 *     itself is the ONE place that applies the exclusion (defense-in-depth — even a
 *     port implementation that forgets to filter cannot leak an invalidated doc into
 *     the rendered pack). Mirrors SPEC-043 D3's "filtered by default" read-surface
 *     class for list-shaped reads.
 *   - `HandoffPointer` — `{ slug: string; title: string }`.
 *   - `PhaseStartBudgets` — `{ max_scope_chars: number; max_siblings_chars: number;
 *     max_knowledge_chars: number; max_handoff_chars: number }`; a
 *     `DEFAULT_PHASE_START_BUDGETS` constant export supplies the `workflow.phase_feed.*`
 *     config defaults (this task's anchors do not extend `config.ts`'s
 *     `WorkflowConfigSchema` — that wiring is the paired implement task's job; this
 *     flow function accepts a plain optional `Partial<PhaseStartBudgets>` override so
 *     it stays testable with zero config-schema coupling, mirroring
 *     `ai.assess.*`/`truncateSection`'s separation of "budget resolution" (CLI/MCP
 *     adapter, config-aware) from "budget application" (this pure-ish flow fn,
 *     config-agnostic)).
 *   - `PhaseStartPack` — `{ phase_id: string; sections: { scope: string; siblings:
 *     string; knowledge_pointers: string; handoff: string }; truncated: string[] }`.
 *     `truncated` names EXACTLY the section keys (`"scope"`/`"siblings"`/
 *     `"knowledge_pointers"`/`"handoff"`) that were cut to fit their budget — mirrors
 *     `assess`'s `judgment.truncated[]` (section-name list, `assessment.ts`).
 *   - `buildPhaseStartPack(deps, phaseId, budgets?)` — `Promise<Result<PhaseStartPack,
 *     LoreError>>`.
 *     - `deps.getPhaseBundle(phaseId)` failing (any `LoreError`, e.g. the phase
 *       doesn't exist / the plan has no phases to resolve into one) is FATAL — the
 *       whole call propagates that error verbatim (T4 "zero-phase plan -> typed err,
 *       not empty pack": the fake in that test simulates "nothing to bundle" via a
 *       `DOC_NOT_FOUND` from this port, since phase SELECTION among a plan's phases —
 *       if any — is explicitly a caller/adapter concern this pure flow fn does not
 *       perform itself, same division of labor as the rest of this contract).
 *     - `deps.listLinkedKnowledgePointers`/`deps.latestHandoffForPlan` failing is
 *       NON-fatal — mirrors `feed-flow.ts::buildFeed`'s documented "never fails,
 *       auxiliary lookups degrade to an advisory note" ethos (this module lives
 *       alongside `buildFeed` under the same `lore feed` "PULL, always exit 0"
 *       philosophy, UNLIKE `buildResumeFeed`'s primary-target-resolution failure,
 *       which the zero-phase-plan case above mirrors instead) — the affected section
 *       degrades to a one-line note, the rest of the pack still builds.
 *
 * Doc-type fixture note (mirrors `phase-checklist-service.test.ts`): `phase` is not
 * yet a registered `DocType` — bundle fixtures below build plain `DocRecord`-shaped
 * objects with a `type: "phase" as unknown as DocRecord["type"]` cast; they are never
 * inserted into a real store (this suite exercises `buildPhaseStartPack` purely
 * against FAKE `PhaseFeedFlowDeps`, mirroring `calibration-hook.ts`/`staleness-flow.ts`
 * "narrow deps, plain fakes, no real store" precedent — no `InMemoryStore` needed here).
 *
 * Six-dimension coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * Source: spec-spec-056-phase-execution-model-phase-doc-type-computed-comp
 *   §Module Boundary, §Design Decisions D5; §Acceptance Criteria AC-P-4;
 *   task-skill-test-checklistservice-feed-flow-red.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { ok, err } from "@lore/core";
import type { DocId, DocRecord, LoreError, Result } from "@lore/core";
import { CHECKPOINT_PRODUCED_TYPE } from "../../../src/flows/feed-flow.js";

// packages/lore/tests/unit/flows/ -> ../../../ -> packages/lore/ -> src/flows/phase-feed-flow.js
const PHASE_FEED_FLOW_MODULE_PATH = ["..", "..", "..", "src", "flows", "phase-feed-flow.js"].join(
  "/",
);

// ─── Contract shapes (see CONTRACT NOTE above) ─────────────────────────────

interface PhaseSiblingSummary {
  slug: string;
  title: string;
  state: string;
}

interface PhaseBundle {
  phase: DocRecord;
  plan: DocRecord;
  specSlice: string | null;
  siblings: PhaseSiblingSummary[];
}

interface KnowledgePointer {
  doc_id: string;
  slug: string;
  title: string;
  invalidated: boolean;
}

interface HandoffPointer {
  slug: string;
  title: string;
}

interface PhaseFeedFlowDeps {
  getPhaseBundle: (phaseId: string) => Promise<Result<PhaseBundle, LoreError>>;
  listLinkedKnowledgePointers: (
    docId: string,
    limit: number,
  ) => Promise<Result<KnowledgePointer[], LoreError>>;
  latestHandoffForPlan: (planId: string) => Promise<Result<HandoffPointer | null, LoreError>>;
}

interface PhaseStartBudgets {
  max_scope_chars: number;
  max_siblings_chars: number;
  max_knowledge_chars: number;
  max_handoff_chars: number;
}

interface PhaseStartPack {
  phase_id: string;
  sections: {
    scope: string;
    siblings: string;
    knowledge_pointers: string;
    handoff: string;
  };
  truncated: string[];
}

interface PhaseFeedFlowModule {
  buildPhaseStartPack: (
    deps: PhaseFeedFlowDeps,
    phaseId: string,
    budgets?: Partial<PhaseStartBudgets>,
  ) => Promise<Result<PhaseStartPack, LoreError>>;
}

let buildPhaseStartPack: PhaseFeedFlowModule["buildPhaseStartPack"];

beforeAll(async () => {
  const mod = (await import(PHASE_FEED_FLOW_MODULE_PATH)) as unknown as PhaseFeedFlowModule;
  buildPhaseStartPack = mod.buildPhaseStartPack;
});

// ─── Fixture helpers ────────────────────────────────────────────────────────

function fakeDoc(overrides: Partial<DocRecord> & { id: DocId; title: string }): DocRecord {
  const now = "2026-07-19T09:00:00.000Z";
  return {
    slug: `doc-${overrides.id}`,
    // reason: `phase` is not yet a registered DocType — see module header.
    type: "phase" as unknown as DocRecord["type"],
    role: "plan",
    status: "draft",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: now,
    updated_at: now,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  };
}

function samplePhase(): DocRecord {
  return { ...fakeDoc({ id: "phase-1" as DocId, title: "Backend slice" }), slug: "phase-backend-slice" };
}

function samplePlan(): DocRecord {
  return {
    ...fakeDoc({ id: "plan-1" as DocId, title: "Implementation Plan" }),
    slug: "plan-implementation",
    type: "plan",
  };
}

function pointer(overrides: Partial<KnowledgePointer> & { doc_id: string }): KnowledgePointer {
  return {
    slug: `knowledge-${overrides.doc_id}`,
    title: `Learning ${overrides.doc_id}`,
    invalidated: false,
    ...overrides,
  };
}

/** A fully-wired fake deps bundle — individual fields overridden per test. */
function makeDeps(overrides: Partial<PhaseFeedFlowDeps> = {}): PhaseFeedFlowDeps {
  return {
    getPhaseBundle: async () =>
      ok({
        phase: samplePhase(),
        plan: samplePlan(),
        specSlice: "## Overview\n\nSpec slice body.",
        siblings: [
          { slug: "phase-frontend-slice", title: "Frontend slice", state: "pending" },
          { slug: "phase-infra-slice", title: "Infra slice", state: "done" },
        ],
      }),
    listLinkedKnowledgePointers: async () => ok([pointer({ doc_id: "k1" })]),
    latestHandoffForPlan: async () => ok({ slug: "knowledge-handoff-alice", title: "Handoff — alice" }),
    ...overrides,
  };
}

// ─── HAPPY — T1 sections complete ──────────────────────────────────────────

describe("HAPPY — buildPhaseStartPack assembles complete T1 sections (scope/siblings) plus knowledge/handoff", () => {
  it("renders phase title, plan title, and spec slice into the scope section; sibling titles into the siblings section", async () => {
    const result = await buildPhaseStartPack(makeDeps(), "phase-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.phase_id).toBe("phase-1");
    expect(result.value.sections.scope).toContain("Backend slice");
    expect(result.value.sections.scope).toContain("Implementation Plan");
    expect(result.value.sections.scope).toContain("Spec slice body");
    expect(result.value.sections.siblings).toContain("Frontend slice");
    expect(result.value.sections.siblings).toContain("Infra slice");
    expect(result.value.truncated).toEqual([]);
  });

  it("renders a null specSlice (no spec ancestor) as a complete scope section that still names phase+plan", async () => {
    const deps = makeDeps({
      getPhaseBundle: async () =>
        ok({ phase: samplePhase(), plan: samplePlan(), specSlice: null, siblings: [] }),
    });
    const result = await buildPhaseStartPack(deps, "phase-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.scope).toContain("Backend slice");
    expect(result.value.sections.scope).toContain("Implementation Plan");
  });

  it("renders the handoff pointer's slug into the handoff section when one exists", async () => {
    const result = await buildPhaseStartPack(makeDeps(), "phase-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.handoff).toContain("knowledge-handoff-alice");
  });

  it("renders a plain no-handoff note when latestHandoffForPlan resolves null", async () => {
    const deps = makeDeps({ latestHandoffForPlan: async () => ok(null) });
    const result = await buildPhaseStartPack(deps, "phase-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.handoff.length).toBeGreaterThan(0);
    expect(result.value.sections.handoff).not.toContain("knowledge-handoff-alice");
  });
});

// ─── T3 — invalidated-knowledge hygiene filter ─────────────────────────────

describe("T3 — knowledge-pointer section excludes invalidated docs; T1 sections stay complete alongside it", () => {
  it("excludes an invalidated pointer's slug/title from the rendered section while keeping the valid pointer", async () => {
    const deps = makeDeps({
      listLinkedKnowledgePointers: async () =>
        ok([
          pointer({ doc_id: "k1", slug: "knowledge-valid", title: "Still true" }),
          pointer({ doc_id: "k2", slug: "knowledge-stale", title: "No longer true", invalidated: true }),
        ]),
    });
    const result = await buildPhaseStartPack(deps, "phase-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.sections.knowledge_pointers).toContain("knowledge-valid");
    expect(result.value.sections.knowledge_pointers).not.toContain("knowledge-stale");
    expect(result.value.sections.knowledge_pointers).not.toContain("No longer true");

    // T1 sections remain complete alongside the T3 filter (hygiene filtering must not
    // have a blast radius on unrelated sections).
    expect(result.value.sections.scope).toContain("Backend slice");
    expect(result.value.sections.siblings).toContain("Frontend slice");
  });

  it("an all-invalidated pointer list degrades to an empty-but-present knowledge_pointers section, never omitted", async () => {
    const deps = makeDeps({
      listLinkedKnowledgePointers: async () =>
        ok([pointer({ doc_id: "k1", invalidated: true }), pointer({ doc_id: "k2", invalidated: true })]),
    });
    const result = await buildPhaseStartPack(deps, "phase-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.knowledge_pointers).not.toContain("k1");
    expect(result.value.sections.knowledge_pointers).not.toContain("k2");
    expect(typeof result.value.sections.knowledge_pointers).toBe("string");
  });
});

// ─── BOUNDARY — over-budget sections recorded in truncated[] ───────────────

describe("BOUNDARY — an over-budget section is clipped to its budget and named in truncated[]", () => {
  it("clips an oversized scope section (long specSlice) to max_scope_chars and records 'scope' in truncated[]", async () => {
    const longSlice = "x".repeat(5000);
    const deps = makeDeps({
      getPhaseBundle: async () =>
        ok({ phase: samplePhase(), plan: samplePlan(), specSlice: longSlice, siblings: [] }),
    });
    const result = await buildPhaseStartPack(deps, "phase-1", { max_scope_chars: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.scope.length).toBeLessThanOrEqual(50);
    expect(result.value.truncated).toContain("scope");
  });

  it("a section within budget is never named in truncated[]", async () => {
    const result = await buildPhaseStartPack(makeDeps(), "phase-1", { max_scope_chars: 5000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.truncated).not.toContain("scope");
  });

  it("clips an oversized knowledge_pointers section to max_knowledge_chars and records 'knowledge_pointers' in truncated[]", async () => {
    const manyPointers = Array.from({ length: 200 }, (_, i) =>
      pointer({ doc_id: `k${i}`, title: `A fairly long learning title number ${i}` }),
    );
    const deps = makeDeps({ listLinkedKnowledgePointers: async () => ok(manyPointers) });
    const result = await buildPhaseStartPack(deps, "phase-1", { max_knowledge_chars: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.knowledge_pointers.length).toBeLessThanOrEqual(100);
    expect(result.value.truncated).toContain("knowledge_pointers");
  });
});

// ─── ERROR — zero-phase plan / port failures ───────────────────────────────

describe("ERROR — a fatal getPhaseBundle failure propagates as a typed err, never an empty pack", () => {
  it("propagates DOC_NOT_FOUND when the target plan has zero phases to resolve into a bundle", async () => {
    const deps = makeDeps({
      getPhaseBundle: async () => err({ code: "DOC_NOT_FOUND", id: "plan-with-zero-phases" }),
    });
    const result = await buildPhaseStartPack(deps, "plan-with-zero-phases");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });

  it("a non-fatal listLinkedKnowledgePointers failure degrades the knowledge section but does not fail the whole pack", async () => {
    const deps = makeDeps({
      listLinkedKnowledgePointers: async () =>
        err({ code: "STORE_ERROR", message: "boom" }),
    });
    const result = await buildPhaseStartPack(deps, "phase-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.scope).toContain("Backend slice");
    expect(result.value.sections.knowledge_pointers.length).toBeGreaterThan(0);
  });

  it("a non-fatal latestHandoffForPlan failure degrades the handoff section but does not fail the whole pack", async () => {
    const deps = makeDeps({
      latestHandoffForPlan: async () => err({ code: "STORE_ERROR", message: "boom" }),
    });
    const result = await buildPhaseStartPack(deps, "phase-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.scope).toContain("Backend slice");
    expect(result.value.sections.handoff.length).toBeGreaterThan(0);
  });
});

// ─── STATE / REGRESSION — determinism (the CLI/MCP identical-by-construction foundation) ──

describe("STATE/REGRESSION — buildPhaseStartPack is deterministic for identical deps+args (AC-P-4 CLI/MCP deep-equal foundation)", () => {
  it("two calls with identical (fake, deterministic) deps and the same phaseId+budgets produce deep-equal payloads", async () => {
    const deps = makeDeps();
    const first = await buildPhaseStartPack(deps, "phase-1", { max_scope_chars: 3000 });
    const second = await buildPhaseStartPack(deps, "phase-1", { max_scope_chars: 3000 });
    expect(first).toEqual(second);
  });
});

// ─── CHECKPOINT_PRODUCED_TYPE SSOT registration pin ────────────────────────

describe("phase-start is registered in feed-flow.ts's CHECKPOINT_PRODUCED_TYPE SSOT map (SPEC-056 D5)", () => {
  it("CHECKPOINT_PRODUCED_TYPE['phase-start'] resolves to the 'phase' produced type", () => {
    expect(CHECKPOINT_PRODUCED_TYPE["phase-start"]).toBe("phase");
  });
});
