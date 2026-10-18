/**
 * `runIssuesSync` — the render + exit-code half of `lore issues --sync [--apply] [--json]`
 * (spec-archiving-the-work-that-resolves-a-defect-report-closes D3, Public Interface).
 *
 * Kept beside `commands/issues.ts` rather than inside it (the vitest-safe sibling split documented in
 * `adapters/cli/CLAUDE.md`): this module imports only the service types and `utils.ts`, so
 * `tests/unit/adapters/issues-sync.test.ts` drives it with a recording fake closer and no `bun:sqlite`.
 *
 * Exit codes: 0 — no drift, or every apply succeeded (and without `--apply`, always 0 once the drift was
 * read); 1 — any apply failed, any report's GitHub state could not be read, or no GitHub closer is
 * configured; a store fault maps through `exitCode`. Without `--apply` nothing is written.
 *
 * Side-effect class: IO (stdout / stderr, and `--apply` writes through the step's closer).
 */

import type { IssueCloseOnArchive, IssueSyncOutcome } from "../../service/issue-close-on-archive.js";
import { exitCode, formatErrorFor } from "./utils.js";
import type { Invocation } from "@lore/core";

/** Minimal shape of the step this module drives — keeps the unit test free of a real store. */
export type IssueSyncDriver = Pick<IssueCloseOnArchive, "planSync" | "applySync">;

/**
 * @param inv - the command's Invocation (the error line names its exact retry command)
 * @param driver - the App's post-archive step (`app.issueClose`)
 * @param opts - `apply`: repair drift (otherwise report only); `json`: machine-readable stdout
 * @returns the process exit code the caller should set
 */
export async function runIssuesSync(
  inv: Invocation,
  driver: IssueSyncDriver | undefined,
  opts: { apply: boolean; json: boolean },
): Promise<number> {
  if (driver === undefined) {
    process.stderr.write("Error: this App has no issue-sync step wired.\n");
    return 1;
  }
  const outcome: IssueSyncOutcome = opts.apply ? await driver.applySync() : await driver.planSync();

  if (outcome.kind === "not_configured") {
    process.stderr.write("Error: GitHub not configured — set feedback.upstream.repo in .lore/config.yaml, then re-run\n");
    return 1;
  }
  if (outcome.kind === "store_error") {
    process.stderr.write(formatErrorFor(inv, outcome.error) + "\n");
    return exitCode(outcome.error);
  }

  const { plan, applied } = outcome;
  const applyFailed = (applied ?? []).some((entry) => entry.error !== undefined);
  const failed = applyFailed || plan.unreadable.length > 0;

  if (opts.json) {
    console.log( // CLI surface
      JSON.stringify(
        {
          ok: !failed,
          data: {
            drift: plan.drift,
            ...(applied !== undefined ? { applied } : {}),
            ...(plan.unreadable.length > 0 ? { unreadable: plan.unreadable } : {}),
          },
        },
        null,
        2,
      ),
    );
    return failed ? 1 : 0;
  }

  if (plan.drift.length === 0 && plan.unreadable.length === 0) {
    console.log("sync: clean — no GitHub issue drift found."); // CLI surface
    return 0;
  }
  if (plan.drift.length > 0) {
    console.log(`sync: ${plan.drift.length} issue(s) drifted${applied === undefined ? " (run with --apply to repair)" : ""}:`); // CLI surface
    for (const entry of plan.drift) {
      const facts = [`${entry.computed}`, `github ${entry.github_state}`, entry.missing_label ? "label missing" : "label ok"];
      console.log(`  #${entry.number} ${entry.slug} — ${facts.join(", ")}`); // CLI surface
    }
  }
  for (const entry of applied ?? []) {
    if (entry.error === undefined) {
      console.log(`  #${entry.number}: repaired (closed=${entry.closed}, labelled=${entry.labelled})`); // CLI surface
    } else {
      process.stderr.write(`  #${entry.number}: repair FAILED — ${entry.error}\n`);
    }
  }
  for (const entry of plan.unreadable) {
    process.stderr.write(`  #${entry.number} ${entry.slug}: could not read GitHub state — ${entry.error}\n`);
  }
  return failed ? 1 : 0;
}
