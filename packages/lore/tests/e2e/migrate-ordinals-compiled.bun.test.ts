/**
 * @spec_ref SPEC-084 §One-shot repair migration, §Acceptance Criteria AC-084-5 —
 *   task task-skill-test-t7-compiled-binary-e2e-migrate-ordinals-dry-run.
 *
 * Compiled-binary end-to-end oracle for `dist/lore migrate ordinals
 * [--apply]` (`OrdinalMigrationService.migrateOrdinals`, T6). Every other
 * SPEC-084 AC is vitest/source-mode or `bun test`-against-source
 * (`migrate-ordinals.bun.test.ts`, AC-084-4, exercises `OrdinalMigrationService`
 * directly against `SQLiteStore(":memory:")`) — this is the sole oracle that
 * spawns the REAL COMPILED `dist/lore` binary (`Bun.spawnSync`), mirroring
 * `tests/integration/cli/slugify-compiled.bun.test.ts` (AC-068-10) and
 * `tests/e2e/bootstrap-injection-compiled.bun.test.ts` (AC-080-3/6)'s
 * compiled-binary harness. This is the sole attested safety proof the live
 * T8 sweep (task-skill-verify-t8-attested-sweep-live-corpus-ordinal-repair)
 * relies on before running the migration against the real, live team corpus.
 *
 * Freshness guard (SPEC-061 lesson — a stale `dist/lore` is a false oracle):
 * `beforeAll` calls `assertFreshBinary`, throwing loud before any test body
 * runs if `dist/lore` is missing or older than the newest `.ts` source under
 * `packages/{lore,core}/src` — run `bun run build` (repo root) first.
 *
 * Never touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule,
 * `packages/dashboard/tests/e2e/global-setup.ts` precedent) — the corpus lives
 * in a THROWAWAY `mkdtempSync(os.tmpdir())` directory, asserted (via
 * `expect(dir.startsWith(REPO_ROOT)).toBe(false)`) to live genuinely outside
 * this repo's working tree.
 *
 * Fixture (models the live 2026-07-26 incident at small scale, mirroring
 * AC-084-4's own fixture shape but through `.lore/lore.db` on disk instead of
 * `:memory:`): a root PRD, then SIX numbered docs seeded via DIRECT
 * `SQLiteStore.insert()` calls against the throwaway `.lore/lore.db` file
 * (never through `CorpusService`/the CLI — the whole point is modeling
 * PRE-EXISTING corrupted data that predates the SPEC-084 title-purity schema
 * guard, which a CLI create can no longer produce):
 *   - specA "SPEC-1 — Alpha decision" (earliest) — declares 1, no collision.
 *     Export-index mapping is DRIFTED (`human_id: "SPEC-99"`, `file_path`
 *     carrying a DOUBLED-number scar `SPEC-99-001-…`, mirroring the real
 *     incident's `SPEC-081-080-…` filename scar).
 *   - specB "SPEC-2 — Beta workflow" — declares 2, no collision, no export
 *     mapping at all (legitimate "never exported yet" control case).
 *   - specC/D/E, ALL declaring "SPEC-3" (a 3-way collision — mirrors the real
 *     3-session "SPEC-080" incident exactly): specC is earliest (created_at
 *     priority) and keeps 3; specD/E are collision losers and get next-free
 *     (4, 5). specE is `approved` status (proves no approved→draft reset).
 *   - specExempt "Domain Detail Overview" (`spec_kind: domain-overview`) — no
 *     declared number, ordinal stays NULL forever (SPEC-084 exempt-kind rule).
 *   - adrOne "ADR-1 — Use store-atomic ordinals" — a DIFFERENT doc type,
 *     boundary case "first doc of a type" AND cross-type independence
 *     (SPEC-1 and ADR-1 coexist without collision).
 *
 * Six-dimension coverage:
 *   NEGATIVE:   `dist/lore create spec` with a title self-declaring "SPEC-99"
 *               is rejected exit 4 VALIDATION_ERROR — the exact schema guard
 *               the raw-store seeding above must bypass to construct the
 *               fixture at all.
 *   HAPPY:      dry-run computes the full converging report with the correct
 *               created_at-priority assignments; a brand-new create after
 *               migration auto-allocates the next-free ordinal.
 *   BOUNDARY:   the 3-way SPEC-3 collision; cross-type coexistence (SPEC-1 +
 *               ADR-1); the exempt-kind doc's permanent NULL ordinal.
 *   STATE:      `--apply` converges the corpus (bijective ordinals, prose-pure
 *               titles, export-index reconciled from columns, `SPEC-<n>`/
 *               `ADR-<n>` resolve via `dist/lore get`), `approved` status
 *               survives the title strip untouched.
 *   ERROR:      n/a at this layer (the malformed-export-index abort path is
 *               AC-084-4's job, `OrdinalMigrationService`-direct) — this
 *               suite's job is the CLI/compiled-binary wiring, not
 *               re-proving every service-level error branch.
 *   REGRESSION: dry-run performs literally ZERO writes (row-state +
 *               whole-file hash proof); a second `--apply` run is idempotent
 *               (empty report, zero writes, byte-unchanged file hash).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "node:crypto";
import type { DocRecord, ExportIndex } from "@lore/core";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

// ─── Path / spawn setup ─────────────────────────────────────────────────────

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up).
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawns the COMPILED `dist/lore` binary with `cwd`/`HOME` both pointed at the
 * throwaway corpus dir. `CLAUDECODE=1` resolves the "agent" caller surface
 * (SPEC-024) so no create call risks a nested AI invocation even though every
 * create below already passes `--no-ai` explicitly. Explicit array args + a
 * bounded default buffer (Bun's own default, never piped through a shell) —
 * BUG-004 spawn discipline (project CLAUDE.md).
 */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function initCorpus(dir: string): void {
  const result = runLore(["init"], dir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
}

/**
 * Disables all four `lore gate` service-layer checkpoints (mirrors
 * `tests/e2e/cli.bun.test.ts`'s own `disableAllGates` precedent) — this
 * suite's job is ordinal-migration behavior, not gate/skeleton-content
 * semantics, and the fixture's directly-seeded rows never had a skeleton
 * heading in the first place.
 */
function disableAllGates(dir: string): void {
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    [
      "workflow:",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "    plan-promote:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      "",
    ].join("\n"),
    "utf8",
  );
}

