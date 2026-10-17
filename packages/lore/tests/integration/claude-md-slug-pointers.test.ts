// @spawns packages/lore/src/index.ts
// @spawns scripts/check-claude-md-live-sweep.ts
/**
 * RED-phase TDD tests for AC-SLUG-1 and AC-SLUG-2 of
 * `spec-claude-md-governance-content-dimension-checks-wire-the` (Phase 2 —
 * the corpus-slug-pointer metric; the paired implementation task is a
 * sibling in the same plan/phase, not yet landed as of this file's
 * authoring).
 *
 * ⛔ Both ACs are bound by the spec's own coverage contract: "Every WIRING AC
 * drives the CLI subprocess, never the unit function directly." Every
 * scenario below spawns the real CLI against a `mkdtemp` + `lore init`
 * throwaway corpus — this file never imports or calls a
 * `checkSlugPointers`-shaped function directly. The sweep over this repo's own
 * real corpus runs from `scripts/check-claude-md-live-sweep.ts`, not from here.
 *
 * RED baseline, confirmed empirically against this worktree before writing
 * this file:
 *   `lore status --check-memory-pointers --json` (run from a fresh mkdtemp
 *   corpus) → citty's strict-flag seam (SPEC-051/073) rejects the flag
 *   BEFORE `status.ts`'s run handler is ever reached:
 *     stderr: "Error: Unknown option: --check-memory-pointers"
 *     exit code: 2
 *   `--check-memory-pointers` does not exist ANYWHERE in
 *   `packages/lore/src/adapters/cli/commands/status.ts` as of this file's
 *   authoring, and `checkSlugPointers` does not exist anywhere in
 *   `packages/lore/src/service/claude-md-admission.ts` either. Separately
 *   confirmed: `lore status --check-claude-md --json` against the SAME
 *   dangling-slug fixture reports `advisory: []` — the pre-existing
 *   `checkReferenceExistence` grammar requires a `/` in the candidate token
 *   (spec §D6), so a bare corpus slug (no `/`) is invisible to it, which is
 *   exactly the structural blindness AC-SLUG-1 exists to close. This is the
 *   uniform RED discriminator every scenario below currently fails on (exit
 *   2, never the AC-required 0/3) — every assertion below targets the
 *   SPEC-required FUTURE behavior, not today's baseline.
 *
 * ⛔ N14: this metric REQUIRES the corpus (a slug either exists in it or it
 * doesn't), so it deliberately does NOT live on `--check-claude-md`, which is
 * corpus-free by SPEC-095 D9 and dispatches before `loadLoreApp`. Every
 * scenario below therefore targets the NEW `--check-memory-pointers` flag —
 * except the dedicated N14-boundary test, which drives `--check-claude-md`
 * on purpose to pin that it structurally CANNOT resolve slugs.
 *
 * ⛔ SAFETY: every mkdtemp fixture below runs its OWN `lore init` — never the
 * repo's own `.lore/`. Nothing in this file reads this repo's real corpus or
 * memory-file tree (task-skill-test-tg-2 moved that sweep into
 * `scripts/check-claude-md-live-sweep.ts`).
 *
 * ## A measured false-positive class (⚠ pinned as a dedicated NEGATIVE case)
 *
 * The root CLAUDE.md contains `` `lore gate plan-close --explain` `` — a
 * backtick-quoted, multi-word CLI invocation whose SECOND token, `plan-close`,
 * has the exact shape of a `plan-*` corpus slug even though it is a GATE
 * NAME, not a document. A slug-pointer grammar that scans for
 * `type-kebab-word` shaped substrings ANYWHERE inside a backtick span
 * (rather than requiring the whole backtick token to BE the slug, the way
 * `checkReferenceExistence`'s `/`-requiring path grammar already does) would
 * misfire on this exact text. This was hit empirically this session while
 * probing slug resolution by hand, so a fixture reproducing it verbatim is
 * asserted as NOT a finding below.
 *
 * ## Why the JSON envelope is read by a generic recursive scan, not a fixed path
 *
 * `--check-memory-pointers`'s exact `--json` envelope shape is not yet
 * decided (the flag does not exist). `collectFindingsByKind` walks the
 * ENTIRE parsed payload looking for any object carrying
 * `kind === "slug_pointer_missing"`, wherever the implementer nests it —
 * this keeps the assertion meaningful ("the kind appears BY NAME somewhere
 * real, never merely a non-zero exit code") without coupling the test to an
 * envelope key this repo has not chosen yet.
 *
 * Coverage dimensions: HAPPY (a dangling slug fires) / NEGATIVE (an existing
 * slug stays silent; the gate-name false-positive class stays silent) /
 * BOUNDARY (two distinct dangling slugs each produce their own finding) /
 * ERROR (empty CLAUDE.md never crashes) / STATE (a dangling slug alongside an
 * existing one — only the dangling one is flagged) / REGRESSION (N14:
 * `--check-claude-md` never resolves slug pointers, even against the exact
 * same dangling-slug fixture).
 *
 * @spec_ref spec-claude-md-governance-content-dimension-checks-wire-the
 * @ac_ref AC-SLUG-1
 * @ac_ref AC-SLUG-2
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

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
  return mkdtempSync(join(tmpdir(), `lore-claude-md-slug-pointers-${label}-`));
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/** `lore init`s a fresh throwaway corpus in `dir` — never this repo's own `.lore/`. */
function initCorpus(dir: string): void {
  const run = runLore(["init"], dir);
  if (run.exitCode !== 0) {
    throw new Error(`lore init failed in fixture ${dir} (exit ${run.exitCode}): ${run.stderr}`);
  }
}

