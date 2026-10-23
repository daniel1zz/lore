/**
 * `lore assess --file-issues`: one GitHub issue per failed dimension, linked to the plan, in one batched call
 * (BR-1372, spec-lean-governance-batch-verbs-judgment-only-at-milestones Part D "Accepted with known defects").
 *
 * Purpose: turn a failed review into the issues plan close accepts as known defects. Each issue is filed through the
 *   existing report-issue path (`fileGithubIssue`, which also mints the corpus issue task) and then linked to the plan
 *   with the existing `resolves` link, so plan close finds it through the same carrier as any `--resolves` issue.
 * Public surface: FailedDimensionFinding, FiledIssue, fileDimensionIssues, dimensionIssueTitle.
 * Invariants:
 *   - Title is `<plan slug>: <dimension>` (plan close matches an open linked issue to a failed dimension by the
 *     dimension id in its title); body carries the dimension's reason and reference.
 *   - One issue per failed dimension per plan; a title already filed is recognised by the receipt log (no duplicate on a
 *     re-run) and still linked.
 *   - A filing or link failure is returned, never swallowed; issues filed before it stay filed and are reported.
 * Side-effect class: IO (GitHub through `fileGithubIssue`, corpus link writes).
 *
 * Reference: merging with follow-up issues on GitHub.
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D, AC-LG-12, BR-1372)
 */

import { err, ok, type LoreError, type MilestoneDimension, type Result } from "@lore/core";
import type { CorpusService } from "../../service/corpus-service.js";
import { hasIssueReport } from "../../service/issue-resolution.js";
import { readGithubIssueRef } from "../../service/resolution-projector.js";
import { fileGithubIssue, type GithubFilingContext, type GithubUpstreamCfg } from "./report-issue-wiring.js";

/** One failed dimension of one plan's review, with the judge's finding. */
export interface FailedDimensionFinding {
  readonly plan: string;
  readonly dimension: MilestoneDimension;
  readonly reason: string;
  readonly reference: string;
  readonly reviewSlug: string;
}

/** One filed (or recognised) and linked issue. */
export interface FiledIssue {
  readonly plan: string;
  readonly dimension: MilestoneDimension;
  readonly number: number;
  readonly url: string;
  readonly retried: boolean;
}

/** The issue title for a plan's failed dimension. */
export function dimensionIssueTitle(plan: string, dimension: MilestoneDimension): string {
  return `${plan}: ${dimension}`;
}

/**
 * Files and links one issue per finding.
 *
 * @param findings - every failed dimension of the batch
 * @param cfg - the GitHub `feedback.upstream`
 * @param ctx - filing context of the caller
 * @param corpusService - the corpus the issue tasks live in and the links are written to
 * @param actor - the filing actor
 * @returns every filed issue, or the first error (issues filed before it are named in the message)
 */
export async function fileDimensionIssues(
  findings: readonly FailedDimensionFinding[],
  cfg: GithubUpstreamCfg,
  ctx: GithubFilingContext,
  corpusService: CorpusService,
  actor: string,
): Promise<Result<FiledIssue[], LoreError>> {
  const filed: FiledIssue[] = [];
  for (const finding of findings) {
    const result = await fileGithubIssue(
      {
        title: dimensionIssueTitle(finding.plan, finding.dimension),
        description:
          `The milestone review ${finding.reviewSlug} of plan ${finding.plan} failed the ${finding.dimension} dimension.\n\n` +
          `Finding: ${finding.reason}\nReference: ${finding.reference.length > 0 ? finding.reference : "(none)"}`,
        expected: `The ${finding.dimension} dimension of plan ${finding.plan} passes its milestone review.`,
        actual: finding.reason,
        repro_command: `lore assess ${finding.plan}`,
        severity: "medium",
        category: "milestone-review",
        tags: ["milestone-review", finding.dimension],
      },
      cfg,
      ctx,
    );
    if (!result.ok) return err(withFiled(result.error, filed));
    const linked = await linkIssueToPlan(corpusService, finding.plan, result.value.number, cfg.repo, actor);
    if (!linked.ok) return err(withFiled(linked.error, filed));
    filed.push({ plan: finding.plan, dimension: finding.dimension, number: result.value.number, url: result.value.url, retried: result.value.retried });
  }
  return ok(filed);
}

function withFiled(error: LoreError, filed: readonly FiledIssue[]): LoreError {
  if (filed.length === 0) return error;
  const done = filed.map((f) => `#${String(f.number)} (${f.plan}: ${f.dimension})`).join(", ");
  const message = "message" in error && typeof error.message === "string" ? error.message : error.code;
  return { code: "VALIDATION_ERROR", field: "file-issues", message: `${message} — already filed and linked: ${done}`, rule: "BR-1372" };
}

async function linkIssueToPlan(
  corpusService: CorpusService,
  planRef: string,
  issueNumber: number,
  repo: string,
  actor: string,
): Promise<Result<void, LoreError>> {
  const bundle = await corpusService.getPlanBundle(planRef);
  if (!bundle.ok) return bundle;
  const tasks = await corpusService.listFull({ type: "task" });
  if (!tasks.ok) return tasks;
  const issueTask = tasks.value.docs.find((doc) => {
    if (!hasIssueReport(doc.extra)) return false;
    const ref = readGithubIssueRef(doc.extra);
    return ref !== undefined && ref.issueNumber === issueNumber && ref.repo === repo;
  });
  if (issueTask === undefined) {
    return err({
      code: "VALIDATION_ERROR",
      field: "file-issues",
      message: `issue #${String(issueNumber)} was filed but no corpus issue task carries it, so it cannot be linked to plan ${planRef}; run \`lore issue adopt ${String(issueNumber)}\` then \`lore link ${planRef} <task> --type resolves\``,
      rule: "BR-1372",
    });
  }
  const linked = await corpusService.link(bundle.value.plan.id, issueTask.id, "resolves", { by: actor });
  if (!linked.ok && linked.error.code !== "DUPLICATE_LINK") return linked;
  return ok(undefined);
}
