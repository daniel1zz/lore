#!/usr/bin/env bun
/**
 * Test-file census (task-skill-implement-tg-23; AC-TG-10 groundwork, cites AS-17: a completeness
 * check never reports complete over what it could not see).
 *
 * Purpose: prove "files on disk == files run" for the one-runner suite: every `*.test.ts(x)` file
 * in the repository ran exactly once, across the Bun-runtime invocation and the Node invocation
 * (vitest.node-files.ts), and nothing ran that is not on disk.
 * Public surface: `evaluateCensus` (pure), `findTestFilesOnDisk` (IO), `readReportedFiles` (IO),
 * `main` (IO, returns the exit code).
 * Invariants: a file is "run" when it appears in a vitest JSON report's `testResults` (whatever its
 * outcome — pass/fail is the runner's exit code, this check owns completeness only); an empty
 * report or zero files on disk is an error, never a pass.
 * Side-effect class: IO (walks the tree, reads report files).
 *
 * Findings (printed as `rule=<name>`):
 *   - `on-disk-not-run`   a test file on disk that neither invocation ran (a dropped file);
 *   - `run-twice`         a file both invocations (or one invocation twice) ran;
 *   - `run-not-on-disk`   a report names a file that is not on disk (stale or wrong root);
 *   - `node-list-missing` vitest.node-files.ts lists a file that does not exist;
 *   - `node-list-ran-under-bun` a Node-listed file appeared in the Bun report (or a non-listed file in the Node report).
 *
 * Usage: bun scripts/check-test-file-census.ts <bun-report.json> <node-report.json>
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { NODE_PROJECT_FILES } from "../vitest.node-files";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".git", ".claude", "dist", ".lore", ".scratch", ".vite", "test-results", "playwright-report"]);
const TEST_FILE_RE = /\.test\.tsx?$/;

export type CensusRule = "on-disk-not-run" | "run-twice" | "run-not-on-disk" | "node-list-missing" | "node-list-ran-under-bun";

export interface CensusFinding {
  readonly rule: CensusRule;
  readonly path: string;
}

export interface CensusReport {
  readonly onDisk: number;
  readonly ranUnderBun: number;
  readonly ranUnderNode: number;
  readonly findings: readonly CensusFinding[];
}

/** Pure census. All paths are repo-relative posix paths. */
export function evaluateCensus(
  onDisk: readonly string[],
  bunRan: readonly string[],
  nodeRan: readonly string[],
  nodeListed: readonly string[],
): CensusReport {
  const findings: CensusFinding[] = [];
  const disk = new Set(onDisk);
  const listed = new Set(nodeListed);
  const counts = new Map<string, number>();
  for (const f of [...bunRan, ...nodeRan]) counts.set(f, (counts.get(f) ?? 0) + 1);

  for (const f of listed) if (!disk.has(f)) findings.push({ rule: "node-list-missing", path: f });
  for (const f of bunRan) if (listed.has(f)) findings.push({ rule: "node-list-ran-under-bun", path: f });
  for (const f of nodeRan) if (!listed.has(f)) findings.push({ rule: "node-list-ran-under-bun", path: f });
  for (const f of disk) if (!counts.has(f)) findings.push({ rule: "on-disk-not-run", path: f });
  for (const [f, n] of counts) {
    if (n > 1) findings.push({ rule: "run-twice", path: f });
    if (!disk.has(f)) findings.push({ rule: "run-not-on-disk", path: f });
  }
  return { onDisk: disk.size, ranUnderBun: new Set(bunRan).size, ranUnderNode: new Set(nodeRan).size, findings };
}

/** Every `*.test.ts(x)` file under `root`, repo-relative posix, skipping vendored and generated trees. */
export function findTestFilesOnDisk(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name));
      } else if (e.isFile() && TEST_FILE_RE.test(e.name)) {
        out.push(relative(root, join(dir, e.name)).split(sep).join("/"));
      }
    }
  };
  walk(root);
  return out.sort();
}

export class CensusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CensusError";
  }
}

/** The repo-relative files a vitest `--reporter=json` report ran. Throws on an unreadable, malformed or empty report. */
export function readReportedFiles(reportPath: string, root: string): string[] {
  let parsed: { testResults?: Array<{ name?: unknown }> };
  try {
    parsed = JSON.parse(readFileSync(reportPath, "utf8")) as typeof parsed;
  } catch (e) {
    throw new CensusError(`cannot read vitest report ${reportPath}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(parsed.testResults)) throw new CensusError(`${reportPath} has no testResults array`);
  const names = parsed.testResults.map((r) => r.name);
  if (names.some((n) => typeof n !== "string")) throw new CensusError(`${reportPath} has a testResults entry with no file name`);
  return (names as string[]).map((n) => relative(root, n).split(sep).join("/"));
}

export function main(argv: readonly string[], root: string = REPO_ROOT): number {
  const [bunReport, nodeReport] = argv;
  if (bunReport === undefined || nodeReport === undefined) {
    console.error("usage: check-test-file-census.ts <bun-report.json> <node-report.json>");
    return 2;
  }
  const onDisk = findTestFilesOnDisk(root);
  const bunRan = readReportedFiles(bunReport, root);
  const nodeRan = readReportedFiles(nodeReport, root);
  if (onDisk.length === 0 || bunRan.length === 0) {
    console.log("check-test-file-census: FAIL — nothing scanned (0 test files on disk or 0 run under Bun); refusing to report complete (AS-17).");
    return 1;
  }
  const report = evaluateCensus(onDisk, bunRan, nodeRan, Object.keys(NODE_PROJECT_FILES));
  console.log(
    `check-test-file-census: ${report.onDisk} test file(s) on disk; ${report.ranUnderBun} ran under Bun + ${report.ranUnderNode} ran under Node = ${report.ranUnderBun + report.ranUnderNode} run.`,
  );
  if (report.findings.length === 0) {
    console.log("check-test-file-census: OK — files on disk == files run, each exactly once.");
    return 0;
  }
  for (const f of report.findings) console.log(`  rule=${f.rule} path=${f.path}`);
  console.log(`check-test-file-census: FAIL — ${report.findings.length} finding(s).`);
  return 1;
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`check-test-file-census: scan failed — ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
