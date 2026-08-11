/**
 * AC-MIS-1 oracle (spec-mirror-identifier-ssot D1/D2) —
 * `OrdinalMigrationService`'s step-3 export-index reconcile MUST compose the
 * expected `human_id` via `formatMirrorHumanId` (padded, e.g. `"SPEC-001"`),
 * never `formatDocDisplayId` (unpadded, e.g. `"SPEC-1"`), because
 * `ExportDocsService` (`export-docs-service.ts:1031`) composes the SAME field
 * with the padded formatter and self-heals any disagreement by deleting the
 * mapping — a migration that writes the unpadded form back oscillates
 * forever on every export/migrate cycle (measured on `main` @ `6be150ef`).
 *
 * ⛔ The fixture below seeds an UNPADDED stored mapping deliberately. A
 * padded-seeded fixture would already match `formatMirrorHumanId`'s output,
 * producing zero reconcile entries — the exact vacuity trap this AC exists
 * to avoid (there would be nothing to assert about the padded fields at
 * all). Seeding unpadded is what FORCES the reconcile diff this suite reads.
 *
 * Distinct from `migrate-ordinals.bun.test.ts` (AC-084-4, tiering/collision
 * semantics of the ordinal BACKFILL step) and
 * `mirror-roundtrip-idempotency.bun.test.ts` (AC-MIS-2, the full CLI
 * export<->migrate seam) — this file's only concern is the human_id
 * COMPOSITION invariant at the reconcile step itself.
 *
 * Six-dimension coverage:
 *   HAPPY:      an unpadded legacy mapping ("SPEC-1") reconciles to the
 *               padded form ("SPEC-001") across old_human_id/new_human_id/
 *               suggested_file_path/rename_command, while the SAME entry's
 *               sibling `reassignments[].new_display` stays unpadded
 *               ("SPEC-1") — D2's display/mirror split asserted directly,
 *               not resting on AC-084-3 alone.
 *   NEGATIVE:   a mapping that is ALREADY correctly padded produces ZERO
 *               reconcile entries — the mechanism must not fire when there
 *               is genuinely nothing to converge.
 *   BOUNDARY:   an ordinal >= 100 (three digits) needs no left-padding at
 *               all, so a legacy UNPADDED mapping at that width is
 *               byte-identical to the padded form and produces zero
 *               reconcile entries too (padding is a no-op at/above `width`).
 *   ERROR:      a malformed `export-index.json` aborts the WHOLE migration
 *               (`err` Result, `VALIDATION_ERROR`) rather than silently
 *               skipping the reconcile step.
 *   STATE:      a dry run computes the padded reconcile entry but leaves
 *               `.lore/export-index.json` byte-UNCHANGED on disk (still the
 *               unpadded legacy value) — the reconcile computation is
 *               side-effect-free until `--apply`.
 *   REGRESSION: a live `--apply` run actually PERSISTS the padded value into
 *               `.lore/export-index.json` on disk, not just in the report.
 *
 * Runner: bun:sqlite (real `SQLiteStore(":memory:")`) — must run under
 * `bun test`, not vitest (project CLAUDE.md "bun:sqlite is external to
 * vitest"). `.lore/export-index.json` lives in a real mkdtemp'd throwaway
 * directory (⛔ never the repo's own `.lore/`).
 *
 * Source: spec-mirror-identifier-ssot-one-writer-for-export-index-human,
 * Acceptance Criteria AC-MIS-1.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocRecord, ExportIndex, MirrorHumanId } from "@lore/core";
import { assertIsMirrorHumanId } from "@lore/core";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { OrdinalMigrationService } from "../../../src/service/ordinal-migration-service.js";

/**
 * Narrows a raw human_id string literal to the branded {@link MirrorHumanId} for fixture
 * construction — via {@link assertIsMirrorHumanId}, never a textual `as MirrorHumanId` cast
 * (`scripts/check-ordinal-write-sites.mjs`'s rule (c) confines that cast to
 * `packages/core/src/schemas.ts` alone; a fixture file is not that file). Local to this suite,
 * per this file's own precedent (see the fixture-factory comment above) of a per-suite-local
 * factory rather than a cross-file fixture module.
 */
