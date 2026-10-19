/**
 * `resolveIssueCarrierRefs` — turns `lore create plan|task --issue <n>` values into the
 * `extra.issues` carrier refs `[{repo_id, number}]`, BEFORE anything is written
 * (spec-github-owns-issue-report-state-no-mirror-task-work-carries D1, BR-1083).
 *
 * Rules:
 *   - only a plan or a task is an issue carrier; any other type is refused (specs are not carriers);
 *   - each value is a positive integer;
 *   - the configured `feedback.upstream` repository must be GitHub-shaped; its LIVE listing is read once
 *     (`resolveGithubIssueListing`) and every number must be present in it;
 *   - the ref is written with that repository's numeric `repo_id` (never the repository name).
 * Every refusal is a `VALIDATION_ERROR` (exit 4) and the caller writes nothing. A number named twice is
 * passed through twice on purpose: `CorpusService` refuses a duplicate ref, the one place that rule lives.
 *
 * Side-effect class: IO (the GitHub listing through `gh`); writes nothing.
 */

import { err, ok } from "@lore/core";
import type { DocType, Invocation, IssueRef, LoreConfig, LoreError, Result } from "@lore/core";

import { classifyFeedbackUpstream, resolveGithubIssueListing } from "./report-issue-wiring.js";

function refusal(message: string, value: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field: "issue", message, value };
}

/**
 * @param inv - the run's invocation (cwd, env, io)
 * @param config - the parsed corpus config (carries `feedback.upstream`)
 * @param docType - the type of the document being created
 * @param tokens - the raw `--issue` values, in command-line order
 * @returns the carrier refs in command-line order, or the first refusal (VALIDATION_ERROR, or the listing's own error kind)
 */
export async function resolveIssueCarrierRefs(
  inv: Invocation,
  config: LoreConfig | undefined,
  docType: DocType,
  tokens: readonly string[],
): Promise<Result<IssueRef[], LoreError>> {
  if (docType !== "task" && docType !== "plan") {
    return err(refusal(`--issue is valid for a plan or task only; a ${docType} is not an issue carrier`, docType));
  }

  const numbers: number[] = [];
  for (const rawToken of tokens) {
    const token = rawToken.trim();
    if (!/^[1-9]\d*$/.test(token)) {
      return err(refusal(`--issue ${JSON.stringify(rawToken)} is not a positive issue number`, rawToken));
    }
    numbers.push(Number(token));
  }

  const classification = classifyFeedbackUpstream(config);
  if (classification.kind === "retired") return err(classification.error);
  if (classification.kind !== "github") {
    return err(
      refusal("--issue needs the GitHub repository the issues live in: set feedback.upstream.repo in .lore/config.yaml", numbers),
    );
  }

  const listed = await resolveGithubIssueListing(inv.io, classification.cfg, inv);
  if (!listed.ok) return listed;
  const present = new Set(listed.value.issues.map((issue) => issue.number));

  const refs: IssueRef[] = [];
  for (const number of numbers) {
    if (!present.has(number)) {
      return err(
        refusal(`--issue ${number}: no issue #${number} in ${classification.cfg.repo}'s live listing; nothing was created`, number),
      );
    }
    refs.push({ repo_id: listed.value.repoId, number });
  }
  return ok(refs);
}
