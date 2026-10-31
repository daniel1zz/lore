#!/usr/bin/env bun
/**
 * Selector cross-check (AC-TG-8 of `spec-test-governance-guards-that-refuse-bad-tests-declared`,
 * task-skill-implement-tg-14).
 *
 * Purpose: after a FULL test run, prove the change selector (`scripts/changed-tests.ts`) would have
 * caught every failure. Given the vitest JSON reports of that run and a commit range, run the selector's
 * own `selectAffectedTests` for the range and name each test that failed in the full run but whose file
 * the selector would not have selected. Those are selector misses: a declared input missing from a test
 * (`// @reads` / `// @spawns`), or an import the static scan cannot see.
 *
 * Public surface: `parseFailedTests` (pure), `findSelectorMisses` (pure), `runMissReport` (IO, returns exit code).
 * Invariants: no second selection algorithm — selection is `selectAffectedTests`, fed the range's changed
 * files; the reports are the ones `scripts/run-tests.ts` already writes (no second reporter).
 * Side-effect class: IO (git, disk) in `runMissReport`; the rest is pure.
 *
 * Exit codes: 0 every failed test would have been selected (or nothing failed); 1 at least one miss
 * (each printed as `miss file=<path> test=<name>`); 2 the check could not run (bad usage, unreadable or
 * malformed report, bad range) — never 0 or 1, so a broken check cannot read as clean (AS-17).
 *
 * Usage: bun scripts/selector-miss-report.ts <base>..<head> <report.json> [<report.json> ...]
 * Run after a full run on main: `bun scripts/run-tests.ts --base <ref>` runs it over `<ref>..HEAD`
 * using the run's own reports.
 */
import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { loadCoreAliasMap, loadFileMap, loadVitestConfigSources, selectAffectedTests, type SelectionResult } from "./changed-tests.js";

/** Typed error for every way the cross-check can fail to run (reported as exit 2). */
export class SelectorMissReportError extends Error {
  constructor(
    public readonly code: "usage" | "report" | "git",
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SelectorMissReportError";
  }
}

/** One failed test in a full-suite report: repo-relative posix file and the test's full name. */
export interface FailedTest {
  readonly file: string;
  readonly test: string;
}

/** Test name used when a file failed without any failed assertion (collection error, import failure). */
export const FILE_LEVEL_FAILURE = "<file-level failure: no failed assertion>";

const VitestReportSchema = z.object({
  testResults: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      assertionResults: z.array(z.object({ fullName: z.string(), status: z.string() })).default([]),
    }),
  ),
});

/**
 * Failed tests in one vitest `--reporter=json` report. File names are made relative to `root`.
 * @throws SelectorMissReportError("report") when the text is not a vitest report.
 */
export function parseFailedTests(json: string, root: string, label: string): FailedTest[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new SelectorMissReportError("report", `${label} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, { label });
  }
  const parsed = VitestReportSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SelectorMissReportError("report", `${label} has no valid testResults array (not a vitest json report)`, { label, issues: parsed.error.issues });
  }
  const failed: FailedTest[] = [];
  for (const result of parsed.data.testResults) {
    const file = relative(root, result.name).split(sep).join("/");
    const failedAssertions = result.assertionResults.filter((a) => a.status === "failed");
    for (const a of failedAssertions) failed.push({ file, test: a.fullName });
    if (result.status === "failed" && failedAssertions.length === 0) failed.push({ file, test: FILE_LEVEL_FAILURE });
  }
  return failed;
}

/** The failed tests whose file is not in the selection. Pure. */
export function findSelectorMisses(failed: readonly FailedTest[], selection: SelectionResult): FailedTest[] {
  const selectedPaths = new Set(selection.selected.map((s) => s.path));
  return failed.filter((f) => !selectedPaths.has(f.file));
}

function runGit(args: readonly string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.error !== undefined || r.status !== 0) {
    throw new SelectorMissReportError("git", `git ${args.join(" ")} failed: ${r.error?.message ?? r.stderr.trim()}`, { args });
  }
  return r.stdout;
}

/** CLI body. Returns the exit code (0 / 1 / 2, see module header). */
export function runMissReport(argv: readonly string[], cwd: string): number {
  try {
    const [range, ...reports] = argv;
    if (range === undefined || !/^[^.\s]\S*\.\.[^.\s]\S*$/.test(range) || reports.length === 0) {
      throw new SelectorMissReportError("usage", "usage: selector-miss-report.ts <base>..<head> <report.json> [<report.json> ...]", { argv });
    }
    const repoRoot = runGit(["rev-parse", "--show-toplevel"], cwd).trim();
    const changedFiles = runGit(["diff", "--name-only", range], repoRoot)
      .split("\n")
      .filter((l) => l.length > 0);
    const failed = reports.flatMap((path) => {
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch (e) {
        throw new SelectorMissReportError("report", `cannot read report ${path}: ${e instanceof Error ? e.message : String(e)}`, { path });
      }
      return parseFailedTests(text, repoRoot, path);
    });
    const selection = selectAffectedTests({ changedFiles, fileMap: loadFileMap(repoRoot), aliasMap: loadCoreAliasMap(repoRoot), vitestConfigSources: loadVitestConfigSources(repoRoot) });
    const misses = findSelectorMisses(failed, selection);
    console.log(
      `selector-miss-report: range ${range}: ${changedFiles.length} changed file(s), selector would select ${selection.selected.length} test file(s); ${failed.length} failed test(s) in the full run.`,
    );
    if (misses.length === 0) {
      console.log("selector-miss-report: OK — every failed test would have been selected.");
      return 0;
    }
    for (const m of misses) console.log(`  miss file=${m.file} test=${m.test}`);
    console.log(
      `selector-miss-report: FAIL — ${misses.length} failed test(s) in ${new Set(misses.map((m) => m.file)).size} file(s) the selector would not have selected for ${range}; declare the missing input (// @reads / // @spawns) in the test.`,
    );
    return 1;
  } catch (e) {
    if (!(e instanceof SelectorMissReportError)) throw e;
    console.error(`selector-miss-report: [${e.code}] ${e.message}`);
    return 2;
  }
}

if (import.meta.main) {
  process.exit(runMissReport(process.argv.slice(2), process.cwd()));
}
