/**
 * Test helper: gives a plan a passing, CURRENT milestone review (BR-1372) so a test whose subject is not the review can
 * close it. Plan close requires exactly that and nothing else, so a fixture that closes a plan in-process records the
 * review the way `lore assess` does — through the guarded `createMilestoneReviewDoc` seam and an `informs` link — with a
 * fingerprint computed from the plan's state AT THE MOMENT OF THE CALL (call it after the last task edit).
 *
 * The review is a fixture, not a judgment: use `tests/integration/milestone-review.test.ts` for the review itself.
 * Side-effect class: IO against the injected service.
 */

import { MILESTONE_DIMENSIONS, renderMilestoneReviewContent, type MilestoneReview } from "@lore/core";
import type { CorpusService } from "../../src/service/corpus-service.js";
import { MILESTONE_REVIEW_SUB_TYPE, planStateFingerprint } from "../../src/service/milestone-review.js";

/**
 * Records a passing review of `planRef`'s current state.
 *
 * @param corpus - the CorpusService the test closes the plan through
 * @param planRef - plan id or slug
 * @throws Error when the plan, the review doc or its link cannot be written (a fixture failure, never a skip)
 */
export async function passMilestoneReview(corpus: CorpusService, planRef: string): Promise<void> {
  const bundle = await corpus.getPlanBundle(planRef);
  if (!bundle.ok) throw new Error(`passMilestoneReview: ${JSON.stringify(bundle.error)}`);
  const { plan, tasks } = bundle.value;
  const dimension = { verdict: "pass" as const, reason: "fixture review", reference: "test fixture" };
  const review: MilestoneReview = {
    plan_id: plan.id,
    fingerprint: planStateFingerprint(plan, tasks),
    overall: "pass",
    dimensions: Object.fromEntries(MILESTONE_DIMENSIONS.map((d) => [d, dimension])) as MilestoneReview["dimensions"],
    decisions: [],
    prompt_version: "fixture",
    diff_source: "fixture",
  };
  const doc = await corpus.createMilestoneReviewDoc({
    type: "knowledge",
    title: `Milestone review fixture ${plan.slug}`,
    parent_id: plan.id,
    extra: { sub_type: MILESTONE_REVIEW_SUB_TYPE, milestone_review: review },
    content: renderMilestoneReviewContent(review),
  });
  if (!doc.ok) throw new Error(`passMilestoneReview: ${JSON.stringify(doc.error)}`);
  const link = await corpus.link(doc.value.id, plan.id, "informs");
  if (!link.ok) throw new Error(`passMilestoneReview: ${JSON.stringify(link.error)}`);
}
