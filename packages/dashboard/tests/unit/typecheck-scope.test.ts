// @reads package.json
// @reads packages/dashboard/tsconfig.json
// @reads packages/dashboard/tsconfig.tests.json
// @reads packages/dashboard/tests/**
// @reads packages/dashboard/src/**
/**
 * Tests for `packages/dashboard/tsconfig.tests.json`'s SCOPE (spec-oracle-tier-
 * falsifiability-a-criterion-never-observed-red M5, AC-FALS-22 / AC-FALS-24).
 *
 * The original defect: `tsconfig.tests.json` declares `include: ["src/**\/*","tests/**\/*"]`
 * but `extends: "./tsconfig.json"`, and `extends` does NOT reset `exclude` — the base's
 * `exclude: [...,"tests"]` was inherited, so the project resolved ZERO files under
 * `packages/dashboard/tests/` and its exit 0 was the exit code of checking nothing.
 *
 * TG-50: this file used to spawn the real `tsc` three-plus times (61 s in a full parallel run
 * against a 30 s timeout) — it measured the machine. The property under test is the SCOPE
 * (which files the project resolves) and the WIRING (the root `typecheck` chain reaches it),
 * both of which are static facts. They are asserted here by resolving the tsconfig's file list
 * in-process with the TypeScript compiler API (`parseJsonConfigFileContent`: the same include /
 * exclude / extends resolution `tsc -p` performs, with no type-check). The COST of an actual
 * type-check is `bun run typecheck`'s job (`typecheck:dashboard-tests`), not a unit test's.
 *
 * Dropped from the unit lane (report to the orchestrator): AC-FALS-22's second half, "running
 * that same project over a fixture whose AcCoverageFact omits `falsified` exits nonzero naming
 * `falsified`", and AC-FALS-24's "that project reports zero errors under a real full type-check"
 * both REQUIRE a real tsc run. The second is exactly what `bun run typecheck` already attests.
 * The first has no remaining unit-lane oracle; the file list proves the fixture would be seen,
 * and `typecheck:dashboard-tests` is what would reject it.
 *
 * Six-dimension coverage:
 *   HAPPY:      dashboard-tests-typechecked (AC-FALS-22) — the tests project's resolved file
 *               list contains SpecAcCoveragePanel.test.tsx
 *   NEGATIVE:   the base tsconfig.json's resolved list contains no tests/ file
 *   BOUNDARY:   tests/e2e stays out of the tests project (it has its own project); other
 *               tests/ subtrees are in
 *   ERROR:      a config that fails to parse throws loudly (never an empty list read as "ok")
 *   STATE:      n/a (pure functions over files on disk)
 *   REGRESSION: the ORIGINAL diagnosis (base config alone excludes tests/) is pinned directly,
 *               and the `typecheck` chain wiring (AC-FALS-24) is parsed structurally, not
 *               hardcoded, so silently dropping the invocation fails
 *
 * @spec_ref spec-oracle-tier-falsifiability-a-criterion-never-observed-red
 *   AC-FALS-22, AC-FALS-24
 */

import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
/** `packages/dashboard` — two levels up from `tests/unit/`. */
const DASHBOARD_ROOT = resolve(THIS_DIR, "..", "..");
/** Repo root — two more levels up from `packages/dashboard`. */
const REPO_ROOT = resolve(DASHBOARD_ROOT, "..", "..");
const TSCONFIG_JSON = join(DASHBOARD_ROOT, "tsconfig.json");
const TSCONFIG_TESTS_JSON = join(DASHBOARD_ROOT, "tsconfig.tests.json");
const ROOT_PACKAGE_JSON = join(REPO_ROOT, "package.json");
const DASHBOARD_TESTS_DIR = join(DASHBOARD_ROOT, "tests") + "/";
const DASHBOARD_E2E_DIR = join(DASHBOARD_ROOT, "tests", "e2e") + "/";

