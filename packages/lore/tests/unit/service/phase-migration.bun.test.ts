// @reads packages/lore/tests/fixtures/phase-migration/seed.json
/**
 * RED suite (TDD-Role: red, paired-impl task-skill-implement-phasemigrationservice)
 * for `packages/lore/src/service/phase-migration-service.ts` — a module that does NOT
 * exist yet. Covers AC-P-5 (migration fixture: aggregate pre/post reconciliation diff
 * = 0, per-field fidelity on >=2 representative phases, legacy_phase grouping
 * fallback, empty declared phase -> empty phase doc, second run = 0 new writes).
 *
 * Runner: bun:sqlite (real `SQLiteStore`, mkdtemp'd throwaway DB per test) — must run
 * under `bun test`, not vitest (project CLAUDE.md "bun:sqlite is external to vitest").
 * ⛔ Never touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule).
 *
 * RED mechanism (mirrors packages/lore/tests/unit/service/seat-service.test.ts and
 * packages/lore/tests/unit/core/seat.test.ts — this repo's SPEC-057/058 RED
 * precedent): `PhaseMigrationService` is loaded via a dynamic `import()` whose
 * specifier is a COMPUTED (non-literal) string, so `bun run typecheck` stays green
 * before `phase-migration-service.ts` exists (TS only statically resolves literal
 * `import()` specifiers) and the import genuinely throws ("Cannot find module") at
 * runtime today.
 *
 * The `PhaseMigrationReport`/`PhaseMigrationServiceCtor` interfaces below are this
 * suite's OWN local contract for the not-yet-existing module (same practice
 * seat-service.test.ts documents) — the paired implementer (T10) must satisfy them
 * verbatim; this suite pins the CONTRACT, not a re-derivation of the real module's
 * eventual internals.
 *
 * Fixture: packages/lore/tests/fixtures/phase-migration/seed.json (3 plans / 13
 * tasks / 120 evidence entries total — see the sibling README.md for the full
 * scenario table). `scenario_index` inside the fixture maps every task/plan slug to
 * its SPEC-056 D6/P7 edge rule and expected post-migration outcome; this suite's
 * assertions are built directly FROM those expectations, not re-derived logic.
 *
 * Known pre-existing gap surfaced by authoring this suite (informational, NOT fixed
 * here — outside this task's file anchor): `migrations/migration-001.ts`'s `docs`
 * table has `CHECK(type IN ('prd','spec','adr','plan','knowledge','task'))` — no
 * migration yet widens this to include `'phase'`. A real `PhaseMigrationService`
 * writing raw `type: "phase"` rows (D6a's "raw store.insert bounded bypass") will
 * hit this SQLite CHECK constraint until a schema migration lands. Left for the
 * paired implementer (T10) to resolve as part of making this suite pass.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      full first-run migration — phase doc count (11, incl. 2 empty),
 *               aggregate evidence reconciliation (120 in == 120 out, D6 "never
 *               truncated" even on the 55-entry over-cap merge group)
 *   NEGATIVE:   dry-run computes the same report but performs zero writes
 *   BOUNDARY:   49-entry solo evidence array (stays under the 50-cap, distinct from
 *               the 55-entry OVER-cap merged case); empty declared phase (2
 *               independent instances, 'ghost' + 'orphan')
 *   ERROR:      a closed/broken store surfaces a typed Result err, never a throw
 *   STATE:      multi-claim collapse (newest-fresh-wins + displaced-holder track
 *               note); legacy_phase grouping fallback; one-phase-per-task fallback;
 *               every source task ends archived with `extra.migrated_to` set
 *   REGRESSION: a second migration run performs 0 new writes (idempotency via
 *               migrated_from/migrated_to markers) — full doc snapshot unchanged
 *
 * Source: spec-spec-056-phase-execution-model-phase-doc-type-computed-comp
 *   §Design Decisions D1, D6, D6a; §Acceptance Criteria AC-P-5.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import type { DocRecord, EvidenceEntry, LoreError, Result, TaskClaim } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

// packages/lore/tests/unit/service/ -> ../../../ -> packages/lore/src/service/phase-migration-service.js
const PHASE_MIGRATION_SERVICE_MODULE_PATH = [
  "..",
  "..",
  "..",
  "src",
  "service",
  "phase-migration-service.js",
].join("/");

// ─── Minimal local contract for the not-yet-existing module ───────────────────
//
// DELIBERATELY narrower/looser than the real module's eventual exports (mirrors
// seat-service.test.ts's precedent) — just enough structure for this suite to call
// through. The paired implementer's real phase-migration-service.ts is the source
// of truth once it lands; this suite pins the CONTRACT it must satisfy.

/**
 * Report returned by `migrateTasks()`.
 *
 *   - phases_created: total NEW phase docs written this run, INCLUDING empty
 *     declared-phase docs with zero migrated_from tasks.
 *   - tasks_archived: total SOURCE task docs processed this run (status set to
 *     "archived" + `extra.migrated_to` populated) — counts every task touched this
 *     run, regardless of its PRE-migration status (an already-archived source task
 *     still counts once, since its evidence/claim/anchors were still merged).
 *   - evidence_merged: total `verification_evidence` entries written across every
 *     phase doc created this run — the AC-P-5 "aggregate reconciliation" number;
 *     must equal the sum of every processed source task's pre-migration evidence
 *     array length, with ZERO entries dropped or duplicated (D6: "never truncated").
 *   - warnings: human-readable notes, at minimum one per displaced multi-claim
 *     holder (D6/P7 "loud in the migration report").
 */
