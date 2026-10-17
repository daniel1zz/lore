// @spawns packages/lore/src/index.ts
/**
 * RED-phase tests for AC-ADV-1 of
 * `spec-claude-md-governance-content-dimension-checks-wire-the` (the two
 * always-on advisory metrics, `line_length` and `target_distance` — the
 * paired implementation task is a sibling in the same plan/phase, not yet
 * landed as of this file's authoring).
 *
 * ⛔ Bound by the spec's own coverage contract ("every WIRING AC drives the
 * CLI subprocess, never the unit function directly" — explicitly names
 * AC-ADV-1) — every scenario below spawns the real CLI
 * (`lore status --check-claude-md --json`) against a `mkdtemp` fixture and
 * reads the JSON payload, mirroring `claude-md-wiring.test.ts`'s established
 * harness in this same directory. This file never calls
 * `runMemoryFileChecks`/`computeHeadroom`/any admission function.
 *
 * The ONE exception is `OFFICIAL_LINE_TARGET` itself: the spec's Module
 * Boundary note pins its home as a plain exported module constant in
 * `claude-md-admission.ts`, deliberately NOT part of `contextConfigSchema`
 * (it is a fixed external citation, not a per-repo tunable), so there is no
 * CLI-observable surface that reveals its value the way a resolved config
 * default is observable elsewhere in this spec (c.f. AC-EMPH-1). The
 * dispatch brief is explicit: "Read `OFFICIAL_LINE_TARGET` from the exported
 * module constant. Never restate 200 in the test." This is a plain constant
 * import, never a call into the admission module's logic, and does not
 * conflict with the "drive the CLI subprocess" binding above (which governs
 * how the FINDINGS are produced/observed, not how a citation constant is
 * read to avoid a hardcoded magic number).
 *
 * ⛔ Empirically verified BEFORE writing this file (throwaway probe, since
 * discarded) that a static `import { OFFICIAL_LINE_TARGET } from
 * "../../src/service/claude-md-admission.js"` of a named export that does
 * NOT YET EXIST resolves to `undefined` under this repo's vitest/esbuild
 * transform — it does NOT throw a module-load-time SyntaxError the way
 * strict native-ESM named-export resolution would. This is why the very
 * first test below is a dedicated guard asserting `OFFICIAL_LINE_TARGET` is
 * actually a number: without it, every other scenario would fail with a
 * confusing `NaN`/`undefined` comparison instead of a legible "the constant
 * is not exported yet" signal.
 *
 * RED baseline, confirmed empirically against this worktree before writing
 * this file: `lore status --check-claude-md --json` against a plain 5-line
 * root CLAUDE.md fixture returns `"advisory": []` and a `headroom` entry
 * with `lines.used: 5` — no `line_length`/`target_distance` kind is ever
 * emitted, at any file size, today. `OFFICIAL_LINE_TARGET` does not exist
 * anywhere under `packages/lore/src/service/claude-md-*.ts` (repo-wide
 * grep), so every scenario below that asserts either kind present, or reads
 * the constant's value, fails on capability absence — not a test bug.
 *
 * ⛔ Non-vacuity trap this suite is written to catch (see this task's
 * dispatch context): "every discovered memory file has both kinds" is
 * trivially true when zero files are discovered. Every scenario that asserts
 * per-kind counts also asserts `headroom.length` is nonzero and equal to
 * those counts, never the counts alone.
 *
 * Coverage dimensions: HAPPY (a single root file gets exactly one
 * `line_length` + one `target_distance`, with `target_distance.measured`
 * matching the file's own headroom line count minus `OFFICIAL_LINE_TARGET`)
 * / NEGATIVE (zero discovered memory files yields zero advisory entries of
 * either kind — proves the metric reports on real files, never fabricates)
 * / BOUNDARY (a file at EXACTLY `OFFICIAL_LINE_TARGET` lines still gets a
 * `target_distance` entry with `measured === 0` — catches a falsy-zero skip
 * bug) / ERROR (an empty, 0-line CLAUDE.md never crashes and still gets both
 * kinds, exit code exactly 0) / STATE (three simultaneously discovered files
 * across all three roles — root, module, AND `rules` — each get their OWN
 * pair of findings, proving the metric is per-file, not a single repo-wide
 * aggregate, and closing the risk that `role: "rules"` files are silently
 * partial on this newest role) / REGRESSION (`OFFICIAL_LINE_TARGET` is a
 * real exported positive-integer module constant, never a restated literal
 * in this test; and the two advisory kinds coexist with, and never alter the
 * exit code decided by, a REAL deterministic ceiling breach).
 *
 * @spec_ref spec-claude-md-governance-content-dimension-checks-wire-the
 * @ac_ref AC-ADV-1
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ⛔ Plain constant import only — never a call into admission logic. See this
// file's own header for why this does not conflict with the "drive the CLI
// subprocess, never the unit function directly" binding. Resolves to
// `undefined` today (empirically verified) since the export does not exist
// yet — the dedicated REGRESSION guard test below turns that into a legible
// failure instead of a downstream NaN.
import { OFFICIAL_LINE_TARGET } from "../../src/service/claude-md-admission.js";

// ─── Path setup (mirrors tests/integration/claude-md-wiring.test.ts) ───────

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

// ─── CLI subprocess harness (mirrors claude-md-wiring.test.ts verbatim) ────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir.
 * MOCK RISK: none — spawns the real CLI, same pattern as
 * `claude-md-wiring.test.ts`. `CLAUDECODE=1` puts the surface into "agent"
 * mode (AI default off) — irrelevant to this deterministic, non-AI,
 * corpus-free check (`--check-claude-md` dispatches before `loadLoreApp`,
 * spec §D9/N14), kept for parity with the repo's established convention.
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
  return mkdtempSync(join(tmpdir(), `lore-claude-md-advisories-${label}-`));
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

// ─── --json payload shape (deliberately partial — mirrors
// claude-md-wiring.test.ts's own convention: an assertion helper, never a
// mirror of AdvisoryFinding/HeadroomReport, which stay owned by the service
// layer) ─────────────────────────────────────────────────────────────────

interface AdvisoryFindingJson {
  kind: string;
  measured?: number;
  message?: string;
  path?: string;
}

interface HeadroomEntryJson {
  path: string;
  role: string;
  lines: { used: number };
}

interface CheckClaudeMdJson {
  data?: {
    claude_md?: {
      findings?: { kind: string }[];
      advisory?: AdvisoryFindingJson[];
      headroom?: HeadroomEntryJson[];
    };
  };
}

function runCheckClaudeMdJson(cwd: string): { result: RunResult; parsed: CheckClaudeMdJson } {
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

function headroomEntries(parsed: CheckClaudeMdJson): HeadroomEntryJson[] {
  return parsed.data?.claude_md?.headroom ?? [];
}

function advisoryOfKind(parsed: CheckClaudeMdJson, kind: string): AdvisoryFindingJson[] {
  return (parsed.data?.claude_md?.advisory ?? []).filter((f) => f.kind === kind);
}

/** A CLAUDE.md body of exactly `lineCount` non-empty lines (mirrors claude-md-wiring.test.ts's `nLineBody`; root ceiling is 300 lines, D3). */
function nLineBody(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= lineCount; i++) {
    lines.push(`Line ${i}: standing discipline entry, not a status narrative.`);
  }
  return lines.join("\n") + "\n";
}

