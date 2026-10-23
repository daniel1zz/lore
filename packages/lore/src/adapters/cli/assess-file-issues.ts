/**
 * The real {@link IssuePort} of the issue filing (BR-1379): GitHub through the report-issue path, the corpus for links.
 * Used by `lore assess --file-issues` and the automatic review batch alike; the grouping is `IssueFilingService`'s.
 *
 * Purpose: file ONE issue per root-cause fingerprint, find an already-open one by the `[fp:<12 hex>]` tag in its
 *   title, and link an issue to a plan with the existing `resolves` link, so plan close finds it through the same
 *   carrier as any `--resolves` issue.
 * Public surface: createGithubIssuePort.
 * Invariants:
 *   - The title is the one `IssueFilingService` built (`<dimension>: <cause> [fp:<12 hex>]`); the full fingerprint is
 *     in the body. `fileGithubIssue` recognises a title already filed through its receipt log (no duplicate on retry).
 *   - A filing or link failure is returned, never swallowed.
 *   - Open issues are read live (`PlanCloseIssuePort.listOpenIssues`), the same reader plan close uses; with none
 *     wired, searching fails loud instead of reading as "no open issue" (that would file duplicates).
 * Side-effect class: IO (GitHub through `fileGithubIssue`, corpus link writes).
 *
 * Reference: Sentry error grouping by fingerprint.
 * @spec_ref spec-plans-close-themselves-level-triggered-reconciliation-of (AC-PCR-4, BR-1379)
 */

import { err, ok, type LoreError, type Result } from "@lore/core";
import type { CorpusService } from "../../service/corpus-service.js";
import { hasIssueReport } from "../../service/issue-resolution.js";
import type { IssuePort, IssueRef } from "../../service/issue-filing-service.js";
import { FINGERPRINT_TITLE_TAG } from "../../service/root-cause-fingerprint.js";
import type { PlanCloseIssuePort } from "../../service/milestone-review-inputs.js";
import { readGithubIssueRef } from "../../service/resolution-projector.js";
import { fileGithubIssue, type GithubFilingContext, type GithubUpstreamCfg } from "./report-issue-wiring.js";

/**
 * Builds the issue port for one run.
 *
 * @param cfg - the GitHub `feedback.upstream`
 * @param ctx - filing context of the caller
 * @param corpusService - the corpus the issue tasks live in and the links are written to
 * @param openIssues - the live open-issue reader (plan close's), absent when none is wired
 */
export function createGithubIssuePort(
  cfg: GithubUpstreamCfg,
  ctx: GithubFilingContext,
  corpusService: CorpusService,
  openIssues: PlanCloseIssuePort | undefined,
): IssuePort {
  return {
    findOpenByFingerprint: async (short) => {
      if (openIssues === undefined) {
        return err({
          code: "VALIDATION_ERROR",
          field: "feedback.upstream",
          message: "cannot search open issues for a fingerprint: no open-issue reader is wired (needs a GitHub feedback.upstream.repo)",
          rule: "BR-1379",
        });
      }
      const listing = await openIssues.listOpenIssues();
      if (!listing.ok) return listing;
      const tag = `${FINGERPRINT_TITLE_TAG}${short}]`;
      const match = listing.value.open.find((issue) => issue.title.includes(tag));
      return ok(match === undefined ? undefined : { number: match.number });
    },
    file: async (input) => {
      const result = await fileGithubIssue(
        {
          title: input.title,
          description: input.body,
          expected: `The ${input.dimension} finding of ${input.plans.join(", ")} passes its milestone review.`,
          actual: input.body.split("\n").find((line) => line.startsWith("Cause:")) ?? input.title,
          repro_command: `lore assess ${input.plans[0] ?? ""}`,
          severity: "medium",
          category: "milestone-review",
          tags: ["milestone-review", input.dimension],
        },
        cfg,
        ctx,
      );
      if (!result.ok) return result;
      return ok({ number: result.value.number, url: result.value.url });
    },
    linkToPlan: (plan, issue) => linkIssueToPlan(corpusService, plan, issue, cfg.repo, ctx.actor),
  };
}

async function linkIssueToPlan(
  corpusService: CorpusService,
  planRef: string,
  issue: IssueRef,
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
    return ref !== undefined && ref.issueNumber === issue.number && ref.repo === repo;
  });
  if (issueTask === undefined) {
    return err({
      code: "VALIDATION_ERROR",
      field: "file-issues",
      message: `issue #${String(issue.number)} exists but no corpus issue task carries it, so it cannot be linked to plan ${planRef}; run \`lore issue adopt ${String(issue.number)}\` then \`lore link ${planRef} <task> --type resolves\``,
      rule: "BR-1379",
    });
  }
  const linked = await corpusService.link(bundle.value.plan.id, issueTask.id, "resolves", { by: actor });
  if (!linked.ok && linked.error.code !== "DUPLICATE_LINK") return linked;
  return ok(undefined);
}
