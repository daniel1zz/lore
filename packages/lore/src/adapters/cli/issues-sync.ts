/**
 * `runIssuesSync` — the render + exit-code half of `lore issues --sync [--json]`, the PUSH-ONLY repair
 * (spec-github-owns-issue-report-state-no-mirror-task-work-carries D5, AC-GS-16).
 *
 * `--sync` repairs GitHub from the carriers: it closes every `fixed (close pending)` issue, converges a fixed
 * issue's `resolution:fixed` label, and strips `resolution:*` labels an open issue must not carry. It reads the
 * corpus (the carriers) and writes nothing to it but `issue_close_failed` audit rows.
 *
 * Kept beside `commands/issues.ts` rather than inside it (the vitest-safe sibling split documented in
 * `adapters/cli/CLAUDE.md`): this module imports only the service types and `utils.ts`, so
 * `tests/unit/adapters/issues-sync.test.ts` drives it with a recording fake driver and no `bun:sqlite`.
 *
 * Exit codes: 0 — every repair succeeded, or nothing needed repair; the FAILING call's own kind otherwise
 * (`exitCode(error)`: 8 auth, 9 transport, 10 rate limit, 4 validation, ...) — the first failure in change order
 * decides; 4 when no GitHub closer is configured; a store fault maps through `exitCode`.
 *
 * ⛔ `clean` is printed only on a path that already holds a COMPLETE listing: the caller fetches the listing
 * first and a failed listing exits before this module runs, so an empty plan can never mean "could not look".
 *
 * Side-effect class: IO (stdout / stderr, and GitHub writes through the driver's closer).
 */

import type { IssueCloseOnArchive, IssueSyncListing, IssueSyncOutcome } from "../../service/issue-close-on-archive.js";
import { exitCode, formatErrorFor } from "./utils.js";
import type { Invocation } from "@lore/core";
import { printLine } from "./output.js";

/** Minimal shape of the step this module drives — keeps the unit test free of a real store. */
export type IssueSyncDriver = Pick<IssueCloseOnArchive, "applySync">;

/**
 * @param inv - the command's Invocation (the error line names its exact retry command)
 * @param driver - the App's post-archive step (`app.issueClose`)
 * @param listing - the COMPLETE live listing the caller already fetched
 * @param opts - `json`: machine-readable stdout
 * @returns the process exit code the caller should set
 */
export async function runIssuesSync(
  inv: Invocation,
  driver: IssueSyncDriver | undefined,
  listing: IssueSyncListing,
  opts: { json: boolean },
): Promise<number> {
  if (driver === undefined) {
    inv.io.stderr.write("Error: this App has no issue-sync step wired.\n");
    return 1;
  }
  const outcome: IssueSyncOutcome = await driver.applySync(listing);

  if (outcome.kind === "not_configured") {
    inv.io.stderr.write("Error: GitHub not configured — set feedback.upstream.repo in .lore/config.yaml, then re-run\n");
    return 4;
  }
  if (outcome.kind === "store_error") {
    inv.io.stderr.write(formatErrorFor(inv, outcome.error) + "\n");
    return exitCode(outcome.error);
  }

  const applied = outcome.applied ?? [];
  const firstFailure = applied.find((entry) => entry.failure !== undefined)?.failure;

  if (opts.json) {
    printLine(inv.io.stdout,  // CLI surface
      JSON.stringify(
        {
          ok: firstFailure === undefined,
          data: {
            clean: outcome.plan.changes.length === 0,
            changes: outcome.plan.changes,
            applied: applied.map((entry) => ({
              number: entry.number,
              action: entry.action,
              lines: entry.lines,
              ...(entry.failure !== undefined ? { failed: true } : {}),
            })),
          },
        },
        null,
        2,
      ),
    );
    return firstFailure === undefined ? 0 : exitCode(firstFailure);
  }

  if (outcome.plan.changes.length === 0) {
    printLine(inv.io.stdout, "sync: clean — the complete listing showed nothing to repair."); // CLI surface
    return 0;
  }
  printLine(inv.io.stdout, `sync: ${outcome.plan.changes.length} issue(s) repaired or attempted:`); // CLI surface
  for (const entry of applied) {
    for (const line of entry.lines) {
      if (entry.failure === undefined) printLine(inv.io.stdout, `  ${line}`); // CLI surface
      else inv.io.stderr.write(`  ${line}\n`);
    }
  }
  if (firstFailure !== undefined) {
    inv.io.stderr.write(formatErrorFor(inv, firstFailure) + "\n");
    return exitCode(firstFailure);
  }
  return 0;
}
