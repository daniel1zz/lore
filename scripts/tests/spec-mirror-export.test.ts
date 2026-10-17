// @spawns packages/lore/src/index.ts
/**
 * Tests for `scripts/export-spec-mirror.ts` + `scripts/export-spec-mirror-core.ts` —
 * `spec-falsifiability-reachability-a-feedable-checkpoint-an` D6, AC-FR-6/AC-FR-7/AC-FR-10 (G5).
 *
 * Two halves, deliberately split by IO shape (mirrors `scripts/tests/check-ac-ref-integrity.test.ts`):
 *
 *   1. Pure algorithm suites (`computeMirrorParity`, `scriptChainReachesTarget`, plus the fs-only
 *      helpers `loadMirrorMappings`/`countMdFilesFlat`) import directly from
 *      `../export-spec-mirror-core.js` — that module has NO `bun:sqlite` dependency anywhere in
 *      its import graph (see its own header), unlike the sibling `export-spec-mirror.ts` IO shell
 *      (imports `createApp`, which does).
 *   2. The end-to-end suites drive the real `lore` CLI and the real `export-spec-mirror.ts` against
 *      ONE seeded `mkdtemp` + `lore init` corpus holding one doc of each of the six mirrored types,
 *      exported once into that fixture's own `docs/requirements/`.
 *
 * ## ⛔ Where the PRODUCTION half went (task-skill-test-tg-2)
 *
 * AC-FR-6 and AC-FR-10 are claims about THIS repo's production corpus and mirror ("never a seeded
 * fixture"; "asserted against the LIVE corpus count, never a literal typed into the test"). Reading
 * the repo's live `.lore/` and its `docs/requirements/` tree from the unit suite made this file's
 * verdict depend on whatever a concurrent session had just written, so those HAPPY assertions
 * moved to `scripts/check-live-mirror-integrity.ts` (wired into `bun run test` as
 * `check:live-repo-state`), which calls the SAME measurement functions
 * (`scripts/lib/mirror-integrity.ts`) this file proves on the fixture. AC-FR-6 and AC-FR-10 are
 * therefore bound to BOTH: this file's `-t` suites (the logic and every RED control) and that
 * script (production). AC-FR-7 states nothing about the live corpus, so it stays on this file.
 *
 * ⛔ The mutation cases used to mutate a `cpSync` copy of the real tree read against the real
 * corpus (a deliberate earlier decision: invented documents prove nothing about production counts).
 * That reasoning still holds for the HAPPY assertions, which is exactly why they stayed live in the
 * script. The RED controls only need a corpus and a mirror to break; a copy of 1,700 production
 * files was a scan of the repo tree the unit suite must not make.
 *
 *      ⛔ AC-OX-1 (`spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check`): every
 *      `export-spec-mirror.ts` call a CASE makes passes `--check` — the READ-ONLY drift-report
 *      path. The single write-mode export below runs ONCE, while building the fixture and before
 *      any drift is seeded, against a throwaway root that is not this repository; it is the setup,
 *      never a "re-establish a clean baseline" step inside a case.
 *
 * ## Isolation
 *
 * Every mutation lands inside the fixture root, which {@link assertInsideTmp} proves is under the OS
 * temp dir before each write. Nothing in this file names `REPO_ROOT`'s `.lore/` or
 * `docs/requirements/`, so no concurrently scheduled sibling suite can see a mutation.
 *
 * ## Delta assertions instead of clean-baseline preconditions
 *
 * Every RED case captures the observable BEFORE mutating, mutates, captures AFTER, and asserts the
 * difference — the target slug is named AFTER and was NOT named BEFORE. A delta proves the mutation
 * CAUSED the change rather than inheriting a state some other test left behind. AC-FR-7's own
 * words are "reports the same drift both times" — IDENTITY between two consecutive runs — so its
 * HAPPY case asserts identity plus an unchanged file-hash manifest.
 *
 * ## Six-dimension coverage for the pure suites
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
 *               is NOT reachable from an unrelated root (this repo's own prior `check:*` pattern)
 *
 * Side-effect class: IO — spawns `bun` subprocesses and WRITES only inside its own `mkdtemp`
 * fixture. ⛔ It never reads this repo's `.lore/` or `docs/requirements/`, and never writes a byte
 * under either.
 *
 * @spec_ref spec-falsifiability-reachability-a-feedable-checkpoint-an D6, AC-FR-6, AC-FR-7, AC-FR-10
 * @spec_ref spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check AC-OX-1
 * @spec_ref spec-a-test-case-s-timeout-budget-must-be-declared-when-its D1/D2/D4
 */

