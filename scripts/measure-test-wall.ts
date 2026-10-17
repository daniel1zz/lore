#!/usr/bin/env bun
/**
 * Wall-time measurement of the full one-runner test run (task-skill-implement-tg-15, AC-TG-11).
 *
 * Purpose: run the same full suite `bun run test:vitest` runs (build once, vitest on the Bun runtime,
 * vitest on Node for vitest.node-files.ts, census), print the measured seconds, the worker count, the
 * number of test files run and the machine (os, arch, cpu count), and fail when the run is too slow
 * or incomplete. Cites AS-17: a fast run that skipped files is not a measurement, so files run below
 * files on disk is a failure however quick it was.
 * Public surface: `parseMaxSeconds`, `evaluateMeasurement` (pure), `main` (IO, returns the exit code).
 * Exit codes: 0 within the limit, complete, suite green; 1 over the limit, OR files run < test files
 * on disk, OR the suite itself exited non-zero (the limit is for a green run); 2 usage error.
 * Reuses scripts/check-test-file-census.ts for "files on disk" and "files in a report" (no second census).
 * Side-effect class: IO (runs the whole suite; reports go to a throwaway temp dir).
 *
 * Usage: bun scripts/measure-test-wall.ts --max-seconds <N>
 */
import { mkdtempSync, rmSync } from "node:fs";
import { arch, cpus, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findTestFilesOnDisk, readReportedFiles } from "./check-test-file-census";
import { runSuite, suiteExit, type SuiteOutcome } from "./run-tests";
import { resolveMaxWorkers } from "./test-max-workers";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");

export interface Measurement {
  readonly seconds: number;
  readonly workers: number;
  readonly filesRun: number;
  readonly filesOnDisk: number;
  readonly suiteExit: number;
  readonly machine: string;
}

export type FailureReason = "over-limit" | "files-run-below-files-on-disk" | "suite-failed";

/** Pure verdict: every failing reason, in a fixed order; empty means the measurement passes. */
export function evaluateMeasurement(m: Measurement, maxSeconds: number): FailureReason[] {
  const reasons: FailureReason[] = [];
  if (m.seconds > maxSeconds) reasons.push("over-limit");
  if (m.filesRun < m.filesOnDisk) reasons.push("files-run-below-files-on-disk");
  if (m.suiteExit !== 0) reasons.push("suite-failed");
  return reasons;
}

export function parseMaxSeconds(argv: readonly string[]): number {
  const i = argv.indexOf("--max-seconds");
  const raw = i === -1 ? undefined : argv[i + 1];
  if (raw === undefined || !/^\d+(\.\d+)?$/.test(raw) || Number(raw) <= 0) {
    throw new Error("usage: measure-test-wall.ts --max-seconds <positive number>");
  }
  return Number(raw);
}

export function describeMachine(): string {
  const c = cpus();
  return `os=${platform()} arch=${arch()} cpus=${c.length}${c[0] === undefined ? "" : ` (${c[0].model})`}`;
}

/** Dependencies of `main`, injectable so the exit-code logic is testable without running the suite. */
export interface MeasureDeps {
  readonly runSuite: (reportDir: string) => SuiteOutcome;
  readonly filesOnDisk: () => readonly string[];
  readonly filesInReport: (reportPath: string) => readonly string[];
  readonly now: () => number;
  readonly machine: () => string;
  readonly workers: () => number;
}

export const REAL_DEPS: MeasureDeps = {
  runSuite: (dir) => runSuite(dir),
  filesOnDisk: () => findTestFilesOnDisk(ROOT),
  filesInReport: (p) => readReportedFiles(p, ROOT),
  now: () => Date.now(),
  machine: describeMachine,
  workers: () => resolveMaxWorkers(process.env),
};

export function main(argv: readonly string[], deps: MeasureDeps = REAL_DEPS): number {
  let maxSeconds: number;
  try {
    maxSeconds = parseMaxSeconds(argv);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const dir = mkdtempSync(join(tmpdir(), "lore-measure-wall-"));
  try {
    const t0 = deps.now();
    const outcome = deps.runSuite(dir);
    const seconds = (deps.now() - t0) / 1000;
    const ran = [...deps.filesInReport(outcome.bunReport), ...deps.filesInReport(outcome.nodeReport)];
    const m: Measurement = {
      seconds,
      workers: deps.workers(),
      filesRun: new Set(ran).size,
      filesOnDisk: new Set(deps.filesOnDisk()).size,
      suiteExit: suiteExit(outcome),
      machine: deps.machine(),
    };
    const reasons = evaluateMeasurement(m, maxSeconds);
    console.log(
      `\nmeasure-test-wall: ${m.seconds.toFixed(1)} s wall (limit ${maxSeconds} s); workers=${m.workers}; ` +
        `files run=${m.filesRun} of ${m.filesOnDisk} on disk; suite exit=${m.suiteExit}; machine: ${m.machine}`,
    );
    if (reasons.length === 0) {
      console.log("measure-test-wall: PASS — within the limit, every test file ran, suite green.");
      return 0;
    }
    console.log(`measure-test-wall: FAIL — ${reasons.join(", ")}`);
    return 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`measure-test-wall: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}
