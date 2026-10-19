// @spawns dist/lore
/**
 * RED-phase e2e for the pre-push CLAUDE.md-budget trip step (AC-CMC-3, task
 * `task-skill-test-pre-push-hook-trip-parity-extension-red-ac-cmc`; paired
 * implementation task `task-skill-implement-pre-push-pair-check-step-assets-
 * manifest`, not yet landed as of this file's authoring — confirmed empirically
 * below).
 *
 * bun test (not vitest): shells out to the REAL `assets/project/pre-push` shell
 * script (`sh <script>`, cwd inside a throwaway fixture repo, `PATH` prepended
 * with this worktree's `dist/` so the script's own `lore` invocations resolve to
 * the freshly-built binary — mirrors `gate-hooks.bun.test.ts`'s shim-spawn
 * harness). ⛔ Never touches the repo's own `.lore/` corpus (project CLAUDE.md
 * hard rule) — every fixture lives under its own `mkdtempSync` directory.
 *
 * ── Fixture-design finding (empirically probed before writing this suite) ──
 * The task brief's original assumption — "minimal `.lore/` dir with config.yaml
 * (defaults), NO lore init, NO DB needed" — does NOT hold for this hook. The
 * hook unconditionally runs THREE pre-existing checks before any future
 * claude-md step could run: `lore status --check-tree --check-drift`, `lore
 * audit --verify`, `lore status --check-prd-budget`. All three need a real
 * corpus DB:
 *   - A `.lore/` dir with ONLY a hand-written config.yaml (no `lore.db`) makes
 *     `lore status --check-tree --check-drift` fail immediately with "No Lore
 *     database found" (exit 1) — the hook then fails at the FIRST step, for a
 *     reason that has nothing to do with CLAUDE.md content, polluting the RED
 *     signal for AC-CMC-3 (wrong-reason non-zero exit).
 *   - Even with a REAL `lore init`-created DB, `--check-tree` additionally
 *     needs a `lore.tree.yaml` blueprint — its ABSENCE makes the tree check
 *     "unarmable" (exit 4), again for a reason unrelated to CLAUDE.md.
 *   - `status.ts` normalizes a declared blueprint's `root.min` up to
 *     `Math.max(declared, 1)` unconditionally, so an EMPTY corpus (zero docs)
 *     under ANY blueprint is reported "inconsistent" (exit 3) — at least one
 *     root-type doc must actually exist.
 * The fixture builder below therefore does a REAL `lore init` + `lore create
 * prd` + writes a matching minimal `lore.tree.yaml` (`root: {type: prd,
 * children: []}`, satisfied by exactly the one created PRD) so that
 * tree/drift/audit/prd-budget all report clean/consistent — empirically
 * verified (`buildBaselineFixture` + the "fixture sanity" HAPPY case below) —
 * making the CLAUDE.md-ceiling step the ONLY variable across scenarios.
 *
 * Coverage dimensions:
 *   HAPPY:      fixture-sanity control — a CONFORMANT fixture (no CLAUDE.md at
 *               all) exits 0 today, proving the fixture design itself isn't
 *               polluted by the pre-existing checks (documents the finding
 *               above as a live, re-run-on-every-suite oracle, not just prose).
 *   BOUNDARY:   the true RED case — an over-ceiling CLAUDE.md (420 lines,
 *               default 300-line root ceiling) under the SAME clean fixture.
 *               EXPECTED (spec'd, future) behavior: exit non-zero, output
 *               names the CLAUDE.md budget breach. ACTUAL (today, no trip step
 *               wired yet): exit 0 — the hook never looks at CLAUDE.md content
 *               at all — so this scenario's assertions FAIL now, by design.
 *   STATE:      `context.memory_files.enabled: false` + the SAME over-ceiling
 *               CLAUDE.md → exit 0. Already true today (the check doesn't
 *               exist yet, so it's vacuously "disabled") — a POSITIVE CONTROL,
 *               not a RED assertion; documents the opt-out contract survives
 *               once the trip step lands (the paired impl task must keep this
 *               green).
 *   ERROR:      no `.lore/` dir at all (fail-open preamble) + the SAME
 *               over-ceiling CLAUDE.md → exit 0. Already true today (the
 *               preamble short-circuits before ANY check runs) — a POSITIVE
 *               CONTROL for the same reason as STATE above.
 *   REGRESSION: the BOUNDARY scenario's stdout still shows the pre-existing
 *               checks' own clean output (tree consistent / audit clean / PRD
 *               budget within budget) — proves a future trip-step failure is
 *               ADDITIVE to the existing three checks, never a replacement
 *               that silently stops running them.
 *
 * @spec_ref spec-project-claude-md-content-contract-governance-injected AC-CMC-3
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { assertFreshBinary } from "./helpers/assert-fresh-binary";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

// tests/integration/ → packages/lore/ → packages/ → repo root (4 levels up).
const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(PROJECT_ROOT, "dist", "lore");
const DIST_DIR = join(PROJECT_ROOT, "dist");
const HOOK_PATH = join(PROJECT_ROOT, "assets", "project", "pre-push");

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Runs the compiled `dist/lore` binary directly, for fixture setup (not the hook itself). */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/**
 * Runs the real `assets/project/pre-push` shell script with `cwd` inside the
 * fixture and `PATH` prepended with this worktree's `dist/` (so the script's
 * own bare `lore` invocations resolve to the freshly-built binary, never a
 * globally-installed one). `HOME` is also pointed at the fixture dir, matching
 * the `runLore` fixture-setup convention above.
 */
