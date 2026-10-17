// @spawns packages/lore/src/index.ts
/**
 * @layer script-integration AC-OX-6 (mirror prune; the AC's oracles are status JSON and check:spec-mirror)
 * task-the-mirror-prune-does-not-retire-a-mapping-whose-doc-was —
 * spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check AC-OX-6.
 *
 * Measured on main @ 27268b62: `pruneOrphanMirrorFiles` (scripts/export-spec-mirror-core.ts,
 * invoked only from `runExport`) deletes an orphaned mirror FILE once its mapping is filtered
 * out of the FRESH-mappings copy that pruning itself computes — but that filtered copy was
 * never written back to `.lore/export-index.json`. So a doc soft-deleted AFTER being mirrored
 * (`01KWVPCJBKHPTBZQBPMXZK0B99`, deleted_at 2026-07-18) kept an `orphan_mapping` entry in the
 * real index FOREVER even though its file was already gone — every corpus-wide parity oracle
 * (AC-OX-6, `mirror-status-parity.test.ts`) reported it as a permanent, un-fixable-by-re-running
 * defect, and that single red short-circuits `bun run test`'s whole bun half.
 *
 * The fix lands in `ExportDocsService`'s index-build phase (`export-docs-service.ts`), NOT in
 * the script: `retireDeletedDocMappings` strips a mapping whose doc no longer belongs to the
 * LIVE population this pass fetched, but ONLY when that doc id resolves to a REAL DocRecord
 * that is soft-deleted (a SEPARATE `findMany({..., exclude_deleted: false})` fetch,
 * `everKnownDocIds`, scoped by the SAME `opts.type` filter as the live population, is the
 * discriminator) — never merely "absent from this pass's live docs", which would ALSO match a
 * docId that never existed in the store at all. That second case is an ESTABLISHED, existing-
 * test-covered pattern (`repairCollisions`/`reconcileOrdinalMappings`'s own "not this
 * reconciler's concern" stance, and `export-docs-service.test.ts`'s SPEC-040 fixture, which
 * uses exactly such an orphan mapping as an inert human_id reservation) that a first version
 * of this fix WRONGLY retired too — measured directly by this file's own REGRESSION case
 * below, which failed red against that first version before the `everKnownDocIds` fetch was
 * added. Once a genuinely-retirable mapping is gone from the SAVED index, the pre-existing
 * `pruneOrphanMirrorFiles` naturally deletes the now-truly-unmapped file on the same run — no
 * new file-deletion code.
 *
 * Two halves, by IO shape (mirrors `mirror-frontmatter-drift.test.ts`'s own split):
 *
 *   1. "production wiring" (HAPPY + STATE + REGRESSION + a measured-incident ERROR replica) —
 *      a REAL throwaway corpus (`mkdtemp` + `lore init`, NEVER this repo's own `.lore/`),
 *      driven through `scripts/export-spec-mirror.ts`'s own `main()` (the exact `bun run
 *      mirror:export` code path) via a driver subprocess, the same reason
 *      `mirror-frontmatter-drift.test.ts` needs one (that script's `REPO_ROOT`/`dbPath` are
 *      always derived from the script's own location / `findLoreDbPath()`, never overridable
 *      from a plain `bun run` invocation; this test file itself cannot import that script
 *      directly — top-level `createApp` -> `bun:sqlite`, unresolvable inside a vitest worker).
 *
 *   2. "boundary + negative + regression" — InMemoryStore + `ExportDocsService` directly (no
 *      bun:sqlite, no subprocess needed), proving the cross-type scope guard, the "file
 *      removed but doc still live" re-export case, and the inert-orphan-reservation invariant
 *      are all handled correctly.
 *
 * Coverage: HAPPY (soft-deleted doc's mapping+file retired) / STATE (a live sibling doc's
 * mapping+file survive untouched) / REGRESSION (repeated re-export stays converged, never
 * resurrects; AND a never-existed orphan reservation survives even a whole-corpus run) /
 * ERROR (the exact measured shape — file already gone before the retiring run — does not
 * crash) / NEGATIVE (a live doc's manually-removed file does NOT get its mapping dropped —
 * that is a re-export case, not retirement) / BOUNDARY (a per-type call cannot retire a
 * DIFFERENT type's soft-deleted doc's mapping, but a whole-corpus call can).
 *
 * @spec_ref spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check AC-OX-6
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ok, DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { DocRecord, Slug } from "@lore/core";
import { loadMirrorMappings } from "../export-spec-mirror-core.js";
import { InMemoryStore } from "../../packages/lore/src/store/in-memory-store.js";
import { ExportDocsService, type ResolveDocBody } from "../../packages/lore/src/service/export-docs-service.js";
import { OutlineService, renderResolvedToMarkdown } from "../../packages/lore/src/service/outline-service.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
// `.js` specifier — Bun resolves this to the sibling `.ts` source (project CLAUDE.md "Import style").
const MIRROR_SCRIPT_JS_SPECIFIER = join(REPO_ROOT, "scripts", "export-spec-mirror.js");
const APP_JS_SPECIFIER = join(REPO_ROOT, "packages", "lore", "src", "app.js");

// ─── Throwaway real-corpus lifecycle (never this repo's own .lore/) ─────────────

const tmpDirs: string[] = [];

function makeThrowawayCorpusDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-mirror-retire-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup — never fail the test run over a leftover tmp dir
    }
  }
});

/** Extracts the JSON payload from CLI stdout (this repo's `--json` commands pretty-print). */
function parseJsonOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to the slice-based recovery below
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      // fall through to the loud failure below
    }
  }
  throw new Error(`No JSON payload found in CLI output:\n${stdout}`);
}