function brandedHumanId(value: string): MirrorHumanId {
  assertIsMirrorHumanId(value);
  return value;
}

// ─── Fixture factory (mirrors migrate-ordinals.bun.test.ts's own local
// factory — deliberately NOT imported/shared, per that file's own precedent
// of a per-suite-local factory rather than a cross-file fixture module). ───

let _counter = 0;

function nextId(): string {
  _counter += 1;
  return `01HMISSSOT${String(_counter).padStart(16, "0")}`;
}

function makeSpecDoc(overrides: Partial<DocRecord> & { title: string; created_at: string }): DocRecord {
  _counter += 1;
  const base: DocRecord = {
    id: nextId(),
    slug: `spec-mirror-human-id-ssot-fixture-${_counter}`,
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

describe("OrdinalMigrationService step-3 reconcile composes human_id via formatMirrorHumanId (AC-MIS-1)", () => {
  let store: SQLiteStore;
  let projectDir: string;
  let service: OrdinalMigrationService;

  beforeEach(() => {
    store = new SQLiteStore(":memory:");
    projectDir = mkdtempSync(join(tmpdir(), "lore-mirror-human-id-ssot-"));
    service = new OrdinalMigrationService(store);
  });

  afterEach(() => {
    store.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  // ── HAPPY: unpadded legacy mapping reconciles to padded, display stays unpadded ──
  it("HAPPY: reconciles an UNPADDED legacy mapping to the padded form; the sibling new_display stays unpadded", async () => {
    const doc = makeSpecDoc({ title: "SPEC-1 — Alpha decision", created_at: "2026-01-01T00:00:00.000Z" });
    const insertResult = await store.insert(doc);
    expect(insertResult.ok).toBe(true);

    // ⛔ Deliberately UNPADDED — the exact legacy shape ordinal-migration-service.ts
    // used to write back via formatDocDisplayId, which this AC forbids.
    writeExportIndex(projectDir, {
      version: 1,
      mappings: {
        [doc.id]: { human_id: brandedHumanId("SPEC-1"), file_path: "docs/requirements/spec/SPEC-1-alpha-decision.md" },
      },
    });

    const result = await service.migrateOrdinals({ dryRun: true, projectDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const report = result.value;

    expect(report.export_index_reconciles).toHaveLength(1);
    const reconcile = report.export_index_reconciles[0];
    expect(reconcile?.doc_id).toBe(doc.id);
    expect(reconcile?.old_human_id).toBe("SPEC-1");
    expect(reconcile?.new_human_id).toBe("SPEC-001");
    expect(reconcile?.suggested_file_path).toBe("docs/requirements/spec/SPEC-001-alpha-decision.md");
    expect(reconcile?.rename_command).toBe(
      "git mv 'docs/requirements/spec/SPEC-1-alpha-decision.md' 'docs/requirements/spec/SPEC-001-alpha-decision.md'",
    );

    // D2: the report's display field (a DIFFERENT consumer's contract, pinned
    // by AC-084-3) stays UNPADDED on the very same doc's reassignment entry —
    // asserted here, not left resting on AC-084-3 alone.
    const reassignment = report.reassignments.find((r) => r.doc_id === doc.id);
    expect(reassignment?.new_display).toBe("SPEC-1");
  });

  // ── NEGATIVE: already-padded mapping produces zero reconcile entries ────
  it("NEGATIVE: a mapping ALREADY in the padded form produces zero reconcile entries", async () => {
    const doc = makeSpecDoc({ title: "SPEC-2 — Beta workflow", created_at: "2026-01-02T00:00:00.000Z" });
    const insertResult = await store.insert(doc);
    expect(insertResult.ok).toBe(true);

    writeExportIndex(projectDir, {
      version: 1,
      mappings: {
        [doc.id]: { human_id: brandedHumanId("SPEC-002"), file_path: "docs/requirements/spec/SPEC-002-beta-workflow.md" },
      },
    });

    const result = await service.migrateOrdinals({ dryRun: true, projectDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.export_index_reconciles).toEqual([]);
  });

  // ── BOUNDARY: ordinal >= 100 needs no padding — unpadded == padded byte-for-byte ──
  it("BOUNDARY: a 3+-digit ordinal's unpadded mapping is already byte-identical to the padded form (zero reconcile)", async () => {
    // Title-declares 100 directly — no collision bookkeeping needed since
    // this is the only doc in the fixture.
    const doc = makeSpecDoc({ title: "SPEC-100 — Century decision", created_at: "2026-01-03T00:00:00.000Z" });
    const insertResult = await store.insert(doc);
    expect(insertResult.ok).toBe(true);

    // formatDocDisplayId({type:"spec", ordinal:100}) === "SPEC-100" and
    // formatMirrorHumanId(...) === "SPEC-100" too (padStart(3,"0") is a no-op
    // once the numeric suffix is already >= 3 digits) — legacy unpadded
    // writers never disagreed with the padded form at this width.
    writeExportIndex(projectDir, {
      version: 1,
      mappings: {
        [doc.id]: { human_id: brandedHumanId("SPEC-100"), file_path: "docs/requirements/spec/SPEC-100-century-decision.md" },
      },
    });

    const result = await service.migrateOrdinals({ dryRun: true, projectDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.export_index_reconciles).toEqual([]);
  });

  // ── ERROR: malformed export-index.json aborts the whole migration ──────
  it("ERROR: a malformed export-index.json aborts the whole migration rather than silently skipping the reconcile step", async () => {
    const doc = makeSpecDoc({ title: "SPEC-1 — Alpha decision", created_at: "2026-01-01T00:00:00.000Z" });
    const insertResult = await store.insert(doc);
    expect(insertResult.ok).toBe(true);

    mkdirSync(join(projectDir, ".lore"), { recursive: true });
    writeFileSync(join(projectDir, ".lore", "export-index.json"), "{ not valid json", "utf8");

    const result = await service.migrateOrdinals({ dryRun: true, projectDir });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  // ── STATE: dry run computes the reconcile but writes NOTHING to disk ───
  it("STATE: a dry run computes the padded reconcile entry but leaves export-index.json byte-unchanged on disk", async () => {
    const doc = makeSpecDoc({ title: "SPEC-1 — Alpha decision", created_at: "2026-01-01T00:00:00.000Z" });
    const insertResult = await store.insert(doc);
    expect(insertResult.ok).toBe(true);

    writeExportIndex(projectDir, {
      version: 1,
      mappings: {
        [doc.id]: { human_id: brandedHumanId("SPEC-1"), file_path: "docs/requirements/spec/SPEC-1-alpha-decision.md" },
      },
    });

    const result = await service.migrateOrdinals({ dryRun: true, projectDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.export_index_reconciles).toHaveLength(1);
    expect(result.value.writes_performed).toBe(0);

    const onDisk = readExportIndex(projectDir);
    expect(onDisk.mappings[doc.id]?.human_id).toBe(brandedHumanId("SPEC-1")); // still unpadded — untouched
  });

  // ── REGRESSION: a live --apply run persists the padded value to disk ───
  it("REGRESSION: a live --apply run persists the padded human_id into export-index.json on disk", async () => {
    const doc = makeSpecDoc({ title: "SPEC-1 — Alpha decision", created_at: "2026-01-01T00:00:00.000Z" });
    const insertResult = await store.insert(doc);
    expect(insertResult.ok).toBe(true);

    writeExportIndex(projectDir, {
      version: 1,
      mappings: {
        [doc.id]: { human_id: brandedHumanId("SPEC-1"), file_path: "docs/requirements/spec/SPEC-1-alpha-decision.md" },
      },
    });

    const applyResult = await service.migrateOrdinals({ dryRun: false, projectDir });
    expect(applyResult.ok).toBe(true);
    if (!applyResult.ok) return;

    const onDisk = readExportIndex(projectDir);
    expect(onDisk.mappings[doc.id]?.human_id).toBe(brandedHumanId("SPEC-001"));
    // file_path is Scope-Alt (report-only rename) — untouched on disk.
    expect(onDisk.mappings[doc.id]?.file_path).toBe("docs/requirements/spec/SPEC-1-alpha-decision.md");
  });
});
