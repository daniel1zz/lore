/**
 * The real {@link IssuePort} of the issue filing (BR-1379): GitHub through the report-issue path, the corpus for links.
 * Used by `lore assess --file-issues` and the automatic review batch alike; the grouping is `IssueFilingService`'s.
 *
 * Purpose: file ONE issue per root-cause fingerprint, find an already-open one by the `[fp:<12 hex>]` tag in its
 *   title, and record it on the plan's own `extra.known_defects` (one entry per failed dimension, never `extra.issues`,
 *   which archive closes), so plan close finds it as coverage. No corpus document is created (GS D7).
 * Public surface: createGithubIssuePort.
 * Invariants:
 *   - The title is the one `IssueFilingService` built (`<dimension>: <cause> [fp:<12 hex>]`); the full fingerprint is
 *     in the body. `fileGithubIssue` recognises a title already filed through its receipt log (no duplicate on retry).
 *   - A filing or link failure is returned, never swallowed.
 *   - Open issues are read live (`PlanCloseIssuePort.listOpenIssues`), the same reader plan close uses; with none
 *     wired, searching fails loud instead of reading as "no open issue" (that would file duplicates).
 * Side-effect class: IO (GitHub through `fileGithubIssue`, a plan write per filed batch).
 *
 * Reference: Sentry error grouping by fingerprint.
 * @spec_ref spec-plans-close-themselves-level-triggered-reconciliation-of (AC-PCR-4, BR-1379)
 * @spec_ref spec-a-plan-s-known-defects-are-its-own-record-of-github-issues (AC-KD-2, BR-1421)
 */

import { appendKnownDefects, err, ok, readKnownDefects, withKnownDefects, type KnownDefectEntry, type LoreError, type Result } from "@lore/core";
import type { CorpusService } from "../../service/corpus-service.js";
import type { IssueFinding, IssuePort, IssueRef } from "../../service/issue-filing-service.js";
import { FINGERPRINT_TITLE_TAG } from "../../service/root-cause-fingerprint.js";
import { type PlanCloseIssuePort } from "../../service/milestone-review-inputs.js";
import { fileGithubIssue, type GithubFilingContext, type GithubUpstreamCfg } from "./report-issue-wiring.js";

/**
 * Builds the issue port for one run.
 *
 * @param cfg - the GitHub `feedback.upstream`
 * @param ctx - filing context of the caller
 * @param corpusService - the corpus whose plans record the known defects
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
    recordKnownDefects: async (plan, issue, findings) => {
      // reason: the entry names its issue by numeric repo id (D1). The issue is read BY NUMBER (never the listing: a
      // just-created issue may be missing from it, #402), which also yields the repository id the reader verified.
      if (openIssues === undefined) {
        return err({
          code: "VALIDATION_ERROR",
          field: "feedback.upstream",
          message: "cannot record known defects: no issue reader is wired (needs a GitHub feedback.upstream.repo)",
          rule: "BR-1421",
        });
      }
      const read = await openIssues.readIssue(issue.number);
      if (!read.ok) return read;
      return recordOnPlan(corpusService, plan, read.value.repoId, issue, findings, ctx.actor);
    },
  };
}

/** Re-read and re-append attempts after losing a version race on the plan (D4). */
const MAX_APPEND_ATTEMPTS = 5;

async function recordOnPlan(
  corpusService: CorpusService,
  planRef: string,
  repoId: number,
  issue: IssueRef,
  findings: readonly IssueFinding[],
  actor: string,
): Promise<Result<void, LoreError>> {
  const additions: KnownDefectEntry[] = findings.map((f) => ({ repo_id: repoId, number: issue.number, dimension: f.dimension, fingerprint: f.fingerprint }));
  let lastConflict: LoreError | undefined;
  for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt += 1) {
    const read = await corpusService.get(planRef);
    if (!read.ok) return read;
    const plan = read.value.doc;
    if (plan.type !== "plan") {
      return err({ code: "VALIDATION_ERROR", field: "plan", message: `${planRef} is a ${plan.type}, not a plan: known defects are recorded on a plan`, rule: "BR-1421" });
    }
    const existing = readKnownDefects(plan.extra);
    const merged = appendKnownDefects(existing, additions);
    if (merged === existing) return ok(undefined);
    const written = await corpusService.set(
      plan.id,
      { extra: withKnownDefects(plan.extra as Record<string, unknown>, merged) },
      { by: actor, expectedVersion: plan.version },
    );
    if (written.ok) return ok(undefined);
    if (written.error.code !== "STALE_VERSION") return written;
    lastConflict = written.error;
  }
  return err(lastConflict ?? { code: "VALIDATION_ERROR", field: "plan", message: `could not record known defects on ${planRef}`, rule: "BR-1421" });
}
