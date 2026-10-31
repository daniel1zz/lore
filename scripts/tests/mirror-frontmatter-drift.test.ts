// @spawns packages/lore/src/index.ts
/**
 * AC-OX-5 — spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check.
 *
 * task-the-two-mirror-exporters-disagree-because-drift-detection: a status-only mirror drift
 * (a doc transitions e.g. draft->archived with its body byte-unchanged) was invisible to every
 * command in this repo — `bun run mirror:export` never touched the file (body matched, so the
 * pre-fix write loop reported `skipped_clean`), `lore export-docs --force` was a no-op for the
 * same reason (force only rewrites files the body-only detector already flagged), and
 * `check:spec-mirror` never looked past count+slug. Measured on main 2026-08-13: 202 of 1470
 * mapped mirror files disagreed with their corpus doc's `status`, and all three commands printed
 * OK against every one of them.
 *
 * This file proves the fix generalizes the write loop's staleness check (export-docs-
 * service.ts) from "identity fields only" (`id`/`parent`/`plan`/`links`, the pre-existing
 * `identity_repaired` mechanism) to the remaining scalar frontmatter fields
 * (`status`/`priority`/`title`/`tags`/`phase`) that are ALSO pure projections of the corpus doc
 * and ALSO invisible to a body-only comparison by construction.
 *
 * Two halves, by IO shape (mirrors `scripts/tests/spec-mirror-export.test.ts`'s own split):
 *
 *   1. "production wiring" (AC-OX-5 a+b+d) — a REAL throwaway corpus (`mkdtemp` + `lore init`,
 *      NEVER this repo's own `.lore/`), driven through BOTH named production surfaces:
 *        - `scripts/export-spec-mirror.ts`'s own exported `main`/`runExport` (the exact
 *          `bun run mirror:export` code path) via a tiny driver subprocess this test writes at
 *          runtime — a plain `bun run <script>` subprocess can't be redirected to a throwaway
 *          corpus (that file's own module header: `projectDir`/`REPO_ROOT` are always derived
 *          from THE SCRIPT's own on-disk location, never `cwd` or the corpus DB path), and this
 *          test file itself cannot import that script directly (it top-level-imports
 *          `createApp` -> `bun:sqlite`, unresolvable inside a vitest worker, same module header)
 *          — so the driver subprocess (a REAL `bun run`, not a vitest worker) is the only way to
 *          call `main(argv, repoRootOverride, dbPathOverride)` with throwaway overrides.
 *        - `ExportDocsService.exportDocs` directly (same driver, a second mode), proving
 *          detection independent of the CLI/script wrapper.
 *      A grep proving `frontmatter_repaired`/`extractFrontmatterScalarFields` exist would pass
 *      even if `main()`'s write path never reached them — this half proves the file on disk
 *      actually changes.
 *
 *   2. "honest decline" (AC-OX-5 c) — InMemoryStore + ExportDocsService directly (the estabished
 *      `packages/lore/tests/unit/service/export-docs-service.test.ts` pattern — no bun:sqlite, no
 *      subprocess needed for these narrower, cheaper scenarios), proving a case the repair
 *      deliberately declines is NAMED (`frontmatter_declined`) rather than silently reported
 *      `skipped_clean`/OK.
 *
 * Coverage: HAPPY (detection+repair+wiring+convergence) / NEGATIVE (undecidable frontmatter,
 * body+frontmatter both stale without --force) / STATE (second run is a byte-identical no-op).
 *
 * @spec_ref spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check AC-OX-5
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { ensureRequirementsDocSlugViaEntry } from "../../packages/lore/tests/helpers/parented-create-via-entry.js";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicaliseBody, splitFrontmatter, ok, DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { DocRecord, Slug } from "@lore/core";
import { loadMirrorMappings } from "../export-spec-mirror-core.js";
import { InMemoryStore } from "../../packages/lore/src/store/in-memory-store.js";
import { ExportDocsService, type ResolveDocBody } from "../../packages/lore/src/service/export-docs-service.js";
import { OutlineService, renderResolvedToMarkdown } from "../../packages/lore/src/service/outline-service.js";
import { actedStore } from "../../packages/lore/tests/live-invocation.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
// `.js` specifier — Bun resolves this to the sibling `.ts` source, same convention this repo's
// own relative imports already use (project CLAUDE.md "Import style").
const MIRROR_SCRIPT_JS_SPECIFIER = join(REPO_ROOT, "scripts", "export-spec-mirror.js");
const APP_JS_SPECIFIER = join(REPO_ROOT, "packages", "lore", "src", "app.js");
const LIVE_INVOCATION_JS_SPECIFIER = join(REPO_ROOT, "packages", "lore", "tests", "live-invocation.js");

// ─── Throwaway real-corpus lifecycle (never this repo's own .lore/) ─────────────

const tmpDirs: string[] = [];

function makeThrowawayCorpusDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-mirror-drift-"));
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

/**
 * Extracts the JSON payload from CLI stdout. Unlike `global-setup.ts`'s single-line
 * `parseLastJsonLine` helper, this repo's `--json` commands (e.g. `lore create ... --json`)
 * pretty-print via `JSON.stringify(data, null, 2)` — a genuine multi-line blob, not one line
 * per record. Tries the whole trimmed output first (the common case: `--json` is the only
 * thing printed); falls back to slicing from the first `{` to the last `}` (tolerates a stray
 * warning line before/after the JSON blob).
 */
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
 * Writes the ONE driver this file needs into `dir` — a real `.ts` entry point (executed as a
 * genuine `bun run` subprocess, never imported by this vitest file) that imports BOTH
 * `scripts/export-spec-mirror.ts`'s `main` and `packages/lore/src/app.ts`'s `createApp` via
 * ABSOLUTE specifiers, so it can drive either surface against an EXPLICIT throwaway
 * `repoRoot`/`dbPath` — the override parameters those functions already accept but that no
 * `--check`-style CLI flag exposes. See this file's own header for why this is the only route.
 */
