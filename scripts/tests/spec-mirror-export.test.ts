/**
 * Tests for `scripts/export-spec-mirror.ts` + `scripts/export-spec-mirror-core.ts` —
 * `spec-falsifiability-reachability-a-feedable-checkpoint-an` D6, AC-FR-6/AC-FR-7 (G5).
 *
 * Two halves, deliberately split by IO shape (mirrors `scripts/tests/check-ac-ref-integrity.test.ts`):
 *
 *   1. Pure algorithm suites (`computeMirrorParity`, `scriptChainReachesTarget`, plus the fs-only
 *      helpers `loadMirrorMappings`/`countMdFilesFlat`) import directly from
 *      `../export-spec-mirror-core.js` — that module has NO `bun:sqlite` dependency anywhere in
 *      its import graph (see its own header), unlike the sibling `export-spec-mirror.ts` IO shell
 *      (imports `createApp`, which does).
 *   2. The end-to-end suites drive the REAL `export-spec-mirror.ts` script (and the real `lore`
 *      CLI, for an independent live-corpus read) as SUBPROCESSES against THIS repo's OWN live
 *      corpus and OWN `docs/requirements/spec/` — never a throwaway `mkdtemp` corpus. This is
 *      deliberate, not a violation of "never write to the repo's own `.lore/` corpus from tests":
 *      that prohibition is about creating/editing/deleting DOCS (the corpus DB); this task's own
 *      deliverable IS `docs/requirements/spec/*.md` + `.lore/export-index.json` — generated,
 *      regenerable projections meant to be committed (this task's own scope note: "Exporting 141
 *      specs will produce a large diff of generated files. That is expected; commit them.").
 *      Every e2e test below RE-ESTABLISHES a clean baseline by actually running the real exporter
 *      before asserting anything, and restores it afterward (`finally`) — so this file's
 *      assertions never depend on execution order or on state left over from a manual run.
 *
 * AC-FR-6's own text: "Asserted against the LIVE corpus count, never a literal typed into the
 * test" — every e2e assertion below re-derives the corpus spec count via a REAL `lore list --type
 * spec --json` subprocess call at test-run time, never a hardcoded number.
 *
 * Six-dimension coverage for the pure suites:
 *   HAPPY:      every spec mapped + file present -> ok; a chain reaching its target via one level
 *               of `bun run` indirection
 *   NEGATIVE:   a spec with no mapping is `no_mapping`; a mapped-but-absent file is `file_absent`;
 *               a chain that never references the target anywhere returns false
 *   BOUNDARY:   an orphan file (fileCountOnDisk > specs.length) fails parity even with `missing`
 *               empty; a self-referencing chain terminates instead of looping
 *   ERROR:      an empty corpus against a non-empty on-disk count still fails parity (arithmetic
 *               is independent of `missing`); a `rootScriptName` absent from `scripts` returns
 *               false rather than throwing
 *   STATE:      multiple missing specs are ALL named, not just the first
 *   REGRESSION: a target string that exists as its OWN standalone, never-referenced script entry
 *               is NOT reachable from an unrelated root (this repo's own prior `check:*` pattern —
 *               see `scripts/tests/check-ac-ref-integrity.test.ts`'s "no CI exists ... had no
 *               caller at all")
 *
 * @spec_ref spec-falsifiability-reachability-a-feedable-checkpoint-an D6, AC-FR-6, AC-FR-7
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExportIndexMapping, MirrorHumanId } from "@lore/core";
import { NoOpTelemetry, assertIsMirrorHumanId } from "@lore/core";
import {
  computeMirrorParity,
  scriptChainReachesTarget,
  loadMirrorMappings,
  countMdFilesFlat,
  MIRROR_DRIFT_EXIT_CODE,
  SPEC_MIRROR_DIR_RELATIVE,
  MIRROR_TYPES,
  mirrorDirRelative,
  type MirrorDocType,
} from "../export-spec-mirror-core.js";
import { InMemoryStore } from "../../packages/lore/src/store/in-memory-store.js";
import { CorpusService } from "../../packages/lore/src/service/corpus-service.js";
import { MigrationService } from "../../packages/lore/src/service/migration-service.js";
import { ReviewService } from "../../packages/lore/src/service/review-service.js";
import { VersionService } from "../../packages/lore/src/service/version-service.js";
import { OutlineService } from "../../packages/lore/src/service/outline-service.js";
import { TreeCheckService } from "../../packages/lore/src/service/tree-check-service.js";
import { runMigrationCoverage } from "../../packages/lore/src/eval/scenarios/migration-coverage.js";
import type { App } from "../../packages/lore/src/app.js";

/**
 * Narrows a raw human_id string literal to the branded {@link MirrorHumanId} for fixture
 * construction — via {@link assertIsMirrorHumanId}, never a textual `as MirrorHumanId` cast
 * (`scripts/check-ordinal-write-sites.mjs`'s rule (c) confines that cast to
 * `packages/core/src/schemas.ts` alone; a fixture file is not that file).
 */
