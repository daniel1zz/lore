/**
 * AC-084-4 oracle — `OrdinalMigrationService.migrateOrdinals` (SPEC-084
 * §One-shot repair migration). Fixture reproduces the SHAPE of the live
 * 2026-07-26 incident at a small, self-contained numbering scale (no filler
 * docs needed to seed `initialMax` — see the fixture comment below for why):
 *
 *   - specA (declared "SPEC-1"): earliest doc, its export-index mapping is
 *     DRIFTED (`human_id: "SPEC-3"`, mirroring the real SPEC-072/073 export
 *     entries snapping back to their title-declared numbers).
 *   - specB (declared "SPEC-2"): its export-index mapping already matches —
 *     the "nothing to reconcile" control case.
 *   - specC/specD/specE (ALL declared "SPEC-3", a 3-way collision — mirrors
 *     the real 3-session "SPEC-080" incident exactly): specC is earliest
 *     (created_at priority) and keeps 3; specD/specE are collision losers
 *     and get next-free (4, 5).
 *
 * RE-BASELINE (spec-mirror-identifier-ssot-one-writer-for-export-index-human
 * D1/D2, AC-MIS-4, 2026-08-11): the step-3 export-index reconcile at
 * `ordinal-migration-service.ts:743` now composes `human_id` via the PADDED
 * `formatMirrorHumanId` (e.g. `"SPEC-001"`), never the unpadded
 * `formatDocDisplayId` (`"SPEC-1"`) this fixture originally pinned. Padded
 * is the decided canonical mirror form — a user decision recorded BEFORE
 * this fix at `packages/core/src/ordinal.ts:133-145` (2026-08-10,
 * `task-unify-mirror-identifiers-on-zero-padded-form-export-all`): the
 * mirror's filenames have always zero-padded (`SPEC-021-*.md`), and
 * `ExportDocsService` (`export-docs-service.ts:1031`) already composed this
 * SAME field padded — the unpadded pin below was therefore already
 * contradicting a landed decision AND the mirror's own filename convention,
 * not merely "inconvenient." Two things changed, both because specB's
 * `human_id` no longer round-trips as "already correct" once composition is
 * padded:
 *   1. specB's SEEDED mapping (`beforeEach`, below) moved from unpadded
 *      `"SPEC-2"` to padded `"SPEC-002"` — otherwise it would ALSO now
 *      mismatch its own declared ordinal 2 (`formatMirrorHumanId` gives
 *      `"SPEC-002"`, not `"SPEC-2"`), turning it from the deliberate
 *      "nothing to reconcile" HAPPY control case into an UNINTENDED second
 *      reconcile entry — a fixture-input correction, not a pinned-output
 *      weakening (specB was never the subject of this AC; it stays a
 *      zero-reconcile control, just at the correct padded value).
 *   2. specA's PINNED OUTPUTS (`new_human_id`, `suggested_file_path`,
 *      `rename_command`, and the post-`--apply` `human_id` on disk) moved
 *      from unpadded `"SPEC-1"`/`"SPEC-1-alpha-decision.md"` to padded
 *      `"SPEC-001"`/`"SPEC-001-alpha-decision.md"` — this is AC-MIS-4's own
 *      named correction.
 * Measured before this fix (`bun test` on the unmodified pins, this same
 * command): `export_index_reconciles` had length 1 (expected) but its lone
 * entry read `new_human_id: "SPEC-1"`, and after `--apply`,
 * `indexAfterApply.mappings[specA.id]?.human_id` read `"SPEC-1"` — exactly
 * the pre-fix, unpadded composition this whole task replaces. Re-running
 * `bun test packages/lore/tests/unit/store/migrate-ordinals.bun.test.ts`
 * with ONLY specA's re-baseline applied (specB's seed left at unpadded
 * `"SPEC-2"`) reproduces `export_index_reconciles` at length 2, not 1 — the
 * fixture-input correction above is required, not optional, for this suite
 * to still assert what it always asserted (specB stays a zero-reconcile
 * control) rather than silently accepting a second, unintended reconcile.
 *
 * Runner: bun:sqlite (real `SQLiteStore(":memory:")`) — must run under
 * `bun test`, not vitest (project CLAUDE.md "bun:sqlite is external to
 * vitest"). `.lore/export-index.json` lives in a real mkdtemp'd throwaway
 * directory (⛔ never the repo's own `.lore/`).
 *
 * Six-dimension coverage (this fixture's own numbers happen to be densely
 * packed from 1, so dry-run and a live `--apply` run of THIS suite always
 * agree — the second describe block below is what actually distinguishes
 * declared-number-preserving semantics from dense-renumbering; see its own
 * header comment for why some of ITS cases are dry-run-only):
 *   HAPPY:      specB — already-correct export mapping, ordinal matches its
 *               own declared number, changed:false, zero reconcile entries.
 *   NEGATIVE:   dry-run performs literally ZERO writes (store untouched,
 *               export-index.json byte-identical) while computing the exact
 *               SAME report a live run would (true for this densely-packed
 *               fixture; not a universal guarantee, see below).
 *   BOUNDARY:   the 3-way SPEC-3 collision — created_at priority winner
 *               keeps 3, both losers get next-free (4, then 5); bijectivity
 *               holds across all 5 docs.
 *   ERROR:      an unreadable/malformed export-index.json aborts the WHOLE
 *               migration (err Result), never a silent rebuild.
 *   STATE:      title-strip on an `approved` doc leaves `status_before ===
 *               status_after === "approved"` (no approved→draft reset —
 *               this bypasses CorpusService entirely); export-index
 *               `file_path` is left untouched (Scope-Alt: renames are
 *               report-only `git mv` commands, never executed).
 *   REGRESSION: a second `--apply` run performs literally ZERO writes
 *               (idempotent).
 *
 * Source: SPEC-084 §One-shot repair migration, §Acceptance Criteria AC-084-4.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocRecord, ExportIndex } from "@lore/core";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { OrdinalMigrationService } from "../../../src/service/ordinal-migration-service.js";

// ─── Fixture factory ────────────────────────────────────────────────────────

let _counter = 0;

function nextId(): string {
  _counter += 1;
  return `01HORDMIG${String(_counter).padStart(17, "0")}`;
}

function makeSpecDoc(overrides: Partial<DocRecord> & { title: string; created_at: string }): DocRecord {
  _counter += 1;
  const base: DocRecord = {
    id: nextId(),
    slug: `spec-migrate-ordinals-fixture-${_counter}`,
    type: "spec",
    role: "spec",
    title: overrides.title,
    status: "draft",
    priority: "medium",
    content: "Fixture body.",
    parent_id: null,
    created_at: overrides.created_at,
    updated_at: overrides.created_at,
    created_by: "agent:test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ordinal: null,
  };
  return { ...base, ...overrides };
}

function writeExportIndex(projectDir: string, index: ExportIndex): void {
  const loreDir = join(projectDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  writeFileSync(join(loreDir, "export-index.json"), JSON.stringify(index, null, 2) + "\n", "utf8");
}

function readExportIndex(projectDir: string): ExportIndex {
  const raw = readFileSync(join(projectDir, ".lore", "export-index.json"), "utf8");
  return JSON.parse(raw) as ExportIndex;
}

// ─── Suite ──────────────────────────────────────────────────────────────────

describe("OrdinalMigrationService.migrateOrdinals (SPEC-084, AC-084-4)", () => {
  let store: SQLiteStore;
  let projectDir: string;
  let service: OrdinalMigrationService;

  let specA: DocRecord; // declared SPEC-1, drifted export mapping (SPEC-3)
  let specB: DocRecord; // declared SPEC-2, already-correct export mapping (padded SPEC-002 — RE-BASELINE above)
  let specC: DocRecord; // declared SPEC-3, earliest of the collision trio — winner
  let specD: DocRecord; // declared SPEC-3, collision loser #1
  let specE: DocRecord; // declared SPEC-3, collision loser #2, approved status

  beforeEach(async () => {
    store = new SQLiteStore(":memory:");
    projectDir = mkdtempSync(join(tmpdir(), "lore-migrate-ordinals-"));
    service = new OrdinalMigrationService(store);

    specA = makeSpecDoc({ title: "SPEC-1 — Alpha decision", created_at: "2026-01-01T00:00:00.000Z", status: "approved" });
    specB = makeSpecDoc({ title: "SPEC-2 — Beta workflow", created_at: "2026-01-02T00:00:00.000Z" });
    specC = makeSpecDoc({ title: "SPEC-3 — Triple collision winner", created_at: "2026-01-03T00:00:00.000Z" });
    specD = makeSpecDoc({ title: "SPEC-3 — Triple collision loser one", created_at: "2026-01-04T00:00:00.000Z" });
    specE = makeSpecDoc({
      title: "SPEC-3 — Triple collision loser two",
      created_at: "2026-01-05T00:00:00.000Z",
      status: "approved",
    });

    for (const doc of [specA, specB, specC, specD, specE]) {
      const result = await store.insert(doc);
      expect(result.ok).toBe(true);
    }

    writeExportIndex(projectDir, {
      version: 1,
      mappings: {
        [specA.id]: { human_id: "SPEC-3", file_path: "docs/requirements/spec/SPEC-3-alpha-decision.md" },
        // RE-BASELINE (2026-08-11, ordinal.ts:133-145): padded SPEC-002, not unpadded
        // SPEC-2 — see this file's module-header RE-BASELINE note, point 1.
        [specB.id]: { human_id: "SPEC-002", file_path: "docs/requirements/spec/SPEC-2-beta-workflow.md" },
      },
    });
  });

  afterEach(() => {
    store.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  // ── HAPPY + BOUNDARY: dry-run computes the full converging report ───────
  it("dry-run computes created_at-priority ordinal assignments, bijectivity, and mapping completeness with ZERO writes", async () => {
    const result = await service.migrateOrdinals({ dryRun: true, projectDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const report = result.value;

    expect(report.dry_run).toBe(true);
    expect(report.writes_performed).toBe(0);
    expect(report.errors).toEqual([]);
    expect(report.numbered_doc_count).toBe(5);
    expect(report.bijective).toBe(true);

    // Every reassignment is present — zero silent moves.
    expect(report.reassignments).toHaveLength(5);
    const byId = new Map(report.reassignments.map((r) => [r.doc_id, r]));

    const a = byId.get(specA.id);
    expect(a?.declared_ordinal).toBe(1);
    expect(a?.old_display).toBe("SPEC-1");
    expect(a?.new_ordinal).toBe(1);
    expect(a?.new_display).toBe("SPEC-1");
    expect(a?.changed).toBe(false);

    const b = byId.get(specB.id);
    expect(b?.new_ordinal).toBe(2);
    expect(b?.changed).toBe(false);

    const c = byId.get(specC.id);
    expect(c?.declared_ordinal).toBe(3);
    expect(c?.new_ordinal).toBe(3);
    expect(c?.changed).toBe(false); // created_at-earliest winner keeps its declared number

    const d = byId.get(specD.id);
    expect(d?.declared_ordinal).toBe(3);
    expect(d?.new_ordinal).toBe(4); // collision loser -> next-free
    expect(d?.changed).toBe(true);

    const e = byId.get(specE.id);
    expect(e?.declared_ordinal).toBe(3);
    expect(e?.new_ordinal).toBe(5); // second collision loser -> next-free
    expect(e?.changed).toBe(true);

    // Title strip is simulated too (dry-run), status untouched.
    expect(report.title_strips).toHaveLength(5);
    const stripA = report.title_strips.find((t) => t.doc_id === specA.id);
    expect(stripA?.new_title).toBe("Alpha decision");
    expect(stripA?.status_before).toBe("approved");
    expect(stripA?.status_after).toBe("approved");

    // Export-index reconcile: only specA's drifted mapping needs converging;
    // specB already matches (no entry, nothing silently changed either way);
    // specC/D/E were never exported (no mapping) so nothing to reconcile.
    expect(report.export_index_reconciles).toHaveLength(1);
    const reconcile = report.export_index_reconciles[0];
    expect(reconcile?.doc_id).toBe(specA.id);
    // RE-BASELINE (2026-08-11, ordinal.ts:133-145): new_human_id/suggested_file_path/
    // rename_command corrected from unpadded SPEC-1/SPEC-1-alpha-decision.md to the
    // padded SPEC-001/SPEC-001-alpha-decision.md form — see this file's module-header
    // RE-BASELINE note, point 2. old_human_id stays "SPEC-3": it is the literal DRIFTED
    // value this fixture seeds above, read back verbatim, never composed by the fix.
    expect(reconcile?.old_human_id).toBe("SPEC-3");
    expect(reconcile?.new_human_id).toBe("SPEC-001");
    expect(reconcile?.file_path).toBe("docs/requirements/spec/SPEC-3-alpha-decision.md");
    expect(reconcile?.suggested_file_path).toBe("docs/requirements/spec/SPEC-001-alpha-decision.md");
    expect(reconcile?.rename_command).toBe(
      "git mv 'docs/requirements/spec/SPEC-3-alpha-decision.md' 'docs/requirements/spec/SPEC-001-alpha-decision.md'",
    );

    // NEGATIVE: dry-run touched NOTHING — re-fetch and verify byte-for-byte.
    const reFetched = await store.find(specA.id);
    expect(reFetched.ok).toBe(true);
    if (reFetched.ok) {
      expect(reFetched.value?.ordinal ?? null).toBe(null);
      expect(reFetched.value?.title).toBe("SPEC-1 — Alpha decision");
      expect(reFetched.value?.version).toBe(1);
    }
    const indexAfterDryRun = readExportIndex(projectDir);
    expect(indexAfterDryRun.mappings[specA.id]?.human_id).toBe("SPEC-3");
  });

  // ── STATE + REGRESSION: --apply executes, converges, and is idempotent ──
  it("--apply executes the SAME plan, strips titles without a status reset, converges export-index, and is idempotent on a second run", async () => {
    const applyResult = await service.migrateOrdinals({ dryRun: false, projectDir });
    expect(applyResult.ok).toBe(true);
    if (!applyResult.ok) return;
    const report = applyResult.value;

    expect(report.dry_run).toBe(false);
    expect(report.errors).toEqual([]);
    expect(report.bijective).toBe(true);
    expect(report.numbered_doc_count).toBe(5);
    // 5 ordinal writes + 5 title-strip writes + 1 export-index file write.
    expect(report.writes_performed).toBe(11);

    const byId = new Map(report.reassignments.map((r) => [r.doc_id, r]));
    expect(byId.get(specA.id)?.new_ordinal).toBe(1);
    expect(byId.get(specB.id)?.new_ordinal).toBe(2);
    expect(byId.get(specC.id)?.new_ordinal).toBe(3);
    expect(byId.get(specD.id)?.new_ordinal).toBe(4);
    expect(byId.get(specE.id)?.new_ordinal).toBe(5);

    // Store state actually converged.
    const freshA = await store.find(specA.id);
    expect(freshA.ok).toBe(true);
    if (freshA.ok) {
      expect(freshA.value?.ordinal).toBe(1);
      expect(freshA.value?.title).toBe("Alpha decision");
      expect(freshA.value?.status).toBe("approved"); // NO approved -> draft reset
    }

    const freshE = await store.find(specE.id);
    expect(freshE.ok).toBe(true);
    if (freshE.ok) {
      expect(freshE.value?.ordinal).toBe(5);
      expect(freshE.value?.title).toBe("Triple collision loser two");
      expect(freshE.value?.status).toBe("approved"); // NO approved -> draft reset
    }

    // Export-index human_id converged; file_path left untouched (Scope-Alt —
    // renames are report-only, never executed against the filesystem).
    // RE-BASELINE (2026-08-11, ordinal.ts:133-145): specA's converged human_id is now
    // padded SPEC-001 (was unpadded SPEC-1) — see this file's module-header RE-BASELINE
    // note, point 2. specB's asserted value is padded SPEC-002 because its SEEDED
    // mapping was corrected to that value above (point 1) — it was never reconciled by
    // this run (report.export_index_reconciles above has length 1, specA only).
    const indexAfterApply = readExportIndex(projectDir);
    expect(indexAfterApply.mappings[specA.id]?.human_id).toBe("SPEC-001");
    expect(indexAfterApply.mappings[specA.id]?.file_path).toBe("docs/requirements/spec/SPEC-3-alpha-decision.md");
    expect(indexAfterApply.mappings[specB.id]?.human_id).toBe("SPEC-002");

    // REGRESSION: a second --apply run performs literally zero writes.
    const secondRun = await service.migrateOrdinals({ dryRun: false, projectDir });
    expect(secondRun.ok).toBe(true);
    if (!secondRun.ok) return;
    expect(secondRun.value.writes_performed).toBe(0);
    expect(secondRun.value.reassignments).toEqual([]);
    expect(secondRun.value.title_strips).toEqual([]);
    expect(secondRun.value.export_index_reconciles).toEqual([]);
    expect(secondRun.value.errors).toEqual([]);
    expect(secondRun.value.bijective).toBe(true);
    expect(secondRun.value.numbered_doc_count).toBe(5);
  });

  // ── ERROR: a corrupt export-index.json aborts the whole migration ──────
  it("aborts the whole migration (err Result) on a malformed export-index.json, never silently rebuilding it", async () => {
    writeFileSync(join(projectDir, ".lore", "export-index.json"), "{ not valid json", "utf8");

    const result = await service.migrateOrdinals({ dryRun: true, projectDir });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");

    // Nothing was touched — not even the ordinal backfill (whole-migration abort).
    const stillA = await store.find(specA.id);
    expect(stillA.ok).toBe(true);
    if (stillA.ok) expect(stillA.value?.ordinal ?? null).toBe(null);
  });

  // ── HAPPY: an ABSENT export-index.json is a legitimate empty state ─────
  it("treats an absent export-index.json as empty (nothing to reconcile), not corruption", async () => {
    const freshDir = mkdtempSync(join(tmpdir(), "lore-migrate-ordinals-noindex-"));
    try {
      expect(existsSync(join(freshDir, ".lore", "export-index.json"))).toBe(false);
      const result = await service.migrateOrdinals({ dryRun: true, projectDir: freshDir });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.export_index_reconciles).toEqual([]);
        expect(result.value.errors).toEqual([]);
      }
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
    }
  });
});

/**
 * 2026-07-27 backfill-semantics fix oracle — the fixtures the ORIGINAL
 * suite above could never catch, because its own numbers (1, 2, 3×3) are
 * densely packed from 1: a dense-renumber bug and a declared-number-
 * preserving fix are INDISTINGUISHABLE on that fixture (both produce
 * 1,2,3,4,5). These cases were proven wrong by a live dry run against the
 * real team corpus (SPEC-027→SPEC-1, SPEC-035→SPEC-9, SPEC-084→SPEC-56 — a
 * dense renumber that discarded every genuinely non-colliding declared
 * number) BEFORE this fix; each `it()` below is the smallest fixture that
 * would have failed the OLD `compareOrdinalCandidates`-based algorithm and
 * passes the NEW tier1/tier2/cascade one.
 *
 * Each test gets its own fresh store/throwaway dir (no shared `specA..E`
 * fixture) so its numbering space is genuinely isolated.
 *
 * 2026-07-27 ADJUDICATION FOLLOW-UP: an earlier revision of this fix fed
 * the computed target through `allocateOrdinalForExisting`'s MAX+1-only
 * mechanism for a live `--apply` run, which only reconstructed the target
 * when the claimed-number set happened to be dense — REJECTED by the
 * orchestrator (the live corpus has real historical gaps; "report says X,
 * apply does Y" violates the plan's R5 mitigation that the two must be
 * equal BY CONSTRUCTION). The fix now routes the apply path through
 * `StoreInterface.assignOrdinalForRepair` (SPEC-084 D7's sanctioned
 * internal repair-migration path — a direct targeted assignment, never a
 * MAX+1 allocation), so EVERY fixture below — including the genuinely
 * gapped ones (a)/(d) — asserts a REAL `--apply` run persists the
 * identical numbers the dry-run report predicted.
 *
 * Six-dimension coverage:
 *   HAPPY:      (a) three non-colliding declared numbers with real gaps
 *               between them are preserved verbatim, in BOTH dry-run and a
 *               real `--apply` run (gaps 28-34/36-83 are never filled).
 *   BOUNDARY:   (b) the worked-example cascade shape — two same-number
 *               collisions bump forward, and a third doc's OWN declared
 *               number collides with where the second bump landed.
 *   STATE:      (c) tier-2 (export-index-only) claims are honored when
 *               free, and lose precedence to a tier-1 (title) claim on the
 *               same number (bumped forward, never silently dropped).
 *   ERROR:      (d) an unclaimed doc never recycles a real historical gap
 *               below the highest claimed/assigned number, in BOTH modes.
 *   NEGATIVE:   every fixture asserts `changed` precisely — a doc that
 *               keeps its declared number is NEVER reported `changed:true`;
 *               a dedicated case additionally proves `assignOrdinalForRepair`
 *               refuses a target already held by another live row — loud
 *               error, zero writes (a migration-plan bug, never silently
 *               resolved).
 *   REGRESSION: EVERY fixture asserts the identical numbers persist through
 *               a REAL `--apply` run (not just the report) — dry-run and
 *               apply are equal by construction on any topology.
 *
 * Source: SPEC-084 §One-shot repair migration, orchestrator-adjudicated
 * declared-number-claim algorithm (task-skill-implement-fix-ordinal-
 * backfill-semantics-declared).
 */