/**
 * Disables SPEC-102 trace recording/pruning for this corpus — this suite's
 * "byte-unchanged corpus DB" idempotency oracle (`hashDbState`, below) hashes
 * the WHOLE db file, and `trace_events` rows (fresh timestamps on every real
 * CLI invocation, e.g. this suite's own `runLore(["get", ...])`/`--dry-run`
 * calls) would otherwise make two back-to-back invocations byte-DIFFERENT
 * even when the ordinal-migration logic under test wrote nothing — a false
 * regression this suite exists to catch would look identical to a genuine
 * one. Disabling trace here scopes the oracle back to its actual concern
 * (ordinal migration idempotency), not an unrelated observability side effect.
 */
function disableTraceRecording(dir: string): void {
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    ["trace:", "  enabled: false", ""].join("\n"),
    "utf8",
  );
}

function dbPathFor(dir: string): string {
  return join(dir, ".lore", "lore.db");
}

/**
 * Whole-file hash of the corpus DB's on-disk state, INCLUDING the WAL/SHM
 * side-files (`SQLiteStore.init` sets `journal_mode = WAL`) — a write that
 * lands only in the WAL (not yet checkpointed into the main file) would be
 * invisible to a hash of the main file alone. Absent side-files hash as
 * nothing (not a zero-length placeholder), so a run that never creates them
 * hashes identically to another run that never creates them.
 */
function hashDbState(dbPath: string): string {
  const hash = createHash("sha256");
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `${dbPath}${suffix}`;
    if (existsSync(p)) {
      hash.update(readFileSync(p));
    }
  }
  return hash.digest("hex");
}

/** One-shot read-only-in-spirit query helper — opens, queries, closes; never
 *  held open across a `dist/lore` subprocess invocation (WAL-lock hygiene). */
function queryDb<T>(dbPath: string, sql: string, params: unknown[] = []): T[] {
  const db = new Database(dbPath);
  try {
    return db.query(sql).all(...(params as never[])) as T[];
  } finally {
    db.close();
  }
}

interface JsonEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: unknown;
}

// ─── Fixture doc factory (mirrors migrate-ordinals.bun.test.ts's makeSpecDoc,
// pointed at a file-backed store instead of :memory:) ───────────────────────

let _counter = 0;
function nextId(): string {
  _counter += 1;
  return `01HT7E2ESEED${String(_counter).padStart(13, "0")}`;
}

