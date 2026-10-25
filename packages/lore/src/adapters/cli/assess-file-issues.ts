/**
 * The real {@link IssuePort} of the issue filing (BR-1379): GitHub through the report-issue path, the corpus for links.
 * Used by `lore assess --file-issues` and the automatic review batch alike; the grouping is `IssueFilingService`'s.
 *
 * Purpose: file ONE issue per root-cause fingerprint, find an already-open one by the `[fp:<12 hex>]` tag in its
 *   title, and link an issue to a plan with a `known-defect` link (never `resolves`, which archive closes), so plan
 *   close finds it as coverage.
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
import { readCarrierIssueRefs } from "../../service/issue-carrier.js";
import { buildCarrierTaskInput, decideAdoption } from "../../service/issue-adoption.js";
import type { IssueFinding, IssuePort, IssueRef } from "../../service/issue-filing-service.js";
import { FINGERPRINT_TITLE_TAG } from "../../service/root-cause-fingerprint.js";
import { MILESTONE_FINDINGS_FIELD, readMilestoneFindings, type OpenIssueListing, type PlanCloseIssuePort } from "../../service/milestone-review-inputs.js";
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
    linkToPlan: async (plan, issue, finding) => {
      // reason: a carrier names its issue by numeric repo id (D1); the repo id of the configured repository is the one
      // the open-issue reader verified. Absent a reader the number alone matches (one upstream per corpus).
      let listing: OpenIssueListing | undefined;
      if (openIssues !== undefined) {
        const listed = await openIssues.listOpenIssues();
        if (!listed.ok) return listed;
        listing = listed.value;
      }
      return linkIssueToPlan(corpusService, plan, issue, finding, listing, cfg.repo, ctx.actor);
    },
  };
}

async function linkIssueToPlan(
  corpusService: CorpusService,
  planRef: string,
  issue: IssueRef,
  finding: IssueFinding,
  listing: OpenIssueListing | undefined,
  repo: string,
  actor: string,
): Promise<Result<void, LoreError>> {
  const repoId = listing?.repoId;
  const bundle = await corpusService.getPlanBundle(planRef);
  if (!bundle.ok) return bundle;
  const tasks = await corpusService.listFull({ type: "task" });
  if (!tasks.ok) return tasks;
  let issueTask = tasks.value.docs.find((doc) => {
    if (doc.status === "archived") return false;
    return readCarrierIssueRefs(doc).some((ref) => ref.number === issue.number && (repoId === undefined || ref.repo_id === repoId));
  });
  if (issueTask === undefined) {
    // reason: filing creates no corpus document (AC-GS-10), so the carrier the known-defect link needs is adopted here:
    // an ad-hoc draft task naming the issue, exactly what `lore issue adopt <n>` creates, never a plan member (a draft
    // member would hold the plan's own close open).
    const open = listing?.open.find((candidate) => candidate.number === issue.number);
    if (listing === undefined || open === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "file-issues",
        message: `issue #${String(issue.number)} exists but no live corpus task carries it (extra.issues) and it is not in the open listing, so it cannot be adopted for plan ${planRef}; run \`lore issue adopt ${String(issue.number)}\` then \`lore link ${planRef} <task> --type known-defect\``,
        rule: "BR-1379",
      });
    }
    const listed = { number: issue.number, title: open.title, state: "open", body: "" } as const;
    const decision = decideAdoption(listed, listing.repoId, tasks.value.docs, new Date().toISOString());
    if (decision.kind !== "create") {
      return err({
        code: "VALIDATION_ERROR",
        field: "file-issues",
        message: `issue #${String(issue.number)} cannot be adopted for plan ${planRef}: ${decision.kind}${"slug" in decision ? ` (${decision.slug})` : ""}`,
        rule: "BR-1379",
      });
    }
    const created = await corpusService.create(buildCarrierTaskInput({ issue: listed, repo, repoId: listing.repoId, slug: decision.slug }), { by: actor });
    if (!created.ok) return created;
    issueTask = created.value;
  }
  // reason: BR-1379 — the record on the carrier (not the title) is what plan close reads as coverage. Written BEFORE the
  // link so a link never exists without the record; an unchanged record writes nothing (idempotent retry).
  const recorded = readMilestoneFindings(issueTask.extra);
  if (!recorded.some((f) => f.dimension === finding.dimension && f.fingerprint === finding.fingerprint)) {
    const written = await corpusService.set(
      issueTask.id,
      { extra: { ...(issueTask.extra as Record<string, unknown>), [MILESTONE_FINDINGS_FIELD]: [...recorded, { dimension: finding.dimension, fingerprint: finding.fingerprint }] } },
      { by: actor },
    );
    if (!written.ok) return written;
  }
  const linked = await corpusService.link(bundle.value.plan.id, issueTask.id, "known-defect", { by: actor });
  if (!linked.ok && linked.error.code !== "DUPLICATE_LINK") return linked;
  return ok(undefined);
}