function runHook(cwd: string): RunResult {
  const proc = Bun.spawnSync(["sh", HOOK_PATH], {
    cwd,
    env: {
      ...process.env,
      HOME: cwd,
      PATH: `${DIST_DIR}:${process.env["PATH"] ?? ""}`,
    },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function makeTempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `lore-pre-push-claude-md-${label}-`));
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function gitInit(dir: string): void {
  const proc = Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  if (proc.exitCode !== 0) {
    throw new Error(`git init failed: ${proc.stderr.toString()}`);
  }
}

/**
 * Builds a fixture repo whose pre-existing tree/drift/audit/prd-budget checks
 * all report clean — see the module header's "fixture-design finding" for why
 * this is required before the CLAUDE.md step can be isolated as the only
 * variable. Real `lore init` + one real PRD + a matching minimal
 * `lore.tree.yaml` (root: prd, no required children).
 */
function buildBaselineFixture(dir: string): void {
  gitInit(dir);

  const initResult = runLore(["init", "--name", "fixture", "--author", "fixture"], dir);
  if (initResult.exitCode !== 0) {
    throw new Error(`lore init failed: ${initResult.stderr}`);
  }

  const prdResult = runLore(
    ["create", "prd", "--title", "Fixture Root", "--content", "Root PRD for the pre-push CLAUDE.md trip fixture.", "--no-ai"],
    dir,
  );
  if (prdResult.exitCode !== 0) {
    throw new Error(`lore create prd failed: ${prdResult.stderr}`);
  }

  writeFileSync(join(dir, "lore.tree.yaml"), "version: 1\nroot:\n  type: prd\n  children: []\n");
}

/** Writes a CLAUDE.md well past the default root ceiling (300 lines / 30720 bytes). */
function writeOverCeilingClaudeMd(dir: string): void {
  const lines = Array.from(
    { length: 420 },
    (_, i) => `line ${i} of filler content padding this fixture CLAUDE.md past the root ceiling`,
  );
  // The five required root H2 sections come first: the fixture must be refused for its CEILING and nothing
  // else — never `section_missing` (spec-claude-md-root-section-structure-check-and-adoption-mode).
  writeFileSync(join(dir, "CLAUDE.md"), `${SECTIONS_PREFIX}${lines.join("\n")}\n`);
}

const SECTIONS_PREFIX =
  ["What This Is", "Commands", "Architecture", "Module Index", "Finding Live Project State"]
    .map((name) => `## ${name}\n\nbody of ${name}\n`)
    .join("\n") + "\n";

/**
 * Appends `context.memory_files` carrying `extraLines` to an already-initialised fixture's config.yaml. With no
 * extra lines it writes nothing: limits are always enforced, there is no setting to pin.
 */
function configureMemoryFiles(dir: string, extraLines = ""): void {
  if (extraLines === "") return;
  const configPath = join(dir, ".lore", "config.yaml");
  const existing = readFileSync(configPath, "utf8");
  writeFileSync(configPath, `${existing}\ncontext:\n  memory_files:\n${extraLines}`);
}

/** Appends `context.memory_files.enabled: false` to an already-initialised fixture's config.yaml. */
function disableMemoryFileCheck(dir: string): void {
  configureMemoryFiles(dir, "    enabled: false\n");
}

// ─── Suite ──────────────────────────────────────────────────────────────────

describe("pre-push hook — CLAUDE.md budget trip (AC-CMC-3)", () => {
  let tmpDir: string;

  // Fails loud (throws) if dist/lore is missing or older than the newest .ts source under
  // packages/{lore,core}/src — this suite spawns the COMPILED binary (directly for fixture
  // setup, and indirectly via the hook script), so a stale artifact would otherwise let the
  // test silently validate old logic against new source.
  beforeAll(() => {
    assertFreshBinary(LORE_BIN, [
      join(PROJECT_ROOT, "packages", "lore", "src"),
      join(PROJECT_ROOT, "packages", "core", "src"),
    ]);
  });

  beforeEach(() => {
    tmpDir = makeTempDir("fixture");
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("HAPPY (fixture sanity): a conformant fixture (no CLAUDE.md at all) exits 0 today — proves the fixture design isn't itself polluting the RED signal", () => {
    buildBaselineFixture(tmpDir);

    const result = runHook(tmpDir);

    expect(result.exitCode).toBe(0);
  });

  it("BOUNDARY (RED — the trip case): an over-ceiling CLAUDE.md under the clean fixture must exit non-zero and name the budget failure — FAILS today because the hook has no CLAUDE.md step yet", () => {
    buildBaselineFixture(tmpDir);
    writeOverCeilingClaudeMd(tmpDir);
    configureMemoryFiles(tmpDir);

    const result = runHook(tmpDir);
    const combined = `${result.stdout}\n${result.stderr}`;

    expect(result.exitCode).not.toBe(0);
    // The ceiling specifically — the fixture is structurally conforming, so a
    // `section_missing` refusal cannot satisfy this.
    expect(combined).toContain("max_lines");
    expect(combined).toMatch(/CLAUDE\.md/i);
    expect(combined.toLowerCase()).toMatch(/budget|ceiling|exceed|breach|lines/);
  });

  it("STATE (positive control): context.memory_files.enabled=false + the SAME over-ceiling CLAUDE.md exits 0 — already true today (vacuous, no step to disable yet); must stay true once the trip step lands", () => {
    buildBaselineFixture(tmpDir);
    writeOverCeilingClaudeMd(tmpDir);
    disableMemoryFileCheck(tmpDir);

    const result = runHook(tmpDir);

    expect(result.exitCode).toBe(0);
  });

  it("ERROR (positive control): no .lore/ dir at all (fail-open preamble) + an over-ceiling CLAUDE.md exits 0 — already true today (preamble short-circuits before any check runs); must stay true once the trip step lands", () => {
    gitInit(tmpDir);
    writeOverCeilingClaudeMd(tmpDir);

    const result = runHook(tmpDir);

    expect(result.exitCode).toBe(0);
  });

  it("REGRESSION: the pre-existing tree/audit/prd-budget checks' own clean output is still present in the BOUNDARY scenario — a future trip-step failure is additive, never a silent replacement", () => {
    buildBaselineFixture(tmpDir);
    writeOverCeilingClaudeMd(tmpDir);
    configureMemoryFiles(tmpDir);

    const result = runHook(tmpDir);
    const combined = `${result.stdout}\n${result.stderr}`;

    expect(combined).toContain("Tree is consistent with lore.tree.yaml blueprint.");
    expect(combined).toContain("Audit trail is complete");
    expect(combined).toContain("Chain integrity: clean");
    expect(combined).toContain("PRD budget: within budget");
  });
});
