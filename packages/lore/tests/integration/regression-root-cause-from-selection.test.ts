/**
 * @spec_ref spec-a-plan-s-close-runs-only-the-tests-its-changes-can-reach (BR-1379, BR-1496)
 *
 * A regression found by the close's SELECTION (the red files charged to a landing at L, never a full-suite run) is filed
 * as an issue: the review stores the charged files as its root cause, the batch does not classify it unfileable, the
 * issue is filed once and a second review with the same red file reuses it. Real `MilestoneReviewService` (scripted judge),
 * real `rootCauseOf` / `unfileableReviewError` / `IssueFilingService`; only the issue tracker is a counting stub.
 *
 * Dimensions: HAPPY (filed once, root cause names the file), NEGATIVE (no regression_files -> no regression cause stored),
 * STATE (second review reuses the open issue), REGRESSION (no suite is supplied: the old `measured`-only path left
 * suite_failing_files empty and the filing refused).
 */

import { describe, expect, it } from "vitest";
import { ok, type MilestoneReview } from "@lore/core";
import { IssueFilingService, type IssuePort, type IssueRef } from "../../src/service/issue-filing-service.js";
import { unfileableReviewError } from "../../src/service/review-batch-service.js";
import { answerJson, buildJudgmentFixture } from "../helpers/milestone-judgment-fixture.js";

const JUDGED_PASS = {
  spec_conformance: { verdict: "pass" },
  design_necessity: { verdict: "pass" },
  concurrency_safety: { verdict: "pass" },
  security: { verdict: "pass" },
};
const RED_FILE = "packages/x/tests/a.test.ts";

/** A tracker that remembers what it filed and finds an open issue by the short fingerprint in its title. */
function stubTracker(): { port: IssuePort; filed: { title: string; body: string }[] } {
  const filed: { title: string; body: string }[] = [];
  const port: IssuePort = {
    findOpenByFingerprint: async (short) => {
      const hit = filed.find((f) => f.title.includes(`[fp:${short}]`));
      return ok(hit === undefined ? undefined : ({ number: 1, url: "https://example.invalid/1" } as unknown as IssueRef));
    },
    file: async (input) => {
      filed.push({ title: input.title, body: input.body });
      return ok({ number: 1, url: "https://example.invalid/1" } as unknown as IssueRef);
    },
    recordKnownDefects: async () => ok(undefined),
  };
  return { port, filed };
}

/** One review of the plan whose selection charged `files` to its landing; no suite is supplied (assess never measures one). */
async function reviewWithCharged(files: readonly string[]): Promise<MilestoneReview> {
  const fixture = buildJudgmentFixture(() => answerJson(JUDGED_PASS));
  const result = await fixture.review({
    diffText: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@\n+x\n",
    facts: {
      regression: [{ subject: "landing-1", verdict: files.length > 0 ? "fail" : "pass", detail: `regression still red: ${files.join(", ")}` }],
      ...(files.length > 0 ? { regression_files: [...files] } : {}),
    },
  });
  expect(result.ok).toBe(true);
  const stored = fixture.stored();
  expect(stored).toBeDefined();
  return stored!;
}

function regressionFinding(review: MilestoneReview) {
  return { plan: "plan-one", dimension: "regression" as const, reason: review.dimensions.regression.reason, reference: "", reviewSlug: "review-one", causes: review.causes };
}

describe("a regression found by the selection files its issue", () => {
  it("HAPPY: the selection's red file is the root cause and the issue is filed once", async () => {
    const review = await reviewWithCharged([RED_FILE]);
    expect(review.dimensions.regression.verdict).toBe("fail");
    expect(unfileableReviewError("plan-one", "review-one", review)).toBeUndefined();

    const tracker = stubTracker();
    const filing = new IssueFilingService(tracker.port);
    const groups = await filing.fileFindings([regressionFinding(review)]);
    expect(groups.ok).toBe(true);
    if (!groups.ok) return;
    expect(groups.value).toHaveLength(1);
    expect(groups.value[0]?.cause.label).toContain(RED_FILE);
    expect(tracker.filed).toHaveLength(1);
    expect(tracker.filed[0]?.title).toContain(RED_FILE);
  });

  it("STATE: a second review with the same red file reuses the open issue and files nothing", async () => {
    const tracker = stubTracker();
    const filing = new IssueFilingService(tracker.port);
    const first = await filing.fileFindings([regressionFinding(await reviewWithCharged([RED_FILE]))]);
    const second = await filing.fileFindings([regressionFinding(await reviewWithCharged([RED_FILE]))]);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(tracker.filed).toHaveLength(1);
    expect(second.value[0]?.reused).toBe(true);
    expect(second.value[0]?.cause.fingerprint).toBe(first.value[0]?.cause.fingerprint);
  });

  it("NEGATIVE: a clean selection stores no regression cause", async () => {
    const review = await reviewWithCharged([]);
    expect(review.causes?.regression_files).toBeUndefined();
    expect(review.causes?.suite_failing_files).toBeUndefined();
  });
});
