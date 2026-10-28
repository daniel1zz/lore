// @spawns packages/lore/src/index.ts
/**
 * AC-BFI-8 — `spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor`,
 * task-compare-mirror-bodies-against-corpus-content-in-the-spec.
 *
 * Proves that `scripts/export-spec-mirror.ts --check` detects a mirror file whose BODY no longer
 * matches its corpus document: exit EXACTLY {@link MIRROR_DRIFT_EXIT_CODE} (2), the divergent
 * SLUG named in the output, and the same verdict on two consecutive runs.
 *
 * Measured baseline this file exists to close (2026-08-17, before the fix): a line appended to
 * `docs/requirements/adr/ADR-001-*.md` left `bun run check:spec-mirror` exiting 0, printing
 * "OK — every corpus adr has a mirror file (count and slug parity; file CONTENT is not compared)".
 *
 * ## The two no-repair conditions, and why (ii) is not paranoia
 *
 *   (i)  The CHECK must not regenerate what it inspects — run twice consecutively it must report
 *        the SAME drift both times. Asserted directly, and its discriminating power is proven by
 *        the REGRESSION case below: a real force-export interleaved between the two runs DOES turn
 *        the second one clean, so a check that repaired would be caught here rather than sailing
 *        through on an assertion nothing could falsify.
 *   (ii) NOTHING may re-export between the mutation and the assertion. Every case that mutates a
 *        body hashes the file IMMEDIATELY after mutating and re-reads that hash IMMEDIATELY before
 *        asserting, requiring equality. This is measured-necessary, not theoretical: on `main` at
 *        `cedb29db` one full `bun run test` moved the mirror fingerprint `45ea1381 -> 4c84f428`,
 *        because the sibling `scripts/tests/spec-mirror-export.ts` drives the REAL exporter against
 *        the REAL production corpus by design (AC-FR-6/7/10 require that) and vitest runs files
 *        concurrently. The BOUNDARY case below proves the equality assertion is falsifiable by
 *        forcing exactly that interleave.
 *
 * ## Isolation mechanism — a throwaway corpus AND a throwaway repo root
 *
 * Every file this suite mutates lives under a `mkdtempSync(tmpdir(), "lore-mirror-content-")`
 * directory that serves as BOTH the corpus (`lore init`, never this repo's own `.lore/`) and the
 * `repoRoot` the mirror is written to. No other process can name that path: the sibling exporter
 * suite derives its target from `REPO_ROOT` (this checkout) and passes `--check` besides, and
 * `export-spec-mirror.ts`'s own `REPO_ROOT` is computed from THAT FILE's on-disk location, never
 * from `cwd`. So a concurrent exporter — this repo's suite, a peer agent's `mirror:export`, a
 * stray `lore export-docs` — physically cannot reach these files. ⛔ That argument is why the
 * isolation holds; condition (ii) above is the PROOF that it held on this run, and it is the
 * assertion, not this paragraph, that fails if the reasoning is ever wrong.
 *
 * ## Why a driver subprocess rather than importing `main` directly
 *
 * Same reason `scripts/tests/mirror-frontmatter-drift.test.ts` writes one (see its header):
 * `export-spec-mirror.ts` top-level-imports `createApp` -> `bun:sqlite`, unresolvable inside a
 * vitest worker; and a plain `bun run scripts/export-spec-mirror.ts` cannot be redirected at a
 * throwaway corpus, because that script derives `repoRoot`/`dbPath` itself unless `main`'s override
 * parameters are passed. A real `bun run` driver is the only route to `main(argv, repoRoot, dbPath)`.
 *
 * Coverage: HAPPY (drift detected by slug, exact exit 2, stable across two runs) / NEGATIVE
 * (restored body exits EXACTLY 0; a frontmatter-only edit is NOT reported as body drift) /
 * BOUNDARY (whitespace-only body edit is normalized away; a forced interleave breaks the hash
 * equality) / REGRESSION (a force-export between two checks turns the second clean, proving the
 * twice-identical assertion is falsifiable).
 *
 * Side-effect class: IO — creates throwaway directories under the OS temp dir, spawns `bun`
 * subprocesses, and mutates files inside those directories ONLY. Never touches this repo's
 * `.lore/`, `docs/requirements/`, or `dist/`.
 *
 * @spec_ref spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor AC-BFI-8
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { ensureRequirementsDocSlugViaEntry } from "../../packages/lore/tests/helpers/parented-create.js";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadMirrorMappings,
  MIRROR_BODY_DIVERGENT_DETAIL,
  MIRROR_DRIFT_EXIT_CODE,
  MIRROR_HARD_FAILURE_EXIT_CODE,
  mirrorContentOkMessage,
} from "../export-spec-mirror-core.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
// `.js` specifier — Bun resolves this to the sibling `.ts` source (project CLAUDE.md "Import style").
const MIRROR_SCRIPT_JS_SPECIFIER = join(REPO_ROOT, "scripts", "export-spec-mirror.js");
const APP_JS_SPECIFIER = join(REPO_ROOT, "packages", "lore", "src", "app.js");
const LIVE_INVOCATION_JS_SPECIFIER = join(REPO_ROOT, "packages", "lore", "tests", "live-invocation.js");

/** Appended to a mirror file's BODY to make it diverge from the corpus projection. */
const BODY_MUTATION_LINE = "\nThis sentence exists only on disk and never in the corpus document.\n";

