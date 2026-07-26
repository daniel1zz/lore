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
 * Runner: bun:sqlite (real `SQLiteStore(":memory:")`) — must run under
 * `bun test`, not vitest (project CLAUDE.md "bun:sqlite is external to
 * vitest"). `.lore/export-index.json` lives in a real mkdtemp'd throwaway
 * directory (⛔ never the repo's own `.lore/`).
 *
 * Six-dimension coverage:
 *   HAPPY:      specB — already-correct export mapping, ordinal matches its
 *               own declared number, changed:false, zero reconcile entries.
 *   NEGATIVE:   dry-run performs literally ZERO writes (store untouched,
 *               export-index.json byte-identical) while computing the exact
 *               SAME report a live run would.
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
  let specB: DocRecord; // declared SPEC-2, already-correct export mapping
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
        [specB.id]: { human_id: "SPEC-2", file_path: "docs/requirements/spec/SPEC-2-beta-workflow.md" },
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
    expect(reconcile?.old_human_id).toBe("SPEC-3");
    expect(reconcile?.new_human_id).toBe("SPEC-1");
    expect(reconcile?.file_path).toBe("docs/requirements/spec/SPEC-3-alpha-decision.md");
    expect(reconcile?.suggested_file_path).toBe("docs/requirements/spec/SPEC-1-alpha-decision.md");
    expect(reconcile?.rename_command).toBe(
      "git mv 'docs/requirements/spec/SPEC-3-alpha-decision.md' 'docs/requirements/spec/SPEC-1-alpha-decision.md'",
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
    const indexAfterApply = readExportIndex(projectDir);
    expect(indexAfterApply.mappings[specA.id]?.human_id).toBe("SPEC-1");
    expect(indexAfterApply.mappings[specA.id]?.file_path).toBe("docs/requirements/spec/SPEC-3-alpha-decision.md");
    expect(indexAfterApply.mappings[specB.id]?.human_id).toBe("SPEC-2");

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
