/**
 * A vitest reporter that writes each test file's state and every error it raised, as JSON, into `$TEST_FILE_OUTCOME_DIR`.
 *
 * Purpose: let `lore assess` tell a test or hook timeout from an assertion failure (BR-1533). vitest's own JSON reporter hides a
 *   timeout's message behind `STACK_TRACE_ERROR`; the result objects this reporter reads still carry it.
 * Public surface: default export `TestOutcomeReporter` (vitest `--reporter=<this file>`), `collectFileOutcome`.
 * Invariants: writes nothing when the env var is unset; one file `outcome-<pid>.json` per vitest process; the shape is
 *   `outcomeReportSchema` in packages/lore/src/service/test-run-classification.ts (which also decides what the errors mean).
 *   A run killed before it finishes writes nothing, and the reader then has no report for the file.
 * Side-effect class: IO (one file write at the end of a run).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunnerTask, RunnerTestFile } from "vitest";

interface ReportedError {
  readonly name: string;
  readonly message: string;
}

export interface FileOutcome {
  readonly path: string;
  readonly state: "pass" | "fail" | "other";
  readonly errors: readonly ReportedError[];
}

function collectErrors(task: RunnerTask, into: ReportedError[]): void {
  for (const error of task.result?.errors ?? []) into.push({ name: String(error.name ?? "Error"), message: String(error.message ?? "") });
  if (task.type === "suite") for (const child of task.tasks) collectErrors(child, into);
}

/** The state and every error of one finished test file (its own hook errors and those of every suite and test below it). */
export function collectFileOutcome(file: RunnerTestFile): FileOutcome {
  const errors: ReportedError[] = [];
  collectErrors(file, errors);
  const state = file.result?.state;
  return { path: file.filepath, state: state === "pass" ? "pass" : state === "fail" ? "fail" : "other", errors };
}

export default class TestOutcomeReporter {
  onFinished(files: readonly RunnerTestFile[] = []): void {
    const dir = process.env["TEST_FILE_OUTCOME_DIR"];
    if (dir === undefined || dir === "") return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `outcome-${String(process.pid)}.json`), JSON.stringify({ files: files.map(collectFileOutcome) }));
  }
}