// ─── AC-ADV-1 ───────────────────────────────────────────────────────────────

describe("always-on advisories — printed every run, exit code untouched", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("scenario");
  });

  afterEach(() => cleanupDir(tmpDir));

  // ─── REGRESSION guard, runs first: the constant itself ───────────────────

  it("REGRESSION: OFFICIAL_LINE_TARGET is exported as a positive-integer module constant (never restated as a literal in this test)", () => {
    expect(
      typeof OFFICIAL_LINE_TARGET,
      "claude-md-admission.ts must export OFFICIAL_LINE_TARGET as a number — every other scenario in this file reads it from this import, never a hardcoded literal",
    ).toBe("number");
    expect(Number.isInteger(OFFICIAL_LINE_TARGET)).toBe(true);
    expect(OFFICIAL_LINE_TARGET as number).toBeGreaterThan(0);
  });

  // ─── HAPPY ────────────────────────────────────────────────────────────────

  it("HAPPY: a single root file gets exactly one line_length and one target_distance entry, measured = lines.used - OFFICIAL_LINE_TARGET, exit code exactly 0", () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), nLineBody(50));

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(result.exitCode).toBe(0);
    const headroom = headroomEntries(parsed);
    expect(headroom).toHaveLength(1);
    expect(headroom[0]?.lines.used).toBe(50);

    const lineLength = advisoryOfKind(parsed, "line_length");
    const targetDistance = advisoryOfKind(parsed, "target_distance");
    expect(lineLength).toHaveLength(1);
    expect(targetDistance).toHaveLength(1);
    expect(targetDistance[0]?.measured).toBe(50 - (OFFICIAL_LINE_TARGET as number));
  });

  // ─── NEGATIVE ─────────────────────────────────────────────────────────────

  it("NEGATIVE: zero discovered memory files yields zero line_length and zero target_distance entries (the metric never fabricates), exit code exactly 0", () => {
    // Deliberately empty tmpDir — no CLAUDE.md, no packages/, no .claude/.

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(result.exitCode).toBe(0);
    expect(headroomEntries(parsed)).toHaveLength(0);
    expect(advisoryOfKind(parsed, "line_length")).toHaveLength(0);
    expect(advisoryOfKind(parsed, "target_distance")).toHaveLength(0);
  });

  // ─── BOUNDARY ─────────────────────────────────────────────────────────────

  it("BOUNDARY: a file at EXACTLY OFFICIAL_LINE_TARGET lines still gets a target_distance entry with measured exactly 0 (not skipped as falsy)", () => {
    // Self-contained guard (does not rely on the earlier REGRESSION test's
    // execution order): a degenerate `undefined` target would silently build
    // a near-empty fixture instead of the intended boundary case.
    expect(
      typeof OFFICIAL_LINE_TARGET,
      "OFFICIAL_LINE_TARGET must be a number to construct this boundary fixture",
    ).toBe("number");
    const target = OFFICIAL_LINE_TARGET as number;
    writeFileSync(join(tmpDir, "CLAUDE.md"), nLineBody(target));

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(result.exitCode).toBe(0);
    const headroom = headroomEntries(parsed);
    expect(headroom).toHaveLength(1);
    expect(headroom[0]?.lines.used).toBe(target);

    const targetDistance = advisoryOfKind(parsed, "target_distance");
    expect(targetDistance).toHaveLength(1);
    expect(targetDistance[0]?.measured).toBe(0);
  });

  // ─── ERROR (no crash) ─────────────────────────────────────────────────────

  it("ERROR (no crash): an empty, 0-line CLAUDE.md still gets both kinds, valid JSON, exit code exactly 0", () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), "");

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(result.exitCode).toBe(0);
    const headroom = headroomEntries(parsed);
    expect(headroom).toHaveLength(1);

    const lineLength = advisoryOfKind(parsed, "line_length");
    const targetDistance = advisoryOfKind(parsed, "target_distance");
    expect(lineLength).toHaveLength(1);
    expect(targetDistance).toHaveLength(1);
    expect(targetDistance[0]?.measured).toBe(headroom[0]!.lines.used - (OFFICIAL_LINE_TARGET as number));
  });

  // ─── STATE ────────────────────────────────────────────────────────────────

  it("STATE: three simultaneously discovered files across root/module/rules roles each get their OWN pair of findings — non-vacuous, per-file, never aggregated", () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), nLineBody(120));
    mkdirSync(join(tmpDir, "packages", "widget"), { recursive: true });
    writeFileSync(join(tmpDir, "packages", "widget", "CLAUDE.md"), nLineBody(45));
    mkdirSync(join(tmpDir, ".claude", "rules"), { recursive: true });
    writeFileSync(join(tmpDir, ".claude", "rules", "a.md"), nLineBody(10));

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(result.exitCode).toBe(0);

    const headroom = headroomEntries(parsed);
    // Non-vacuity: nonzero AND the discovered count this whole assertion
    // chain is built on.
    expect(headroom.length).toBeGreaterThan(0);
    expect(headroom).toHaveLength(3);
    expect(headroom.some((h) => h.role === "root")).toBe(true);
    expect(headroom.some((h) => h.role === "module")).toBe(true);
    expect(headroom.some((h) => h.role === "rules")).toBe(true);

    const lineLength = advisoryOfKind(parsed, "line_length");
    const targetDistance = advisoryOfKind(parsed, "target_distance");
    // Exactly one of each kind PER discovered file, not one aggregate pair
    // for the whole repo and not silently partial on the `rules` role.
    expect(lineLength).toHaveLength(headroom.length);
    expect(targetDistance).toHaveLength(headroom.length);

    const expectedDeltas = headroom.map((h) => h.lines.used - (OFFICIAL_LINE_TARGET as number)).sort((a, b) => a - b);
    const actualDeltas = targetDistance.map((f) => f.measured).sort((a, b) => (a ?? NaN) - (b ?? NaN));
    expect(actualDeltas).toEqual(expectedDeltas);
  });

  // ─── REGRESSION: advisories never gate the exit code, even alongside a
  // REAL deterministic breach ────────────────────────────────────────────

  it("REGRESSION: a real max_lines breach still decides the exit code (3) — line_length and target_distance are still present, never crowding out or being crowded out by a real finding", () => {
    // Absent `adoption` resolves to warn (exit 0); this case asserts ENFORCEMENT, so it pins the mode.
    mkdirSync(join(tmpDir, ".lore"), { recursive: true });
    writeFileSync(join(tmpDir, ".lore", "config.yaml"), "context:\n  memory_files:\n    adoption: enforce\n");
    writeFileSync(join(tmpDir, "CLAUDE.md"), nLineBody(400)); // root ceiling is 300 lines — real breach

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(result.exitCode).toBe(3); // the real breach decides the exit code, never the advisories
    expect((parsed.data?.claude_md?.findings ?? []).map((f) => f.kind)).toContain("max_lines");

    const headroom = headroomEntries(parsed);
    expect(headroom).toHaveLength(1);
    expect(advisoryOfKind(parsed, "line_length")).toHaveLength(1);
    expect(advisoryOfKind(parsed, "target_distance")).toHaveLength(1);
  });
});