import { describe, it, expect, afterAll } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExportIndexMapping, MirrorHumanId } from "@lore/core";
import { assertIsMirrorHumanId } from "@lore/core";
import {
  computeMirrorParity,
  scriptChainReachesTarget,
  loadMirrorMappings,
  countMdFilesFlat,
  MIRROR_DRIFT_EXIT_CODE,
  MIRROR_MAPPED_FILE_MISSING_DETAIL,
  mirrorParityOkMessage,
  SPEC_MIRROR_DIR_RELATIVE,
  MIRROR_TYPES,
  mirrorDirRelative,
  type MirrorDocType,
} from "../export-spec-mirror-core.js";
import {
  extractFilenameLeadingId,
  extractIdFromFileContent,
  isThreeDigitPadded,
  listMirrorFilenamesAt,
  measureAllTypesParity,
  measureLinksBrokenAt,
  runLoreList,
} from "../lib/mirror-integrity.js";

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

// Locates the code under test (the CLI entry and the mirror script) — never a corpus or a mirror.
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CODE_ROOT = join(__dirname, "..", "..");
const LORE_ENTRY = join(CODE_ROOT, "packages", "lore", "src", "index.ts");
const DOCS_REQUIREMENTS_RELATIVE = join("docs", "requirements");
// `.js` specifier — Bun resolves this to the sibling `.ts` source (project CLAUDE.md "Import
// style"). Imported by the generated driver subprocess ONLY, never by this vitest worker:
// `export-spec-mirror.ts` top-level-imports `createApp` -> `bun:sqlite`, unresolvable in-worker.
const MIRROR_SCRIPT_JS_SPECIFIER = join(CODE_ROOT, "scripts", "export-spec-mirror.js");
const MIRROR_CORE_JS_SPECIFIER = join(CODE_ROOT, "scripts", "export-spec-mirror-core.js");

// ─── Declared timeout budgets ────────────────────────────────────────────────
//
// Measured 2026-08-25 on the PRODUCTION corpus (1741 mirror files, six types) for ONE
// `export-spec-mirror.ts --check` pass. The fixture's passes are far cheaper (six docs), but every
// budget below stays derived from the COLD production figure: a budget is declared arithmetic, not
// a measurement of today's fixture, and a fresh worktree always pays cold for `bun` transpilation.

/** One production `--check` pass, COLD. Corroborated by `knowledge-corpus-growth-crossed-three-hard-coded-thresholds-in`'s last-green measurements of 28298ms and 27931ms. */
const CHECK_PASS_COLD_MS = 27_900;

/**
 * A case's declared timeout budget, as ARITHMETIC rather than a comment's claim: `passes` full
 * `--check` passes priced at the COLD figure, plus `otherWorkMs` for everything else that case does
 * (subprocess reads, in-process migration-coverage passes, fixture construction, slack).
 *
 * `spec-a-test-case-s-timeout-budget-must-be-declared-when-its` judges DECLARATION, never the
 * value; `scripts/check-test-budgets.ts` accepts any non-empty third argument, so an expression
 * satisfies it exactly as a literal does.
 */
function budgetMs(passes: number, otherWorkMs: number): number {
  return passes * CHECK_PASS_COLD_MS + otherWorkMs;
}

/** Cap on a child's captured output. The fixture's output is a few KB; the cap fails LOUD rather than truncating. */
const MAX_SUBPROCESS_BUFFER_BYTES = 64 * 1024 * 1024;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Awaits a subprocess instead of blocking the vitest worker (`spawnSync` for a long pass starves
 * the reporter's `onTaskUpdate` heartbeat and exits 1 behind a green summary — measured
 * 2026-08-25). An exit code is returned ONLY when the child actually returned one, and the output
 * cap fails LOUD instead of handing back silently truncated bytes.
 */