// ─── Throwaway corpus + repo root lifecycle (never this repo's own .lore/) ──────

const tmpDirs: string[] = [];

function makeThrowawayDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-mirror-content-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup — a leftover temp dir must never fail the run
    }
  }
});

/** Extracts the JSON payload from a `--json` CLI stdout (pretty-printed, so multi-line). */
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
 * Writes the one driver this file needs — a real `bun run` entry point (never imported by this
 * vitest worker) exposing three modes against an EXPLICIT throwaway `repoRoot`/`dbPath`:
 *
 *   `check`        — `main(["--check"], repoRoot, dbPath)`, the exact `bun run check:spec-mirror` path.
 *   `export`       — `main([], repoRoot, dbPath)`, the exact `bun run mirror:export` path (no force:
 *                    it converges frontmatter but deliberately leaves a body-drifted file alone).
 *   `export-force` — `exportDocs({ force: true })` per type, the `lore export-docs --force` path,
 *                    the ONLY thing that converges a drifted BODY. Used to construct the two
 *                    falsifiability controls; never to "fix up" a case before its assertion.
 */
function writeDriver(dir: string): string {
  const driverPath = join(dir, "mirror-content-driver.ts");
  const source = `
import { main, MIRROR_TYPES } from ${JSON.stringify(MIRROR_SCRIPT_JS_SPECIFIER)};
import { createApp } from ${JSON.stringify(APP_JS_SPECIFIER)};
import { liveAmbient, liveWriteContext } from ${JSON.stringify(LIVE_INVOCATION_JS_SPECIFIER)};

const [, , mode, dbPath, repoRoot] = process.argv;

async function run() {
  if (mode === "check" || mode === "export") {
    const exitCode = await main(mode === "check" ? ["--check"] : [], repoRoot, dbPath);
    console.log(JSON.stringify({ exitCode }));
    process.exit(exitCode);
  }
  if (mode === "export-force") {
    const app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
    try {
      for (const type of MIRROR_TYPES) {
        const result = await app.exportDocsService.exportDocs({
          projectDir: repoRoot,
          dryRun: false,
          force: true,
          type,
        });
        if (!result.ok) {
          console.log(JSON.stringify({ ok: false, type, error: result.error }));
          process.exit(1);
        }
      }
      console.log(JSON.stringify({ ok: true }));
      process.exit(0);
    } finally {
      app.close();
    }
  }
  console.error("mirror-content-driver: unknown mode " + mode);
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
  /** stdout + stderr — the check prints parity to stdout and drift findings to stderr. */
  readonly output: string;
}

function runDriver(driverPath: string, mode: string, dbPath: string, repoRoot: string): DriverResult {
  const result = spawnSync("bun", ["run", driverPath, mode, dbPath, repoRoot], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status === null) {
    throw new Error(`mirror-content-driver crashed (signal ${result.signal}): ${result.stderr}`);
  }
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { exitCode: result.status, stdout, stderr, output: `${stdout}\n${stderr}` };
}

/** sha256 of the raw file bytes — the condition (ii) instrument. */
function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

interface SeededCorpus {
  readonly dir: string;
  readonly dbPath: string;
  readonly driverPath: string;
  readonly slug: string;
  readonly absFilePath: string;
  /** The exact bytes the exporter wrote — restoring these makes the body match the corpus again. */
  readonly exportedContent: string;
}

/**
 * Builds a throwaway corpus with one `knowledge` doc, exports the mirror, and asserts the baseline
 * check is CLEAN — so any later non-zero verdict is attributable to the mutation under test rather
 * than to a corpus that never converged in the first place.
 */
function seedCorpusWithExportedMirror(): SeededCorpus {
  const dir = makeThrowawayDir();
  execFileSync("bun", [LORE_ENTRY, "init", "--author", "mirror-content-test"], { cwd: dir, stdio: "pipe" });

  const createOut = execFileSync(
    "bun",
    [
      LORE_ENTRY, "create", "knowledge", "--parent", ensureRequirementsDocSlugViaEntry(LORE_ENTRY, dir),
      "--title", "Body Divergence Probe",
      "--sub-type", "reference",
      "--content", "# Body Divergence Probe\n\nThe corpus is the only place this body is authored.\n",
      "--json",
    ],
    { cwd: dir, stdio: "pipe" },
  ).toString();
  const created = parseJsonOutput(createOut) as { ok: boolean; data?: { id?: string; slug?: string } };
  if (!created.ok || created.data?.id === undefined || created.data.slug === undefined) {
    throw new Error(`test setup: lore create knowledge did not return an id+slug: ${createOut}`);
  }
  const { id: docId, slug } = created.data;

  const dbPath = join(dir, ".lore", "lore.db");
  const driverPath = writeDriver(dir);

  const baselineExport = runDriver(driverPath, "export", dbPath, dir);
  if (baselineExport.exitCode !== 0) {
    throw new Error(`test setup: baseline export exited ${baselineExport.exitCode}: ${baselineExport.output}`);
  }

  const mapping = loadMirrorMappings(dir)[docId];
  if (mapping === undefined) {
    throw new Error(`test setup: no export-index mapping for ${docId} after the baseline export`);
  }
  const absFilePath = join(dir, mapping.file_path);

  const baselineCheck = runDriver(driverPath, "check", dbPath, dir);
  if (baselineCheck.exitCode !== 0) {
    throw new Error(`test setup: baseline check exited ${baselineCheck.exitCode}, expected 0: ${baselineCheck.output}`);
  }

  return { dir, dbPath, driverPath, slug, absFilePath, exportedContent: readFileSync(absFilePath, "utf8") };
}

/** Appends a line to the mirror file's BODY (frontmatter untouched) and returns the mutated bytes. */
function mutateBody(absFilePath: string): string {
  const mutated = readFileSync(absFilePath, "utf8") + BODY_MUTATION_LINE;
  writeFileSync(absFilePath, mutated, "utf8");
  return mutated;
}

describe("AC-BFI-8 — spec-mirror --check compares mirror BODIES against corpus content, and nothing repairs them before the assertion", () => {
  it(
    "HAPPY + STATE: a mirror body edited away from its corpus document makes --check exit EXACTLY 2 naming the slug, identically on two consecutive runs, with the mutated file byte-unchanged across the whole window",
    () => {
      const corpus = seedCorpusWithExportedMirror();

      mutateBody(corpus.absFilePath);
      // Condition (ii), first half — hashed IMMEDIATELY after the mutation, before anything else runs.
      const hashAfterMutation = fileHash(corpus.absFilePath);

      const first = runDriver(corpus.driverPath, "check", corpus.dbPath, corpus.dir);
      const second = runDriver(corpus.driverPath, "check", corpus.dbPath, corpus.dir);

      // Condition (ii), second half — re-read IMMEDIATELY before asserting. If ANY concurrent
      // exporter (or the check itself) rewrote the file, this differs and the case fails here
      // rather than reporting a drift verdict about a file that is no longer the one we mutated.
      const hashBeforeAssertion = fileHash(corpus.absFilePath);
      expect(hashBeforeAssertion).toBe(hashAfterMutation);

      // EXACT exit code. ⛔ Never "non-zero": MIRROR_HARD_FAILURE_EXIT_CODE (4) is also non-zero
      // and would mean the check crashed, which has zero discriminating power for this criterion.
      expect(first.exitCode).toBe(MIRROR_DRIFT_EXIT_CODE);
      expect(first.exitCode).not.toBe(MIRROR_HARD_FAILURE_EXIT_CODE);
      expect(first.output).toContain(corpus.slug);
      expect(first.output).toContain(MIRROR_BODY_DIVERGENT_DETAIL);

      // Condition (i) — the check did not regenerate what it inspected.
      expect(second.exitCode).toBe(MIRROR_DRIFT_EXIT_CODE);
      expect(second.output).toContain(corpus.slug);
      expect(second.output).toContain(MIRROR_BODY_DIVERGENT_DETAIL);
    },
    120_000,
  );

  it(
    "NEGATIVE (paired control): restoring the body to the exported bytes makes the IDENTICAL run exit EXACTLY 0 — proving the 2 above came from body divergence, not from a crash or a permanently-red check",
    () => {
      const corpus = seedCorpusWithExportedMirror();

      mutateBody(corpus.absFilePath);
      const drifted = runDriver(corpus.driverPath, "check", corpus.dbPath, corpus.dir);
      expect(drifted.exitCode).toBe(MIRROR_DRIFT_EXIT_CODE);

      writeFileSync(corpus.absFilePath, corpus.exportedContent, "utf8");
      const restored = runDriver(corpus.driverPath, "check", corpus.dbPath, corpus.dir);

      expect(restored.exitCode).toBe(0);
      expect(restored.output).toContain(mirrorContentOkMessage("knowledge"));
      expect(restored.output).not.toContain(MIRROR_BODY_DIVERGENT_DETAIL);
    },
    120_000,
  );

  it(
    "REGRESSION (falsifiability of condition (i)): a real force-export interleaved between two checks DOES turn the second one clean — so the twice-identical assertion above is falsifiable, and a check that repaired what it inspects would be caught by it",
    () => {
      const corpus = seedCorpusWithExportedMirror();

      mutateBody(corpus.absFilePath);
      const before = runDriver(corpus.driverPath, "check", corpus.dbPath, corpus.dir);
      expect(before.exitCode).toBe(MIRROR_DRIFT_EXIT_CODE);

      // The FORCED regeneration — deterministic, never a scheduling race.
      const forced = runDriver(corpus.driverPath, "export-force", corpus.dbPath, corpus.dir);
      expect(forced.exitCode).toBe(0);

      const after = runDriver(corpus.driverPath, "check", corpus.dbPath, corpus.dir);
      expect(after.exitCode).toBe(0);
      expect(after.output).not.toContain(MIRROR_BODY_DIVERGENT_DETAIL);
    },
    120_000,
  );

  it(
    "BOUNDARY (falsifiability of condition (ii)): invoking the real exporter between the mutation and the assertion CHANGES the file hash — so the equality assertion in the HAPPY case is a live instrument, not a tautology",
    () => {
      const corpus = seedCorpusWithExportedMirror();

      mutateBody(corpus.absFilePath);
      const hashAfterMutation = fileHash(corpus.absFilePath);

      // The forced interleave AC-BFI-8 RED (c) names — the exact event condition (ii) exists to
      // detect, performed deliberately here rather than waited for.
      const forced = runDriver(corpus.driverPath, "export-force", corpus.dbPath, corpus.dir);
      expect(forced.exitCode).toBe(0);

      const hashAfterInterleave = fileHash(corpus.absFilePath);
      expect(hashAfterInterleave).not.toBe(hashAfterMutation);
      expect(readFileSync(corpus.absFilePath, "utf8")).not.toContain(BODY_MUTATION_LINE.trim());
    },
    120_000,
  );

  it(
    "NEGATIVE (no over-match): a frontmatter-only edit on disk is NOT reported as BODY divergence — it is counted as frontmatter drift (exit 2), never as a body difference",
    () => {
      const corpus = seedCorpusWithExportedMirror();

      // `status:` is a frontmatter scalar, outside the body by construction. A content check that
      // compared whole files (or re-derived its own notion of "body") would flag this.
      const edited = corpus.exportedContent.replace(/^status: .*$/m, "status: archived");
      expect(edited).not.toBe(corpus.exportedContent);
      writeFileSync(corpus.absFilePath, edited, "utf8");
      const hashAfterMutation = fileHash(corpus.absFilePath);

      const result = runDriver(corpus.driverPath, "check", corpus.dbPath, corpus.dir);

      const hashBeforeAssertion = fileHash(corpus.absFilePath);
      expect(hashBeforeAssertion).toBe(hashAfterMutation);

      expect(result.output).not.toContain(MIRROR_BODY_DIVERGENT_DETAIL);
      // (F3; AC-CRIT-5 is owned by mirror-body-drift-rewrite.test.ts): a status-only drift is drift — --check exits exactly 2 and says it is frontmatter.
      expect(result.exitCode).toBe(2);
      expect(result.output).toContain("frontmatter (status/priority/title/tags/phase) differs");
    },
    120_000,
  );

  it(
    "BOUNDARY (no over-match): trailing whitespace appended to the body is normalized away by the shared canonicaliseBody comparison — not reported as divergence",
    () => {
      const corpus = seedCorpusWithExportedMirror();

      writeFileSync(corpus.absFilePath, `${corpus.exportedContent}   \n\n`, "utf8");
      const hashAfterMutation = fileHash(corpus.absFilePath);

      const result = runDriver(corpus.driverPath, "check", corpus.dbPath, corpus.dir);

      const hashBeforeAssertion = fileHash(corpus.absFilePath);
      expect(hashBeforeAssertion).toBe(hashAfterMutation);

      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain(MIRROR_BODY_DIVERGENT_DETAIL);
    },
    120_000,
  );
});