interface PhaseMigrationReport {
  dry_run: boolean;
  phases_created: number;
  tasks_archived: number;
  evidence_merged: number;
  warnings: string[];
}

/**
 * Progress durably committed to the store BEFORE a mid-run store failure
 * aborted `migrateTasks` (BUG-009 fix) — this suite's own local contract for
 * the real module's `PhaseMigrationPartialProgress`, same "pin the contract"
 * practice as `PhaseMigrationReport` above.
 */
interface PhaseMigrationPartialProgressLike {
  phases_created: number;
  tasks_archived: number;
  evidence_merged: number;
}

/**
 * Local contract for the real module's `PhaseMigrationError` (BUG-009 fix) —
 * distinct from a bare `LoreError` so a mid-run failure's caller can report
 * BOTH the underlying cause AND how much progress already landed.
 */
interface PhaseMigrationErrorLike {
  cause: LoreError;
  partial: PhaseMigrationPartialProgressLike;
}

interface PhaseMigrationServiceCtor {
  new (store: StoreInterface): {
    migrateTasks(opts: { dryRun: boolean }): Promise<Result<PhaseMigrationReport, PhaseMigrationErrorLike>>;
  };
}

async function loadPhaseMigrationServiceCtor(): Promise<PhaseMigrationServiceCtor> {
  const mod = (await import(PHASE_MIGRATION_SERVICE_MODULE_PATH)) as unknown as {
    PhaseMigrationService: PhaseMigrationServiceCtor;
  };
  return mod.PhaseMigrationService;
}

// ─── Fixture loading ────────────────────────────────────────────────────────

interface FixtureScenarioEntry {
  task_slug: string | null;
  plan_slug: string;
  edge_rule: string;
  expect: string;
}

interface FixtureSeed {
  _comment: string;
  shared_fake_parent_spec_id: string;
  scenario_index: FixtureScenarioEntry[];
  plans: DocRecord[];
  tasks: DocRecord[];
}

function loadFixture(): FixtureSeed {
  const fixturePath = join(
    fileURLToPath(new URL(".", import.meta.url)),
    "..",
    "..",
    "fixtures",
    "phase-migration",
    "seed.json",
  );
  return JSON.parse(readFileSync(fixturePath, "utf8")) as unknown as FixtureSeed;
}

function taskBySlug(fixture: FixtureSeed, slug: string): DocRecord {
  const found = fixture.tasks.find((t) => t.slug === slug);
  if (found === undefined) throw new Error(`fixture task not found: ${slug}`);
  return found;
}

function planBySlug(fixture: FixtureSeed, slug: string): DocRecord {
  const found = fixture.plans.find((p) => p.slug === slug);
  if (found === undefined) throw new Error(`fixture plan not found: ${slug}`);
  return found;
}

function evidenceOf(doc: DocRecord): EvidenceEntry[] {
  return ((doc.extra as { verification_evidence?: EvidenceEntry[] }).verification_evidence ??
    []) as EvidenceEntry[];
}

// ─── Store seeding + generic read helpers ──────────────────────────────────

async function mustInsert(store: StoreInterface, doc: DocRecord): Promise<void> {
  const result = await store.insert(doc);
  if (!result.ok) {
    throw new Error(`fixture insert failed for ${doc.slug}: ${JSON.stringify(result.error)}`);
  }
}

/**
 * Every fixture plan's `parent_id` points at `shared_fake_parent_spec_id` — the
 * `docs` table's `parent_id TEXT REFERENCES docs(id)` column constraint
 * (migration-001.ts) is enforced (`SQLiteStore` runs `PRAGMA foreign_keys = ON`),
 * so that id must exist as a real row before any plan referencing it can be
 * inserted. This stub is intentionally minimal — its own content is never read by
 * any assertion in this suite, only its existence as a valid FK target.
 */
