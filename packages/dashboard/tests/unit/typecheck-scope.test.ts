/**
 * Tests for `packages/dashboard/tsconfig.tests.json`'s SCOPE — a direct probe of
 * the tsconfig fix this task's own defect report was wrong about (spec-oracle-
 * tier-falsifiability-a-criterion-never-observed-red M5, AC-FALS-22).
 *
 * The original defect report claimed `bunx tsc -p packages/dashboard/
 * tsconfig.tests.json --noEmit --listFilesOnly` already resolved 50 errors
 * including the dashboard test tree. Measured 2026-08-07 from the repo root:
 * that invocation resolved 648 files, ZERO of them under `packages/dashboard/
 * tests/`. The config declares `include: ["src/**\/*","tests/**\/*"]` but
 * `extends: "./tsconfig.json"`, and `extends` does NOT reset `exclude` — the
 * base config's `exclude: [...,"tests"]` is inherited, and `exclude` filters
 * `include`. Its exit 0 was the exit code of checking nothing. The fix (this
 * task, same anchor set) gives `tsconfig.tests.json` its OWN `exclude` that
 * does not swallow `tests`.
 *
 * ⛔ This file proves the FIX, not the WIRING. `bun run typecheck` does NOT
 * invoke this project (`packages/dashboard`'s own `typecheck` script runs bare
 * `tsc --noEmit`, i.e. `tsconfig.json`, never `tsconfig.tests.json`) — wiring
 * this project into that chain, and clearing the 46 pre-existing strictness
 * errors it surfaces, belongs to the SIBLING task in phase `typecheck-sweep`
 * (AC-FALS-24, a DIFFERENT test in this SAME file, deliberately NOT written
 * here — see that AC's own statement: "one test asserts... that the typecheck
 * chain... invokes the dashboard project... and reports zero errors", which
 * this task's own file anchors explicitly forbid attempting, since 46 of the
 * ~50 errors the un-excluded tree surfaces are unrelated and out of scope).
 *
 * Both tests spawn the REAL `tsc` binary (`node_modules/.bin/tsc`) against the
 * REAL, already-fixed `tsconfig.tests.json` — an external-oracle check, never a
 * self-report about what the config "should" do.
 *
 * Six-dimension coverage:
 *   HAPPY:      dashboard-tests-typechecked (AC-FALS-22) — the fixed project
 *               resolves SpecAcCoveragePanel.test.tsx into its file list, AND a
 *               deliberately-broken temp fixture (an AcCoverageFact literal
 *               omitting `falsified`) makes that SAME project exit nonzero with
 *               an error naming `falsified`
 *   NEGATIVE:   n/a — this file has no in-scope "should NOT resolve" case; the
 *               base tsconfig.json's own exclusion of `tests/` is asserted
 *               directly (REGRESSION below), which already covers the negative
 *               shape
 *   BOUNDARY:   the probe fixture is placed inside `tests/**` (never `src/**`)
 *               to prove the FIX covers the tests tree specifically, not an
 *               incidental side effect of `src/**` already being checked
 *   ERROR:      the fixture is ALWAYS removed (try/finally), even if an
 *               assertion throws mid-test — a failed run must not leave a
 *               permanently broken file inside the real `tests/` tree
 *   STATE:      n/a (each test spawns tsc fresh; no shared mutable state
 *               between tests beyond the filesystem cleanup contract above)
 *   REGRESSION: the ORIGINAL diagnosis (`tsconfig.json` alone, unpatched,
 *               excludes `tests/`) is re-asserted directly, so this file also
 *               pins the defect report's own measurement, not just the fix
 *
 * @spec_ref spec-oracle-tier-falsifiability-a-criterion-never-observed-red
 *   AC-FALS-22
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
/** `packages/dashboard` — two levels up from `tests/unit/`. */
const DASHBOARD_ROOT = resolve(THIS_DIR, "..", "..");
/** Repo root — two more levels up from `packages/dashboard`. */
const REPO_ROOT = resolve(DASHBOARD_ROOT, "..", "..");
const TSC_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsc");
const TSCONFIG_JSON = join(DASHBOARD_ROOT, "tsconfig.json");
const TSCONFIG_TESTS_JSON = join(DASHBOARD_ROOT, "tsconfig.tests.json");
/**
 * Inside `tests/**` on purpose (BOUNDARY) — proves the fix covers the tests tree,
 * not src. ⛔ NEVER dot-prefixed: TypeScript's own file resolution silently
 * excludes dot-prefixed directories/files from a wildcard `include` glob (measured
 * directly — a `.typecheck-scope-probe` name made this exact fixture invisible to
 * `tsc`, a false green the first time this test was written), independent of this
 * config's own `exclude` list.
 */
