// @spawns packages/lore/src/index.ts
// @spawns scripts/check-claude-md-live-sweep.ts
/**
 * RED-phase TDD tests for AC-EMPH-1 and AC-EMPH-2 of
 * `spec-claude-md-governance-content-dimension-checks-wire-the` (Phase 2 —
 * the emphasis-saturation metric; the paired implementation task is a
 * sibling in the same plan/phase, not yet landed as of this file's
 * authoring).
 *
 * ⛔ Both ACs are bound by the spec's own coverage contract: "Every WIRING AC
 * drives the CLI subprocess, never the unit function directly." Every
 * scenario below drives `lore status --check-claude-md --json` against a
 * `mkdtemp` fixture (the live repo sweep runs from scripts/check-claude-md-live-sweep.ts) and reads
 * the JSON payload — this file never imports or calls a `measureEmphasis`-
 * shaped check function.
 *
 * RED baseline, confirmed empirically against this worktree before writing
 * this file (a throwaway probe script, deleted immediately after running):
 *   `resolveMemoryFileBudgets(undefined)` (packages/core/src/config.ts)
 *   returns `{ enabled, filenames, root, module, warn_threshold_fraction,
 *   evict_threshold_fraction }` — NO `emphasis` key at all. Reading
 *   `.emphasis.max_per_kb` off that value throws
 *   `TypeError: undefined is not an object (evaluating
 *   'budgets.emphasis.max_per_kb')` at runtime (vitest transpiles via esbuild
 *   with no type-checking pass, so this is a REAL runtime failure, not a
 *   caught-at-compile-time one). `resolveShippedMaxPerKb` below turns that
 *   opaque TypeError into a legible, purpose-built error naming exactly what
 *   is missing, so every test in this file fails on ONE unambiguous cause —
 *   the emphasis metric has not shipped — rather than an incidental crash.
 *   Separately confirmed: `lore status --check-claude-md --json` against a
 *   heavily ⛔/MUST/NEVER-laden fixture today reports `findings: []` — the
 *   kind `emphasis_saturated` does not exist anywhere in this codebase yet.
 *
 * ## Why the default is READ from resolved config, never hardcoded (N6)
 *
 * AC-EMPH-1 requires both fixtures ("at the default" and "twice the
 * default") to be built FROM the resolved `memory_files.emphasis.max_per_kb`
 * config value, never from a restated literal (anti-dual-write — the same
 * discipline `contextConfigSchema`'s own JSDoc already applies to the
 * line/byte ceilings). Unlike AC-WIRE-2's `ISO_DATE_DENSITY_THRESHOLD`
 * (discovered via CLI binary search because the declaring MODULE did not
 * exist yet at authoring time), `resolveMemoryFileBudgets` already exists
 * today in `@lore/core` — only its return value lacks an `.emphasis` field.
 * Importing the (already-stable) resolver function to read a config DEFAULT
 * is not "driving the unit function to decide a verdict" (the restriction
 * AC-EMPH-1/2 bind to `runMemoryFileChecks`/`measureEmphasis`-shaped check
 * functions) — it is exactly what the AC's own text instructs.
 *
 * `findFixtureScale` picks the smallest whole-KiB fixture size at which
 * `max_per_kb * kb` lands within 1e-6 of an integer marker count, so a
 * fixture built at that size can hit density === max_per_kb EXACTLY despite
 * marker counts being whole numbers — then the "twice the default" fixture
 * simply doubles the marker count at the SAME kb, which preserves the ratio
 * exactly (no re-derivation of the scale, no accumulated rounding error).
 *
 * Coverage dimensions: HAPPY (2x density fires, exactly one finding) /
 * NEGATIVE (at-default density stays silent) / BOUNDARY (default vs.
 * default+1-marker vs. 2x-default) / ERROR (empty CLAUDE.md never crashes) /
 * STATE (an unrelated real ceiling breach in a SIBLING module file and
 * over-threshold emphasis in the root file are both reported by the same
 * run) / REGRESSION (N5: the finding carries no warn/evict fraction field —
 * density is not a capacity metric, so it must never smuggle in the
 * three-band ceiling machinery's vocabulary).
 *
 * @spec_ref spec-claude-md-governance-content-dimension-checks-wire-the
 * @ac_ref AC-EMPH-1
 * @ac_ref AC-EMPH-2
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { resolveMemoryFileBudgets } from "@lore/core";

// ─── Path setup (mirrors tests/integration/claude-md-wiring.test.ts and
// tests/integration/anchor-coverage-surface.test.ts) ────────────────────────

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
/** Repo root: four levels up from `packages/lore/tests/integration/`. */
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");

