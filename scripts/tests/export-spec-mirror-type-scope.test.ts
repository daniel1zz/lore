/**
 * AC-MOS-4 — `spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by`,
 * `task-a-real-argv-parser-for-export-spec-mirror-unknown-flags`.
 *
 * Proves that `--type` narrows WHICH mirrored types `scripts/export-spec-mirror.ts --check` visits
 * and NOTHING else: for a type it does visit, the narrowed run reports the same drift, by the same
 * slug, with the same exit code, as the full run.
 *
 * ## Why the oracle is a seeded drift and never a stopwatch
 *
 * The falsifier design is inherited verbatim from
 * `task-the-mirror-check-absorbed-the-content-probe-in-90951390`: a timing assertion has no
 * discriminating power — a `--type` that scanned nothing at all would be the fastest of all and
 * would pass it. ⛔ Wall-clock is a machine property and appears in NO assertion here. What is
 * asserted instead is a real drift, seeded in exactly one type, and three verdicts over it:
 *
 *   (a) the full `--check` exits `MIRROR_DRIFT_EXIT_CODE` and names the seeded slug;
 *   (b) `--check --type <seeded>` exits the SAME code and names the SAME slug;
 *   (c) `--check --type <other>` exits 0 and does NOT name that slug.
 *
 * Smallest mutation turning this red: make the narrow path skip the seeded type — (b) fails; make
 * it scan everything — (c) fails.
 *
 * ⛔ (c) alone is satisfiable VACUOUSLY: a `--type` that visited no type whatsoever would also
 * exit 0 without naming the slug. So each narrowed run additionally asserts that its own type WAS
 * visited (its parity line is present) and that the other type was NOT — "scanned and clean" is
 * kept distinguishable from "never looked".
 *
 * ⛔ The three conjuncts are asserted with `expect.soft` so that ONE run reports EVERY violated
 * conjunct. Measured while building the two falsifier probes: under a hard `expect`, making
 * `--type` inert aborted the test inside (b) and (c) was never evaluated, which would have made
 * the two falsifier directions indistinguishable in the recorded output.
 *
 * ## Isolation — a throwaway corpus AND a throwaway repo root, never this repo's mirror
 *
 * Everything this suite creates or mutates lives under a `mkdtempSync(tmpdir(),
 * "lore-mirror-type-scope-")` directory that serves as BOTH the corpus (`lore init`, ⛔ never this
 * repo's `.lore/`) and the `repoRoot` the mirror is written to. That is not a stylistic
 * preference: while `scripts/tests/spec-mirror-export.test.ts` held a REAL mirror file deleted,
 * `scripts/tests/mirror-status-parity.test.ts` ran concurrently in another worker
 * (`fileParallelism` default true, `maxWorkers: 4`) and legitimately reported drift — one file's
 * mutation reddening another (defect 2 of
 * `task-skill-test-the-mirror-end-to-end-oracles-cost-o-corpus`). No other process can name these
 * paths: `export-spec-mirror.ts` computes its own `REPO_ROOT` from that FILE's location, so it
 * reaches this fixture only through `main`'s explicit override parameters. The hash-equality check
 * below is the PROOF that the isolation held on this run; this paragraph is only the argument.
 *
 * ## Why a driver subprocess rather than importing `main`
 *
 * Same reason as `scripts/tests/spec-mirror-content-drift.test.ts` (see its header):
 * `export-spec-mirror.ts` top-level-imports `createApp` -> `bun:sqlite`, unresolvable inside a
 * vitest worker, and a plain `bun scripts/export-spec-mirror.ts` cannot be redirected at a
 * throwaway corpus — only `main(argv, repoRoot, dbPath)` can. The driver passes its trailing
 * arguments through to `argv` UNCHANGED, so what is under test is the real argv path, not a
 * hand-assembled options object.
 *
 * Coverage: HAPPY (the three conjuncts in one run) / NEGATIVE (a non-seeded type reports no drift
 * and never names the seeded slug) / BOUNDARY (the narrowed run's exit code and named slug EQUAL
 * the full run's, not merely "also non-zero") / ERROR (each narrowed run proves it visited its own
 * type, so an empty scan cannot masquerade as a clean one) / STATE (the narrowed check run twice
 * over unchanged state reports the identical verdict — it repairs nothing) / REGRESSION (once the
 * body is restored, the full AND the narrowed run both exit 0, so the narrow path is not wired to
 * report drift unconditionally).
 *
 * Side-effect class: IO — creates throwaway directories under the OS temp dir, spawns `bun`
 * subprocesses, and mutates files inside those directories ONLY. Never touches this repo's
 * `.lore/`, `docs/requirements/`, or `dist/`.
 *
 * @spec_ref spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by AC-MOS-4
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMirrorMappings, MIRROR_DRIFT_EXIT_CODE } from "../export-spec-mirror-core.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
// `.js` specifier — Bun resolves this to the sibling `.ts` source (project CLAUDE.md "Import style").
const MIRROR_SCRIPT_JS_SPECIFIER = join(REPO_ROOT, "scripts", "export-spec-mirror.js");

/** The type the drift is seeded in. */
const SEEDED_TYPE = "knowledge";
/** A DIFFERENT mirrored type, seeded with a doc of its own so a narrowed run over it has something to find. */
const OTHER_TYPE = "adr";