async function spawnCaptureAsync(
  label: string,
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, env: { ...process.env, CLAUDECODE: "1" } });
    let stdout = "";
    let stderr = "";
    let killedForBuffer = false;

    const guardBuffer = (): void => {
      if (!killedForBuffer && stdout.length + stderr.length > MAX_SUBPROCESS_BUFFER_BYTES) {
        killedForBuffer = true;
        child.kill("SIGTERM");
      }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; guardBuffer(); });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; guardBuffer(); });

    child.on("error", (e: Error) => {
      reject(new Error(`${label}: failed to spawn — ${e.message}`));
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (killedForBuffer) {
        reject(new Error(
          `${label}: output exceeded MAX_SUBPROCESS_BUFFER_BYTES (${MAX_SUBPROCESS_BUFFER_BYTES}); the child was SIGTERM'd and its ${stdout.length + stderr.length} captured bytes are TRUNCATED, not a result.`,
        ));
        return;
      }
      if (code === null) {
        reject(new Error(
          `${label}: subprocess did not run to completion — exited on signal=${String(signal)} with no exit code. ⛔ Never reported as an exit code: \`code ?? 1\` would fabricate a code the child never returned.`,
        ));
        return;
      }
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

// ─── The seeded fixture: one doc of each mirrored type, exported once ────────

interface MirrorFixture {
  /** The `mkdtemp` root — both the corpus cwd (`.lore/lore.db`) and the mirror root (`docs/requirements/`). */
  readonly root: string;
  readonly dbPath: string;
  /** `<root>/mirror-fixture-driver.ts` — the generated `bun run` entry that reaches `main(argv, repoRoot, dbPath)`. */
  readonly driverPath: string;
  readonly specSlug: string;
  readonly planSlug: string;
}

/** Refuses any write target outside the OS temp dir — the mechanized replacement for the old "mutation escaped onto the REAL tree" probes. */
function assertInsideTmp(path: string): void {
  if (!path.startsWith(tmpdir() + sep)) {
    throw new Error(`refusing to touch ${path} — it is not under ${tmpdir()}; every mutation here must stay inside the fixture`);
  }
}

function loreIn(root: string, args: string[]): string {
  return execFileSync("bun", [LORE_ENTRY, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HOME: root, EDITOR: "true", CLAUDECODE: "1", CI: "true", LORE_AI_DEFAULT: "off" },
  });
}

function createDoc(root: string, args: string[]): string {
  const out = loreIn(root, ["create", ...args, "--no-ai", "--json"]);
  const parsed = JSON.parse(out) as { ok?: boolean; data?: { slug?: string } };
  if (parsed.ok !== true || parsed.data?.slug === undefined) {
    throw new Error(`fixture setup: lore create ${args.join(" ")} did not return a slug: ${out.slice(0, 300)}`);
  }
  return parsed.data.slug;
}

const SPEC_SKELETON = "## Overview/Goal\n\ng\n\n## Scope\n\ns\n\n## Acceptance Criteria\n\nSee ac add.\n";

let fixture: MirrorFixture | null = null;
const driverRuns: Promise<RunResult>[] = [];

/**
 * Lazily builds (and memoizes) the fixture: `lore init`, one doc of each of the six types, a
 * plan -> spec `relates-to` edge (so the plan mirror carries a `links:` entry AC-FR-10(c) can
 * corrupt), then ONE write-mode export into the fixture's own `docs/requirements/`, then a baseline
 * `--check` that must be clean so any later non-zero verdict is attributable to the mutation.
 *
 * The driver replicates `export-spec-mirror.ts`'s OWN `import.meta.main` error mapping, so a
 * `SpecMirrorError` surfaces as the documented hard-failure code rather than as bun's generic 1 —
 * otherwise "exits EXACTLY MIRROR_DRIFT_EXIT_CODE" could not distinguish drift from a crash.
 */
function mirrorFixture(): MirrorFixture {
  if (fixture !== null) return fixture;

  const root = mkdtempSync(join(tmpdir(), "lore-mirror-export-"));
  assertInsideTmp(root);
  loreIn(root, ["init", "--author", "mirror-export-test"]);
  createDoc(root, ["prd", "--title", "Fixture Prd", "--content", "p"]);
  const specSlug = createDoc(root, ["spec", "--title", "Fixture Spec", "--content", SPEC_SKELETON]);
  createDoc(root, ["adr", "--title", "Fixture Adr", "--decision-status", "accepted", "--content", "d"]);
  createDoc(root, ["knowledge", "--sub-type", "reference", "--title", "Fixture Kn", "--content", "k"]);
  const planSlug = createDoc(root, ["plan", "--title", "Fixture Plan", "--content", "pl"]);
  loreIn(root, ["link", planSlug, specSlug, "--json"]);
  createDoc(root, ["task", "--title", "Fixture Task", "--plan-id", planSlug, "--content", "t"]);

  const dbPath = join(root, ".lore", "lore.db");
  const driverPath = join(root, "mirror-fixture-driver.ts");
  writeFileSync(
    driverPath,
    `
import { main, SpecMirrorError } from ${JSON.stringify(MIRROR_SCRIPT_JS_SPECIFIER)};
import { MIRROR_HARD_FAILURE_EXIT_CODE } from ${JSON.stringify(MIRROR_CORE_JS_SPECIFIER)};

const [, , mode, dbPath, repoRoot] = process.argv;
try {
  process.exit(await main(mode === "check" ? ["--check"] : [], repoRoot, dbPath));
} catch (e) {
  if (e instanceof SpecMirrorError) {
    console.error(\`export-spec-mirror: \${e.message}\`);
    if (e.context) console.error(JSON.stringify(e.context));
    process.exit(MIRROR_HARD_FAILURE_EXIT_CODE);
  }
  console.error(\`export-spec-mirror: failed — \${e instanceof Error ? e.message : String(e)}\`);
  process.exit(MIRROR_HARD_FAILURE_EXIT_CODE);
}
`,
    "utf8",
  );

  // The ONE write-mode export: setup of a throwaway root, before any drift exists.
  execFileSync("bun", ["run", driverPath, "export", dbPath, root], { cwd: root, stdio: "pipe" });

  fixture = { root, dbPath, driverPath, specSlug, planSlug };
  return fixture;
}

afterAll(async () => {
  await Promise.allSettled(driverRuns);
  if (fixture === null) return;
  const { root } = fixture;
  fixture = null;
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // best-effort cleanup — a leftover temp dir must never fail the run
  }
});