// ─── CLI subprocess harness ─────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawn `bun run <INDEX_TS> ...args` in `cwd`.
 *
 * `HOME` is always redirected into `cwd` — every fixture is its own throwaway corpus and must never
 * see a developer's real global lore state (the live-repo sweep moved to scripts/check-claude-md-live-sweep.ts).
 */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: cwd,
      EDITOR: "true",
      CLAUDECODE: "1",
    },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

function makeTempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `lore-claude-md-emphasis-${label}-`));
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

// ─── --json payload shape (deliberately partial — a CLI-output assertion
// helper, never a mirror of MemoryFileFinding, which stays service-owned) ───

interface ClaudeMdFindingJson {
  kind: string;
  [key: string]: unknown;
}

interface CheckClaudeMdJson {
  data?: {
    claude_md?: {
      findings?: ClaudeMdFindingJson[];
      advisory?: ClaudeMdFindingJson[];
      headroom?: unknown[];
    };
  };
}

function runCheckClaudeMdJson(
  cwd: string,
): { result: RunResult; parsed: CheckClaudeMdJson } {
  const result = runLore(["status", "--check-claude-md", "--json"], cwd);
  let parsed: CheckClaudeMdJson;
  try {
    parsed = JSON.parse(result.stdout) as CheckClaudeMdJson;
  } catch (error) {
    throw new Error(
      `--check-claude-md --json produced non-JSON stdout (exit ${result.exitCode}): ${error instanceof Error ? error.message : String(error)}\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  return { result, parsed };
}

function findingsByKind(parsed: CheckClaudeMdJson, kind: string): ClaudeMdFindingJson[] {
  return (parsed.data?.claude_md?.findings ?? []).filter((f) => f.kind === kind);
}

function findingKindsAll(parsed: CheckClaudeMdJson): string[] {
  return (parsed.data?.claude_md?.findings ?? []).map((f) => f.kind);
}

/** A CLAUDE.md body of exactly `lineCount` non-empty, non-marker lines (root ceiling is 300 lines, D3). */
function nLineBody(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= lineCount; i++) {
    lines.push(`Line ${i}: standing discipline entry, not a status narrative.`);
  }
  return lines.join("\n") + "\n";
}

// ─── Reading the shipped default (N6) — never hardcoded (see module header) ─

/**
 * Reads `memory_files.emphasis.max_per_kb` off the SCHEMA DEFAULT (no config
 * file involved — `resolveMemoryFileBudgets(undefined)` resolves to
 * `contextConfigSchema.parse({}).memory_files`, i.e. exactly the "shipped
 * default" AC-EMPH-1/2 refer to). Throws a purpose-built, legible error
 * (rather than letting an opaque `TypeError` propagate) naming EXACTLY what
 * is missing when the field does not exist yet — see this file's module
 * header for the empirically-confirmed RED baseline.
 */
function resolveShippedMaxPerKb(): number {
  const budgets = resolveMemoryFileBudgets(undefined) as unknown as {
    emphasis?: { max_per_kb?: unknown };
  };
  const maxPerKb = budgets.emphasis?.max_per_kb;
  if (typeof maxPerKb !== "number" || !Number.isFinite(maxPerKb) || maxPerKb <= 0) {
    throw new Error(
      `resolveMemoryFileBudgets(undefined).emphasis.max_per_kb is not a positive finite number ` +
        `(got ${JSON.stringify(maxPerKb)}). The emphasis-saturation metric (N5/N6, ` +
        `spec-claude-md-governance-content-dimension-checks-wire-the) has not shipped a ` +
        `memory_files.emphasis.max_per_kb config default yet — this is the expected RED baseline ` +
        `for AC-EMPH-1/AC-EMPH-2 before the Phase 2 implementation lands.`,
    );
  }
  return maxPerKb;
}

/** Upper bound (KiB) searched by {@link findFixtureScale} — stays comfortably under the root byte ceiling (D3: 30720 bytes = 30 KiB), even after a 2x marker-count doubling at the same kb. */
const MAX_SCALE_KB = 20;
const SCALE_EPSILON = 1e-6;

/**
 * Finds the smallest whole-KiB fixture size (1..{@link MAX_SCALE_KB}) at
 * which `maxPerKb * kb` lands within {@link SCALE_EPSILON} of an integer
 * marker count — so a fixture built at that size can hit
 * `density === maxPerKb` EXACTLY despite marker counts being whole numbers.
 * Doubling the returned `markerCount` at the SAME `kb` then hits exactly
 * `2 * maxPerKb` (proportional scaling preserves the ratio exactly; no
 * re-derivation, no accumulated rounding).
 */
function findFixtureScale(maxPerKb: number): { markerCount: number; kb: number } {
  for (let kb = 1; kb <= MAX_SCALE_KB; kb++) {
    const n = maxPerKb * kb;
    if (Math.abs(n - Math.round(n)) < SCALE_EPSILON) {
      return { markerCount: Math.round(n), kb };
    }
  }
  throw new Error(
    `findFixtureScale: no integer marker count for max_per_kb=${maxPerKb} within 1..${MAX_SCALE_KB} KiB — ` +
      `this fixture builder assumes the shipped default has a small number of decimal digits (N6: a legible, ` +
      `deliberately-chosen number, not an arbitrary float).`,
  );
}

/**
 * The five required root H2 sections (marker-free), prefixed to every root
 * fixture so a fixture pinning `adoption: enforce` is refused ONLY for
 * emphasis, never for `section_missing`
 * (spec-claude-md-root-section-structure-check-and-adoption-mode). Counted
 * INSIDE the exact-KiB budget below, so the density arithmetic is unchanged.
 */
const SECTIONS_PREFIX =
  ["What This Is", "Commands", "Architecture", "Module Index", "Finding Live Project State"]
    .map((name) => `## ${name}\n\nbody of ${name}\n`)
    .join("\n") + "\n";

/** Pins `adoption: enforce` in a config-only `.lore/` — absent key resolves to warn, which would make every exit-3 assertion here unreachable. */
function pinEnforce(dir: string): void {
  mkdirSync(join(dir, ".lore"), { recursive: true });
  writeFileSync(join(dir, ".lore", "config.yaml"), "context:\n  memory_files:\n    adoption: enforce\n");
}

/** One of the four AC-EMPH emphasis markers (⛔ / IMPORTANT / MUST / NEVER) — chosen because a bare emoji needs no word-boundary reasoning, unlike the three ASCII words. */
const MARKER = "⛔";

/**
 * Builds a CLAUDE.md body of EXACTLY `kb` KiB containing EXACTLY
 * `markerCount` occurrences of {@link MARKER}, plus inert ASCII filler ('x',
 * one byte each in UTF-8) that contains none of the four marker tokens as a
 * substring. One line total (`markerBlock`, no newlines) — well under both
 * the root (300) and module (200) line ceilings regardless of `kb`.
 */
function buildEmphasisContent(markerCount: number, kb: number): string {
  const totalBytes = kb * 1024;
  const structureBytes = Buffer.byteLength(SECTIONS_PREFIX, "utf8");
  const markerBlock = Array.from({ length: markerCount }, () => `${MARKER} `).join("");
  const markerBytes = Buffer.byteLength(markerBlock, "utf8");
  if (markerBytes + structureBytes >= totalBytes) {
    throw new Error(
      `buildEmphasisContent: marker block (${markerBytes}B, ${markerCount} markers) does not fit within the ` +
        `target ${totalBytes}B (${kb} KiB) — increase kb or reduce markerCount.`,
    );
  }
  const filler = "x".repeat(totalBytes - markerBytes - structureBytes);
  const content = SECTIONS_PREFIX + filler + markerBlock;
  const actualBytes = Buffer.byteLength(content, "utf8");
  if (actualBytes !== totalBytes) {
    throw new Error(`buildEmphasisContent: expected exactly ${totalBytes}B, constructed ${actualBytes}B.`);
  }
  return content;
}

// ─── Shared scale, resolved once (N6: read from config, never hardcoded) ───

let maxPerKb: number;
let scale: { markerCount: number; kb: number };

beforeAll(() => {
  maxPerKb = resolveShippedMaxPerKb();
  scale = findFixtureScale(maxPerKb);
});

// ─── AC-EMPH-1: over-threshold density is refused, at-default stays silent ─

describe("emphasis saturation — over-threshold density is refused", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("threshold");
  });
  afterEach(() => cleanupDir(tmpDir));

  it("HAPPY: a fixture at TWICE the resolved max_per_kb yields exactly one emphasis_saturated, exit code exactly 3", () => {
    pinEnforce(tmpDir);
    writeFileSync(join(tmpDir, "CLAUDE.md"), buildEmphasisContent(scale.markerCount * 2, scale.kb));

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(result.exitCode).toBe(3);
    expect(findingsByKind(parsed, "emphasis_saturated").length).toBe(1);
  });

  it("NEGATIVE (BOUNDARY: exactly at default): a fixture at EXACTLY the resolved max_per_kb yields none, exit code exactly 0", () => {
    pinEnforce(tmpDir);
    writeFileSync(join(tmpDir, "CLAUDE.md"), buildEmphasisContent(scale.markerCount, scale.kb));

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(result.exitCode).toBe(0);
    expect(findingsByKind(parsed, "emphasis_saturated")).toEqual([]);
  });

  it("BOUNDARY: one marker more than exactly the default already fires (a saturation ceiling, not merely 'way above')", () => {
    pinEnforce(tmpDir);
    writeFileSync(join(tmpDir, "CLAUDE.md"), buildEmphasisContent(scale.markerCount + 1, scale.kb));

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(result.exitCode).toBe(3);
    expect(findingsByKind(parsed, "emphasis_saturated").length).toBe(1);
  });

  it("REGRESSION (N5): the emphasis_saturated finding carries no warn/evict fraction field — density is not a capacity metric", () => {
    pinEnforce(tmpDir);
    writeFileSync(join(tmpDir, "CLAUDE.md"), buildEmphasisContent(scale.markerCount * 2, scale.kb));

    const { parsed } = runCheckClaudeMdJson(tmpDir);
    const saturated = findingsByKind(parsed, "emphasis_saturated");
    expect(saturated.length).toBe(1);

    const keys = Object.keys(saturated[0] as ClaudeMdFindingJson);
    expect(keys.some((k) => /fraction/i.test(k))).toBe(false);
    expect(keys).not.toContain("warn");
    expect(keys).not.toContain("evict");
  });

  it("ERROR (no crash): an empty CLAUDE.md produces zero emphasis_saturated findings, exit code exactly 0", () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), "");

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(result.exitCode).toBe(0);
    expect(findingsByKind(parsed, "emphasis_saturated")).toEqual([]);
  });

  it("STATE: a real ceiling breach in a SIBLING module file and over-threshold emphasis in the root file are BOTH reported by the same run", () => {
    pinEnforce(tmpDir);
    writeFileSync(join(tmpDir, "CLAUDE.md"), buildEmphasisContent(scale.markerCount * 2, scale.kb));
    mkdirSync(join(tmpDir, "nested-module"), { recursive: true });
    // module max_lines ceiling is 200 (D3) — 250 lines is a genuine, unrelated breach.
    writeFileSync(join(tmpDir, "nested-module", "CLAUDE.md"), nLineBody(250));

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(result.exitCode).toBe(3);
    const kinds = new Set(findingKindsAll(parsed));
    expect(kinds.has("max_lines")).toBe(true);
    expect(kinds.has("emphasis_saturated")).toBe(true);
  });
});