/** Appended to a mirror file's BODY to make it diverge from the corpus projection. */
const BODY_MUTATION_LINE = "\nThis sentence exists only on disk and never in the corpus document.\n";

// ─── Throwaway corpus + repo root lifecycle (never this repo's own .lore/) ──────

const tmpDirs: string[] = [];

function makeThrowawayDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-mirror-type-scope-"));
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
 * Writes the one driver this file needs: a real `bun run` entry point (never imported by this
 * vitest worker) that forwards its trailing arguments to `main(argv, repoRoot, dbPath)` UNCHANGED,
 * so the argv parser under test is the thing actually exercised.
 */
function writeDriver(dir: string): string {
  const driverPath = join(dir, "mirror-type-scope-driver.ts");
  const source = `
import { main } from ${JSON.stringify(MIRROR_SCRIPT_JS_SPECIFIER)};

const [, , dbPath, repoRoot, ...mirrorArgs] = process.argv;
process.exit(await main(mirrorArgs, repoRoot, dbPath));
`;
  writeFileSync(driverPath, source, "utf8");
  return driverPath;
}

interface DriverResult {
  readonly exitCode: number;
  /** stdout + stderr — parity goes to stdout, drift findings to stderr. */
  readonly output: string;
}

function runDriver(seed: SeededCorpus, ...mirrorArgs: readonly string[]): DriverResult {
  const result = spawnSync("bun", ["run", seed.driverPath, seed.dbPath, seed.dir, ...mirrorArgs], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status === null) {
    throw new Error(`mirror-type-scope-driver crashed (signal ${result.signal}): ${result.stderr}`);
  }
  return { exitCode: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

interface SeededCorpus {
  readonly dir: string;
  readonly dbPath: string;
  readonly driverPath: string;
  /** Slug of the `knowledge` doc whose mirror body the test mutates. */
  readonly seededSlug: string;
  /** ULID of the `adr` doc, left clean — its export-index mapping is what proves the narrowed run over `OTHER_TYPE` had a real file to judge. */
  readonly otherDocId: string;
  readonly seededFilePath: string;
  /** The exact bytes the exporter wrote for the seeded doc — restoring them re-converges the body. */
  readonly exportedContent: string;
}

function createDoc(dir: string, args: readonly string[]): { id: string; slug: string } {
  const out = execFileSync("bun", [LORE_ENTRY, ...args, "--json"], { cwd: dir, stdio: "pipe" }).toString();
  const created = parseJsonOutput(out) as { ok: boolean; data?: { id?: string; slug?: string } };
  if (!created.ok || created.data?.id === undefined || created.data.slug === undefined) {
    throw new Error(`test setup: lore ${args.join(" ")} did not return an id+slug: ${out}`);
  }
  return { id: created.data.id, slug: created.data.slug };
}

/**
 * Builds a throwaway corpus holding ONE doc of {@link SEEDED_TYPE} and ONE of {@link OTHER_TYPE},
 * exports the mirror, and asserts the baseline check is CLEAN — so any later non-zero verdict is
 * attributable to the mutation under test rather than to a corpus that never converged.
 */
function seedTwoTypeCorpus(): SeededCorpus {
  const dir = makeThrowawayDir();
  execFileSync("bun", [LORE_ENTRY, "init", "--author", "mirror-type-scope-test"], { cwd: dir, stdio: "pipe" });

  const seeded = createDoc(dir, [
    "create", SEEDED_TYPE,
    "--title", "Type Scope Seeded Drift",
    "--sub-type", "reference",
    "--content", "# Type Scope Seeded Drift\n\nThe corpus is the only place this body is authored.\n",
  ]);
  const other = createDoc(dir, [
    "create", OTHER_TYPE,
    "--title", "Type Scope Clean Neighbour",
    "--decision-status", "accepted",
    "--content", "# Type Scope Clean Neighbour\n\nThis document's mirror is never mutated.\n",
  ]);

  const dbPath = join(dir, ".lore", "lore.db");
  const driverPath = writeDriver(dir);
  const partial: SeededCorpus = {
    dir, dbPath, driverPath,
    seededSlug: seeded.slug, otherDocId: other.id,
    seededFilePath: "", exportedContent: "",
  };

  const baselineExport = runDriver(partial);
  if (baselineExport.exitCode !== 0) {
    throw new Error(`test setup: baseline export exited ${baselineExport.exitCode}: ${baselineExport.output}`);
  }

  const mapping = loadMirrorMappings(dir)[seeded.id];
  if (mapping === undefined) {
    throw new Error(`test setup: no export-index mapping for ${seeded.id} after the baseline export`);
  }
  const seededFilePath = join(dir, mapping.file_path);

  const baselineCheck = runDriver(partial, "--check");
  if (baselineCheck.exitCode !== 0) {
    throw new Error(`test setup: baseline check exited ${baselineCheck.exitCode}, expected 0: ${baselineCheck.output}`);
  }

  return { ...partial, seededFilePath, exportedContent: readFileSync(seededFilePath, "utf8") };
}

/** sha256 of the raw file bytes — the instrument proving nothing re-exported between the mutation and the assertion. */
function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Appends a line the corpus document does not contain, so the mirrored BODY diverges. */
function seedBodyDrift(seed: SeededCorpus): string {
  writeFileSync(seed.seededFilePath, `${seed.exportedContent}${BODY_MUTATION_LINE}`, "utf8");
  return fileHash(seed.seededFilePath);
}

describe("--type narrows the scan without narrowing what it can detect", () => {
  it(
    `AC-MOS-4 (a)+(b)+(c): the full check and \`--type ${SEEDED_TYPE}\` report the SAME drift by the SAME slug, while \`--type ${OTHER_TYPE}\` reports none`,
    () => {
      const seed = seedTwoTypeCorpus();
      const hashAfterMutation = seedBodyDrift(seed);

      // ⛔ `expect.soft` throughout the three conjuncts, deliberately: the criterion asks for all
      // three IN ONE RUN, and a hard `expect` would abort at the first violated one — so a single
      // mutation would only ever evidence whichever conjunct happens to be checked first, and
      // "(b) fails" vs "(c) fails" would be indistinguishable in the output. Measured while
      // building the two falsifier probes for this file: making `--type` inert reddened the
      // narrowing check inside (b) and the run never reached (c) at all. Soft assertions report
      // every violated conjunct; the test still fails.
      // (a) — the unnarrowed command, the one `bun run check:spec-mirror` invokes.
      const full = runDriver(seed, "--check");
      expect.soft(full.exitCode).toBe(MIRROR_DRIFT_EXIT_CODE);
      expect.soft(full.output).toContain(seed.seededSlug);
      // Non-vacuity for (a): the full run really did visit BOTH types.
      expect.soft(full.output).toContain(`docs/requirements/${SEEDED_TYPE}`);
      expect.soft(full.output).toContain(`docs/requirements/${OTHER_TYPE}`);

      // (b) — narrowing to the seeded type keeps every bit of detection.
      const narrowedToSeeded = runDriver(seed, "--check", "--type", SEEDED_TYPE);
      expect.soft(narrowedToSeeded.exitCode).toBe(MIRROR_DRIFT_EXIT_CODE);
      expect.soft(narrowedToSeeded.exitCode).toBe(full.exitCode);
      expect.soft(narrowedToSeeded.output).toContain(seed.seededSlug);
      // ...and it really was narrowed: the other type's directory is never mentioned.
      expect.soft(narrowedToSeeded.output).toContain(`docs/requirements/${SEEDED_TYPE}`);
      expect.soft(narrowedToSeeded.output).not.toContain(`docs/requirements/${OTHER_TYPE}`);

      // (c) — a type with no seeded drift is clean, and never borrows the other type's finding.
      const narrowedToOther = runDriver(seed, "--check", "--type", OTHER_TYPE);
      expect.soft(narrowedToOther.exitCode).toBe(0);
      expect.soft(narrowedToOther.output).not.toContain(seed.seededSlug);
      // Non-vacuity for (c): exiting 0 must mean "looked and found nothing", not "looked at nothing".
      expect.soft(narrowedToOther.output).toContain(`docs/requirements/${OTHER_TYPE}`);
      // ...over a directory that is not empty: the neighbour doc was exported there, so a clean
      // verdict is a statement about a real file, not about an absent one.
      expect(loadMirrorMappings(seed.dir)[seed.otherDocId]?.file_path).toContain(`docs/requirements/${OTHER_TYPE}`);

      // Nothing re-exported between the mutation and these assertions — see the header's isolation note.
      expect(fileHash(seed.seededFilePath)).toBe(hashAfterMutation);
    },
    300_000,
  );

  it(
    "STATE + REGRESSION: the narrowed check repairs nothing (same verdict twice), and once the body is restored both the narrowed and the full run exit 0",
    () => {
      const seed = seedTwoTypeCorpus();
      const hashAfterMutation = seedBodyDrift(seed);

      const first = runDriver(seed, "--check", "--type", SEEDED_TYPE);
      const second = runDriver(seed, "--check", "--type", SEEDED_TYPE);
      expect(first.exitCode).toBe(MIRROR_DRIFT_EXIT_CODE);
      expect(second.exitCode).toBe(first.exitCode);
      expect(second.output).toContain(seed.seededSlug);
      expect(fileHash(seed.seededFilePath)).toBe(hashAfterMutation);

      // REGRESSION control: without this, a narrow path hardcoded to report drift would pass
      // everything above.
      writeFileSync(seed.seededFilePath, seed.exportedContent, "utf8");
      expect(runDriver(seed, "--check", "--type", SEEDED_TYPE).exitCode).toBe(0);
      expect(runDriver(seed, "--check").exitCode).toBe(0);
    },
    300_000,
  );
});
