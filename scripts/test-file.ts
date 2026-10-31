#!/usr/bin/env bun
/**
 * `bun run test:file <path...> [vitest args]` — THE way to run specific test files (TG-41).
 *
 * Purpose: route each file to the runner that can collect it. Files named in `vitest.node-files.ts`
 * (the one Node list) run under `bunx vitest run --config vitest.node.config.ts`; every other file
 * runs under `bunx --bun vitest run`. A Node-listed file under the default config collects nothing,
 * so routing by construction replaces hand-split AC commands.
 * Public surface: `splitArgs`, `splitByRunner`, `planGroups`, `judgeCollected` (pure), `main` (IO, returns the exit code).
 * Invariants: only non-empty groups run; non-path args (`-t <name>`, flags) pass through to both;
 * exit is non-zero when either runner fails OR any given path collected no passed/failed test
 * ("No test files found" and an all-filtered file are failures, never a silent pass).
 * Output: the dot reporter keeps each runner's output short, so BOTH runner summaries
 * ("Test Files N passed (N)") stay inside the 4000-char evidence tail that
 * `lore verify` sums for its completeness check (a verbose per-test list pushed the first summary out: 1 of 3).
 * Side-effect class: IO (spawns vitest, writes a JSON report under a per-invocation temp dir, removed after judging).
 *
 * Exit codes: 0 every path collected tests and every runner passed; 1 a runner failed or a path
 * collected nothing; 2 usage error (no test path given).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { NODE_PROJECT_FILES } from "../vitest.node-files.js";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const TEST_PATH_RE = /\.(?:bun\.)?test\.tsx?$/;

export type Runner = "bun" | "node";
export interface Group {
  readonly runner: Runner;
  readonly files: readonly string[];
  readonly argv: readonly string[]; // after `bunx`
}

/** Pure. Splits CLI args into test paths and pass-through args. */
export function splitArgs(args: readonly string[]): { paths: string[]; passthrough: string[] } {
  const paths: string[] = [];
  const passthrough: string[] = [];
  for (const a of args) (TEST_PATH_RE.test(a) ? paths : passthrough).push(a);
  return { paths: paths.map((p) => p.replace(/^\.\//, "")), passthrough };
}

/** Pure. Bun-project vs Node-project files, by the one Node list. */
export function splitByRunner(paths: readonly string[], nodeFiles: ReadonlySet<string>): { bun: string[]; node: string[] } {
  return { bun: paths.filter((p) => !nodeFiles.has(p)), node: paths.filter((p) => nodeFiles.has(p)) };
}

/** Pure. The runner invocations for the non-empty groups. `reportFile(runner)` names each JSON report. */
export function planGroups(
  paths: readonly string[],
  passthrough: readonly string[],
  nodeFiles: ReadonlySet<string>,
  reportFile: (r: Runner) => string,
  outcomeReporter?: string,
): Group[] {
  const { bun, node } = splitByRunner(paths, nodeFiles);
  // reason: BR-1533 — when a caller asked for per-file outcomes (TEST_FILE_OUTCOME_DIR), vitest also runs the outcome reporter that records each
  // file's errors; the review runner reads them to tell a timeout from an assertion. The default output is unchanged.
  const report = (r: Runner): string[] => [
    "--reporter=dot",
    "--reporter=json",
    `--outputFile.json=${reportFile(r)}`,
    ...(outcomeReporter === undefined ? [] : [`--reporter=${outcomeReporter}`]),
  ];
  const groups: Group[] = [];
  if (bun.length > 0) groups.push({ runner: "bun", files: bun, argv: ["--bun", "vitest", "run", ...report("bun"), ...passthrough, ...bun] });
  if (node.length > 0) {
    groups.push({ runner: "node", files: node, argv: ["vitest", "run", "--config", "vitest.node.config.ts", ...report("node"), ...passthrough, ...node] });
  }
  return groups;
}

const ReportSchema = z.object({
  testResults: z.array(z.object({ name: z.string(), assertionResults: z.array(z.object({ status: z.string() })) })),
});

/** Pure. Paths with no passed/failed test in the report (absent, or every test skipped/filtered). */
export function judgeCollected(files: readonly string[], reportJson: string | null, root: string): string[] {
  if (reportJson === null) return [...files];
  let json: unknown;
  try {
    json = JSON.parse(reportJson);
  } catch {
    return [...files];
  }
  const parsed = ReportSchema.safeParse(json);
  if (!parsed.success) return [...files];
  const ran = new Set<string>();
  for (const r of parsed.data.testResults) {
    if (r.assertionResults.some((a) => a.status === "passed" || a.status === "failed")) ran.add(relative(root, resolve(root, r.name)));
  }
  return files.filter((f) => !ran.has(f));
}

export interface RunResult {
  readonly exit: number;
  readonly report: string | null;
}
export type GroupRunner = (group: Group, reportFile: string) => RunResult;

function spawnGroup(group: Group, reportFile: string): RunResult {
  const r = spawnSync("bunx", [...group.argv], { cwd: REPO_ROOT, stdio: "inherit" });
  let report: string | null = null;
  try {
    report = readFileSync(reportFile, "utf8");
  } catch {
    report = null;
  }
  return { exit: r.status ?? 1, report };
}

/** IO. Returns the exit code; never calls `process.exit`. */
export function main(
  args: readonly string[],
  run: GroupRunner = spawnGroup,
  nodeFiles: ReadonlySet<string> = new Set(Object.keys(NODE_PROJECT_FILES)),
  root: string = REPO_ROOT,
): number {
  const { paths, passthrough } = splitArgs(args);
  if (paths.length === 0) {
    console.error("test:file: FAIL — no test file path given (usage: bun run test:file <path.test.ts...> [-t <name>])");
    return 2;
  }
  // Per-invocation directory: concurrent sessions share one node_modules, so a fixed report path let one run judge another's report.
  const reportDir = mkdtempSync(join(tmpdir(), "lore-test-file-"));
  const reportFile = (r: Runner): string => join(reportDir, `${r}.json`);
  let code = 0;
  try {
    const outcomeDir = process.env["TEST_FILE_OUTCOME_DIR"];
    const outcomeReporter = outcomeDir === undefined || outcomeDir === "" ? undefined : join(REPO_ROOT, "scripts", "test-outcome-reporter.ts");
    for (const g of planGroups(paths, passthrough, nodeFiles, reportFile, outcomeReporter)) {
      const res = run(g, reportFile(g.runner));
      const empty = judgeCollected(g.files, res.report, root);
      console.log(`test:file: ${g.runner} runner exit ${res.exit}; ${g.files.length - empty.length}/${g.files.length} path(s) collected tests`);
      if (res.exit !== 0) code = 1;
      for (const f of empty) {
        console.log(`test:file: FAIL — ${f} collected no tests under the ${g.runner} runner (no such file, filtered to nothing, or wrong runner)`);
        code = 1;
      }
    }
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
  return code;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