/**
 * The file list a `tsc -p <project>` run would load as ROOT files, resolved from the project's
 * own include / exclude / extends — no type-check, no spawn. Throws on an unreadable or
 * unparseable config (never returns an empty list for a broken config).
 */
function resolveProjectFiles(project: string): readonly string[] {
  const read = ts.readConfigFile(project, ts.sys.readFile);
  if (read.error) {
    throw new Error(`cannot read ${project}: ${ts.flattenDiagnosticMessageText(read.error.messageText, "\n")}`);
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(project), undefined, project);
  const fatal = parsed.errors.filter((d) => d.code !== 18003); // 18003 = "No inputs were found" — reported by the assertions below, not here
  if (fatal.length > 0) {
    throw new Error(`cannot parse ${project}: ${fatal.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("; ")}`);
  }
  return parsed.fileNames;
}

describe("tsconfig.tests.json scope (AC-FALS-22)", () => {
  it("HAPPY: dashboard-tests-typechecked — the tests project's file list resolves SpecAcCoveragePanel.test.tsx, and covers the tests tree but not tests/e2e", () => {
    const files = resolveProjectFiles(TSCONFIG_TESTS_JSON);
    expect(files.filter((f) => f.endsWith("SpecAcCoveragePanel.test.tsx")).length).toBeGreaterThan(0);
    const underTests = files.filter((f) => f.startsWith(DASHBOARD_TESTS_DIR));
    expect(underTests.length).toBeGreaterThan(0);
    // BOUNDARY: e2e has its own project (tsconfig.e2e.json); pulling it in re-introduces TS6059.
    expect(underTests.filter((f) => f.startsWith(DASHBOARD_E2E_DIR))).toEqual([]);
    // The fix gives the project its OWN exclude: it must not inherit the base's "tests".
    const raw = ts.readConfigFile(TSCONFIG_TESTS_JSON, ts.sys.readFile).config as { exclude?: string[] };
    expect(raw.exclude).toBeDefined();
    expect(raw.exclude).not.toContain("tests");
  });

  it("REGRESSION: the unpatched base tsconfig.json alone still excludes tests/ — pins the ORIGINAL defect report's own measurement, not just the fix", () => {
    const files = resolveProjectFiles(TSCONFIG_JSON);
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => f.includes("/tests/"))).toEqual([]);
  });

  it("ERROR: a missing config throws instead of resolving to an empty list", () => {
    expect(() => resolveProjectFiles(join(DASHBOARD_ROOT, "tsconfig.does-not-exist.json"))).toThrow(/cannot read/);
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
  it("typecheck-chain-covers-tests — the chain declared in root package.json invokes a tsc project whose resolved file list contains packages/dashboard/tests/ files", () => {
    const rootPackageJson = JSON.parse(readFileSync(ROOT_PACKAGE_JSON, "utf8")) as {
      scripts: Record<string, string>;
    };
    const scripts = rootPackageJson.scripts;
    const typecheckChain = definedOrThrow(scripts.typecheck, "root package.json must declare a \"typecheck\" script");
    expect(typecheckChain).toBeTruthy();

    const tscProjects = collectTscProjects(typecheckChain, scripts, new Set());
    expect(tscProjects.length).toBeGreaterThan(0);

    // Among every tsc project structurally reachable from the `typecheck` chain, find the one
    // whose resolved file list contains packages/dashboard/tests/ files. Not hardcoded to a
    // path: a rename that still covers the tests tree keeps passing; a chain that no longer
    // reaches any such project finds none and fails loudly.
    const covering = tscProjects.filter((project) =>
      resolveProjectFiles(project).some((file) => file.startsWith(DASHBOARD_TESTS_DIR)),
    );
    expect(
      covering,
      "no tsc project reachable from the typecheck chain has a file list covering packages/dashboard/tests/",
    ).not.toEqual([]);
    // Today that project is the fixed tsconfig.tests.json; zero errors under a real run is
    // `bun run typecheck`'s attestation (typecheck:dashboard-tests), not a unit test's.
    expect(covering).toContain(TSCONFIG_TESTS_JSON);
  });
});