function brandedHumanId(value: string): MirrorHumanId {
  assertIsMirrorHumanId(value);
  return value;
}

// ─── Path setup ─────────────────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const MIRROR_SCRIPT = join(REPO_ROOT, "scripts", "export-spec-mirror.ts");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const PACKAGE_JSON_PATH = join(REPO_ROOT, "package.json");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns `bun run <LORE_ENTRY> ...args` against the REPO ROOT — a read-only corpus query in every call site this file makes. Explicit `maxBuffer` per this repo's spawnSync-truncation discipline (project CLAUDE.md). */
function runLore(args: string[]): RunResult {
  const result = spawnSync("bun", ["run", LORE_ENTRY, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, CLAUDECODE: "1" },
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

/** Spawns the REAL `export-spec-mirror.ts` — the exact `bun run mirror:export` / `bun run check:spec-mirror` path, driven directly (mirrors `check-ac-ref-integrity.test.ts`'s `runDetector`). */
function runMirrorScript(args: string[]): RunResult {
  const result = spawnSync("bun", ["run", MIRROR_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env },
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

/** Reads the REAL root `package.json`'s `scripts` map fresh from disk — never a cached/hardcoded copy, so a manual edit during RED verification is picked up immediately. */
function readRealPackageScripts(): Record<string, string> {
  const raw = readFileSync(PACKAGE_JSON_PATH, "utf8");
  const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
  if (!parsed.scripts) throw new Error(`${PACKAGE_JSON_PATH} has no "scripts" section`);
  return parsed.scripts;
}

/** Live corpus spec (id, slug) pairs via a real `lore list --type spec --json` subprocess — the AC-FR-6-mandated "never a literal typed into the test" source of truth. */
function readLiveCorpusSpecs(): { id: string; slug: string }[] {
  const result = runLore(["list", "--type", "spec", "--json"]);
  if (result.exitCode !== 0) {
    throw new Error(`test setup: lore list --type spec --json failed (exit ${result.exitCode}): ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as { data: { docs: { id: string; slug: string }[] } };
  return parsed.data.docs.map((d) => ({ id: d.id, slug: d.slug }));
}

/** The full live parity snapshot (specs, mappings, on-disk count, existence probe) as of the moment this is called — a fresh re-derivation every time, never reused across a mutation this file makes. */
function measureLiveParity(): { specs: { id: string; slug: string }[]; mappings: Record<string, ExportIndexMapping>; fileCountOnDisk: number; fileExists: (relPath: string) => boolean } {
  const specs = readLiveCorpusSpecs();
  const mappings = loadMirrorMappings(REPO_ROOT);
  const fileCountOnDisk = countMdFilesFlat(join(REPO_ROOT, SPEC_MIRROR_DIR_RELATIVE));
  const fileExists = (relPath: string): boolean => existsSync(join(REPO_ROOT, relPath));
  return { specs, mappings, fileCountOnDisk, fileExists };
}

// ─── AC-FR-10: all-types-parity-and-id-format helpers ────────────────────────
//
// spec-falsifiability-reachability-a-feedable-checkpoint-an D6, AC-FR-10 (task-unify-mirror-
// identifiers-on-zero-padded-form-export-all, 2026-08-11) — widens AC-FR-6/AC-FR-7's spec-only
// scope to all six mirrored doc types, and adds two NEW invariants AC-FR-6 never asserted:
// (b) every mirror file's frontmatter `id:` is byte-identical to its filename's leading
// identifier, zero-padded to 3 digits; (c) the migration-coverage eval over docs/requirements
// reports links_broken === 0. ⛔ Asserted against THIS repo's PRODUCTION corpus — the sibling
// AC-FR-1 (a different plan) went green on a self-seeded corpus while 7 of 8 checkpoints were
// empty in production, which is exactly the failure mode a fixture-only proof would repeat here.

/** Live corpus (id, slug) pairs for ONE {@link MirrorDocType} via a real `lore list --type <t>
 *  --json --include-invalid` subprocess. `--include-invalid` matches EXACTLY what
 *  `ExportDocsService.exportDocs` itself walks (`StoreInterface.findMany` has no invalidation
 *  filter at all — that filter is a `CorpusService.list()`-only post-filter, SPEC-043 D3);
 *  omitting the flag would make knowledge/adr/task counts structurally NEVER match the mirror,
 *  for a reason having nothing to do with padding or missing exports. */
function readLiveCorpusDocsIncludingInvalid(type: MirrorDocType): { id: string; slug: string }[] {
  const result = runLore(["list", "--type", type, "--json", "--include-invalid"]);
  if (result.exitCode !== 0) {
    throw new Error(`test setup: lore list --type ${type} --json --include-invalid failed (exit ${result.exitCode}): ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as { data: { docs: { id: string; slug: string }[] } };
  return parsed.data.docs.map((d) => ({ id: d.id, slug: d.slug }));
}

/** Every `.md` file's basename directly under one mirror type's directory (non-recursive, matches {@link countMdFilesFlat}'s own scope). */
function listMirrorFilenames(type: MirrorDocType): string[] {
  const dir = join(REPO_ROOT, mirrorDirRelative(type));
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name);
}

/** Extracts the frontmatter `id:` scalar from a file's raw content — a minimal, test-local regex parse (mirrors `export-docs-service.test.ts`'s own `parseFrontmatterScalars`, not shared, since that file lives in a different package and this repo's convention keeps test helpers local per SPEC-013's eval CLAUDE.md note on fixtures). Returns `null` if no strict frontmatter block or no `id:` line is found. */
function extractIdFromFileContent(content: string): string | null {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  for (const line of (match[1] ?? "").split("\n")) {
    if (line.startsWith("id:")) return line.slice("id:".length).trim();
  }
  return null;
}

/** Extracts the leading `{PREFIX}-{digits}` identifier from a mirror filename, e.g. `"SPEC-021-foo.md"` → `"SPEC-021"`. Returns `null` if the filename has no such leading segment. */
function extractFilenameLeadingId(filename: string): string | null {
  const match = filename.match(/^([A-Za-z]+-\d+)-/);
  return match?.[1] ?? null;
}

/** True iff `id`'s numeric suffix is zero-padded to AT LEAST 3 digits (`padStart(3,"0")` round-trips to itself) — the canonical mirror form (task-unify-mirror-identifiers-on-zero-padded-form-export-all, 2026-08-11). */
function isThreeDigitPadded(id: string): boolean {
  const match = id.match(/^[A-Za-z]+-(\d+)$/);
  if (!match) return false;
  const digits = match[1] as string;
  return digits.padStart(3, "0") === digits;
}

/** Builds a throwaway `App` backed by `InMemoryStore` — the SAME construction `packages/lore/tests/unit/eval/migration-coverage.test.ts::makeApp` uses, duplicated here (not imported — that file is a `packages/lore`-internal test, this one lives under `scripts/tests/`, and this repo's convention keeps eval-scenario test fixtures local rather than exporting a shared test-only App builder from `src/`). NEVER touches this repo's own `.lore/lore.db` — `MigrationService`/`InMemoryStore` here operate entirely in memory. */
function makeThrowawayApp(): App {
  const store = new InMemoryStore();
  const telemetry = new NoOpTelemetry();
  return {
    corpusService: new CorpusService(store, telemetry),
    reviewService: new ReviewService(store),
    versionService: new VersionService(store),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: null as unknown as App["apiKeyStore"],
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry,
    close: () => { telemetry.close(); },
  };
}

describe("all-types-parity-and-id-format: AC-FR-10 end-to-end against the REAL production corpus (all six doc types, never a fixture)", () => {
  it(
    "HAPPY (a+b): for every mirrored doc type, on-disk file count equals the live corpus count, and every mirror file's frontmatter id: is byte-identical to its filename's zero-padded leading identifier",
    () => {
      const baseline = runMirrorScript([]);
      expect(baseline.exitCode).toBe(0);

      let totalFilesChecked = 0;
      for (const type of MIRROR_TYPES) {
        const liveDocs = readLiveCorpusDocsIncludingInvalid(type);
        const filenames = listMirrorFilenames(type);

        // (a) exact-count parity, per type, against the LIVE corpus — never a literal.
        expect(filenames.length).toBe(liveDocs.length);

        // (b) every mirror file's frontmatter id: is byte-identical to its filename's leading
        // identifier, AND that shared value is zero-padded to (at least) 3 digits.
        for (const filename of filenames) {
          const filenameId = extractFilenameLeadingId(filename);
          expect(filenameId, `${type}/${filename} has no {PREFIX}-{digits}- leading identifier`).not.toBeNull();

          const absPath = join(REPO_ROOT, mirrorDirRelative(type), filename);
          const content = readFileSync(absPath, "utf8");
          const frontmatterId = extractIdFromFileContent(content);
          expect(frontmatterId, `${type}/${filename} has no frontmatter id: line`).not.toBeNull();

          expect(frontmatterId, `${type}/${filename}: frontmatter id: (${frontmatterId}) != filename leading id (${filenameId})`).toBe(filenameId);
          expect(isThreeDigitPadded(frontmatterId as string), `${type}/${filename}: id "${frontmatterId}" is not zero-padded to 3 digits`).toBe(true);

          totalFilesChecked += 1;
        }
      }

      // Sanity floor: never a vacuous pass over zero files (would trivially satisfy every
      // assertion above without checking anything real).
      expect(totalFilesChecked).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    "HAPPY (c): the migration-coverage eval over the REAL docs/requirements reports links_broken === 0",
    async () => {
      const baseline = runMirrorScript([]);
      expect(baseline.exitCode).toBe(0);

      const app = makeThrowawayApp();
      const result = await runMigrationCoverage(join(REPO_ROOT, "docs", "requirements"), app);
      app.close();

      expect(result.expected_files).toBeGreaterThan(0); // sanity floor: never a vacuous empty-dir pass
      expect(result.links_broken).toBe(0);
    },
    60_000,
  );

  it(
    "RED (a) — live: deleting one exported file of any type makes the per-type count parity check fail, naming that type and slug",
    () => {
      const baseline = runMirrorScript([]);
      expect(baseline.exitCode).toBe(0);

      // "plan" (never spec — AC-FR-6/AC-FR-7 already cover spec's own RED cases) — any doc with
      // an export-index mapping works; the first one found is as good as any other.
      const type: MirrorDocType = "plan";
      const mappings = loadMirrorMappings(REPO_ROOT);
      const liveDocs = readLiveCorpusDocsIncludingInvalid(type);
      const target = liveDocs.find((d) => mappings[d.id] !== undefined);
      if (target === undefined) {
        throw new Error(`test setup: no live ${type} doc has an export-index mapping after a clean export`);
      }
      const mapping = mappings[target.id] as ExportIndexMapping;
      const absPath = join(REPO_ROOT, mapping.file_path);

      unlinkSync(absPath);
      try {
        const filenames = listMirrorFilenames(type);
        expect(filenames.length).not.toBe(liveDocs.length);

        const parity = computeMirrorParity(
          liveDocs,
          mappings,
          (relPath) => existsSync(join(REPO_ROOT, relPath)),
          filenames.length,
        );
        expect(parity.ok).toBe(false);
        expect(parity.missing).toContainEqual({ slug: target.slug, reason: "file_absent" });
      } finally {
        const restore = runMirrorScript([]);
        expect(restore.exitCode).toBe(0);
        expect(existsSync(absPath)).toBe(true);
      }
    },
    60_000,
  );

  it(
    "RED (b) — live: rewriting one mirror file's frontmatter id: to the non-padded form fails, naming that exact file",
    () => {
      const baseline = runMirrorScript([]);
      expect(baseline.exitCode).toBe(0);

      const type: MirrorDocType = "adr";
      const filenames = listMirrorFilenames(type);
      const target = filenames.find((f) => extractFilenameLeadingId(f) !== null);
      if (target === undefined) {
        throw new Error(`test setup: no ${type} mirror file has a parseable leading identifier`);
      }
      const filenameId = extractFilenameLeadingId(target) as string;
      const numMatch = filenameId.match(/^([A-Za-z]+)-0*(\d+)$/);
      if (numMatch === null) {
        throw new Error(`test setup: ${filenameId} does not parse as {PREFIX}-{digits}`);
      }
      const prefix = numMatch[1] as string;
      const nonPaddedId = `${prefix}-${Number.parseInt(numMatch[2] as string, 10)}`;

      const absPath = join(REPO_ROOT, mirrorDirRelative(type), target);
      const original = readFileSync(absPath, "utf8");
      const mutated = original.replace(/^id: .+$/m, `id: ${nonPaddedId}`);
      expect(mutated).not.toBe(original); // sanity: the replace actually matched something

      writeFileSync(absPath, mutated, "utf8");
      try {
        const rewritten = readFileSync(absPath, "utf8");
        const frontmatterId = extractIdFromFileContent(rewritten);
        expect(frontmatterId).toBe(nonPaddedId);
        // The RED this test demonstrates: frontmatter id: no longer matches the filename's
        // leading identifier, nor is it 3-digit padded — exactly the AC-FR-10(b) failure shape.
        expect(frontmatterId).not.toBe(filenameId);
        expect(isThreeDigitPadded(frontmatterId as string)).toBe(false);
      } finally {
        writeFileSync(absPath, original, "utf8");
        expect(readFileSync(absPath, "utf8")).toBe(original);
      }
    },
    60_000,
  );

  it(
    "RED (c) — live: pointing one cross-type reference at a non-existent id makes migration-coverage's links_broken non-zero",
    async () => {
      const baseline = runMirrorScript([]);
      expect(baseline.exitCode).toBe(0);

      // A plan mirror file with at least one links: entry — PLAN-115 (audit-remediation, cited
      // in this task's own root-cause diagnosis) always has outbound spec links on this corpus;
      // fall back to scanning if that exact file ever moves.
      const planFilenames = listMirrorFilenames("plan");
      const target = planFilenames.find((f) => {
        const content = readFileSync(join(REPO_ROOT, mirrorDirRelative("plan"), f), "utf8");
        return /^links:\n(  - .*\n)+/m.test(content);
      });
      if (target === undefined) {
        throw new Error("test setup: no plan mirror file has a links: array to corrupt");
      }
      const absPath = join(REPO_ROOT, mirrorDirRelative("plan"), target);
      const original = readFileSync(absPath, "utf8");
      const mutated = original.replace(/(links:\n  - \{id: )([^,]+)(, )/, `$1SPEC-999999$3`);
      expect(mutated).not.toBe(original); // sanity: the replace actually matched something

      writeFileSync(absPath, mutated, "utf8");
      try {
        const app = makeThrowawayApp();
        const result = await runMigrationCoverage(join(REPO_ROOT, "docs", "requirements"), app);
        app.close();

        expect(result.links_broken).toBeGreaterThan(0);
        expect(result.passed).toBe(false);
      } finally {
        writeFileSync(absPath, original, "utf8");
        expect(readFileSync(absPath, "utf8")).toBe(original);
      }
    },
    60_000,
  );
});

// ─── Pure: computeMirrorParity ──────────────────────────────────────────────

describe("computeMirrorParity (pure, no IO)", () => {
  const mkMapping = (filePath: string): ExportIndexMapping => ({ human_id: brandedHumanId("SPEC-1"), file_path: filePath });

  it("HAPPY: every spec mapped with its file present -> ok true, missing empty", () => {
    const specs = [{ id: "id-a", slug: "spec-a" }, { id: "id-b", slug: "spec-b" }];
    const mappings = { "id-a": mkMapping("docs/requirements/spec/a.md"), "id-b": mkMapping("docs/requirements/spec/b.md") };
    const result = computeMirrorParity(specs, mappings, () => true, 2);
    expect(result).toEqual({ corpusSpecCount: 2, fileCountOnDisk: 2, missing: [], ok: true });
  });

  it("NEGATIVE: a spec with no export-index entry at all is reported missing with reason no_mapping, naming its slug", () => {
    const specs = [{ id: "id-a", slug: "spec-never-exported" }];
    const result = computeMirrorParity(specs, {}, () => true, 0);
    expect(result.missing).toEqual([{ slug: "spec-never-exported", reason: "no_mapping" }]);
    expect(result.ok).toBe(false);
  });

  it("NEGATIVE: a spec mapped but whose file_path does not exist is reported missing with reason file_absent, naming its slug", () => {
    const specs = [{ id: "id-a", slug: "spec-deleted-file" }];
    const mappings = { "id-a": mkMapping("docs/requirements/spec/deleted.md") };
    const result = computeMirrorParity(specs, mappings, () => false, 0);
    expect(result.missing).toEqual([{ slug: "spec-deleted-file", reason: "file_absent" }]);
    expect(result.ok).toBe(false);
  });

  it("BOUNDARY: an orphan file inflating fileCountOnDisk beyond specs.length fails parity even though missing is empty", () => {
    const specs = [{ id: "id-a", slug: "spec-a" }];
    const mappings = { "id-a": mkMapping("docs/requirements/spec/a.md") };
    // fileExists is true for the one mapped file; fileCountOnDisk (2) reflects an orphan the
    // mapping table doesn't know about — the exact-count half of `ok` must catch this alone.
    const result = computeMirrorParity(specs, mappings, () => true, 2);
    expect(result.missing).toEqual([]);
    expect(result.fileCountOnDisk).toBe(2);
    expect(result.corpusSpecCount).toBe(1);
    expect(result.ok).toBe(false);
  });

  it("ERROR: an empty corpus against a non-empty on-disk count still fails parity (arithmetic is independent of missing, which is vacuously empty)", () => {
    const result = computeMirrorParity([], {}, () => true, 3);
    expect(result.missing).toEqual([]);
    expect(result.corpusSpecCount).toBe(0);
    expect(result.fileCountOnDisk).toBe(3);
    expect(result.ok).toBe(false);
  });

  it("STATE: multiple missing specs are ALL named, not just the first", () => {
    const specs = [
      { id: "id-a", slug: "spec-a-missing" },
      { id: "id-b", slug: "spec-b-present" },
      { id: "id-c", slug: "spec-c-missing" },
    ];
    const mappings = {
      "id-b": mkMapping("docs/requirements/spec/b.md"),
      "id-c": mkMapping("docs/requirements/spec/c.md"),
    };
    const fileExists = (p: string): boolean => p !== "docs/requirements/spec/c.md";
    const result = computeMirrorParity(specs, mappings, fileExists, 1);
    expect(result.missing).toEqual([
      { slug: "spec-a-missing", reason: "no_mapping" },
      { slug: "spec-c-missing", reason: "file_absent" },
    ]);
  });

  it("REGRESSION: fileExists is consulted with the mapping's file_path, never the spec's slug or id", () => {
    const specs = [{ id: "id-a", slug: "spec-a" }];
    const mappings = { "id-a": mkMapping("docs/requirements/spec/exact-path.md") };
    const seenArgs: string[] = [];
    const fileExists = (p: string): boolean => {
      seenArgs.push(p);
      return true;
    };
    computeMirrorParity(specs, mappings, fileExists, 1);
    expect(seenArgs).toEqual(["docs/requirements/spec/exact-path.md"]);
  });
});

// ─── Pure: scriptChainReachesTarget ──────────────────────────────────────────

describe("scriptChainReachesTarget (pure, no IO)", () => {
  it("HAPPY: a script's own value directly containing the target substring is reachable from itself", () => {
    const scripts = { "check:spec-mirror": "bun scripts/export-spec-mirror.ts --check" };
    expect(scriptChainReachesTarget(scripts, "check:spec-mirror", "export-spec-mirror.ts")).toBe(true);
  });

  it("HAPPY: one level of `bun run <name>` indirection to a script whose value contains the target is reachable", () => {
    const scripts = {
      test: "bun run test:vitest && bun run test:bun && bun run check:spec-mirror",
      "check:spec-mirror": "bun scripts/export-spec-mirror.ts --check",
    };
    expect(scriptChainReachesTarget(scripts, "test", "export-spec-mirror.ts")).toBe(true);
  });

  it("NEGATIVE (export-covers-corpus, RED a — in-memory control): a test chain with the check:spec-mirror reference removed does not reach the export script", () => {
    // Simulates exactly the AC-FR-6 RED(a) mutation ("remove the script from the chain") without
    // touching the real package.json — the mutated fixture mirrors the pre-fix `test` script
    // (before this task's own D6 revision wired check:spec-mirror into it).
    const mutatedScripts = {
      test: "bun run test:vitest && bun run test:bun",
      "check:spec-mirror": "bun scripts/export-spec-mirror.ts --check",
    };
    expect(scriptChainReachesTarget(mutatedScripts, "test", "export-spec-mirror.ts")).toBe(false);
  });

  it("BOUNDARY: a cyclic script chain (A -> B -> A) terminates and returns false when the target is unreachable", () => {
    const scripts = { a: "bun run b", b: "bun run a" };
    expect(scriptChainReachesTarget(scripts, "a", "export-spec-mirror.ts")).toBe(false);
  });

  it("ERROR: a rootScriptName absent from the scripts map returns false rather than throwing", () => {
    expect(() => scriptChainReachesTarget({}, "does-not-exist", "export-spec-mirror.ts")).not.toThrow();
    expect(scriptChainReachesTarget({}, "does-not-exist", "export-spec-mirror.ts")).toBe(false);
  });

  it("REGRESSION: a target existing as its OWN standalone, never-referenced script entry is NOT reachable from an unrelated root — existing is not the same as being wired (this repo's own prior check:* antipattern)", () => {
    const scripts = {
      test: "bun run test:vitest && bun run test:bun",
      "check:spec-mirror": "bun scripts/export-spec-mirror.ts --check",
    };
    expect(scriptChainReachesTarget(scripts, "test", "export-spec-mirror.ts")).toBe(false);
  });
});

// ─── export-covers-corpus: AC-FR-6 end-to-end ────────────────────────────────

describe("export-covers-corpus: AC-FR-6 end-to-end against the REAL package.json + REAL live corpus", () => {
  it("export-covers-corpus: HAPPY — the REAL root package.json's test chain reaches export-spec-mirror.ts (via check:spec-mirror), proving the export script is WIRED, not merely present", () => {
    // AC-FR-6 names the SCRIPT ("export-spec-mirror.ts"), never a specific mode-flag string —
    // `check:spec-mirror` invokes this exact file (with --check), so the criterion holds while
    // the chain-wired command itself stays read-only (D6; see export-spec-mirror.ts's own header
    // for why `mirror:export`, the WRITE mode, is deliberately NOT chain-wired).
    const scripts = readRealPackageScripts();
    expect(scriptChainReachesTarget(scripts, "test", "export-spec-mirror.ts")).toBe(true);
  });

  it(
    "export-covers-corpus: HAPPY — after running the real exporter against the real corpus, on-disk file count EQUALS the LIVE corpus spec count and every corpus spec slug is present as a file",
    () => {
      const exportResult = runMirrorScript([]);
      expect(exportResult.exitCode).toBe(0);
      expect(exportResult.stdout).toContain("OK — every corpus spec has a mirror file (count and slug parity; file CONTENT is not compared).");

      // Independent, fresh re-derivation — never trusts the script's own self-report.
      const { specs, mappings, fileCountOnDisk, fileExists } = measureLiveParity();
      expect(specs.length).toBeGreaterThan(0); // sanity floor: never a vacuous empty-corpus pass

      const parity = computeMirrorParity(specs, mappings, fileExists, fileCountOnDisk);
      expect(parity.missing).toEqual([]);
      expect(parity.fileCountOnDisk).toBe(parity.corpusSpecCount);
      expect(parity.ok).toBe(true);
    },
    30000,
  );

  it(
    "export-covers-corpus: NEGATIVE (RED b, live) — deleting one exported file after export makes the parity check fail, NAMING that exact slug",
    () => {
      // Re-establish a known-clean baseline first — this test never assumes a prior test's state.
      const baseline = runMirrorScript([]);
      expect(baseline.exitCode).toBe(0);

      const before = measureLiveParity();
      const target = before.specs.find((s) => before.mappings[s.id] !== undefined);
      if (target === undefined) {
        throw new Error("test setup: no corpus spec has an export-index mapping after a clean export — cannot induce RED b");
      }
      const mapping = before.mappings[target.id]!;
      const absPath = join(REPO_ROOT, mapping.file_path);

      unlinkSync(absPath);
      try {
        // Re-measure fresh (never reuse the pre-deletion snapshot) so this assertion reflects
        // the SAME live state the deletion just changed.
        const after = measureLiveParity();
        const parity = computeMirrorParity(after.specs, after.mappings, after.fileExists, after.fileCountOnDisk);

        expect(parity.ok).toBe(false);
        expect(parity.missing).toContainEqual({ slug: target.slug, reason: "file_absent" });
      } finally {
        // Restore — the exporter is idempotent/convergent, so re-running it recreates exactly
        // the deleted file and nothing else.
        const restore = runMirrorScript([]);
        expect(restore.exitCode).toBe(0);
        expect(existsSync(absPath)).toBe(true);
      }
    },
    30000,
  );
});

// ─── drift-check-is-separate: AC-FR-7 end-to-end ─────────────────────────────

describe("drift-check-is-separate: AC-FR-7 end-to-end against the REAL script + REAL live corpus", () => {
  it(
    "drift-check-is-separate: HAPPY — after a clean export, running --check twice in a row reports OK both times",
    () => {
      const baseline = runMirrorScript([]);
      expect(baseline.exitCode).toBe(0);

      const first = runMirrorScript(["--check"]);
      expect(first.exitCode).toBe(0);
      expect(first.stdout).toContain("OK — every corpus spec has a mirror file (count and slug parity; file CONTENT is not compared).");

      const second = runMirrorScript(["--check"]);
      expect(second.exitCode).toBe(0);
      expect(second.stdout).toContain("OK — every corpus spec has a mirror file (count and slug parity; file CONTENT is not compared).");
    },
    30000,
  );

  it(
    "drift-check-is-separate: NEGATIVE — with one mirror file deleted, --check exits EXACTLY MIRROR_DRIFT_EXIT_CODE and names the missing slug on BOTH consecutive runs, never regenerating the file",
    () => {
      const baseline = runMirrorScript([]);
      expect(baseline.exitCode).toBe(0);

      const before = measureLiveParity();
      const target = before.specs.find((s) => before.mappings[s.id] !== undefined);
      if (target === undefined) {
        throw new Error("test setup: no corpus spec has an export-index mapping after a clean export — cannot induce this scenario");
      }
      const mapping = before.mappings[target.id]!;
      const absPath = join(REPO_ROOT, mapping.file_path);

      unlinkSync(absPath);
      try {
        const firstCheck = runMirrorScript(["--check"]);
        expect(firstCheck.exitCode).toBe(MIRROR_DRIFT_EXIT_CODE);
        expect(firstCheck.stdout + firstCheck.stderr).toContain(target.slug);

        // The check must NEVER regenerate what it inspects — the file must still be absent,
        // and a SECOND consecutive run must report the IDENTICAL drift, not a self-healed clean.
        expect(existsSync(absPath)).toBe(false);

        const secondCheck = runMirrorScript(["--check"]);
        expect(secondCheck.exitCode).toBe(MIRROR_DRIFT_EXIT_CODE);
        expect(secondCheck.stdout + secondCheck.stderr).toContain(target.slug);
        expect(existsSync(absPath)).toBe(false);
      } finally {
        const restore = runMirrorScript([]);
        expect(restore.exitCode).toBe(0);
        expect(existsSync(absPath)).toBe(true);
      }
    },
    30000,
  );
});
