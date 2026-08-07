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
 * ⛔ The first two tests below prove the FIX, not the WIRING. As landed by phase
 * `derivation`, `bun run typecheck` did NOT invoke this project
 * (`packages/dashboard`'s own `typecheck` script runs bare `tsc --noEmit`, i.e.
 * `tsconfig.json`, never `tsconfig.tests.json`). The sibling task in phase
 * `typecheck-sweep` (AC-FALS-24) wires this project into that chain, clears the
 * 47 pre-existing strictness errors the un-excluded tree surfaces (all fixture
 * bugs, none production-type widenings), AND adds the third test below, which
 * proves the wiring itself — structurally, by parsing root `package.json`'s
 * `typecheck` chain rather than hardcoding the project path, so a future
 * regression that silently drops the invocation is caught.
 *
 * All three tests spawn the REAL `tsc` binary (`node_modules/.bin/tsc`) against
 * REAL config — an external-oracle check, never a self-report about what a
 * config "should" do.
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
 * A third test, `typecheck-chain-covers-tests` (AC-FALS-24), covers the WIRING:
 *   HAPPY:      the `typecheck` chain declared in root `package.json`, resolved
 *               structurally (parsed, not hardcoded), reaches a `tsc -p <project>`
 *               invocation whose file list contains `packages/dashboard/tests/`
 *               files, AND that exact project reports zero errors under a real
 *               full type-check
 *   NEGATIVE:   n/a — covered by the two tests above (the unpatched base config
 *               excludes `tests/` outright)
 *   BOUNDARY:   parses `package.json` at read time rather than asserting a
 *               literal script string, so a future rename/reorder of the chain
 *               that still reaches the same project keeps passing
 *   ERROR:      n/a — no fixture is created; the test only spawns `tsc` in
 *               `--listFilesOnly`/`--noEmit` read-only modes
 *   STATE:      n/a (no shared mutable state)
 *   REGRESSION: fails loudly (not silently) if the chain ever stops reaching a
 *               project whose file list covers `packages/dashboard/tests/` —
 *               the exact defect this AC exists to catch (an oracle that was
 *               green before the fix measures nothing)
 *
 * @spec_ref spec-oracle-tier-falsifiability-a-criterion-never-observed-red
 *   AC-FALS-22, AC-FALS-24
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const ROOT_PACKAGE_JSON = join(REPO_ROOT, "package.json");
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

/**
 * Recursively resolves every `tsc -p <project>` invocation reachable from a
 * root `package.json` script command, following `bun run <name>` references
 * into OTHER root-level scripts (never following `--filter`-style delegation
 * into a DIFFERENT package's own `package.json` — `typecheck:dashboard`'s
 * `bun run --filter '@lore/dashboard' typecheck` delegates that way into a
 * bare `tsc --noEmit` i.e. `tsconfig.json`, a DIFFERENT, deliberately-unrelated
 * project, and is correctly invisible to this resolver).
 *
 * Structural parsing (not a hardcoded path) is the point: a future edit that
 * silently drops the tests-project invocation from the chain must fail this
 * test, not slide past a string literal that no longer reflects reality.
 */
/**
 * Fail-loud narrowing for a value that SHOULD be defined by construction (a
 * regex capture group that participated in a successful match; a script name
 * root `package.json` is expected to declare) — never `!`, which would trust
 * silently instead of throwing a message that points at WHICH invariant broke.
 */
function definedOrThrow<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function collectTscProjects(command: string, scripts: Readonly<Record<string, string>>, seen: Set<string>): string[] {
  const projects: string[] = [];
  for (const rawPart of command.split("&&")) {
    const part = rawPart.trim();
    const projectFlagMatch = part.match(/(?:^|\s)-p\s+(\S+)/);
    if (projectFlagMatch) {
      const projectPath = definedOrThrow(projectFlagMatch[1], "a matched -p flag must carry a capture group value");
      projects.push(resolve(REPO_ROOT, projectPath));
      continue;
    }
    const scriptRefMatch = part.match(/^bun run ([\w:.-]+)$/);
    if (scriptRefMatch) {
      const name = definedOrThrow(scriptRefMatch[1], "a matched 'bun run <name>' must carry a capture group value");
      if (seen.has(name)) continue;
      seen.add(name);
      const nested = scripts[name];
      if (nested) projects.push(...collectTscProjects(nested, scripts, seen));
    }
  }
  return projects;
}

describe("typecheck chain wiring (AC-FALS-24)", () => {
  it("typecheck-chain-covers-tests — the chain declared in root package.json invokes the project whose file list contains packages/dashboard/tests/ files, and that project reports zero errors", () => {
    const rootPackageJson = JSON.parse(readFileSync(ROOT_PACKAGE_JSON, "utf8")) as {
      scripts: Record<string, string>;
    };
    const scripts = rootPackageJson.scripts;
    const typecheckChain = definedOrThrow(scripts.typecheck, "root package.json must declare a \"typecheck\" script");
    expect(typecheckChain).toBeTruthy();

    const tscProjects = collectTscProjects(typecheckChain, scripts, new Set());
    expect(tscProjects.length).toBeGreaterThan(0);

    // Among every tsc project structurally reachable from the `typecheck`
    // chain, find the one whose resolved file list contains
    // packages/dashboard/tests/ files — the SAME project the HAPPY case above
    // (AC-FALS-22) already proves is the fixed tsconfig.tests.json. Not
    // hardcoded to that path: if the wiring moved to a differently-named
    // project that still covers the tests tree, this must still find it; if
    // NO reachable project covers the tests tree (today's un-wired state),
    // this must find none.
    let dashboardTestsProject: string | undefined;
    for (const project of tscProjects) {
      const listing = runTsc(["-p", project, "--noEmit", "--listFilesOnly"]);
      expect(listing.status).toBe(0);
      if (listing.output.split("\n").some((line) => line.includes("packages/dashboard/tests/"))) {
        dashboardTestsProject = project;
        break;
      }
    }
    // `expect(...).toBeDefined()` does not narrow for TypeScript's control
    // flow — `definedOrThrow` both asserts AND narrows, so the next line
    // never needs an `as string`/`!` to silence the possibly-undefined type.
    const foundProject = definedOrThrow(
      dashboardTestsProject,
      "no tsc project reachable from the typecheck chain has a file list covering packages/dashboard/tests/",
    );

    // That SAME project reports zero errors under a real, full type-check —
    // not just "some project's file list happens to mention tests/", but
    // "the project the chain actually runs is clean".
    const checked = runTsc(["-p", foundProject, "--noEmit"]);
    expect(checked.status).toBe(0);
  });
});