// ─── AC-EMPH-2: positive control + repo sweep at the shipped default ───────

describe("emphasis saturation — positive control plus repo sweep at shipped default", () => {
  // ⛔ The LIVE sweep (this repo's own memory files at the shipped default) is NOT here: it reads the
  // repo's `.lore/` and memory-file tree, so it lives in `scripts/check-claude-md-live-sweep.ts`
  // (wired into `bun run test` as `check:live-repo-state`). What stays here is the positive control
  // plus the sweep script's own logic, driven against mkdtemp fixtures (task-skill-test-tg-2).
  const SWEEP_SCRIPT = join(REPO_ROOT, "scripts", "check-claude-md-live-sweep.ts");

  /** Runs the sweep script with `--root <fixture>` and `HOME` redirected into it. */
  function runSweep(root: string): RunResult {
    const result = spawnSync("bun", [SWEEP_SCRIPT, "--root", root], {
      cwd: tmpdir(),
      env: { ...process.env, HOME: root, EDITOR: "true", CLAUDECODE: "1" },
      encoding: "utf8",
    });
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
  }

  /** A fixture corpus (`lore init`) — `--check-memory-pointers` needs a corpus; adoption stays at its default. */
  function initFixture(label: string): string {
    const dir = makeTempDir(label);
    const init = runLore(["init"], dir);
    if (init.exitCode !== 0) throw new Error(`lore init failed in ${dir}: ${init.stderr}`);
    return dir;
  }

  it("positive control fires exactly one emphasis_saturated at 2x the shipped default", () => {
    // Mandatory alongside any sweep: a skipped check and a passing check both produce zero
    // findings, so "zero" must be paired with proof the metric CAN fire at all.
    const controlDir = makeTempDir("repo-sweep-control");
    try {
      pinEnforce(controlDir);
      writeFileSync(join(controlDir, "CLAUDE.md"), buildEmphasisContent(scale.markerCount * 2, scale.kb));
      const control = runCheckClaudeMdJson(controlDir);
      expect(control.result.exitCode).toBe(3);
      expect(findingsByKind(control.parsed, "emphasis_saturated").length).toBe(1);
    } finally {
      cleanupDir(controlDir);
    }
  });

  it("the sweep script exits 1 naming emphasis_saturated on a fixture at 2x the default (sweep can FAIL)", () => {
    const dir = initFixture("sweep-saturated");
    try {
      writeFileSync(join(dir, "CLAUDE.md"), buildEmphasisContent(scale.markerCount * 2, scale.kb));
      const run = runSweep(dir);
      expect(run.exitCode).toBe(1);
      // default adoption is warn, so the finding surfaces as an advisory downgrade — the script reads both places
      expect(run.stderr).toContain("emphasis_saturated");
    } finally {
      cleanupDir(dir);
    }
  });

  it("the sweep script exits 0 on a fixture at EXACTLY the default, having walked >= 1 memory file", () => {
    const dir = initFixture("sweep-clean");
    try {
      writeFileSync(join(dir, "CLAUDE.md"), buildEmphasisContent(scale.markerCount, scale.kb));
      const run = runSweep(dir);
      expect(run.exitCode, run.stderr).toBe(0);
      expect(run.stdout).toMatch(/\b[1-9]\d* memory file\(s\) walked/);
    } finally {
      cleanupDir(dir);
    }
  });

  it("NON-VACUITY: the sweep script exits 1 naming a vacuous sweep when the root holds no memory file", () => {
    const dir = initFixture("sweep-vacuous");
    try {
      const run = runSweep(dir);
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain("vacuous sweep");
    } finally {
      cleanupDir(dir);
    }
  });

  it("ERROR: a --root that is not a directory makes the sweep script exit 2, never 0", () => {
    const run = runSweep(join(tmpdir(), "lore-claude-md-emphasis-no-such-dir-xyz"));
    expect(run.exitCode).toBe(2);
  });
});