/**
 * The five required root H2 sections — every fixture that pins
 * `adoption: enforce` carries them so the ONLY thing that can trip the check is
 * the slug pointer under test, never `section_missing`
 * (spec-claude-md-root-section-structure-check-and-adoption-mode).
 */
const SECTIONS_PREFIX =
  ["What This Is", "Commands", "Architecture", "Module Index", "Finding Live Project State"]
    .map((name) => `## ${name}\n\nbody of ${name}\n`)
    .join("\n") + "\n";

/**
 * Appends `context.memory_files.adoption: enforce` to the fixture's
 * `lore init`-written config (absent key resolves to warn, under which a
 * dangling slug is downgraded and exit 3 is unreachable). Fails loud if the
 * init config already carries a `context:` key rather than clobbering it.
 */
function pinEnforce(dir: string): void {
  const configPath = join(dir, ".lore", "config.yaml");
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  if (/^context:/m.test(existing)) {
    throw new Error(`pinEnforce: ${configPath} already has a context: key; extend this helper before pinning`);
  }
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  writeFileSync(configPath, `${existing}${separator}context:\n  memory_files:\n    adoption: enforce\n`);
}

/** Pins enforce and writes a structurally conforming root CLAUDE.md whose body is `body`. */
function writeEnforcedRoot(dir: string, body: string): void {
  pinEnforce(dir);
  writeFileSync(join(dir, "CLAUDE.md"), SECTIONS_PREFIX + body);
}

/** Creates a `knowledge --sub-type reference` doc (no gate applies to knowledge creation) and returns its slug. */
function createReferenceDoc(dir: string, title: string): string {
  const run = runLore(
    ["create", "knowledge", "--sub-type", "reference", "--title", title, "--content", "## Overview", "--no-ai", "--json"],
    dir,
  );
  if (run.exitCode !== 0) {
    throw new Error(`create knowledge "${title}" failed in fixture ${dir} (exit ${run.exitCode}): ${run.stderr}`);
  }
  const parsed = JSON.parse(run.stdout) as { data: { slug: string } };
  return parsed.data.slug;
}

// ─── Generic JSON finding-kind scan (envelope shape not yet decided) ───────

interface JsonFinding {
  kind?: unknown;
  [key: string]: unknown;
}

/**
 * Recursively scans an arbitrary parsed JSON value for every plain object
 * carrying `kind === targetKind`, wherever it is nested — see this file's
 * module header for why the envelope shape cannot be assumed.
 */
function collectFindingsByKind(value: unknown, targetKind: string, out: JsonFinding[] = []): JsonFinding[] {
  if (Array.isArray(value)) {
    for (const item of value) collectFindingsByKind(item, targetKind, out);
  } else if (value !== null && typeof value === "object") {
    const record = value as JsonFinding;
    if (record.kind === targetKind) out.push(record);
    for (const nested of Object.values(record)) collectFindingsByKind(nested, targetKind, out);
  }
  return out;
}