interface CheckResult extends RunResult {
  /** stdout + stderr — `printParity` writes the OK/count lines to stdout and drift findings to stderr. */
  readonly output: string;
}

/**
 * Runs ONE read-only `--check` pass against the fixture (AC-OX-1: `--check`, always).
 * Each call is a full pass — count them against the declared budget of whatever case calls this.
 */
async function runFixtureCheck(): Promise<CheckResult> {
  const { root, dbPath, driverPath } = mirrorFixture();
  const run = spawnCaptureAsync("export-spec-mirror --check (fixture)", "bun", ["run", driverPath, "check", dbPath, root], root);
  driverRuns.push(run);
  const { stdout, stderr, exitCode } = await run;
  return { stdout, stderr, exitCode, output: `${stdout}\n${stderr}` };
}

let cachedFixtureBaseline: Promise<CheckResult> | null = null;

/**
 * The ONE shared `--check` baseline over the UNMUTATED fixture — memoized, so the two
 * `drift-check-is-separate` cases pay for it once between them rather than once each. A BEFORE
 * observation for a delta: a slug absent HERE and present AFTER a mutation was put there BY that
 * mutation. Memoizes the PROMISE so two cases awaiting it concurrently still spend ONE pass.
 */
function fixtureCheckBaseline(): Promise<CheckResult> {
  cachedFixtureBaseline ??= runFixtureCheck();
  return cachedFixtureBaseline;
}

/**
 * sha256-per-file manifest of every `.md` under one root's `docs/requirements/`, as a sorted
 * `relpath  hash` block. The instrument for "the check regenerated nothing".
 */
function hashManifest(root: string): string {
  const base = join(root, DOCS_REQUIREMENTS_RELATIVE);
  const lines: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        lines.push(`${relative(base, abs)}  ${createHash("sha256").update(readFileSync(abs)).digest("hex")}`);
      }
    }
  };
  walk(base);
  return lines.sort().join("\n");
}

/**
 * Projects a `--check` report onto the part determined SOLELY by the on-disk mirror tree: the
 * per-type `N file(s) on disk under <dir>` figures, in report order. What AC-FR-7 forbids is the
 * check WRITING (repairing what it inspects); a repair necessarily moves these on-disk counts, and
 * moves the {@link hashManifest} the HAPPY case samples three times.
 */
function onDiskFileCountProjection(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.match(/^export-spec-mirror \(check\): (\d+ file\(s\) on disk under \S+)/)?.[1])
    .filter((m): m is string => m !== undefined);
}

/** Full parity snapshot for the fixture: specs from its corpus, mappings + on-disk state from its mirror, re-derived on every call. */
function measureParityAt(root: string): {
  specs: { id: string; slug: string }[];
  mappings: Record<string, ExportIndexMapping>;
  fileCountOnDisk: number;
  fileExists: (relPath: string) => boolean;
} {
  const specs = runLoreList("spec", root);
  const mappings = loadMirrorMappings(root);
  const fileCountOnDisk = countMdFilesFlat(join(root, SPEC_MIRROR_DIR_RELATIVE));
  const fileExists = (relPath: string): boolean => existsSync(join(root, relPath));
  return { specs, mappings, fileCountOnDisk, fileExists };
}

