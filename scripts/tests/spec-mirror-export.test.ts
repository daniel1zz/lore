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
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExportIndexMapping } from "@lore/core";
import {
  computeMirrorParity,
  scriptChainReachesTarget,
  loadMirrorMappings,
  countMdFilesFlat,
  MIRROR_DRIFT_EXIT_CODE,
  SPEC_MIRROR_DIR_RELATIVE,
} from "../export-spec-mirror-core.js";

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

// ─── Pure: computeMirrorParity ──────────────────────────────────────────────

describe("computeMirrorParity (pure, no IO)", () => {
  const mkMapping = (filePath: string): ExportIndexMapping => ({ human_id: "SPEC-1", file_path: filePath });

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
      expect(exportResult.stdout).toContain("OK — mirror matches the corpus exactly.");

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
      expect(first.stdout).toContain("OK — mirror matches the corpus exactly.");

      const second = runMirrorScript(["--check"]);
      expect(second.exitCode).toBe(0);
      expect(second.stdout).toContain("OK — mirror matches the corpus exactly.");
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