function runCheckMemoryPointersJson(
  cwd: string,
): { result: RunResult; parsed: unknown } {
  const result = runLore(["status", "--check-memory-pointers", "--json"], cwd);
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `--check-memory-pointers --json produced non-JSON stdout (exit ${result.exitCode}): ${error instanceof Error ? error.message : String(error)}\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  return { result, parsed };
}

/** Same helper for `--check-claude-md` — used ONLY by the N14-boundary regression test below. */
function runCheckClaudeMdJson(cwd: string): { result: RunResult; parsed: unknown } {
  const result = runLore(["status", "--check-claude-md", "--json"], cwd);
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `--check-claude-md --json produced non-JSON stdout (exit ${result.exitCode}): ${error instanceof Error ? error.message : String(error)}\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  return { result, parsed };
}

// ─── A dangling slug, shaped like a real corpus slug but guaranteed absent ──

const DANGLING_SLUG_1 = "spec-this-corpus-definitely-lacks-this-doc-xyz-999";
const DANGLING_SLUG_2 = "knowledge-another-doc-this-corpus-definitely-lacks-000";

/** Verbatim text from THIS repo's own root CLAUDE.md — the measured `plan-close` gate-name false positive. */
const GATE_NAME_LOOKALIKE_LINE = "⛔ Gate name look-alike: `lore gate plan-close --explain` is the SSOT.\n";

// ─── AC-SLUG-1: a dangling slug is refused ─────────────────────────────────

describe("slug pointers — a dangling slug is refused", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("dangling");
    initCorpus(tmpDir);
  });
  afterEach(() => cleanupDir(tmpDir));

  it("HAPPY: a backtick-quoted corpus slug absent from this corpus fires slug_pointer_missing, exit code exactly 3", () => {
    writeEnforcedRoot(tmpDir, `See \`${DANGLING_SLUG_1}\` for the mechanism.\n`);

    const { result, parsed } = runCheckMemoryPointersJson(tmpDir);

    expect(result.exitCode).toBe(3);
    expect(collectFindingsByKind(parsed, "slug_pointer_missing").length).toBe(1);
  });

  it("NEGATIVE: a backtick-quoted slug that actually exists in this corpus is never flagged, exit code exactly 0", () => {
    const realSlug = createReferenceDoc(tmpDir, "Probe Reference Doc");
    writeEnforcedRoot(tmpDir, `See \`${realSlug}\` for the mechanism.\n`);

    const { result, parsed } = runCheckMemoryPointersJson(tmpDir);

    expect(result.exitCode).toBe(0);
    expect(collectFindingsByKind(parsed, "slug_pointer_missing")).toEqual([]);
  });

  it("NEGATIVE (measured false-positive class): a gate name that merely LOOKS LIKE a plan-* slug inside a longer backtick-quoted command is never flagged", () => {
    writeEnforcedRoot(tmpDir, GATE_NAME_LOOKALIKE_LINE);

    const { result, parsed } = runCheckMemoryPointersJson(tmpDir);

    expect(result.exitCode).toBe(0);
    expect(collectFindingsByKind(parsed, "slug_pointer_missing")).toEqual([]);
  });

  it("BOUNDARY: two distinct dangling slugs in one file each produce their own finding", () => {
    writeEnforcedRoot(
      tmpDir,
      `See \`${DANGLING_SLUG_1}\` and also \`${DANGLING_SLUG_2}\` for the mechanism.\n`,
    );

    const { result, parsed } = runCheckMemoryPointersJson(tmpDir);

    expect(result.exitCode).toBe(3);
    expect(collectFindingsByKind(parsed, "slug_pointer_missing").length).toBe(2);
  });

  it("ERROR (no crash): an empty CLAUDE.md produces zero slug_pointer_missing findings, exit code exactly 0", () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), "");

    const { result, parsed } = runCheckMemoryPointersJson(tmpDir);

    expect(result.exitCode).toBe(0);
    expect(collectFindingsByKind(parsed, "slug_pointer_missing")).toEqual([]);
  });

  it("STATE: a dangling slug alongside an existing one — only the dangling one is flagged", () => {
    const realSlug = createReferenceDoc(tmpDir, "Probe Reference Doc Two");
    writeEnforcedRoot(
      tmpDir,
      `See \`${realSlug}\` (real) and \`${DANGLING_SLUG_1}\` (dangling) for the mechanism.\n`,
    );

    const { result, parsed } = runCheckMemoryPointersJson(tmpDir);

    expect(result.exitCode).toBe(3);
    const findings = collectFindingsByKind(parsed, "slug_pointer_missing");
    expect(findings.length).toBe(1);
    // The flagged finding must name the DANGLING slug, never the real one —
    // checked against whatever string field the implementer used to carry it
    // (`path`/`reference`/`slug` are the plausible candidates).
    const serialized = JSON.stringify(findings[0]);
    expect(serialized).toContain(DANGLING_SLUG_1);
    expect(serialized).not.toContain(realSlug);
  });

  it("REGRESSION (N14 boundary): --check-claude-md never resolves slug pointers, even against the exact same dangling-slug fixture", () => {
    writeEnforcedRoot(tmpDir, `See \`${DANGLING_SLUG_1}\` for the mechanism.\n`);

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    // --check-claude-md is corpus-free by SPEC-095 D9 — it structurally
    // cannot know whether a slug exists, so it must stay silent AND exit 0
    // even though the identical text trips --check-memory-pointers above.
    expect(result.exitCode).toBe(0);
    expect(collectFindingsByKind(parsed, "slug_pointer_missing")).toEqual([]);
  });
});

