/**
 * `resolveResolvesTargets` — resolves `lore create spec|plan|task --resolves <n|task-gh-…>` tokens to
 * the filed defect reports they name, BEFORE anything is written
 * (spec-archiving-the-work-that-resolves-a-defect-report-closes D5, BR-1083).
 *
 * Accepted token forms:
 *   - a bare issue number `n` — matched against the GitHub number each filed report carries
 *     (`extra.issue_report.github.number`). That is the SAME report `lore issue adopt <n>` names by its
 *     deterministic slug `task-gh-<repo_id>-<n>`, found WITHOUT a network call (the slug's `repo_id` is
 *     stored on the report, so the local match and the slug rule cannot disagree);
 *   - a document slug or id (the `task-gh-…` form).
 *
 * Every named target must be a task carrying `extra.issue_report`; ANY failure refuses the whole
 * creation (the caller maps `VALIDATION_ERROR` to exit 4 and writes nothing). A target named twice
 * (e.g. once by number, once by slug) is returned once.
 *
 * Vitest-safe sibling of `commands/create.ts` (see `adapters/cli/CLAUDE.md`): imports only service types.
 *
 * Side-effect class: IO (one store read through the injected corpus port); writes nothing.
 */

import { err, ok } from "@lore/core";
import type { DocRecord, LoreError, Result } from "@lore/core";

import { hasIssueReport } from "../../service/issue-resolution.js";
import { readGithubIssueRef } from "../../service/resolution-projector.js";

/** The one read this resolver needs from `CorpusService`. */
export interface ResolvesCorpusReader {
  listFull(filters: { type: "task" }): Promise<Result<{ docs: DocRecord[]; total: number }, LoreError>>;
}

/** One resolved report. */
export interface ResolvesTarget {
  readonly id: string;
  readonly slug: string;
}

function refusal(message: string, value: string): LoreError {
  return { code: "VALIDATION_ERROR", field: "resolves", message, value };
}

/**
 * @param corpus - read access to the task listing
 * @param tokens - the raw `--resolves` values, in command-line order
 * @returns the distinct reports in first-seen order, or the first refusal
 */
export async function resolveResolvesTargets(
  corpus: ResolvesCorpusReader,
  tokens: readonly string[],
): Promise<Result<ResolvesTarget[], LoreError>> {
  const listed = await corpus.listFull({ type: "task" });
  if (!listed.ok) return listed;
  const reports = listed.value.docs.filter((doc) => hasIssueReport(doc.extra));

  const targets: ResolvesTarget[] = [];
  for (const rawToken of tokens) {
    const token = rawToken.trim();
    if (token === "") return err(refusal("--resolves received an empty value", rawToken));

    let match: DocRecord | undefined;
    if (/^\d+$/.test(token)) {
      const number = Number(token);
      const candidates = reports.filter((doc) => readGithubIssueRef(doc.extra)?.issueNumber === number);
      if (candidates.length === 0) {
        return err(
          refusal(
            `--resolves ${token}: no filed defect report carries GitHub issue #${token} — adopt it first with \`lore issue adopt ${token}\``,
            token,
          ),
        );
      }
      if (candidates.length > 1) {
        return err(
          refusal(
            `--resolves ${token} is ambiguous (${candidates.map((doc) => doc.slug).join(", ")}) — name the report by slug`,
            token,
          ),
        );
      }
      match = candidates[0];
    } else {
      match = reports.find((doc) => doc.slug === token || doc.id === token);
      if (match === undefined) {
        const existing = listed.value.docs.find((doc) => doc.slug === token || doc.id === token);
        return err(
          refusal(
            existing === undefined
              ? `--resolves ${token}: does not name a filed defect report (no task with that slug or id carries extra.issue_report)`
              : `--resolves ${token}: ${existing.slug} is not a filed defect report (it carries no extra.issue_report)`,
            token,
          ),
        );
      }
    }
    if (match !== undefined && !targets.some((target) => target.id === match.id)) {
      targets.push({ id: match.id, slug: match.slug });
    }
  }
  return ok(targets);
}
