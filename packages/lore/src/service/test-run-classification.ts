/**
 * Classifies a review test run of one file as red, green or inconclusive from the test runner's own per-test errors (BR-1533).
 *
 * Purpose: a test or hook timeout says nothing about the file, so it must never be charged to a plan or confirm a transition. The
 *   console text cannot tell a hook timeout from an assertion (both print `FAIL <file>`), so the classification reads the structured
 *   outcome report that `scripts/test-outcome-reporter.ts` writes from vitest's result objects.
 * Public surface: outcomeReportSchema, OutcomeReport, ReportedFile, parseOutcomeReports, findReportedFile, isTimeoutError,
 *   classifyReportedFile, ClassifiedRun, TEST_OUTCOME_DIR_ENV.
 * Invariants:
 *   - Detection rule: an error is a timeout iff its message begins `Test timed out in <n>ms` or `Hook timed out in <n>ms`, vitest's own
 *     runner messages (the error's name is a plain `Error` and the JSON reporter hides the text behind `STACK_TRACE_ERROR`, so neither
 *     is usable; the structured error objects the reporter reads are).
 *   - A failed file is `inconclusive` only when it has at least one error and EVERY error is a timeout; one assertion or import error
 *     makes it `red`; a failed file with no error named is `red` (never inconclusive without proof).
 *   - A file the report does not show as passed or failed is not classified here (`undefined`): the caller makes it inconclusive
 *     `no-report`. There is NO console-text or exit-code fallback anywhere: the console cannot tell a timeout from an assertion (spec D4).
 * Side-effect class: pure.
 *
 * @spec_ref spec-review-test-runs-are-capped-per-machine-and-a-run-that (AC-MC-3, BR-1533)
 */

import { z } from "zod";

/** The environment variable naming the directory the outcome reporter writes into (set by the review runner, read by `scripts/test-file.ts` and the reporter). */
export const TEST_OUTCOME_DIR_ENV = "TEST_FILE_OUTCOME_DIR";

/** One runner's outcome report: the files it ran, each with its state and every error the file or its tests raised. */
export const outcomeReportSchema = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      state: z.enum(["pass", "fail", "other"]),
      errors: z.array(z.object({ name: z.string(), message: z.string() })),
    }),
  ),
});
export type OutcomeReport = z.infer<typeof outcomeReportSchema>;
export type ReportedFile = OutcomeReport["files"][number];

/** What one run of one file amounts to; `inconclusive` always carries its cause. */
export type ClassifiedRun =
  | { readonly classification: "red" }
  | { readonly classification: "green" }
  | { readonly classification: "inconclusive"; readonly inconclusive_cause: "timeout" | "no-report" };

/** A run (or file) with no usable report entry: nothing reliable says how it went, so it decides nothing. */
export const NO_REPORT_RUN: ClassifiedRun = { classification: "inconclusive", inconclusive_cause: "no-report" };

/** A run the invocation's own time limit ended: its unfinished files decide nothing. */
export const TIMED_OUT_RUN: ClassifiedRun = { classification: "inconclusive", inconclusive_cause: "timeout" };

const TIMEOUT_MESSAGE = /^(?:Test|Hook) timed out in \d+ms\b/;

/** Whether one reported error is vitest's test or hook timeout. */
export function isTimeoutError(error: { readonly name: string; readonly message: string }): boolean {
  return TIMEOUT_MESSAGE.test(error.message.trimStart());
}

/**
 * Classifies a file from its reported state and errors.
 *
 * @param file - the file's entry of the outcome report
 * @returns the classification; `undefined` when the report shows the file neither passed nor failed (skipped only): the caller treats that as no report
 */
export function classifyReportedFile(file: ReportedFile): ClassifiedRun | undefined {
  if (file.state === "pass") return { classification: "green" };
  if (file.state !== "fail") return undefined;
  if (file.errors.length > 0 && file.errors.every(isTimeoutError)) return { classification: "inconclusive", inconclusive_cause: "timeout" };
  return { classification: "red" };
}

/**
 * Reads the reports of one invocation (one per runner). Text that does not parse against the schema is skipped and counted.
 *
 * @param texts - the contents of the report files
 * @returns every reported file by absolute path, and how many report texts could not be read
 */
export function parseOutcomeReports(texts: readonly string[]): { readonly files: ReadonlyMap<string, ReportedFile>; readonly unreadable: number } {
  const files = new Map<string, ReportedFile>();
  let unreadable = 0;
  for (const text of texts) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      unreadable += 1;
      continue;
    }
    const parsed = outcomeReportSchema.safeParse(json);
    if (!parsed.success) {
      unreadable += 1;
      continue;
    }
    for (const file of parsed.data.files) files.set(file.path, file);
  }
  return { files, unreadable };
}

/** The reported entry for a repo-relative `file` (the report holds absolute paths): the one whose path ends with `/<file>`. */
export function findReportedFile(reported: ReadonlyMap<string, ReportedFile>, file: string): ReportedFile | undefined {
  const normalized = file.replace(/^\.\//, "");
  for (const [path, entry] of reported) if (path === normalized || path.endsWith(`/${normalized}`)) return entry;
  return undefined;
}