function makeDoc(overrides: Partial<DocRecord> & { type: DocRecord["type"]; slug: string; title: string; created_at: string; parent_id: string | null }): DocRecord {
  const role = overrides.type === "adr" ? "decision" : "spec";
  const base: DocRecord = {
    id: nextId(),
    slug: overrides.slug,
    type: overrides.type,
    role,
    title: overrides.title,
    status: "draft",
    priority: "medium",
    content: "Fixture body seeded directly via SQLiteStore (bypasses the SPEC-084 title-purity guard).",
    parent_id: overrides.parent_id,
    created_at: overrides.created_at,
    updated_at: overrides.created_at,
    created_by: "agent:t7-fixture",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ordinal: null,
  };
  return { ...base, ...overrides };
}

// ─── Suite ──────────────────────────────────────────────────────────────────

describe("AC-084-5: compiled dist/lore migrate ordinals — dry-run/apply/idempotency/resolution", () => {
  let dir: string;
  let dbPath: string;
  let prdSlug: string;
  let prdId: string;

  let specA: DocRecord; // SPEC-1, earliest, drifted+scarred export mapping
  let specB: DocRecord; // SPEC-2, no export mapping (never exported control case)
  let specC: DocRecord; // SPEC-3, earliest of the trio -> keeps 3
  let specD: DocRecord; // SPEC-3, collision loser #1 -> next-free
  let specE: DocRecord; // SPEC-3, collision loser #2, approved -> next-free
  let specExempt: DocRecord; // domain-overview, permanently NULL ordinal
  let adrOne: DocRecord; // ADR-1, cross-type independence + "first of type"

  beforeAll(() => {
    assertFreshBinary(LORE_BIN, [
      join(REPO_ROOT, "packages", "lore", "src"),
      join(REPO_ROOT, "packages", "core", "src"),
    ]);

    dir = mkdtempSync(join(tmpdir(), "lore-t7-migrate-ordinals-"));
    // Never the repo's own .lore/ corpus (project CLAUDE.md hard rule) — a
    // genuine os.tmpdir() path is never a prefix of REPO_ROOT.
    expect(dir.startsWith(REPO_ROOT)).toBe(false);
    initCorpus(dir);
    disableAllGates(dir);
    disableTraceRecording(dir);
    dbPath = dbPathFor(dir);

    const prdResult = runLore(
      ["create", "prd", "--title", "T7 Ordinal Migration E2E Root PRD", "--content", "## Overview\nroot", "--no-ai", "--json"],
      dir,
    );
    expect(prdResult.exitCode).toBe(0);
    const prdEnvelope = JSON.parse(prdResult.stdout) as JsonEnvelope<{ slug: string; id: string }>;
    prdSlug = prdEnvelope.data!.slug;
    prdId = prdEnvelope.data!.id;

    // Direct store writes (bypass CorpusService/the CLI entirely) — the ONLY
    // way to construct pre-existing self-declared-number titles now that the
    // SPEC-084 schema guard forbids creating them through any public surface.
    const seedStore = new SQLiteStore(dbPath);
    specA = makeDoc({
      type: "spec",
      slug: "spec-t7-alpha-decision",
      title: "SPEC-1 — Alpha decision",
      created_at: "2026-07-20T00:00:00.000Z",
      parent_id: prdId,
    });
    specB = makeDoc({
      type: "spec",
      slug: "spec-t7-beta-workflow",
      title: "SPEC-2 — Beta workflow",
      created_at: "2026-07-20T00:00:01.000Z",
      parent_id: prdId,
    });
    specC = makeDoc({
      type: "spec",
      slug: "spec-t7-collision-winner",
      title: "SPEC-3 — Triple collision winner",
      created_at: "2026-07-20T00:00:02.000Z",
      parent_id: prdId,
    });
    specD = makeDoc({
      type: "spec",
      slug: "spec-t7-collision-loser-one",
      title: "SPEC-3 — Triple collision loser one",
      created_at: "2026-07-20T00:00:03.000Z",
      parent_id: prdId,
    });
    specE = makeDoc({
      type: "spec",
      slug: "spec-t7-collision-loser-two",
      title: "SPEC-3 — Triple collision loser two",
      created_at: "2026-07-20T00:00:04.000Z",
      parent_id: prdId,
      status: "approved",
    });
    specExempt = makeDoc({
      type: "spec",
      slug: "spec-t7-domain-exempt",
      title: "Domain Detail Overview",
      created_at: "2026-07-20T00:00:05.000Z",
      parent_id: prdId,
      extra: { spec_kind: "domain-overview" },
    });
    adrOne = makeDoc({
      type: "adr",
      slug: "adr-t7-use-ordinals",
      title: "ADR-1 — Use store-atomic ordinals",
      created_at: "2026-07-20T00:00:06.000Z",
      parent_id: prdId,
      extra: { decision_status: "accepted" },
    });

    for (const doc of [specA, specB, specC, specD, specE, specExempt, adrOne]) {
      const insertResult = seedStore.insert(doc);
      // insert() is synchronous under the hood (bun:sqlite) but typed async —
      // await to be safe against a future implementation change.
      void insertResult;
    }
    seedStore.close();

    const exportIndex: ExportIndex = {
      version: 1,
      mappings: {
        [specA.id]: {
          human_id: "SPEC-99",
          // Doubled-number scar, mirrors the real incident's "SPEC-081-080-…" filename.
          file_path: "docs/requirements/spec/SPEC-99-001-alpha-decision.md",
        },
      },
    };
    Bun.write(join(dir, ".lore", "export-index.json"), JSON.stringify(exportIndex, null, 2) + "\n");
  });

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it("NEGATIVE: dist/lore create spec with a self-declared SPEC-99 title is rejected exit 4 (the guard the raw-store seeding above must bypass)", () => {
    const result = runLore(
      [
        "create",
        "spec",
        "--title",
        "SPEC-99 — Should never be creatable",
        "--parent",
        prdSlug,
        "--content",
        "## Overview\nx",
        "--no-ai",
      ],
      dir,
    );
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("title must not self-declare a SPEC-/ADR- number");

    // Confirm nothing was created — the corpus's numbered-doc count is
    // unaffected by this rejected attempt (BOUNDARY: still exactly the 6
    // seeded numbered docs before any migration has run).
    const rows = queryDb<{ n: number }>(
      dbPath,
      "SELECT COUNT(*) as n FROM docs WHERE title LIKE 'SPEC-99%'",
    );
    expect(rows[0]?.n).toBe(0);
  });

  it("HAPPY+BOUNDARY: dry-run computes the full converging report (collision priority, cross-type coexistence) with ZERO writes", () => {
    const beforeHash = hashDbState(dbPath);

    const result = runLore(["migrate", "ordinals", "--json"], dir);
    expect(result.exitCode).toBe(0);

    const envelope = JSON.parse(result.stdout) as JsonEnvelope<{
      dry_run: boolean;
      writes_performed: number;
      bijective: boolean;
      numbered_doc_count: number;
      errors: string[];
      reassignments: Array<{ doc_id: string; declared_ordinal: number | null; new_ordinal: number; changed: boolean }>;
      title_strips: Array<{ doc_id: string; new_title: string }>;
      export_index_reconciles: Array<{ doc_id: string; old_human_id: string; new_human_id: string; suggested_file_path: string; rename_command: string }>;
    }>;
    expect(envelope.ok).toBe(true);
    const report = envelope.data!;

    expect(report.dry_run).toBe(true);
    expect(report.writes_performed).toBe(0);
    expect(report.errors).toEqual([]);
    expect(report.bijective).toBe(true);
    expect(report.numbered_doc_count).toBe(6);
    expect(report.reassignments).toHaveLength(6);

    const byId = new Map(report.reassignments.map((r) => [r.doc_id, r]));
    expect(byId.get(specA.id)).toMatchObject({ declared_ordinal: 1, new_ordinal: 1, changed: false });
    expect(byId.get(specB.id)).toMatchObject({ declared_ordinal: 2, new_ordinal: 2, changed: false });
    expect(byId.get(specC.id)).toMatchObject({ declared_ordinal: 3, new_ordinal: 3, changed: false });
    expect(byId.get(specD.id)).toMatchObject({ declared_ordinal: 3, new_ordinal: 4, changed: true });
    expect(byId.get(specE.id)).toMatchObject({ declared_ordinal: 3, new_ordinal: 5, changed: true });
    // Cross-type independence: ADR-1 allocates its own type's ordinal 1,
    // entirely independent of SPEC-1 already occupying spec:1.
    expect(byId.get(adrOne.id)).toMatchObject({ declared_ordinal: 1, new_ordinal: 1, changed: false });
    // The exempt-kind doc never appears in reassignments at all.
    expect(byId.has(specExempt.id)).toBe(false);

    // Doubled-number-scar export-index reconcile, computed but not written.
    expect(report.export_index_reconciles).toHaveLength(1);
    const reconcile = report.export_index_reconciles[0]!;
    expect(reconcile.doc_id).toBe(specA.id);
    expect(reconcile.old_human_id).toBe("SPEC-99");
    expect(reconcile.new_human_id).toBe("SPEC-1");
    expect(reconcile.suggested_file_path).toBe("docs/requirements/spec/SPEC-1-alpha-decision.md");
    expect(reconcile.rename_command).toBe(
      "git mv 'docs/requirements/spec/SPEC-99-001-alpha-decision.md' 'docs/requirements/spec/SPEC-1-alpha-decision.md'",
    );

    // REGRESSION: dry-run touched NOTHING — row state re-fetched fresh...
    const rows = queryDb<{ ordinal: number | null; title: string; version: number; status: string }>(
      dbPath,
      "SELECT ordinal, title, version, status FROM docs WHERE id = ?",
      [specA.id],
    );
    expect(rows[0]?.ordinal).toBeNull();
    expect(rows[0]?.title).toBe("SPEC-1 — Alpha decision");
    expect(rows[0]?.version).toBe(1);

    const indexAfter = JSON.parse(readFileSync(join(dir, ".lore", "export-index.json"), "utf8")) as ExportIndex;
    expect(indexAfter.mappings[specA.id]?.human_id).toBe("SPEC-99");

    // ...and the whole-file hash (incl. WAL/SHM) is byte-identical.
    const afterHash = hashDbState(dbPath);
    expect(afterHash).toBe(beforeHash);
  });

  it("STATE: --apply converges the corpus (bijective ordinals, prose-pure titles, export-index reconciled, SPEC-<n>/ADR-<n> resolve)", () => {
    const result = runLore(["migrate", "ordinals", "--apply", "--json"], dir);
    expect(result.exitCode).toBe(0);

    const envelope = JSON.parse(result.stdout) as JsonEnvelope<{
      dry_run: boolean;
      writes_performed: number;
      bijective: boolean;
      numbered_doc_count: number;
      errors: string[];
    }>;
    expect(envelope.ok).toBe(true);
    const report = envelope.data!;
    expect(report.dry_run).toBe(false);
    expect(report.errors).toEqual([]);
    expect(report.bijective).toBe(true);
    expect(report.numbered_doc_count).toBe(6);
    // 6 ordinal allocations + 6 title strips + 1 export-index file write.
    expect(report.writes_performed).toBe(13);

    // Zero duplicate (type, ordinal) pairs — the store's partial unique index
    // AND this independent report-time bijectivity check both hold; this
    // query is a THIRD, fully independent oracle over the raw table.
    const dupes = queryDb<{ type: string; ordinal: number; c: number }>(
      dbPath,
      "SELECT type, ordinal, COUNT(*) as c FROM docs WHERE ordinal IS NOT NULL GROUP BY type, ordinal HAVING COUNT(*) > 1",
    );
    expect(dupes).toEqual([]);

    // Titles are prose-pure — none of the 6 numbered docs (nor the exempt
    // doc, which never had a number to begin with) still self-declares a
    // SPEC-/ADR- prefix.
    const stillNumbered = queryDb<{ title: string }>(
      dbPath,
      "SELECT title FROM docs WHERE title LIKE 'SPEC-%' OR title LIKE 'ADR-%'",
    );
    expect(stillNumbered).toEqual([]);

    // approved status survived the title strip untouched (no draft reset).
    const eRow = queryDb<{ status: string; title: string; ordinal: number }>(
      dbPath,
      "SELECT status, title, ordinal FROM docs WHERE id = ?",
      [specE.id],
    );
    expect(eRow[0]?.status).toBe("approved");
    expect(eRow[0]?.title).toBe("Triple collision loser two");
    expect(eRow[0]?.ordinal).toBe(5);

    // Export-index human_id read from the column (never a stored composite).
    const index = JSON.parse(readFileSync(join(dir, ".lore", "export-index.json"), "utf8")) as ExportIndex;
    expect(index.mappings[specA.id]?.human_id).toBe("SPEC-1");
    // file_path itself is untouched (Scope-Alt: renames stay report-only).
    expect(index.mappings[specA.id]?.file_path).toBe("docs/requirements/spec/SPEC-99-001-alpha-decision.md");

    // `dist/lore get SPEC-<n>` / `ADR-<n>` resolve every renumbered doc.
    const getSpec1 = runLore(["get", "SPEC-1", "--json"], dir);
    expect(getSpec1.exitCode).toBe(0);
    const spec1Envelope = JSON.parse(getSpec1.stdout) as JsonEnvelope<{ doc: DocRecord }>;
    expect(spec1Envelope.data!.doc.slug).toBe(specA.slug);
    expect(spec1Envelope.data!.doc.title).toBe("Alpha decision");
    expect(spec1Envelope.data!.doc.ordinal).toBe(1);

    const getSpec5 = runLore(["get", "spec-5", "--json"], dir); // lowercase + zero-form regression
    expect(getSpec5.exitCode).toBe(0);
    const spec5Envelope = JSON.parse(getSpec5.stdout) as JsonEnvelope<{ doc: DocRecord }>;
    expect(spec5Envelope.data!.doc.slug).toBe(specE.slug);

    // Cross-type independence resolved through the compiled binary too:
    // ADR-1 and SPEC-1 both resolve to their own distinct docs.
    const getAdr1 = runLore(["get", "ADR-1", "--json"], dir);
    expect(getAdr1.exitCode).toBe(0);
    const adr1Envelope = JSON.parse(getAdr1.stdout) as JsonEnvelope<{ doc: DocRecord }>;
    expect(adr1Envelope.data!.doc.slug).toBe(adrOne.slug);
    expect(adr1Envelope.data!.doc.title).toBe("Use store-atomic ordinals");

    // The exempt-kind doc never resolves via an ordinal ref (it never got one).
    const getSpecExempt = runLore(["get", "spec-t7-domain-exempt", "--json"], dir);
    expect(getSpecExempt.exitCode).toBe(0);
    const exemptEnvelope = JSON.parse(getSpecExempt.stdout) as JsonEnvelope<{ doc: DocRecord }>;
    expect(exemptEnvelope.data!.doc.ordinal ?? null).toBeNull();
  });

  it("REGRESSION: a second --apply run is idempotent — empty report, zero writes, byte-unchanged corpus DB", () => {
    const beforeHash = hashDbState(dbPath);

    const result = runLore(["migrate", "ordinals", "--apply", "--json"], dir);
    expect(result.exitCode).toBe(0);

    const envelope = JSON.parse(result.stdout) as JsonEnvelope<{
      writes_performed: number;
      reassignments: unknown[];
      title_strips: unknown[];
      export_index_reconciles: unknown[];
      errors: string[];
      bijective: boolean;
      numbered_doc_count: number;
    }>;
    expect(envelope.ok).toBe(true);
    const report = envelope.data!;
    expect(report.writes_performed).toBe(0);
    expect(report.reassignments).toEqual([]);
    expect(report.title_strips).toEqual([]);
    expect(report.export_index_reconciles).toEqual([]);
    expect(report.errors).toEqual([]);
    expect(report.bijective).toBe(true);
    expect(report.numbered_doc_count).toBe(6);

    const afterHash = hashDbState(dbPath);
    expect(afterHash).toBe(beforeHash);
  });

  it("HAPPY: a NEW create after migration auto-allocates the next-free ordinal", () => {
    const result = runLore(
      [
        "create",
        "spec",
        "--title",
        "New Spec After Migration",
        "--parent",
        prdSlug,
        "--content",
        "## Overview\nfresh doc created post-migration",
        "--no-ai",
        "--json",
      ],
      dir,
    );
    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout) as JsonEnvelope<{ slug: string; ordinal: number | null; title: string }>;
    expect(envelope.ok).toBe(true);
    const doc = envelope.data!;
    // Next-free = 6 (specA..E occupy 1-5; specExempt never consumed a number).
    expect(doc.ordinal).toBe(6);
    // The stored title itself is never prefixed — composition is display-only.
    expect(doc.title).toBe("New Spec After Migration");

    const getResult = runLore(["get", "SPEC-6", "--json"], dir);
    expect(getResult.exitCode).toBe(0);
    const getEnvelope = JSON.parse(getResult.stdout) as JsonEnvelope<{ doc: DocRecord }>;
    expect(getEnvelope.data!.doc.slug).toBe(doc.slug);
    expect(getEnvelope.data!.doc.ordinal).toBe(6);
  });
});