function buildFakeParentSpec(fixture: FixtureSeed): DocRecord {
  return {
    id: fixture.shared_fake_parent_spec_id,
    slug: "spec-phase-migration-fixture-fake-parent",
    type: "spec",
    role: "spec",
    title: "Fixture fake parent spec (phase-migration fixture FK stub)",
    status: "approved",
    priority: "medium",
    content: "# Fixture stub — FK target only, not read by any assertion.",
    parent_id: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    created_by: "phase-migration-fixture",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
  };
}

async function seedFixtureStore(store: StoreInterface, fixture: FixtureSeed): Promise<void> {
  await mustInsert(store, buildFakeParentSpec(fixture));
  for (const plan of fixture.plans) {
    await mustInsert(store, plan);
  }
  for (const task of fixture.tasks) {
    await mustInsert(store, task);
  }
}

async function mustFindMany(
  store: StoreInterface,
  filters: Parameters<StoreInterface["findMany"]>[0],
): Promise<DocRecord[]> {
  const result = await store.findMany(filters);
  if (!result.ok) throw new Error(`findMany failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** `phase` is not yet a registered `DocType` (deferred per SPEC-056 T1's own header
 *  invariant) — widen to `string` before comparing so this suite doesn't require
 *  `types.ts` edits outside its file anchor. */
function rawType(doc: DocRecord): string {
  return doc.type as unknown as string;
}

function isPhaseDoc(doc: DocRecord): boolean {
  return rawType(doc) === "phase";
}

interface PhaseExtraLike {
  plan_id?: string;
  claim?: TaskClaim;
  verification_evidence?: Array<EvidenceEntry & { origin?: string }>;
  file_anchors?: string[];
  track?: Array<{ id: string; note: string; by: string; at: string }>;
  migrated_from?: string[];
  legacy_phase?: string;
}

function phaseExtraOf(doc: DocRecord): PhaseExtraLike {
  return doc.extra as PhaseExtraLike;
}

function findPhaseByMigratedFrom(phaseDocs: DocRecord[], taskIds: string[]): DocRecord | undefined {
  const wanted = new Set(taskIds);
  return phaseDocs.find((doc) => {
    const from = phaseExtraOf(doc).migrated_from ?? [];
    return from.length === wanted.size && from.every((id) => wanted.has(id));
  });
}

function findEmptyPhaseByTitle(phaseDocs: DocRecord[], title: string): DocRecord | undefined {
  return phaseDocs.find(
    (doc) => doc.title === title && (phaseExtraOf(doc).migrated_from ?? []).length === 0,
  );
}

/**
 * Verifies a merged `verification_evidence` array faithfully carries every source
 * task's entries: same count, same field values, `origin` set to the correct source
 * task id — matched PER SOURCE TASK (not globally by `command`) because the fixture
 * deliberately reuses the SAME command string across different source tasks (e.g.
 * "core" phase's mixed-anchors + archived-first-seen tasks both use
 * "bunx vitest run fixture-suite-0.test.ts"), so a global command->entry map would
 * silently collide.
 */
function assertEvidenceMergedFaithfully(
  merged: Array<EvidenceEntry & { origin?: string }>,
  sources: Array<{ taskId: string; evidence: EvidenceEntry[] }>,
): void {
  const expectedTotal = sources.reduce((sum, s) => sum + s.evidence.length, 0);
  expect(merged).toHaveLength(expectedTotal);

  for (const { taskId, evidence } of sources) {
    const fromThisTask = merged.filter((e) => e.origin === taskId);
    expect(fromThisTask).toHaveLength(evidence.length);

    const byCommand = new Map(fromThisTask.map((e) => [e.command, e]));
    for (const original of evidence) {
      const found = byCommand.get(original.command);
      expect(found).toBeDefined();
      if (found === undefined) continue;
      expect(found.oracle).toBe(original.oracle);
      expect(found.result).toBe(original.result);
      expect(found.recorded_at).toBe(original.recorded_at);
      expect(found.recorded_by).toBe(original.recorded_by);
      expect(found.ac_ref).toBe(original.ac_ref);
      expect(found.attestation).toEqual(original.attestation);
    }
  }
}

// ─── Suite setup ────────────────────────────────────────────────────────────

let tempDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lore-phase-migration-"));
  dbPath = join(tempDir, "test.db");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function freshSeededStore(): Promise<{ store: SQLiteStore; fixture: FixtureSeed }> {
  const fixture = loadFixture();
  const store = actedStore(new SQLiteStore(dbPath));
  await seedFixtureStore(store, fixture);
  return { store, fixture };
}

async function migratedStore(
  opts: { dryRun: boolean } = { dryRun: false },
): Promise<{ store: SQLiteStore; fixture: FixtureSeed; report: PhaseMigrationReport }> {
  const { store, fixture } = await freshSeededStore();
  const PhaseMigrationService = await loadPhaseMigrationServiceCtor();
  const service = new PhaseMigrationService(store);
  const result = await service.migrateTasks(opts);
  if (!result.ok) throw new Error(`migrateTasks failed: ${JSON.stringify(result.error)}`);
  return { store, fixture, report: result.value };
}

// ─── HAPPY: full first-run migration + aggregate reconciliation ───────────────

describe("PhaseMigrationService.migrateTasks — aggregate reconciliation (AC-P-5 HAPPY)", () => {
  it("creates exactly 11 phase docs (incl. 2 empty) and merges all 120 evidence entries with zero loss or duplication", async () => {
    const { store, report } = await migratedStore();

    expect(report.dry_run).toBe(false);
    expect(report.phases_created).toBe(11);
    expect(report.tasks_archived).toBe(13);
    expect(report.evidence_merged).toBe(120);

    const allDocs = await mustFindMany(store, {});
    const phaseDocs = allDocs.filter(isPhaseDoc);
    expect(phaseDocs).toHaveLength(11);

    // Aggregate reconciliation: independently re-derived from raw store state (not
    // trusting the report alone) — sum of every phase doc's merged evidence array
    // must equal the fixture's pre-migration total (120), diff = 0.
    const totalMergedEvidence = phaseDocs.reduce(
      (sum, doc) => sum + (phaseExtraOf(doc).verification_evidence ?? []).length,
      0,
    );
    expect(totalMergedEvidence).toBe(120);

    // every phase doc carries the D1 doc-type-rename shape
    for (const doc of phaseDocs) {
      expect(rawType(doc)).toBe("phase");
      expect(doc.role).toBe("plan");
    }

    store.close();
  });

  it("reports at least one warning naming the displaced multi-claim holder (D6/P7 'loud in the migration report')", async () => {
    const { store, report } = await migratedStore();
    expect(
      report.warnings.some(
        (w) => w.includes("agent:alpha-old-holder") || w.includes("task-alpha-build-holder-displaced"),
      ),
    ).toBe(true);
    store.close();
  });
});

// ─── STATE: per-field fidelity — representative phase 1 ("build", multi-claim) ─

describe("PhaseMigrationService.migrateTasks — 'build' phase fidelity: multi-claim collapse (AC-P-5 STATE)", () => {
  it("newest fresh claim wins, displaced holder is recorded as a track note, and all 55 merged evidence entries survive with origin+ac_ref intact", async () => {
    const { store, fixture } = await migratedStore();

    const plan = planBySlug(fixture, "plan-alpha-legacy-and-multiclaim");
    const displaced = taskBySlug(fixture, "task-alpha-build-holder-displaced");
    const winner = taskBySlug(fixture, "task-alpha-build-holder-winner");

    const allDocs = await mustFindMany(store, { parent_id: plan.id });
    const phaseDocs = allDocs.filter(isPhaseDoc);
    const buildPhase = findPhaseByMigratedFrom(phaseDocs, [displaced.id, winner.id]);
    expect(buildPhase).toBeDefined();
    if (buildPhase === undefined) return;

    expect(buildPhase.title).toBe("build");
    expect(buildPhase.parent_id).toBe(plan.id);
    expect(phaseExtraOf(buildPhase).plan_id).toBe(plan.id);

    // claim precedence: newest fresh claim (winner, at 2026-07-15) wins verbatim —
    // the OLDER claim (displaced, at 2026-07-10) must not survive as the phase claim
    const winnerClaim = (winner.extra as { claim?: TaskClaim }).claim;
    expect(phaseExtraOf(buildPhase).claim).toEqual(winnerClaim);

    // displaced holder recorded as a track note naming holder+branch+at (D6/P7)
    const track = phaseExtraOf(buildPhase).track ?? [];
    const displacedClaim = (displaced.extra as { claim?: TaskClaim }).claim;
    expect(track.length).toBeGreaterThan(0);
    expect(
      track.some(
        (t) =>
          t.note.includes(displacedClaim?.by ?? "__missing__") &&
          t.note.includes(displacedClaim?.branch ?? "__missing__") &&
          t.note.includes(displacedClaim?.at ?? "__missing__"),
      ),
    ).toBe(true);

    // merged evidence: 20 (displaced) + 35 (winner) = 55, ALL present, never truncated
    const merged = phaseExtraOf(buildPhase).verification_evidence ?? [];
    assertEvidenceMergedFaithfully(merged, [
      { taskId: displaced.id, evidence: evidenceOf(displaced) },
      { taskId: winner.id, evidence: evidenceOf(winner) },
    ]);
    expect(merged).toHaveLength(55);

    store.close();
  });
});

// ─── STATE: per-field fidelity — representative phase 2 ("core", 3-task merge) ─

describe("PhaseMigrationService.migrateTasks — 'core' phase fidelity: anchor byte-equality + attestation.first_seen (AC-P-5 STATE)", () => {
  it("preserves the sole anchor-bearing task's anchor list byte-equal and keeps attestation.first_seen intact through the merge", async () => {
    const { store, fixture } = await migratedStore();

    const plan = planBySlug(fixture, "plan-beta-anchors-and-scale");
    const mixedAnchors = taskBySlug(fixture, "task-beta-core-mixed-anchors");
    const untouched = taskBySlug(fixture, "task-beta-core-untouched");
    const archivedFirstSeen = taskBySlug(fixture, "task-beta-core-archived-first-seen");

    const allDocs = await mustFindMany(store, { parent_id: plan.id });
    const phaseDocs = allDocs.filter(isPhaseDoc);
    const corePhase = findPhaseByMigratedFrom(phaseDocs, [
      mixedAnchors.id,
      untouched.id,
      archivedFirstSeen.id,
    ]);
    expect(corePhase).toBeDefined();
    if (corePhase === undefined) return;

    expect(corePhase.title).toBe("core");

    // anchor list byte-equal: only mixedAnchors contributes anchors, the other two
    // contribute none, so the merged anchor list must equal mixedAnchors' own array
    // exactly (order + content), not a mutated/re-sorted copy.
    const mixedAnchorsList = (mixedAnchors.extra as { file_anchors?: string[] }).file_anchors ?? [];
    expect(phaseExtraOf(corePhase).file_anchors).toEqual(mixedAnchorsList);

    // merged evidence: 6 (mixedAnchors) + 0 (untouched) + 1 (archivedFirstSeen) = 7
    const merged = phaseExtraOf(corePhase).verification_evidence ?? [];
    assertEvidenceMergedFaithfully(merged, [
      { taskId: mixedAnchors.id, evidence: evidenceOf(mixedAnchors) },
      { taskId: untouched.id, evidence: evidenceOf(untouched) },
      { taskId: archivedFirstSeen.id, evidence: evidenceOf(archivedFirstSeen) },
    ]);
    expect(merged).toHaveLength(7);

    // attestation.first_seen: true survives byte-identical through the merge, gains origin
    const firstSeenEntry = merged.find((e) => e.origin === archivedFirstSeen.id);
    expect(firstSeenEntry?.attestation?.first_seen).toBe(true);

    store.close();
  });
});

// ─── BOUNDARY: solo near-cap evidence (49, no merge partner) ──────────────────

describe("PhaseMigrationService.migrateTasks — 'solo' phase boundary: 49-entry evidence stays under the 50-cap (AC-P-5 BOUNDARY)", () => {
  it("carries all 49 evidence entries with origin set, distinct from the Alpha over-cap MERGED case", async () => {
    const { store, fixture } = await migratedStore();

    const plan = planBySlug(fixture, "plan-gamma-boundary-and-empty");
    const solo = taskBySlug(fixture, "task-gamma-solo-near-cap-evidence");

    const allDocs = await mustFindMany(store, { parent_id: plan.id });
    const phaseDocs = allDocs.filter(isPhaseDoc);
    const soloPhase = findPhaseByMigratedFrom(phaseDocs, [solo.id]);
    expect(soloPhase).toBeDefined();
    if (soloPhase === undefined) return;

    expect(soloPhase.title).toBe("solo");
    const merged = phaseExtraOf(soloPhase).verification_evidence ?? [];
    assertEvidenceMergedFaithfully(merged, [{ taskId: solo.id, evidence: evidenceOf(solo) }]);
    expect(merged).toHaveLength(49);

    const soloAnchors = (solo.extra as { file_anchors?: string[] }).file_anchors ?? [];
    expect(phaseExtraOf(soloPhase).file_anchors).toEqual(soloAnchors);

    store.close();
  });
});

// ─── STATE: legacy_phase grouping fallback ─────────────────────────────────────

describe("PhaseMigrationService.migrateTasks — legacy_phase grouping fallback (AC-P-5 STATE)", () => {
  it("groups a legacy_phase-only task under a phase named from legacy_phase, since `phase` is absent", async () => {
    const { store, fixture } = await migratedStore();

    const plan = planBySlug(fixture, "plan-alpha-legacy-and-multiclaim");
    const legacyTask = taskBySlug(fixture, "task-alpha-legacy-phase-residue");

    const allDocs = await mustFindMany(store, { parent_id: plan.id });
    const phaseDocs = allDocs.filter(isPhaseDoc);
    const legacyPhase = findPhaseByMigratedFrom(phaseDocs, [legacyTask.id]);
    expect(legacyPhase).toBeDefined();
    if (legacyPhase === undefined) return;

    expect(legacyPhase.title).toBe("old-build-track");
    expect(phaseExtraOf(legacyPhase).legacy_phase).toBe("old-build-track");

    const merged = phaseExtraOf(legacyPhase).verification_evidence ?? [];
    assertEvidenceMergedFaithfully(merged, [{ taskId: legacyTask.id, evidence: evidenceOf(legacyTask) }]);
    expect(merged).toHaveLength(2);

    store.close();
  });
});

// ─── BOUNDARY: empty declared phase -> empty phase doc (2 independent instances) ─

describe("PhaseMigrationService.migrateTasks — empty declared phase -> empty phase doc (AC-P-5 BOUNDARY)", () => {
  it("creates an empty 'ghost' phase doc under plan-alpha even though zero tasks reference it", async () => {
    const { store, fixture } = await migratedStore();

    const plan = planBySlug(fixture, "plan-alpha-legacy-and-multiclaim");
    const allDocs = await mustFindMany(store, { parent_id: plan.id });
    const phaseDocs = allDocs.filter(isPhaseDoc);

    const ghost = findEmptyPhaseByTitle(phaseDocs, "ghost");
    expect(ghost).toBeDefined();
    if (ghost === undefined) return;

    expect(phaseExtraOf(ghost).verification_evidence ?? []).toHaveLength(0);
    expect(phaseExtraOf(ghost).claim).toBeUndefined();
    expect(phaseExtraOf(ghost).file_anchors ?? []).toHaveLength(0);

    store.close();
  });

  it("creates an independent empty 'orphan' phase doc under plan-gamma, proving the rule generalizes (second instance)", async () => {
    const { store, fixture } = await migratedStore();

    const plan = planBySlug(fixture, "plan-gamma-boundary-and-empty");
    const allDocs = await mustFindMany(store, { parent_id: plan.id });
    const phaseDocs = allDocs.filter(isPhaseDoc);

    const orphan = findEmptyPhaseByTitle(phaseDocs, "orphan");
    expect(orphan).toBeDefined();
    if (orphan === undefined) return;

    expect(phaseExtraOf(orphan).verification_evidence ?? []).toHaveLength(0);
    expect(phaseExtraOf(orphan).claim).toBeUndefined();

    store.close();
  });
});

// ─── STATE: one-phase-per-task fallback (no phase, no legacy_phase at all) ─────

describe("PhaseMigrationService.migrateTasks — one-phase-per-task fallback (AC-P-5 STATE)", () => {
  it("gives each phase-less, legacy_phase-less task its OWN phase doc, never merged with a sibling", async () => {
    const { store, fixture } = await migratedStore();

    const betaPlan = planBySlug(fixture, "plan-beta-anchors-and-scale");
    const gammaPlan = planBySlug(fixture, "plan-gamma-boundary-and-empty");
    const noPhaseAtAll = taskBySlug(fixture, "task-beta-no-phase-field-at-all");
    const untouchedDraft = taskBySlug(fixture, "task-gamma-untouched-draft");
    const evidenceNoPhase = taskBySlug(fixture, "task-gamma-evidence-no-phase-no-anchors");

    const betaDocs = await mustFindMany(store, { parent_id: betaPlan.id });
    const gammaDocs = await mustFindMany(store, { parent_id: gammaPlan.id });
    const phaseDocs = [...betaDocs, ...gammaDocs].filter(isPhaseDoc);

    for (const task of [noPhaseAtAll, untouchedDraft, evidenceNoPhase]) {
      const ownPhase = findPhaseByMigratedFrom(phaseDocs, [task.id]);
      expect(ownPhase).toBeDefined();
    }

    // evidence fidelity for the one with a non-trivial evidence array
    const ownPhase = findPhaseByMigratedFrom(phaseDocs, [evidenceNoPhase.id]);
    if (ownPhase !== undefined) {
      const merged = phaseExtraOf(ownPhase).verification_evidence ?? [];
      assertEvidenceMergedFaithfully(merged, [
        { taskId: evidenceNoPhase.id, evidence: evidenceOf(evidenceNoPhase) },
      ]);
    }

    store.close();
  });
});

// ─── STATE: every source task ends archived with migrated_to set ──────────────

describe("PhaseMigrationService.migrateTasks — source task disposition (AC-P-5 STATE)", () => {
  it("archives all 13 source tasks and sets extra.migrated_to to an existing phase doc id, regardless of pre-migration status", async () => {
    const { store, fixture } = await migratedStore();

    const allDocs = await mustFindMany(store, {});
    const phaseDocIds = new Set(allDocs.filter(isPhaseDoc).map((d) => d.id));

    const taskIds = fixture.tasks.map((t) => t.id);
    const findResult = await store.findByIds(taskIds);
    if (!findResult.ok) throw new Error(`findByIds failed: ${JSON.stringify(findResult.error)}`);
    const postMigrationTasks = findResult.value;

    expect(postMigrationTasks.size).toBe(13);
    for (const taskId of taskIds) {
      const task = postMigrationTasks.get(taskId);
      expect(task).toBeDefined();
      if (task === undefined) continue;
      expect(task.status).toBe("archived");
      const migratedTo = (task.extra as { migrated_to?: string }).migrated_to;
      expect(typeof migratedTo).toBe("string");
      expect(migratedTo !== undefined && phaseDocIds.has(migratedTo)).toBe(true);
    }

    store.close();
  });
});

// ─── NEGATIVE: dry-run performs zero writes ────────────────────────────────────

describe("PhaseMigrationService.migrateTasks — dry-run (AC-P-5 NEGATIVE)", () => {
  it("computes the same aggregate numbers but writes nothing to the store", async () => {
    const { store, fixture, report } = await migratedStore({ dryRun: true });

    expect(report.dry_run).toBe(true);
    expect(report.phases_created).toBe(11);
    expect(report.tasks_archived).toBe(13);
    expect(report.evidence_merged).toBe(120);

    const allDocs = await mustFindMany(store, {});
    expect(allDocs.filter(isPhaseDoc)).toHaveLength(0);

    // every source task remains exactly as seeded — no status/extra mutation
    for (const seededTask of fixture.tasks) {
      const findResult = await store.find(seededTask.id);
      if (!findResult.ok) throw new Error(`find failed: ${JSON.stringify(findResult.error)}`);
      expect(findResult.value?.status).toBe(seededTask.status);
      expect((findResult.value?.extra as { migrated_to?: string } | undefined)?.migrated_to).toBeUndefined();
    }

    store.close();
  });
});

// ─── ERROR: closed store surfaces a typed Result err, never a throw ────────────

describe("PhaseMigrationService.migrateTasks — closed store (AC-P-5 ERROR)", () => {
  it("returns a Result err instead of throwing when the underlying store is closed", async () => {
    const { store } = await freshSeededStore();
    store.close();

    const PhaseMigrationService = await loadPhaseMigrationServiceCtor();
    const service = new PhaseMigrationService(store);
    const result = await service.migrateTasks({ dryRun: false });

    expect(result.ok).toBe(false);
  });
});

// ─── REGRESSION: second run performs 0 new writes (idempotency) ───────────────

describe("PhaseMigrationService.migrateTasks — idempotent second run (AC-P-5 REGRESSION)", () => {
  it("a second migrateTasks call against an already-migrated corpus creates nothing new and leaves every doc's version untouched", async () => {
    const { store, report: firstReport } = await migratedStore();
    expect(firstReport.phases_created).toBe(11);

    const beforeSecondRun = await mustFindMany(store, {});
    const beforeSnapshot = new Map(beforeSecondRun.map((d) => [d.id, d.version]));

    const PhaseMigrationService = await loadPhaseMigrationServiceCtor();
    const service = new PhaseMigrationService(store);
    const secondResult = await service.migrateTasks({ dryRun: false });
    if (!secondResult.ok) {
      throw new Error(`second migrateTasks failed: ${JSON.stringify(secondResult.error)}`);
    }
    const secondReport = secondResult.value;

    expect(secondReport.phases_created).toBe(0);
    expect(secondReport.tasks_archived).toBe(0);
    expect(secondReport.evidence_merged).toBe(0);

    const afterSecondRun = await mustFindMany(store, {});
    expect(afterSecondRun).toHaveLength(beforeSecondRun.length);

    const afterSnapshot = new Map(afterSecondRun.map((d) => [d.id, d.version]));
    expect(afterSnapshot).toEqual(beforeSnapshot);

    store.close();
  });
});

// ─── STATE: mid-loop store failure reports partial progress (BUG-009) ─────────

/**
 * Wraps a real `SQLiteStore` so its `insert()` fails with a synthetic
 * `STORE_ERROR` on the Nth call whose argument is a `phase`-typed doc — every
 * other call (task/version/audit inserts, `findMany`, `update`, etc.) passes
 * through unmodified via `target.<method>(...)` / a bound `Reflect.get`.
 * Simulates a genuine mid-migration store failure (e.g. disk full, a
 * constraint violation on one specific row) without touching the real
 * `SQLiteStore` implementation.
 */
function wrapStoreFailingNthPhaseInsert(store: SQLiteStore, failOnCount: number): StoreInterface {
  let phaseInsertCount = 0;
  // reason: the write actor is resolved from the store OBJECT's declared write context, which a Proxy does not carry.
  return actedStore(new Proxy(store, {
    get(target, prop, receiver) {
      // reason: defect-clusters D3 — the phase doc now lands through the one write route's `insertWithProvenance`
      // (doc + version + audit in one transaction), not a bare `insert`; the first argument is still the doc.
      if (prop === "insert" || prop === "insertWithProvenance") {
        return async (doc: DocRecord, ...rest: unknown[]) => {
          if ((doc.type as unknown as string) === "phase") {
            phaseInsertCount += 1;
            if (phaseInsertCount === failOnCount) {
              return {
                ok: false,
                error: {
                  code: "STORE_ERROR",
                  message: `synthetic failure: phase-doc insert #${failOnCount}`,
                },
              };
            }
          }
          return (target[prop] as (...a: unknown[]) => unknown)(doc, ...rest);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as StoreInterface);
}