const PROBE_DIR = join(DASHBOARD_ROOT, "tests", "typecheck-scope-probe-tmp");
const PROBE_FILE = join(PROBE_DIR, "broken-fact.probe.ts");

/** Spawns `tsc` and returns its exit status + combined stdout/stderr — never throws on a nonzero exit (that is the signal under test, not an error condition). */
function runTsc(args: readonly string[]): { status: number; output: string } {
  try {
    const output = execFileSync(TSC_BIN, [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, output };
  } catch (error) {
    const spawnError = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: spawnError.status ?? 1,
      output: `${spawnError.stdout ?? ""}${spawnError.stderr ?? ""}`,
    };
  }
}

function removeProbeFixture(): void {
  if (existsSync(PROBE_DIR)) rmSync(PROBE_DIR, { recursive: true, force: true });
}

// ERROR dimension: the probe fixture is removed after EVERY test in this file,
// not just the one that creates it — a thrown assertion must never leave a
// permanently broken file inside the real tests/ tree.
afterEach(() => {
  removeProbeFixture();
});

describe("tsconfig.tests.json scope (AC-FALS-22)", () => {
  it("HAPPY: dashboard-tests-typechecked — resolves SpecAcCoveragePanel.test.tsx, and a temp fixture missing falsified makes the SAME project exit nonzero naming falsified", () => {
    // Part 1: the fixed project's file list includes the real test file the
    // ORIGINAL defect report measured as absent (0 of 648 files under tests/).
    const listing = runTsc(["-p", TSCONFIG_TESTS_JSON, "--noEmit", "--listFilesOnly"]);
    expect(listing.status).toBe(0);
    const resolvedTestFiles = listing.output.split("\n").filter((line) => line.includes("SpecAcCoveragePanel.test.tsx"));
    expect(resolvedTestFiles.length).toBeGreaterThan(0);

    // Part 2: a deliberately-broken temp fixture — an AcCoverageFact literal
    // omitting the required `falsified` field — placed inside tests/** (never
    // src/**, BOUNDARY) makes the SAME project's full type-check exit nonzero
    // with an error that NAMES falsified, not merely "some error, somewhere".
    mkdirSync(PROBE_DIR, { recursive: true });
    writeFileSync(
      PROBE_FILE,
      [
        'import type { AcCoverageFact } from "@lore/core";',
        "",
        "// Deliberately missing `falsified` — the exact M5 shape (a required field",
        "// a hand-built fixture does not actually satisfy at compile time).",
        "export const broken: AcCoverageFact = {",
        '  ac_id: "AC-PROBE",',
        '  mode: "script",',
        "  pass: 1,",
        "  fail: 0,",
        "  refs: [],",
        "  attested_pass: 0,",
        "  attested_fail: 0,",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    const checked = runTsc(["-p", TSCONFIG_TESTS_JSON, "--noEmit"]);
    expect(checked.status).not.toBe(0);
    expect(checked.output).toContain("falsified");
  });

  it("REGRESSION: the unpatched base tsconfig.json alone still excludes tests/ — pins the ORIGINAL defect report's own measurement, not just the fix", () => {
    const listing = runTsc(["-p", TSCONFIG_JSON, "--noEmit", "--listFilesOnly"]);
    expect(listing.status).toBe(0);
    const resolvedTestFiles = listing.output.split("\n").filter((line) => line.includes("/tests/"));
    expect(resolvedTestFiles.length).toBe(0);
  });
});