// ─── AC-SLUG-2: positive control + real-corpus sweep ───────────────────────

describe("slug pointers — positive control plus real-corpus sweep", () => {
  // ⛔ The LIVE sweep (this repo's own memory files against this repo's own corpus) is NOT here: it reads
  // the repo's `.lore/`, so it lives in `scripts/check-claude-md-live-sweep.ts` (wired into `bun run test`
  // as `check:live-repo-state`). What stays here is the positive control plus the sweep script's own
  // logic, driven against mkdtemp fixtures (task-skill-test-tg-2).
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

  it("positive control fires exactly one slug_pointer_missing for a dangling slug", () => {
    // Mandatory alongside any sweep: a skipped check and a passing check both produce zero
    // findings, so "the corpus is clean" must be paired with proof the metric CAN fire at all.
    const controlDir = makeTempDir("repo-sweep-control");
    try {
      initCorpus(controlDir);
      writeEnforcedRoot(controlDir, `See \`${DANGLING_SLUG_1}\` for the mechanism.\n`);
      const control = runCheckMemoryPointersJson(controlDir);
      expect(control.result.exitCode).toBe(3);
      expect(collectFindingsByKind(control.parsed, "slug_pointer_missing").length).toBe(1);
    } finally {
      cleanupDir(controlDir);
    }
  });

  it("the sweep script exits 1 naming slug_pointer_missing on a fixture whose CLAUDE.md cites a dangling slug (sweep can FAIL)", () => {
    const dir = makeTempDir("sweep-dangling");
    try {
      initCorpus(dir);
      writeEnforcedRoot(dir, `See \`${DANGLING_SLUG_1}\` for the mechanism.\n`);
      const run = runSweep(dir);
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain("slug_pointer_missing");
    } finally {
      cleanupDir(dir);
    }
  });

  it("the sweep script also catches the dangling slug when adoption is warn (finding downgraded to advisory)", () => {
    const dir = makeTempDir("sweep-dangling-warn");
    try {
      initCorpus(dir);
      // no adoption pin: absent key resolves to warn, which moves the finding to advisory `downgraded`
      writeFileSync(join(dir, "CLAUDE.md"), SECTIONS_PREFIX + `See \`${DANGLING_SLUG_1}\` for the mechanism.\n`);
      const run = runSweep(dir);
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain("slug_pointer_missing");
    } finally {
      cleanupDir(dir);
    }
  });

  it("the sweep script exits 0 on a fixture citing only an existing slug, having walked >= 1 memory file", () => {
    const dir = makeTempDir("sweep-clean");
    try {
      initCorpus(dir);
      const realSlug = createReferenceDoc(dir, "Sweep Clean Reference");
      writeEnforcedRoot(dir, `See \`${realSlug}\` for the mechanism.\n`);
      const run = runSweep(dir);
      expect(run.exitCode, run.stderr).toBe(0);
      expect(run.stdout).toMatch(/\b[1-9]\d* memory file\(s\) walked/);
    } finally {
      cleanupDir(dir);
    }
  });

  it("NON-VACUITY: the sweep script exits 1 naming a vacuous sweep when the root holds no memory file", () => {
    const dir = makeTempDir("sweep-vacuous");
    try {
      initCorpus(dir);
      const run = runSweep(dir);
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain("vacuous sweep");
    } finally {
      cleanupDir(dir);
    }
  });
});