describe("OrdinalMigrationService.migrateOrdinals — declared-number claims preserved, not dense renumber", () => {
  let store: SQLiteStore;
  let projectDir: string;
  let service: OrdinalMigrationService;

  beforeEach(() => {
    store = new SQLiteStore(":memory:");
    projectDir = mkdtempSync(join(tmpdir(), "lore-migrate-ordinals-claims-"));
    service = new OrdinalMigrationService(store);
  });

  afterEach(() => {
    store.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  // ── (a) HAPPY: non-colliding declared numbers, real gaps, preserved ────
  it("(a) preserves non-colliding title-declared numbers VERBATIM across real gaps — never compacts to 1/2/3", async () => {
    const docLow = makeSpecDoc({ title: "SPEC-27 — Sparse alpha", created_at: "2026-01-01T00:00:00.000Z" });
    const docMid = makeSpecDoc({ title: "SPEC-35 — Sparse beta", created_at: "2026-01-02T00:00:00.000Z" });
    const docHigh = makeSpecDoc({ title: "SPEC-84 — Sparse gamma", created_at: "2026-01-03T00:00:00.000Z" });
    for (const doc of [docLow, docMid, docHigh]) {
      const result = await store.insert(doc);
      expect(result.ok).toBe(true);
    }

    // 27, 35, 84 are genuine historical gaps (nothing claims 28-34 or
    // 36-83) — `assignOrdinalForRepair` (SPEC-084 D7) writes each doc's own
    // target directly, so a live --apply run reconstructs them exactly too.
    const dryResult = await service.migrateOrdinals({ dryRun: true, projectDir });
    expect(dryResult.ok).toBe(true);
    if (!dryResult.ok) return;
    const report = dryResult.value;

    const byId = new Map(report.reassignments.map((r) => [r.doc_id, r]));
    expect(byId.get(docLow.id)).toMatchObject({
      declared_ordinal: 27,
      claim_source: "title",
      new_ordinal: 27,
      changed: false,
    });
    expect(byId.get(docMid.id)).toMatchObject({
      declared_ordinal: 35,
      claim_source: "title",
      new_ordinal: 35,
      changed: false,
    });
    expect(byId.get(docHigh.id)).toMatchObject({
      declared_ordinal: 84,
      claim_source: "title",
      new_ordinal: 84,
      changed: false,
    });
    expect(report.unchanged_count).toBe(3);
    expect(report.changed_count).toBe(0);
    expect(report.bijective).toBe(true);

    // REGRESSION: a real --apply run persists the IDENTICAL numbers — dry
    // run and apply are equal by construction, gaps preserved on-disk too.
    const applyResult = await service.migrateOrdinals({ dryRun: false, projectDir });
    expect(applyResult.ok).toBe(true);
    if (!applyResult.ok) return;
    expect(applyResult.value.errors).toEqual([]);
    const applyById = new Map(applyResult.value.reassignments.map((r) => [r.doc_id, r]));
    expect(applyById.get(docLow.id)?.new_ordinal).toBe(27);
    expect(applyById.get(docMid.id)?.new_ordinal).toBe(35);
    expect(applyById.get(docHigh.id)?.new_ordinal).toBe(84);

    const freshLow = await store.find(docLow.id);
    expect(freshLow.ok && freshLow.value?.ordinal).toBe(27);
    const freshMid = await store.find(docMid.id);
    expect(freshMid.ok && freshMid.value?.ordinal).toBe(35);
    const freshHigh = await store.find(docHigh.id);
    expect(freshHigh.ok && freshHigh.value?.ordinal).toBe(84);
  });

  // ── (b) BOUNDARY: worked-example cascade shape (dense — both modes) ────
  it("(b) cascades a same-number collision forward, then bumps a third doc's OWN claim that collides with the landing spot", async () => {
    const docFirst = makeSpecDoc({ title: "SPEC-1 — Cascade first claimant", created_at: "2026-02-01T00:00:00.000Z" });
    const docSecond = makeSpecDoc({ title: "SPEC-1 — Cascade second claimant", created_at: "2026-02-02T00:00:00.000Z" });
    const docThird = makeSpecDoc({ title: "SPEC-2 — Cascade third claimant", created_at: "2026-02-03T00:00:00.000Z" });

    // Dry-run first.
    for (const doc of [docFirst, docSecond, docThird]) {
      const result = await store.insert(doc);
      expect(result.ok).toBe(true);
    }
    const dryResult = await service.migrateOrdinals({ dryRun: true, projectDir });
    expect(dryResult.ok).toBe(true);
    if (!dryResult.ok) return;
    const dryById = new Map(dryResult.value.reassignments.map((r) => [r.doc_id, r]));
    expect(dryById.get(docFirst.id)).toMatchObject({ declared_ordinal: 1, new_ordinal: 1, changed: false });
    expect(dryById.get(docSecond.id)).toMatchObject({ declared_ordinal: 1, new_ordinal: 2, changed: true });
    expect(dryById.get(docThird.id)).toMatchObject({ declared_ordinal: 2, new_ordinal: 3, changed: true });
    expect(dryResult.value.unchanged_count).toBe(1);
    expect(dryResult.value.changed_count).toBe(2);

    // REGRESSION: a real --apply run of this SAME (dense, gap-free) fixture
    // persists the identical numbers — the fix is not just a report-time
    // simulation.
    const applyResult = await service.migrateOrdinals({ dryRun: false, projectDir });
    expect(applyResult.ok).toBe(true);
    if (!applyResult.ok) return;
    const applyById = new Map(applyResult.value.reassignments.map((r) => [r.doc_id, r]));
    expect(applyById.get(docFirst.id)?.new_ordinal).toBe(1);
    expect(applyById.get(docSecond.id)?.new_ordinal).toBe(2);
    expect(applyById.get(docThird.id)?.new_ordinal).toBe(3);

    const freshFirst = await store.find(docFirst.id);
    expect(freshFirst.ok && freshFirst.value?.ordinal).toBe(1);
    const freshSecond = await store.find(docSecond.id);
    expect(freshSecond.ok && freshSecond.value?.ordinal).toBe(2);
    const freshThird = await store.find(docThird.id);
    expect(freshThird.ok && freshThird.value?.ordinal).toBe(3);
  });

  // ── (c) STATE: tier-2 claim kept, and loses to a tier-1 collision ──────
  it("(c) a tier-2 (export-index-only) claim is honored when free, and loses to a tier-1 (title) claim on the same number", async () => {
    // No title-declared number — the ONLY claim source is the export index
    // (tier 2, models a legacy pre-title-convention doc).
    const docTier2Solo = makeSpecDoc({ title: "Legacy solo doc, no title number", created_at: "2026-03-01T00:00:00.000Z" });
    const docTier1Winner = makeSpecDoc({ title: "SPEC-2 — Tier1 winner", created_at: "2026-03-02T00:00:00.000Z" });
    const docTier2Loser = makeSpecDoc({ title: "Legacy loser doc, no title number", created_at: "2026-03-03T00:00:00.000Z" });

    for (const doc of [docTier2Solo, docTier1Winner, docTier2Loser]) {
      const result = await store.insert(doc);
      expect(result.ok).toBe(true);
    }
    writeExportIndex(projectDir, {
      version: 1,
      mappings: {
        [docTier2Solo.id]: { human_id: "SPEC-1", file_path: "docs/requirements/spec/legacy-solo.md" },
        [docTier2Loser.id]: { human_id: "SPEC-2", file_path: "docs/requirements/spec/legacy-loser.md" },
      },
    });

    const dryResult = await service.migrateOrdinals({ dryRun: true, projectDir });
    expect(dryResult.ok).toBe(true);
    if (!dryResult.ok) return;
    const dryById = new Map(dryResult.value.reassignments.map((r) => [r.doc_id, r]));
    expect(dryById.get(docTier2Solo.id)).toMatchObject({
      declared_ordinal: 1,
      claim_source: "export_index",
      new_ordinal: 1,
      changed: false,
    });
    expect(dryById.get(docTier1Winner.id)).toMatchObject({
      declared_ordinal: 2,
      claim_source: "title",
      new_ordinal: 2,
      changed: false,
    });
    // Tier 1 is resolved entirely before tier 2, so docTier1Winner claims 2
    // FIRST — docTier2Loser's identical claim of 2 is bumped to next-free.
    expect(dryById.get(docTier2Loser.id)).toMatchObject({
      declared_ordinal: 2,
      claim_source: "export_index",
      new_ordinal: 3,
      changed: true,
    });

    // REGRESSION: dense (1,2,3) from a virgin store — a real --apply run
    // persists the identical numbers.
    const applyResult = await service.migrateOrdinals({ dryRun: false, projectDir });
    expect(applyResult.ok).toBe(true);
    if (!applyResult.ok) return;
    const freshSolo = await store.find(docTier2Solo.id);
    expect(freshSolo.ok && freshSolo.value?.ordinal).toBe(1);
    const freshWinner = await store.find(docTier1Winner.id);
    expect(freshWinner.ok && freshWinner.value?.ordinal).toBe(2);
    const freshLoser = await store.find(docTier2Loser.id);
    expect(freshLoser.ok && freshLoser.value?.ordinal).toBe(3);
  });

  // ── (d) ERROR: unclaimed doc lands strictly above max, never a gap-fill ─
  it("(d) an unclaimed doc lands strictly above the highest claim — never recycling a lower, unclaimed historical gap", async () => {
    const docClaimLow = makeSpecDoc({ title: "SPEC-1 — Claim one", created_at: "2026-04-01T00:00:00.000Z" });
    const docClaimHigh = makeSpecDoc({ title: "SPEC-5 — Claim five", created_at: "2026-04-02T00:00:00.000Z" });
    // No title number, no export-index mapping at all — genuinely unclaimed.
    const docUnclaimed = makeSpecDoc({ title: "Brand new doc, never numbered", created_at: "2026-04-03T00:00:00.000Z" });

    for (const doc of [docClaimLow, docClaimHigh, docUnclaimed]) {
      const result = await store.insert(doc);
      expect(result.ok).toBe(true);
    }

    // 2,3,4 are a genuine gap between the two declared numbers (nothing
    // claims them) — `assignOrdinalForRepair` writes each target directly,
    // so a live --apply run never fills that gap either.
    const dryResult = await service.migrateOrdinals({ dryRun: true, projectDir });
    expect(dryResult.ok).toBe(true);
    if (!dryResult.ok) return;
    const byId = new Map(dryResult.value.reassignments.map((r) => [r.doc_id, r]));

    expect(byId.get(docClaimLow.id)).toMatchObject({ declared_ordinal: 1, new_ordinal: 1, changed: false });
    expect(byId.get(docClaimHigh.id)).toMatchObject({ declared_ordinal: 5, new_ordinal: 5, changed: false });
    // Strictly above 5 (the highest claim) — NEVER 2 (the smallest free
    // gap). `changed: true` here simply reflects "declared nothing, now
    // carries a number" (null !== 6) — the SAME semantics an unclaimed doc
    // always had, unrelated to this fix.
    expect(byId.get(docUnclaimed.id)).toMatchObject({
      declared_ordinal: null,
      claim_source: null,
      new_ordinal: 6,
      changed: true,
    });

    // REGRESSION: a real --apply run persists the IDENTICAL numbers — the
    // gap (2,3,4) stays permanently unoccupied on-disk, never recycled.
    const applyResult = await service.migrateOrdinals({ dryRun: false, projectDir });
    expect(applyResult.ok).toBe(true);
    if (!applyResult.ok) return;
    expect(applyResult.value.errors).toEqual([]);

    const freshLow = await store.find(docClaimLow.id);
    expect(freshLow.ok && freshLow.value?.ordinal).toBe(1);
    const freshHigh = await store.find(docClaimHigh.id);
    expect(freshHigh.ok && freshHigh.value?.ordinal).toBe(5);
    const freshUnclaimed = await store.find(docUnclaimed.id);
    expect(freshUnclaimed.ok && freshUnclaimed.value?.ordinal).toBe(6);
  });

  // ── NEGATIVE: assignOrdinalForRepair refuses a target held by another live row ─
  it("(negative) assignOrdinalForRepair targeting an ordinal already held by another live row refuses loud, zero writes", async () => {
    const docHolder = makeSpecDoc({ title: "SPEC-9 — Already numbered", created_at: "2026-05-01T00:00:00.000Z" });
    const insertHolder = await store.insert(docHolder);
    expect(insertHolder.ok).toBe(true);
    // Directly assign 9 to docHolder via the SAME repair path this suite is
    // exercising — establishes a live row genuinely occupying ordinal 9.
    const seedAssign = await store.assignOrdinalForRepair(docHolder.id, 9);
    expect(seedAssign.ok).toBe(true);

    const docChallenger = makeSpecDoc({ title: "SPEC-9 — Different doc, same target", created_at: "2026-05-02T00:00:00.000Z" });
    const insertChallenger = await store.insert(docChallenger);
    expect(insertChallenger.ok).toBe(true);

    // A migration-plan bug: something computed target 9 for docChallenger
    // even though docHolder already legitimately occupies it. This MUST be
    // a loud, immediate error — never silently resolved to a different number.
    const collisionResult = await store.assignOrdinalForRepair(docChallenger.id, 9);
    expect(collisionResult.ok).toBe(false);
    if (collisionResult.ok) return;
    expect(collisionResult.error.code).toBe("STORE_ERROR");

    // Zero writes — docChallenger's ordinal is still null, docHolder's is untouched.
    const freshChallenger = await store.find(docChallenger.id);
    expect(freshChallenger.ok && (freshChallenger.value?.ordinal ?? null)).toBe(null);
    const freshHolder = await store.find(docHolder.id);
    expect(freshHolder.ok && freshHolder.value?.ordinal).toBe(9);
  });
});