function writeDriver(dir: string): string {
  const driverPath = join(dir, "mirror-drift-driver.ts");
  const source = `
import { main } from ${JSON.stringify(MIRROR_SCRIPT_JS_SPECIFIER)};
import { createApp } from ${JSON.stringify(APP_JS_SPECIFIER)};
import { liveAmbient, liveWriteContext } from ${JSON.stringify(LIVE_INVOCATION_JS_SPECIFIER)};

const [, , mode, dbPath, repoRoot, typeArg] = process.argv;

async function run() {
  if (mode === "export" || mode === "check") {
    const exitCode = await main(mode === "check" ? ["--check"] : [], repoRoot, dbPath);
    console.log(JSON.stringify({ exitCode }));
    process.exit(exitCode);
  }
  if (mode === "detect") {
    const app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
    try {
      const result = await app.exportDocsService.exportDocs({
        projectDir: repoRoot,
        dryRun: true,
        type: typeArg,
      });
      if (!result.ok) {
        console.log(JSON.stringify({ ok: false, error: result.error }));
        process.exit(1);
      }
      console.log(JSON.stringify({ ok: true, report: result.value }));
      process.exit(0);
    } finally {
      app.close();
    }
  }
  console.error("mirror-drift-driver: unknown mode " + mode);
  process.exit(1);
}

await run();
`;
  writeFileSync(driverPath, source, "utf8");
  return driverPath;
}