/**
 * Writes the ONE driver this file needs: a real `.ts` entry point (executed as a genuine
 * `bun run` subprocess, never imported by this vitest file) that imports
 * `scripts/export-spec-mirror.ts`'s `main` via an ABSOLUTE specifier, so it can drive the
 * exact `bun run mirror:export` code path against an EXPLICIT throwaway `repoRoot`/`dbPath` —
 * the override parameters `main` already accepts but that no CLI flag exposes.
 */
function writeDriver(dir: string): string {
  const driverPath = join(dir, "mirror-retire-driver.ts");
  const source = `
import { main } from ${JSON.stringify(MIRROR_SCRIPT_JS_SPECIFIER)};

const [, , dbPath, repoRoot] = process.argv;

const exitCode = await main([], repoRoot, dbPath);
console.log(JSON.stringify({ exitCode }));
process.exit(exitCode);
`;
  writeFileSync(driverPath, source, "utf8");
  return driverPath;
}

interface DriverResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runExportDriver(driverPath: string, dbPath: string, repoRoot: string): DriverResult {
  const result = spawnSync("bun", ["run", driverPath, dbPath, repoRoot], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status === null) {
    throw new Error(`mirror-retire-driver crashed (signal ${result.signal}): ${result.stderr}`);
  }
  return { exitCode: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** `lore create knowledge --sub-type reference --title <t> --json` against the throwaway corpus. */
function createKnowledgeDoc(tmpDir: string, title: string): string {
  const out = execFileSync(
    "bun",
    [
      LORE_ENTRY, "create", "knowledge",
      "--title", title,
      "--sub-type", "reference",
      "--content", `# ${title}\n\nBody for ${title}.\n`,
      "--json",
    ],
    { cwd: tmpDir, stdio: "pipe" },
  ).toString();
  const parsed = parseJsonOutput(out) as { ok: boolean; data?: { id: string } };
  if (!parsed.ok || parsed.data === undefined) {
    throw new Error(`test setup: lore create knowledge "${title}" failed: ${out}`);
  }
  return parsed.data.id;
}

/** `lore delete <id> --confirm --json` (soft-delete) against the throwaway corpus. */
function softDeleteDoc(tmpDir: string, docId: string): void {
  const out = execFileSync(
    "bun",
    [LORE_ENTRY, "delete", docId, "--confirm", "--json"],
    { cwd: tmpDir, stdio: "pipe" },
  ).toString();
  const parsed = parseJsonOutput(out) as { ok: boolean };
  if (!parsed.ok) {
    throw new Error(`test setup: lore delete ${docId} failed: ${out}`);
  }
}

// ─── Half 1: production wiring — a REAL throwaway corpus, main()'s own write mode ──

describe("HAPPY + STATE + REGRESSION — a soft-deleted doc's export-index mapping AND mirror file are retired by main()'s write mode, a live sibling survives untouched, and repeated runs stay converged", () => {
  it(
    "seeds two knowledge docs, soft-deletes one, re-exports, and asserts the deleted doc's mapping+file are gone while the live sibling's mapping+file are unchanged — across two more re-export runs",
    () => {
      const tmpDir = makeThrowawayCorpusDir();
      execFileSync("bun", [LORE_ENTRY, "init", "--author", "mirror-retire-test"], { cwd: tmpDir, stdio: "pipe" });

      const retireId = createKnowledgeDoc(tmpDir, "Retire Probe");
      const siblingId = createKnowledgeDoc(tmpDir, "Sibling Probe");

      const dbPath = join(tmpDir, ".lore", "lore.db");
      const driverPath = writeDriver(tmpDir);

      // Baseline export — both docs get mapping + file.
      const baseline = runExportDriver(driverPath, dbPath, tmpDir);
      expect(baseline.exitCode).toBe(0);

      const baselineMappings = loadMirrorMappings(tmpDir);
      const retireMapping = baselineMappings[retireId];
      const siblingMapping = baselineMappings[siblingId];
      if (retireMapping === undefined || siblingMapping === undefined) {
        throw new Error(`test setup: baseline export did not map both docs: ${JSON.stringify(baselineMappings)}`);
      }
      const retireAbsPath = join(tmpDir, retireMapping.file_path);
      const siblingAbsPath = join(tmpDir, siblingMapping.file_path);
      expect(existsSync(retireAbsPath)).toBe(true);
      expect(existsSync(siblingAbsPath)).toBe(true);
      const siblingContentBefore = readFileSync(siblingAbsPath, "utf8");

      // Soft-delete ONE doc — the file and mapping are UNCHANGED by the delete alone (this is
      // exactly the measured defect state: nothing has re-exported yet).
      softDeleteDoc(tmpDir, retireId);
      expect(existsSync(retireAbsPath)).toBe(true);
      expect(loadMirrorMappings(tmpDir)[retireId]).toBeDefined();

      // ── Re-export: THIS is the retiring run ────────────────────────────────
      const afterDelete = runExportDriver(driverPath, dbPath, tmpDir);
      expect(afterDelete.exitCode).toBe(0);

      // HAPPY — the deleted doc's mapping is GONE from the index, and its file is GONE too
      // (pruneOrphanMirrorFiles removes it now that nothing maps to it).
      const mappingsAfterRetire = loadMirrorMappings(tmpDir);
      expect(mappingsAfterRetire[retireId]).toBeUndefined();
      expect(existsSync(retireAbsPath)).toBe(false);

      // STATE — the LIVE sibling's mapping and file are byte-identical and untouched.
      expect(mappingsAfterRetire[siblingId]).toEqual(siblingMapping);
      expect(existsSync(siblingAbsPath)).toBe(true);
      expect(readFileSync(siblingAbsPath, "utf8")).toBe(siblingContentBefore);

      // REGRESSION — running export AGAIN (twice more) never resurrects the retired mapping
      // and never errors: this is the exact "keeps it forever" shape the defect exhibited,
      // now proven to converge instead.
      const secondRun = runExportDriver(driverPath, dbPath, tmpDir);
      expect(secondRun.exitCode).toBe(0);
      expect(loadMirrorMappings(tmpDir)[retireId]).toBeUndefined();

      const thirdRun = runExportDriver(driverPath, dbPath, tmpDir);
      expect(thirdRun.exitCode).toBe(0);
      const mappingsAfterThirdRun = loadMirrorMappings(tmpDir);
      expect(mappingsAfterThirdRun[retireId]).toBeUndefined();
      expect(mappingsAfterThirdRun[siblingId]).toEqual(siblingMapping);
      expect(existsSync(siblingAbsPath)).toBe(true);
    },
    60_000,
  );
});

describe("ERROR — the exact measured incident shape (mapping present, file ALREADY gone) does not crash and still converges", () => {
  it(
    "soft-deletes a doc and hand-removes its mirror file BEFORE re-exporting (replicating the real KN-025 state) — the retiring run still exits 0 and drops the mapping",
    () => {
      const tmpDir = makeThrowawayCorpusDir();
      execFileSync("bun", [LORE_ENTRY, "init", "--author", "mirror-retire-error-test"], { cwd: tmpDir, stdio: "pipe" });

      const docId = createKnowledgeDoc(tmpDir, "Double Orphan Probe");
      const dbPath = join(tmpDir, ".lore", "lore.db");
      const driverPath = writeDriver(tmpDir);

      const baseline = runExportDriver(driverPath, dbPath, tmpDir);
      expect(baseline.exitCode).toBe(0);
      const mapping = loadMirrorMappings(tmpDir)[docId];
      if (mapping === undefined) throw new Error("test setup: baseline export did not map the doc");
      const absPath = join(tmpDir, mapping.file_path);
      expect(existsSync(absPath)).toBe(true);

      softDeleteDoc(tmpDir, docId);
      // Hand-remove the file BEFORE the retiring run — this is the measured real-tree state
      // (a prior prune run already deleted the file while the mapping itself survived).
      unlinkSync(absPath);
      expect(existsSync(absPath)).toBe(false);
      expect(loadMirrorMappings(tmpDir)[docId]).toBeDefined(); // mapping still present, as measured

      const retiringRun = runExportDriver(driverPath, dbPath, tmpDir);
      expect(retiringRun.exitCode).toBe(0); // no crash despite the file already being absent
      expect(loadMirrorMappings(tmpDir)[docId]).toBeUndefined();
    },
    60_000,
  );
});

// ─── Half 2: BOUNDARY + NEGATIVE — InMemoryStore + ExportDocsService directly ───

/** Same construction style as `mirror-frontmatter-drift.test.ts` — local, not shared. */
function makeExportService(store: InMemoryStore): ExportDocsService {
  const outlineService = new OutlineService(store);
  const resolveDocBody: ResolveDocBody = async (doc) => {
    const resolved = await outlineService.resolve(doc);
    if (!resolved.ok) return resolved;
    return ok(renderResolvedToMarkdown(resolved.value));
  };
  return new ExportDocsService(store, resolveDocBody);
}

function makeInMemoryProjectDir(): string {
  const dir = join(tmpdir(), `lore-mirror-retire-unit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, ".lore"), { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

function makeDoc(overrides: Partial<DocRecord> & { id: string; type: DocRecord["type"]; title: string; slug: string }): DocRecord {
  const now = "2026-08-17T00:00:00.000Z";
  return {
    id: overrides.id,
    slug: overrides.slug as Slug,
    type: overrides.type,
    role: DOC_TYPE_ROLE_MAP[overrides.type],
    title: overrides.title,
    status: overrides.status ?? "draft",
    priority: overrides.priority ?? "medium",
    content: overrides.content ?? "# Default\n\nBody.",
    parent_id: overrides.parent_id ?? null,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
    created_by: overrides.created_by ?? "test-agent",
    version: overrides.version ?? 1,
    deleted_at: overrides.deleted_at ?? null,
    tags: overrides.tags ?? [],
    extra: overrides.extra ?? {},
  };
}

async function insertDoc(store: InMemoryStore, doc: DocRecord): Promise<DocRecord> {
  const result = await store.insert(doc);
  if (!result.ok) throw new Error(`store.insert failed: ${result.error.code}`);
  return result.value;
}

/** Hand-writes `.lore/export-index.json` — used to seed an orphan mapping BEFORE calling exportDocs (the schema's `human_id` accepts a plain string; the branded cast only matters when read back through `exportIndexSchema`). */
function seedIndex(projectDir: string, mappings: Record<string, { human_id: string; file_path: string }>): void {
  writeFileSync(
    join(projectDir, ".lore", "export-index.json"),
    JSON.stringify({ version: 1, mappings }, null, 2),
    "utf8",
  );
}

describe("BOUNDARY — a per-type exportDocs({type}) call must not retire a SOFT-DELETED doc's mapping when that doc belongs to a DIFFERENT type, but a whole-corpus call may", () => {
  it("BOUNDARY: exportDocs({type:'spec'}) leaves a soft-deleted KNOWLEDGE doc's mapping untouched — its id never appears in this pass's type-scoped everKnownDocIds at all", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeInMemoryProjectDir();

    const deletedKnowledgeDoc = await insertDoc(store, makeDoc({
      id: "doc-knowledge-deleted-1",
      slug: "knowledge-boundary-deleted-probe",
      type: "knowledge",
      title: "Boundary Deleted Probe",
      content: "# Boundary Deleted Probe\n\nBody.",
      extra: { sub_type: "reference" },
    }));
    const softDeleteResult = await store.softDelete(deletedKnowledgeDoc.id);
    if (!softDeleteResult.ok) throw new Error(`softDelete failed: ${JSON.stringify(softDeleteResult.error)}`);

    const deletedKnowledgeMapping = {
      human_id: "KN-999",
      file_path: "docs/requirements/knowledge/KN-999-boundary-deleted-probe.md",
    };
    seedIndex(projectDir, { [deletedKnowledgeDoc.id]: deletedKnowledgeMapping });

    await insertDoc(store, makeDoc({
      id: "doc-real-spec-1",
      slug: "spec-boundary-probe",
      type: "spec",
      title: "Boundary Probe",
      content: "# Boundary Probe\n\nBody.",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false, type: "spec" });
    if (!result.ok) throw new Error(`export failed: ${JSON.stringify(result.error)}`);

    const mappingsAfter = loadMirrorMappings(projectDir);
    // The soft-deleted KNOWLEDGE doc's mapping must survive UNCHANGED: a spec-scoped pass's
    // everKnownDocIds is fetched with the SAME type filter as its live-doc population, so a
    // knowledge doc's id — deleted or not — never appears in it at all.
    expect(mappingsAfter[deletedKnowledgeDoc.id]).toEqual(deletedKnowledgeMapping);
    // The real spec doc got its own fresh mapping created in the SAME run.
    expect(mappingsAfter["doc-real-spec-1"]).toBeDefined();
  });

  it("BOUNDARY (contrast): a whole-corpus exportDocs({type: undefined}) DOES retire that SAME soft-deleted knowledge doc's mapping, proving the restriction above is scope-specific, not a blanket refusal", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeInMemoryProjectDir();

    const deletedKnowledgeDoc = await insertDoc(store, makeDoc({
      id: "doc-knowledge-deleted-2",
      slug: "knowledge-boundary-contrast-probe",
      type: "knowledge",
      title: "Boundary Contrast Probe",
      content: "# Boundary Contrast Probe\n\nBody.",
      extra: { sub_type: "reference" },
    }));
    const softDeleteResult = await store.softDelete(deletedKnowledgeDoc.id);
    if (!softDeleteResult.ok) throw new Error(`softDelete failed: ${JSON.stringify(softDeleteResult.error)}`);

    seedIndex(projectDir, {
      [deletedKnowledgeDoc.id]: {
        human_id: "KN-998",
        file_path: "docs/requirements/knowledge/KN-998-boundary-contrast-probe.md",
      },
    });

    const result = await service.exportDocs({ projectDir, dryRun: false });
    if (!result.ok) throw new Error(`export failed: ${JSON.stringify(result.error)}`);

    expect(loadMirrorMappings(projectDir)[deletedKnowledgeDoc.id]).toBeUndefined();
  });
});

describe("REGRESSION — a mapping whose docId NEVER existed in the store at all (an inert orphan RESERVATION) is left untouched, even by a whole-corpus call", () => {
  it("REGRESSION: an orphan mapping claiming SPEC-999 with no backing DocRecord anywhere survives a whole-corpus exportDocs() run — this is the exact shape an existing fixture (export-docs-service.test.ts's SPEC-040 case) relies on to force sequential fallback instead of a human_id collision", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeInMemoryProjectDir();

    const orphanReservation = {
      human_id: "SPEC-999",
      file_path: "docs/requirements/spec/SPEC-999-never-existed.md",
    };
    // This docId is NEVER inserted into the store — by design. It must never resolve to a
    // DocRecord, live or deleted, in ANY findMany call this run makes.
    seedIndex(projectDir, { "orphan-doc-never-existed-1": orphanReservation });

    const result = await service.exportDocs({ projectDir, dryRun: false }); // whole-corpus — no type restriction
    if (!result.ok) throw new Error(`export failed: ${JSON.stringify(result.error)}`);

    // Must survive BYTE-IDENTICAL: retiring it would free "SPEC-999" for reuse, reintroducing
    // the human_id-collision risk this reservation pattern exists to prevent.
    expect(loadMirrorMappings(projectDir)["orphan-doc-never-existed-1"]).toEqual(orphanReservation);
  });
});

describe("NEGATIVE — a LIVE doc whose mirror file was manually removed keeps its mapping (this is a re-export case, never a retirement case)", () => {
  it("NEGATIVE: file deleted out-of-band, doc still live in the store — mapping is preserved and the file is recreated at the SAME path", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeInMemoryProjectDir();

    await insertDoc(store, makeDoc({
      id: "doc-negative-1",
      slug: "knowledge-negative-probe",
      type: "knowledge",
      title: "Negative Probe",
      content: "# Negative Probe\n\nBody.",
      extra: { sub_type: "reference" },
    }));

    const baseline = await service.exportDocs({ projectDir, dryRun: false, type: "knowledge" });
    if (!baseline.ok) throw new Error(`baseline export failed: ${JSON.stringify(baseline.error)}`);
    const filePath = baseline.value.created[0];
    if (filePath === undefined) throw new Error("test setup: baseline export created no file");
    const absPath = join(projectDir, filePath);
    expect(existsSync(absPath)).toBe(true);

    const mappingBefore = loadMirrorMappings(projectDir)["doc-negative-1"];
    if (mappingBefore === undefined) throw new Error("test setup: no mapping after baseline export");

    // Manually remove the file — the doc itself is still LIVE (never soft-deleted).
    unlinkSync(absPath);
    expect(existsSync(absPath)).toBe(false);

    const reExport = await service.exportDocs({ projectDir, dryRun: false, type: "knowledge" });
    if (!reExport.ok) throw new Error(`re-export failed: ${JSON.stringify(reExport.error)}`);

    // The mapping must NOT have been dropped-and-reallocated — same human_id, same file_path.
    const mappingAfter = loadMirrorMappings(projectDir)["doc-negative-1"];
    expect(mappingAfter).toEqual(mappingBefore);
    // The file is recreated (this is exportDocs' ordinary "file absent -> create" path).
    expect(existsSync(absPath)).toBe(true);
    expect(reExport.value.created).toEqual([filePath]);
  });
});