// ─── AC-FR-10: all-types-parity-and-id-format ────────────────────────────────
//
// spec-falsifiability-reachability-a-feedable-checkpoint-an D6, AC-FR-10 (task-unify-mirror-
// identifiers-on-zero-padded-form-export-all, 2026-08-11) — widens AC-FR-6/AC-FR-7's spec-only
// scope to all six mirrored doc types, and adds two invariants AC-FR-6 never asserted:
// (b) every mirror file's frontmatter `id:` is byte-identical to its filename's leading
// identifier, zero-padded to 3 digits; (c) the migration-coverage eval over docs/requirements
// reports links_broken === 0. The PRODUCTION assertion of all three runs in
// `scripts/check-live-mirror-integrity.ts`; this describe proves the same functions HAPPY on a
// clean fixture and RED when each invariant is broken.

describe("all-types-parity-and-id-format: AC-FR-10 end-to-end against a seeded all-six-types corpus + mirror (production half: scripts/check-live-mirror-integrity.ts)", () => {
  it(
    "HAPPY (a+b): for every mirrored doc type, on-disk file count equals the corpus count, and every mirror file's frontmatter id: is byte-identical to its filename's zero-padded leading identifier",
    () => {
      const { root } = mirrorFixture();
      const parity = measureAllTypesParity(root, root);

      // Sanity floor FIRST: never a vacuous pass over zero files — one file per type was seeded.
      expect(parity.totalFilesChecked).toBe(MIRROR_TYPES.length);
      expect(parity.idViolations).toEqual([]);
      expect(parity.countMismatches).toEqual([]);
    },
    // Budget: ZERO `--check` passes (one pass costs 27.9s cold — see budgetMs). Cost here is
    // fixture construction (init + six creates + one export) plus six `lore list` reads.
    budgetMs(0, 120_000),
  );

  it(
    "HAPPY (c): the migration-coverage eval over the fixture's docs/requirements reports links_broken === 0",
    async () => {
      const { root } = mirrorFixture();
      const result = await measureLinksBrokenAt(root);

      expect(result.expected_files).toBeGreaterThan(0); // sanity floor: never a vacuous empty-dir pass
      expect(result.links_broken).toBe(0);
    },
    // Budget: ZERO `--check` passes. One in-process migration-coverage pass over six mirror files.
    budgetMs(0, 120_000),
  );

  it(
    "RED (a) — deleting one exported file of any type makes the per-type count parity check fail, naming that type and slug",
    () => {
      const { root } = mirrorFixture();
      const type: MirrorDocType = "plan";
      const mappings = loadMirrorMappings(root);
      const liveDocs = runLoreList(type, root);
      const target = liveDocs.find((d) => mappings[d.id] !== undefined);
      if (target === undefined) {
        throw new Error(`test setup: no live ${type} doc has an export-index mapping in the fixture index`);
      }
      const mapping = mappings[target.id] as ExportIndexMapping;
      const path = join(root, mapping.file_path);
      assertInsideTmp(path);
      const original = readFileSync(path, "utf8");

      // BEFORE — the delta's first endpoint: this slug is not yet named, and the type counts agree.
      const filenamesBefore = listMirrorFilenamesAt(root, type);
      const parityBefore = computeMirrorParity(liveDocs, mappings, (relPath) => existsSync(join(root, relPath)), filenamesBefore.length);
      expect(parityBefore.missing).not.toContainEqual({ slug: target.slug, reason: "file_absent" });
      expect(measureAllTypesParity(root, root).countMismatches).toEqual([]);

      unlinkSync(path);
      try {
        const filenamesAfter = listMirrorFilenamesAt(root, type);
        expect(filenamesAfter.length).toBe(filenamesBefore.length - 1);

        const parityAfter = computeMirrorParity(liveDocs, mappings, (relPath) => existsSync(join(root, relPath)), filenamesAfter.length);
        expect(parityAfter.ok).toBe(false);
        expect(parityAfter.missing).toContainEqual({ slug: target.slug, reason: "file_absent" });

        // DELTA: the target is named AFTER and was NOT named BEFORE — proof the mutation CAUSED it.
        const newlyMissing = parityAfter.missing.filter(
          (m) => !parityBefore.missing.some((b) => b.slug === m.slug && b.reason === m.reason),
        );
        expect(newlyMissing).toEqual([{ slug: target.slug, reason: "file_absent" }]);

        // AND the all-types measurement the production script runs reports the TYPE.
        const mismatches = measureAllTypesParity(root, root).countMismatches;
        expect(mismatches).toEqual([`${type}: 0 mirror file(s) on disk vs 1 live corpus doc(s)`]);
      } finally {
        writeFileSync(path, original, "utf8");
        expect(readFileSync(path, "utf8")).toBe(original);
      }
    },
    // Budget: ZERO `--check` passes. Seven `lore list` reads plus fixture construction on first use.
    budgetMs(0, 120_000),
  );

  it(
    "RED (b) — rewriting one mirror file's frontmatter id: to the non-padded form fails, naming that exact file",
    () => {
      const { root } = mirrorFixture();
      const type: MirrorDocType = "adr";
      const target = listMirrorFilenamesAt(root, type).find((f) => extractFilenameLeadingId(f) !== null);
      if (target === undefined) {
        throw new Error(`test setup: no ${type} mirror file has a parseable leading identifier`);
      }
      const filenameId = extractFilenameLeadingId(target) as string;
      const numMatch = filenameId.match(/^([A-Za-z]+)-0*(\d+)$/);
      if (numMatch === null) {
        throw new Error(`test setup: ${filenameId} does not parse as {PREFIX}-{digits}`);
      }
      const nonPaddedId = `${numMatch[1] as string}-${Number.parseInt(numMatch[2] as string, 10)}`;

      const path = join(root, mirrorDirRelative(type), target);
      assertInsideTmp(path);
      const original = readFileSync(path, "utf8");

      // BEFORE — the delta's first endpoint: the id MATCHES, IS padded, and no violation is reported.
      expect(extractIdFromFileContent(original)).toBe(filenameId);
      expect(isThreeDigitPadded(filenameId)).toBe(true);
      expect(measureAllTypesParity(root, root).idViolations).toEqual([]);

      const mutated = original.replace(/^id: .+$/m, `id: ${nonPaddedId}`);
      expect(mutated).not.toBe(original); // sanity: the replace actually matched something

      writeFileSync(path, mutated, "utf8");
      try {
        const frontmatterId = extractIdFromFileContent(readFileSync(path, "utf8"));
        expect(frontmatterId).toBe(nonPaddedId);
        expect(frontmatterId).not.toBe(filenameId);
        expect(isThreeDigitPadded(frontmatterId as string)).toBe(false);

        // The RED the production script reports: this exact file, both ways it is wrong.
        const violations = measureAllTypesParity(root, root).idViolations;
        expect(violations).toContain(`${type}/${target}: frontmatter id: (${nonPaddedId}) != filename leading id (${filenameId})`);
        expect(violations).toContain(`${type}/${target}: id "${nonPaddedId}" is not zero-padded to 3 digits`);
      } finally {
        writeFileSync(path, original, "utf8");
        expect(readFileSync(path, "utf8")).toBe(original);
      }
    },
    // Budget: ZERO `--check` passes. Six `lore list` reads per measurement, two measurements.
    budgetMs(0, 120_000),
  );

  it(
    "RED (c) — pointing one cross-type reference at a non-existent id makes migration-coverage's links_broken non-zero",
    async () => {
      const { root } = mirrorFixture();
      const target = listMirrorFilenamesAt(root, "plan").find((f) => {
        const content = readFileSync(join(root, mirrorDirRelative("plan"), f), "utf8");
        return /^links:\n(  - .*\n)+/m.test(content);
      });
      if (target === undefined) {
        throw new Error("test setup: no plan mirror file has a links: array to corrupt");
      }
      const path = join(root, mirrorDirRelative("plan"), target);
      assertInsideTmp(path);
      const original = readFileSync(path, "utf8");

      // BEFORE — the delta's first endpoint (clean on a fixture, but asserted as a baseline for the delta).
      const before = await measureLinksBrokenAt(root);
      expect(before.expected_files).toBeGreaterThan(0); // sanity floor: never a vacuous empty-dir delta
      expect(before.links_broken).toBe(0);

      const mutated = original.replace(/(links:\n  - \{id: )([^,]+)(, )/, `$1SPEC-999999$3`);
      expect(mutated).not.toBe(original); // sanity: the replace actually matched something

      writeFileSync(path, mutated, "utf8");
      try {
        const after = await measureLinksBrokenAt(root);

        // DELTA: strictly more broken links than before, and the eval now fails.
        expect(after.links_broken).toBeGreaterThan(before.links_broken);
        expect(after.passed).toBe(false);
      } finally {
        writeFileSync(path, original, "utf8");
        expect(readFileSync(path, "utf8")).toBe(original);
      }
    },
    // Budget: ZERO `--check` passes. TWO in-process migration-coverage passes over six files.
    budgetMs(0, 180_000),
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

/** Reads a `package.json`'s `scripts` map fresh from disk — never a cached/hardcoded copy. */
function readPackageScripts(root: string): Record<string, string> {
  const raw = readFileSync(join(root, "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
  if (!parsed.scripts) throw new Error(`${join(root, "package.json")} has no "scripts" section`);
  return parsed.scripts;
}

describe("export-covers-corpus: AC-FR-6 end-to-end against a seeded corpus + mirror (production half: scripts/check-live-mirror-integrity.ts)", () => {
  it("export-covers-corpus: HAPPY and RED (a) — a package.json whose test chain reaches export-spec-mirror.ts (via check:spec-mirror) is WIRED, and removing it from the chain makes the check fail", () => {
    // AC-FR-6 names the SCRIPT ("export-spec-mirror.ts"), never a specific mode-flag string —
    // `check:spec-mirror` invokes this exact file (with --check), so the criterion holds while the
    // chain-wired command itself stays read-only. The REAL repo package.json is checked by
    // `scripts/check-live-mirror-integrity.ts`; here the SAME predicate runs on a fixture file read
    // back from disk, in both directions.
    const { root } = mirrorFixture();
    const wired = {
      scripts: {
        test: "bun run check:spec-mirror && bunx vitest run",
        "check:spec-mirror": "bun scripts/export-spec-mirror.ts --check",
      },
    };
    writeFileSync(join(root, "package.json"), JSON.stringify(wired));
    expect(scriptChainReachesTarget(readPackageScripts(root), "test", "export-spec-mirror.ts")).toBe(true);

    // RED (a): the script still EXISTS as an entry, but the test chain no longer references it.
    const unwired = { scripts: { test: "bunx vitest run", "check:spec-mirror": wired.scripts["check:spec-mirror"] } };
    writeFileSync(join(root, "package.json"), JSON.stringify(unwired));
    expect(scriptChainReachesTarget(readPackageScripts(root), "test", "export-spec-mirror.ts")).toBe(false);
  });

  it(
    "export-covers-corpus: HAPPY — the read-only checker (AC-OX-1: never the write-mode exporter) exits 0 and reports on-disk file count EQUALS the corpus spec count, with every corpus spec slug present as a file",
    async () => {
      const checkResult = await runFixtureCheck();

      // On a fixture nothing else writes, so the exact code is knowable: 0. (The PRODUCTION run
      // cannot pin it — see `scripts/check-live-mirror-integrity.ts` — and accepts 0 or the
      // documented drift code.)
      expect(checkResult.exitCode, checkResult.output).toBe(0);
      expect(checkResult.stdout).toContain(mirrorParityOkMessage("spec"));

      // Independent, fresh re-derivation — never trusts the script's own self-report.
      const { root } = mirrorFixture();
      const { specs, mappings, fileCountOnDisk, fileExists } = measureParityAt(root);
      expect(specs.length).toBeGreaterThan(0); // sanity floor: never a vacuous empty-corpus pass

      const parity = computeMirrorParity(specs, mappings, fileExists, fileCountOnDisk);
      expect(parity.missing).toEqual([]);
      expect(parity.fileCountOnDisk).toBe(parity.corpusSpecCount);
      expect(parity.ok).toBe(true);
    },
    // Budget: ONE `--check` pass (27.9s cold) + one `lore list --type spec` read.
    budgetMs(1, 90_000),
  );

  it(
    "export-covers-corpus: NEGATIVE (RED b) — deleting one exported file makes the parity check fail, NAMING that exact slug",
    () => {
      const { root } = mirrorFixture();

      const before = measureParityAt(root);
      const target = before.specs.find((s) => before.mappings[s.id] !== undefined);
      if (target === undefined) {
        throw new Error("test setup: no corpus spec has an export-index mapping in the fixture index — cannot induce RED b");
      }
      const mapping = before.mappings[target.id]!;
      const path = join(root, mapping.file_path);
      assertInsideTmp(path);
      const original = readFileSync(path, "utf8");

      // BEFORE endpoint — the target is NOT reported missing yet.
      const parityBefore = computeMirrorParity(before.specs, before.mappings, before.fileExists, before.fileCountOnDisk);
      expect(parityBefore.missing).not.toContainEqual({ slug: target.slug, reason: "file_absent" });

      unlinkSync(path);
      try {
        // Re-measure fresh (never reuse the pre-deletion snapshot).
        const after = measureParityAt(root);
        const parityAfter = computeMirrorParity(after.specs, after.mappings, after.fileExists, after.fileCountOnDisk);

        expect(parityAfter.ok).toBe(false);
        expect(parityAfter.missing).toContainEqual({ slug: target.slug, reason: "file_absent" });

        // DELTA: named AFTER, not named BEFORE.
        const newlyMissing = parityAfter.missing.filter(
          (m) => !parityBefore.missing.some((b) => b.slug === m.slug && b.reason === m.reason),
        );
        expect(newlyMissing).toEqual([{ slug: target.slug, reason: "file_absent" }]);
      } finally {
        writeFileSync(path, original, "utf8");
        expect(readFileSync(path, "utf8")).toBe(original);
      }
    },
    // Budget: ZERO `--check` passes. Two `lore list --type spec` reads (the delta's endpoints).
    budgetMs(0, 120_000),
  );
});

// ─── drift-check-is-separate: AC-FR-7 end-to-end ─────────────────────────────

describe("drift-check-is-separate: AC-FR-7 end-to-end against the REAL script + a seeded corpus + mirror", () => {
  it(
    "drift-check-is-separate: HAPPY — running --check twice in a row over unchanged state reports the IDENTICAL verdict both times and regenerates nothing",
    async () => {
      // ⛔ AC-FR-7's own words are "run twice in a row it reports the same drift both times" —
      // IDENTITY, not "reports OK".
      const { root } = mirrorFixture();

      const manifestBefore = hashManifest(root);
      const first = await fixtureCheckBaseline();
      const manifestBetween = hashManifest(root);
      const second = await runFixtureCheck();
      const manifestAfter = hashManifest(root);

      // THE no-repair proof: a byte-level measurement of the very tree the check inspected,
      // sampled before, between, and after the two runs. A check that regenerated ANY mirror file
      // fails here.
      expect(manifestBetween).toBe(manifestBefore);
      expect(manifestAfter).toBe(manifestBefore);

      // "Reports the same drift both times", on the projection the frozen tree alone determines.
      const firstCounts = onDiskFileCountProjection(first.output);
      expect(onDiskFileCountProjection(second.output)).toEqual(firstCounts);

      // Sanity floor: never a vacuous pass — one count line per mirrored type, which is also proof
      // the regex still matches the report's real shape.
      expect(firstCounts).toHaveLength(MIRROR_TYPES.length);
      expect(first.output).toContain("export-spec-mirror (check):");

      // Both runs produced a verdict the script DOCUMENTS; on an unmodified fixture that is 0.
      expect(first.exitCode, first.output).toBe(0);
      expect(second.exitCode, second.output).toBe(0);
    },
    // Budget: TWO `--check` passes — the memoized shared baseline plus one more consecutive run.
    budgetMs(2, 120_000),
  );

  it(
    "drift-check-is-separate: NEGATIVE — with one mirror file deleted, --check exits EXACTLY MIRROR_DRIFT_EXIT_CODE and names the missing slug on BOTH consecutive runs, never regenerating the file",
    async () => {
      const { root } = mirrorFixture();

      const before = measureParityAt(root);
      const target = before.specs.find((s) => before.mappings[s.id] !== undefined);
      if (target === undefined) {
        throw new Error("test setup: no corpus spec has an export-index mapping in the fixture index — cannot induce this scenario");
      }
      const mapping = before.mappings[target.id]!;
      const path = join(root, mapping.file_path);
      assertInsideTmp(path);
      const original = readFileSync(path, "utf8");

      // BEFORE endpoint — the shared memoized baseline: clean, and it does not name the target.
      const baseline = await fixtureCheckBaseline();
      expect(baseline.exitCode, baseline.output).toBe(0);
      expect(baseline.output).not.toContain(target.slug);

      unlinkSync(path);
      try {
        const firstCheck = await runFixtureCheck();
        expect(firstCheck.exitCode).toBe(MIRROR_DRIFT_EXIT_CODE);
        expect(firstCheck.output).toContain(target.slug);

        // The check must NEVER regenerate what it inspects — the file must still be absent, and a
        // SECOND consecutive run must report the IDENTICAL drift, not a self-healed clean.
        expect(existsSync(path)).toBe(false);

        const secondCheck = await runFixtureCheck();
        expect(secondCheck.exitCode).toBe(MIRROR_DRIFT_EXIT_CODE);
        expect(secondCheck.output).toContain(target.slug);
        expect(existsSync(path)).toBe(false);

        // "reports the same drift both times": the on-disk counts are what a repair would move.
        expect(onDiskFileCountProjection(secondCheck.output)).toEqual(onDiskFileCountProjection(firstCheck.output));

        // DELTA — the assertion that actually discriminates: the slug appears only AFTER the
        // deletion. A check that repaired the file, or one that was already reporting this slug,
        // fails here.
        expect(baseline.output).not.toContain(target.slug);
        expect(firstCheck.output).toContain(`${target.slug} — ${MIRROR_MAPPED_FILE_MISSING_DETAIL}`);
      } finally {
        writeFileSync(path, original, "utf8");
        expect(readFileSync(path, "utf8")).toBe(original);
      }
    },
    // Budget: THREE `--check` passes worst case — the shared baseline (free when the HAPPY case
    // above already ran it) plus the two post-mutation runs AC-FR-7 requires.
    budgetMs(3, 90_000),
  );
});