interface DriverResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runDriver(driverPath: string, args: readonly string[]): DriverResult {
  const result = spawnSync("bun", ["run", driverPath, ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status === null) {
    throw new Error(`mirror-drift-driver crashed (signal ${result.signal}): ${result.stderr}`);
  }
  return { exitCode: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

interface DetectReport {
  readonly frontmatter_repaired: readonly string[];
  readonly frontmatter_declined: readonly string[];
  readonly skipped_clean: readonly string[];
}

function parseDetectReport(driverResult: DriverResult): DetectReport {
  const parsed = parseJsonOutput(driverResult.stdout) as { ok: boolean; report?: DetectReport };
  if (!parsed.ok || parsed.report === undefined) {
    throw new Error(`mirror-drift-driver detect mode failed: ${driverResult.stdout}\n${driverResult.stderr}`);
  }
  return parsed.report;
}

/** sha256 of the raw file bytes — used for the byte-identical-no-op assertion (AC-OX-5b). */
function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// ─── Half 1: production wiring — a REAL throwaway corpus, both named entry points ──

describe("AC-OX-5 (a+b+d) — production wiring: a status-only draft->archived drift is detected and repaired through scripts/export-spec-mirror.ts's own main() AND ExportDocsService directly, on a throwaway corpus", () => {
  it(
    "HAPPY: seeded draft->archived transition (body byte-unchanged) — detected nonzero, shown CLEAN by a pure body-only control, repaired by main()'s write mode, and a second run is a byte-identical no-op",
    () => {
      const tmpDir = makeThrowawayCorpusDir();

      // 1. Real throwaway corpus — `lore init`, never this repo's own `.lore/`.
      execFileSync("bun", [LORE_ENTRY, "init", "--author", "mirror-drift-test"], { cwd: tmpDir, stdio: "pipe" });

      // 2. Seed one `knowledge` doc (no parent_id required; draft->archived is a VALID single-hop
      //    transition for this type per DRAFT_TO_ARCHIVED_ALLOWED_TYPES, schemas.ts) with a body
      //    that will NEVER change for the rest of this test.
      const createOut = execFileSync(
        "bun",
        [
          LORE_ENTRY, "create", "knowledge", "--parent", ensureRequirementsDocSlugViaEntry(LORE_ENTRY, tmpDir),
          "--title", "Frontmatter Drift Probe",
          "--sub-type", "reference",
          "--content", "# Frontmatter Drift Probe\n\nThis body never changes across this test.\n",
          "--json",
        ],
        { cwd: tmpDir, stdio: "pipe" },
      ).toString();
      const created = parseJsonOutput(createOut) as { ok: boolean; data?: { id: string } };
      if (!created.ok || created.data === undefined) {
        throw new Error(`test setup: lore create knowledge failed: ${createOut}`);
      }
      const docId = created.data.id;

      const dbPath = join(tmpDir, ".lore", "lore.db");
      const driverPath = writeDriver(tmpDir);

      // 3. Baseline export (write mode, via main() itself) — writes the mirror file with
      //    `status: draft`.
      const baseline = runDriver(driverPath, ["export", dbPath, tmpDir]);
      expect(baseline.exitCode).toBe(0);

      const mappingsAfterBaseline = loadMirrorMappings(tmpDir);
      const mapping = mappingsAfterBaseline[docId];
      if (mapping === undefined) {
        throw new Error(`test setup: no export-index mapping for ${docId} after baseline export`);
      }
      const absFilePath = join(tmpDir, mapping.file_path);
      const preMutationContent = readFileSync(absFilePath, "utf8");
      expect(preMutationContent).toMatch(/^status: draft$/m);

      // 4. Mutate the CORPUS doc's status only — draft -> archived, body untouched.
      const setOut = execFileSync(
        "bun",
        [LORE_ENTRY, "set", docId, "--status", "archived", "--json"],
        { cwd: tmpDir, stdio: "pipe" },
      ).toString();
      const setResult = parseJsonOutput(setOut) as { ok: boolean };
      if (!setResult.ok) {
        throw new Error(`test setup: lore set --status archived failed: ${setOut}`);
      }

      // The mirror file on disk is UNCHANGED by the corpus write alone (this is exactly the
      // measured defect: no invocable command has run yet).
      const postMutationContent = readFileSync(absFilePath, "utf8");
      expect(postMutationContent).toBe(preMutationContent);
      expect(postMutationContent).toMatch(/^status: draft$/m);

      // ── (a) DETECTION + REVERSE CONTROL ──────────────────────────────────────
      //
      // Reverse control FIRST: a pure body-only comparison (splitFrontmatter + canonicaliseBody,
      // the SAME two public @lore/core functions the pre-fix write loop's drift check used,
      // never a re-derivation) reports this exact construction CLEAN — the body is
      // byte-identical before and after the status mutation. Without this control, a nonzero
      // verdict from the new mechanism would be indistinguishable from a detector that flags
      // everything.
      const preMutationSplit = splitFrontmatter(preMutationContent, "strict");
      const postMutationSplit = splitFrontmatter(postMutationContent, "strict");
      if (!preMutationSplit.ok || !postMutationSplit.ok) {
        throw new Error("test setup: mirror file has no strict frontmatter block");
      }
      expect(canonicaliseBody(postMutationSplit.body)).toBe(canonicaliseBody(preMutationSplit.body));

      // Now the ACTUAL detector: driving `ExportDocsService.exportDocs` directly (dryRun,
      // read-only), via the driver's "detect" mode — nonzero verdict, naming this exact file.
      const detect = runDriver(driverPath, ["detect", dbPath, tmpDir, "knowledge"]);
      expect(detect.exitCode).toBe(0);
      const detectReport = parseDetectReport(detect);
      expect(detectReport.frontmatter_repaired).toEqual([mapping.file_path]);
      expect(detectReport.frontmatter_declined).toEqual([]);
      expect(detectReport.skipped_clean).not.toContain(mapping.file_path);

      // dryRun: true must not have written anything.
      expect(readFileSync(absFilePath, "utf8")).toBe(postMutationContent);

      // ── (b) REPAIR, via main()'s write mode — the EXACT `bun run mirror:export` path ────
      const repair = runDriver(driverPath, ["export", dbPath, tmpDir]);
      expect(repair.exitCode).toBe(0);

      const repairedContent = readFileSync(absFilePath, "utf8");
      expect(repairedContent).toMatch(/^status: archived$/m);
      expect(repairedContent).not.toMatch(/^status: draft$/m);
      // Body is STILL byte-identical — only the frontmatter scalar line changed.
      const repairedSplit = splitFrontmatter(repairedContent, "strict");
      if (!repairedSplit.ok) throw new Error("test setup: repaired mirror file has no frontmatter block");
      expect(canonicaliseBody(repairedSplit.body)).toBe(canonicaliseBody(preMutationSplit.body));

      // A re-run of detection now reports CLEAN for this file.
      const detectAfterRepair = runDriver(driverPath, ["detect", dbPath, tmpDir, "knowledge"]);
      expect(detectAfterRepair.exitCode).toBe(0);
      const detectAfterRepairReport = parseDetectReport(detectAfterRepair);
      expect(detectAfterRepairReport.frontmatter_repaired).toEqual([]);
      expect(detectAfterRepairReport.frontmatter_declined).toEqual([]);
      expect(detectAfterRepairReport.skipped_clean).toContain(mapping.file_path);

      // STATE — a SECOND real write-mode run is a byte-identical no-op (hash equality), proving
      // convergence rather than mere mutation.
      const hashBeforeSecondRun = fileHash(absFilePath);
      const secondRepairRun = runDriver(driverPath, ["export", dbPath, tmpDir]);
      expect(secondRepairRun.exitCode).toBe(0);
      const hashAfterSecondRun = fileHash(absFilePath);
      expect(hashAfterSecondRun).toBe(hashBeforeSecondRun);
    },
    60_000,
  );
});

// ─── Half 2: honest decline — InMemoryStore + ExportDocsService directly ───────

/** Same construction style as `packages/lore/tests/unit/service/export-docs-service.test.ts` — local, not shared (test-helper files stay local per this repo's convention). */
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
  const dir = join(tmpdir(), `lore-mirror-drift-decline-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, ".lore"), { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

function makeDoc(overrides: Partial<DocRecord> & { id: string; type: DocRecord["type"]; title: string; slug: string }): DocRecord {
  const now = "2026-08-13T00:00:00.000Z";
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

describe("AC-OX-5 (c) — honest decline: a repair the mechanism cannot safely perform is NAMED, never silently folded into skipped_clean", () => {
  it("NEGATIVE: on-disk frontmatter with the status: line stripped (body otherwise clean) is UNDECIDABLE — declined, not reported clean", async () => {
    const store = actedStore(new InMemoryStore());
    const service = makeExportService(store);
    const projectDir = makeInMemoryProjectDir();

    const doc = await insertDoc(store, makeDoc({
      id: "doc-undecidable-1",
      slug: "knowledge-undecidable-probe",
      type: "knowledge",
      title: "Undecidable Probe",
      content: "# Undecidable Probe\n\nBody.",
      status: "draft",
      extra: { sub_type: "reference" },
    }));

    const baseline = await service.exportDocs({ projectDir, dryRun: false, type: "knowledge" });
    if (!baseline.ok) throw new Error(`baseline export failed: ${JSON.stringify(baseline.error)}`);
    expect(baseline.value.created.length).toBe(1);
    const filePath = baseline.value.created[0]!;
    const absPath = join(projectDir, filePath);

    // Corrupt ONLY the frontmatter — strip the entire status: line, leaving body untouched.
    const original = readFileSync(absPath, "utf8");
    const corrupted = original.replace(/^status: .+\n/m, "");
    expect(corrupted).not.toBe(original); // sanity: the replace actually matched something
    writeFileSync(absPath, corrupted, "utf8");

    // Mutate the corpus doc's status too (irrelevant to whether this is UNDECIDABLE — even a
    // real drift can't be safely repaired if the on-disk frontmatter can't be parsed at all).
    const updateResult = await store.update(doc.id, { status: "archived" });
    if (!updateResult.ok) throw new Error(`store.update failed: ${JSON.stringify(updateResult.error)}`);

    const detect = await service.exportDocs({ projectDir, dryRun: true, type: "knowledge" });
    if (!detect.ok) throw new Error(`detect export failed: ${JSON.stringify(detect.error)}`);
    expect(detect.value.frontmatter_declined).toEqual([filePath]);
    expect(detect.value.frontmatter_repaired).toEqual([]);
    expect(detect.value.skipped_clean).not.toContain(filePath);

    // dryRun must not have touched the file.
    expect(readFileSync(absPath, "utf8")).toBe(corrupted);
  });

  it("NEGATIVE: body AND frontmatter both drifted, without --force — declined explicitly (in addition to the existing drift[] entry), file left untouched", async () => {
    const store = actedStore(new InMemoryStore());
    const service = makeExportService(store);
    const projectDir = makeInMemoryProjectDir();

    const doc = await insertDoc(store, makeDoc({
      id: "doc-both-stale-1",
      slug: "knowledge-both-stale-probe",
      type: "knowledge",
      title: "Both Stale Probe",
      content: "# Both Stale Probe\n\nOriginal body.",
      status: "draft",
      extra: { sub_type: "reference" },
    }));

    const baseline = await service.exportDocs({ projectDir, dryRun: false, type: "knowledge" });
    if (!baseline.ok) throw new Error(`baseline export failed: ${JSON.stringify(baseline.error)}`);
    const filePath = baseline.value.created[0]!;
    const absPath = join(projectDir, filePath);
    const original = readFileSync(absPath, "utf8");

    // Hand-edit the BODY (simulates a manual edit — the pre-existing drift[] case).
    const bodyEdited = original.replace("Original body.", "Hand-edited body.");
    expect(bodyEdited).not.toBe(original);
    writeFileSync(absPath, bodyEdited, "utf8");

    // ALSO change the corpus doc's status — this file is now stale in BOTH dimensions.
    const updateResult = await store.update(doc.id, { status: "archived" });
    if (!updateResult.ok) throw new Error(`store.update failed: ${JSON.stringify(updateResult.error)}`);

    const run = await service.exportDocs({ projectDir, dryRun: false, type: "knowledge" }); // force omitted
    if (!run.ok) throw new Error(`export failed: ${JSON.stringify(run.error)}`);

    expect(run.value.drift).toEqual([filePath]);
    expect(run.value.frontmatter_declined).toEqual([filePath]);
    expect(run.value.frontmatter_repaired).toEqual([]);
    expect(run.value.skipped_clean).not.toContain(filePath);

    // Without --force, the file must be left byte-identical to the hand-edited state.
    expect(readFileSync(absPath, "utf8")).toBe(bodyEdited);
  });
});