describe("PhaseMigrationService.migrateTasks — mid-loop store failure reports partial progress (BUG-009 STATE)", () => {
  it("returns err.partial matching independently-derived store state, and a retry with a healthy store reaches the fixture's known total", async () => {
    const { store: rawStore, fixture } = await freshSeededStore();
    const FAIL_ON_COUNT = 4; // < 11 total phase groups (see the HAPPY suite above) — a genuine MID-loop failure
    const wrappedStore = wrapStoreFailingNthPhaseInsert(rawStore, FAIL_ON_COUNT);

    const PhaseMigrationService = await loadPhaseMigrationServiceCtor();
    const failingService = new PhaseMigrationService(wrappedStore);
    const result = await failingService.migrateTasks({ dryRun: false });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected migrateTasks to fail on the 4th phase-doc insert");

    expect(result.error.cause.code).toBe("STORE_ERROR");

    // Independently re-derive "what actually landed" from raw store state —
    // NEVER trust the service's own accumulators as ground truth for this
    // assertion. `extra.migrated_to` (not bare `status === "archived"`) is the
    // correct completion marker: some fixture tasks are ALREADY archived
    // pre-migration (see the "source task disposition" suite above), so a
    // bare status check would over-count tasks the migration never touched.
    const allDocsAfterFailure = await mustFindMany(rawStore, {});
    const phaseDocsAfterFailure = allDocsAfterFailure.filter(isPhaseDoc);
    const tasksArchivedAfterFailure = allDocsAfterFailure.filter(
      (d) => rawType(d) === "task" && (d.extra as { migrated_to?: unknown }).migrated_to !== undefined,
    );
    const evidenceMergedAfterFailure = phaseDocsAfterFailure.reduce(
      (sum, doc) => sum + (phaseExtraOf(doc).verification_evidence ?? []).length,
      0,
    );

    // Exactly FAIL_ON_COUNT - 1 phase docs fully committed before the failing
    // insert — the failing group's doc was never persisted, so it contributes
    // nothing to phase doc count, task archival, or evidence merge.
    expect(phaseDocsAfterFailure).toHaveLength(FAIL_ON_COUNT - 1);

    expect(result.error.partial).toEqual({
      phases_created: phaseDocsAfterFailure.length,
      tasks_archived: tasksArchivedAfterFailure.length,
      evidence_merged: evidenceMergedAfterFailure,
    });

    // Sanity: the partial progress is a STRICT subset of the fixture's known
    // full totals (11 phases / 13 tasks / 120 evidence entries) — a failure
    // this early in the loop cannot have already reached completion.
    expect(phaseDocsAfterFailure.length).toBeLessThan(11);
    expect(tasksArchivedAfterFailure.length).toBeLessThan(13);
    expect(evidenceMergedAfterFailure).toBeLessThan(120);

    // Retry with a healthy (unwrapped) store's NEW service instance — the
    // migration must be idempotent-retryable: it skips every already-migrated
    // group/task and completes the remainder, reaching the SAME full totals
    // the uninterrupted HAPPY-path run reaches.
    const healthyService = new PhaseMigrationService(rawStore);
    const retryResult = await healthyService.migrateTasks({ dryRun: false });
    if (!retryResult.ok) {
      throw new Error(`retry migrateTasks failed: ${JSON.stringify(retryResult.error)}`);
    }

    const allDocsAfterRetry = await mustFindMany(rawStore, {});
    const phaseDocsAfterRetry = allDocsAfterRetry.filter(isPhaseDoc);
    expect(phaseDocsAfterRetry).toHaveLength(11);

    const totalEvidenceAfterRetry = phaseDocsAfterRetry.reduce(
      (sum, doc) => sum + (phaseExtraOf(doc).verification_evidence ?? []).length,
      0,
    );
    expect(totalEvidenceAfterRetry).toBe(120);

    for (const seededTask of fixture.tasks) {
      const findResult = await rawStore.find(seededTask.id);
      if (!findResult.ok) throw new Error(`find failed: ${JSON.stringify(findResult.error)}`);
      expect(findResult.value?.status).toBe("archived");
      expect((findResult.value?.extra as { migrated_to?: unknown } | undefined)?.migrated_to).toBeDefined();
    }

    rawStore.close();
  });
});
