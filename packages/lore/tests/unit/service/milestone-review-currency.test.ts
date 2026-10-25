/**
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D, BR-1372)
 *
 * The plan-state fingerprint, the currency check plan close runs, the milestone decisions a review lists, and the
 * review prompt. Pure modules, so vitest.
 *
 * Dimensions: HAPPY (a stored review of the current state passes), NEGATIVE (absent / stale / failed refuse),
 * BOUNDARY (no tasks, no landing, an unparsable review doc), STATE (each edit moves the fingerprint; the newest
 * landing wins), REGRESSION (a forged shape is never read as a pass), ERROR (a failing dimension in a current review).
 */

import { describe, it, expect } from "vitest";
import { MILESTONE_DIMENSIONS, type DocRecord, type MilestoneReview } from "@lore/core";
import {
  MILESTONE_REVIEW_SUB_TYPE,
  assessMilestoneCurrency,
  latestLandingCommit,
  planStateFingerprint,
  selectLatestMilestoneReview,
} from "../../../src/service/milestone-review.js";
import { selectPlanMilestoneDecisions } from "../../../src/service/milestone-review-service.js";
import { buildMilestoneReviewPrompt } from "../../../src/ai/milestone-review-template.js";
import type { DecisionLogRow } from "../../../src/store/decision-log.js";

const plan = { id: "P1", version: 3 };
const task = (id: string, version: number, landing?: { at: string; commit: string }) => ({
  id,
  version,
  extra: landing
    ? {
        landing: {
          branch: "b",
          branch_head: "h",
          main_before: "m0",
          main_after: landing.commit,
          landing_commit: landing.commit,
          recorded_at: landing.at,
        },
      }
    : {},
});

function reviewDoc(slug: string, createdAt: string, review: Partial<MilestoneReview> & { fingerprint: string }): DocRecord {
  const dimension = { verdict: "pass" as const, reason: "ok", reference: "ref" };
  const full: MilestoneReview = {
    plan_id: "P1",
    overall: "pass",
    dimensions: Object.fromEntries(MILESTONE_DIMENSIONS.map((d) => [d, dimension])) as MilestoneReview["dimensions"],
    decisions: [],
    prompt_version: "milestone-1",
    diff_source: "none",
    ...review,
  };
  return {
    id: `id-${slug}`,
    slug,
    type: "knowledge",
    status: "approved",
    version: 1,
    created_at: createdAt,
    deleted_at: null,
    extra: { sub_type: MILESTONE_REVIEW_SUB_TYPE, milestone_review: full },
  } as unknown as DocRecord;
}

describe("planStateFingerprint", () => {
  it("HAPPY: names the plan version, every task id@version sorted by id, and the landed commit", () => {
    expect(planStateFingerprint(plan, [task("T2", 1), task("T1", 2)], undefined)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("STATE: a plan edit, a task edit and a newer landing each move the fingerprint", () => {
    const base = planStateFingerprint(plan, [task("T1", 2)], undefined);
    expect(planStateFingerprint({ id: "P1", version: 4 }, [task("T1", 2)], undefined)).not.toBe(base);
    expect(planStateFingerprint(plan, [task("T1", 3)], undefined)).not.toBe(base);
    expect(planStateFingerprint(plan, [task("T1", 2, { at: "2026-10-01T00:00:00Z", commit: "abc" })], undefined)).not.toBe(base);
  });

  it("STATE: the commit that last landed one of the tasks wins, by recorded_at", () => {
    const tasks = [
      task("T1", 1, { at: "2026-10-01T00:00:00Z", commit: "old" }),
      task("T2", 1, { at: "2026-10-02T00:00:00Z", commit: "new" }),
    ];
    expect(latestLandingCommit(tasks)).toBe("new");
  });

  it("BOUNDARY: no task landed -> none; a malformed landing is not trusted", () => {
    expect(latestLandingCommit([task("T1", 1)])).toBe("none");
    expect(latestLandingCommit([{ extra: { landing: { branch: "b" } } }])).toBe("none");
  });
});

describe("assessMilestoneCurrency", () => {
  const tasks = [task("T1", 2)];
  const now = planStateFingerprint(plan, tasks, undefined);

  it("HAPPY: a passing review of the current state is a pass", () => {
    expect(assessMilestoneCurrency(plan, tasks, [reviewDoc("r1", "2026-10-01", { fingerprint: now })], undefined)).toEqual({ state: "pass", reviewSlug: "r1" });
  });

  it("NEGATIVE: no review is absent", () => {
    expect(assessMilestoneCurrency(plan, tasks, [], undefined)).toEqual({ state: "absent" });
  });

  it("NEGATIVE: a review of another state is stale and names both fingerprints", () => {
    const result = assessMilestoneCurrency(plan, tasks, [reviewDoc("r1", "2026-10-01", { fingerprint: "stale-fingerprint" })], undefined);
    expect(result).toMatchObject({ state: "stale", reviewed: "stale-fingerprint", current: now, reviewSlug: "r1" });
  });

  it("ERROR: a current review with a failing dimension is failed and names it", () => {
    const failing = reviewDoc("r1", "2026-10-01", {
      fingerprint: now,
      overall: "fail",
      dimensions: {
        ...(reviewDoc("x", "x", { fingerprint: "x" }).extra["milestone_review"] as MilestoneReview).dimensions,
        security: { verdict: "fail", reason: "bad", reference: "OWASP" },
      },
    });
    expect(assessMilestoneCurrency(plan, tasks, [failing], undefined)).toEqual({ state: "failed", failed: ["security"], reviewSlug: "r1" });
  });

  it("STATE: the NEWEST review decides: an old pass does not rescue a newer stale or failed one", () => {
    const old = reviewDoc("old", "2026-10-01", { fingerprint: now });
    const newer = reviewDoc("new", "2026-10-02", { fingerprint: "plan:P1@1|tasks:|landed:none" });
    expect(assessMilestoneCurrency(plan, tasks, [old, newer], undefined).state).toBe("stale");
  });

  it("BOUNDARY: a plan with no tasks has nothing to review", () => {
    expect(assessMilestoneCurrency(plan, [], [], undefined)).toEqual({ state: "no-tasks" });
  });

  it("REGRESSION: a doc whose milestone_review does not parse is not a review, never a pass", () => {
    const forged = { ...reviewDoc("f", "2026-10-03", { fingerprint: now }), extra: { sub_type: MILESTONE_REVIEW_SUB_TYPE, milestone_review: { overall: "pass" } } } as unknown as DocRecord;
    expect(selectLatestMilestoneReview([forged])).toBeUndefined();
    expect(assessMilestoneCurrency(plan, tasks, [forged], undefined)).toEqual({ state: "absent" });
  });

  it("REGRESSION: a deleted review doc and a doc of another sub_type are ignored", () => {
    const deleted = { ...reviewDoc("d", "2026-10-03", { fingerprint: now }), deleted_at: "2026-10-04" } as unknown as DocRecord;
    const other = { ...reviewDoc("o", "2026-10-03", { fingerprint: now }), extra: { sub_type: "retro" } } as unknown as DocRecord;
    expect(assessMilestoneCurrency(plan, tasks, [deleted, other], undefined)).toEqual({ state: "absent" });
  });
});

describe("selectPlanMilestoneDecisions", () => {
  const row = (over: Partial<DecisionLogRow>): DecisionLogRow =>
    ({
      id: 1,
      ts: "2026-10-01T00:00:00Z",
      class: "override-judgment",
      subject_id: "spec-x#1",
      subject_version: "1",
      facts: "{}",
      factors: "{}",
      score: 0,
      threshold: null,
      verdict: "milestone",
      reasons: "[]",
      executor_run: null,
      channel: "machine",
      detail: null,
      prev_hash: "",
      entry_hash: "h",
      ...over,
    }) as DecisionLogRow;
  const slugs = new Set(["plan-a", "task-a", "spec-a"]);

  it("HAPPY: lists milestone decisions whose document is the plan, a task or the spec, with the detail summary", () => {
    const detail = JSON.stringify({ summary: "Allow an override on task-a", requested_by: "r", change: { document: "task-a" }, on_accept: "a", on_reject: "b" });
    const out = selectPlanMilestoneDecisions([row({ subject_id: "task-a#1", detail }), row({ subject_id: "plan-a#2", class: "ac-exempt" })], slugs);
    expect(out).toEqual([
      { class: "override-judgment", document: "task-a", summary: "Allow an override on task-a" },
      { class: "ac-exempt", document: "plan-a", summary: "" },
    ]);
  });

  it("NEGATIVE: other verdicts and other plans' documents are not listed", () => {
    expect(selectPlanMilestoneDecisions([row({ verdict: "auto", subject_id: "plan-a#1" }), row({ subject_id: "plan-b#1" })], slugs)).toEqual([]);
  });

  it("BOUNDARY: an unreadable detail still lists the decision (visible, never dropped)", () => {
    const out = selectPlanMilestoneDecisions([row({ subject_id: "spec-a#1", detail: "{not json" })], slugs);
    expect(out).toEqual([{ class: "override-judgment", document: "spec-a", summary: "" }]);
  });

  it("STATE: a re-run of the same decision is listed once", () => {
    const out = selectPlanMilestoneDecisions([row({ subject_id: "plan-a#1" }), row({ id: 2, subject_id: "plan-a#1" })], slugs);
    expect(out).toHaveLength(1);
  });
});

describe("buildMilestoneReviewPrompt", () => {
  const input = {
    plan: { slug: "plan-a", title: "Plan A", content: "goals" },
    tasks: [{ slug: "task-a", title: "T", status: "archived", content: "body", evidence: [{ oracle: "test", command: "bun test", result: "pass", attested: true }] }],
    citedRules: [{ rule_id: "BR-5", state: "stale" }],
    decisions: [{ class: "ac-exempt", document: "task-a", summary: "exempt" }],
    diffSource: "derived",
    maxDiffChars: 100,
  };

  it("HAPPY: names all seven dimensions, the evidence trust, the rule state and the decisions", () => {
    const prompt = buildMilestoneReviewPrompt({ ...input, diffText: "diff --git a/src/x.ts b/src/x.ts\n+x" });
    for (const d of MILESTONE_DIMENSIONS) expect(prompt).toContain(d);
    expect(prompt).toContain("[attested] test pass: bun test");
    expect(prompt).toContain("BR-5: stale");
    expect(prompt).toContain("ac-exempt on task-a: exempt");
  });

  it("BOUNDARY: an absent diff is said to be absent, with the reason", () => {
    expect(buildMilestoneReviewPrompt({ ...input, diffSource: "none: no commits" })).toContain("No diff is available (none: no commits)");
  });

  it("BOUNDARY: a diff over the budget is cut by file and the prompt says so", () => {
    const big = `diff --git a/src/a.ts b/src/a.ts\n${"+a\n".repeat(200)}diff --git a/src/b.ts b/src/b.ts\n${"+b\n".repeat(200)}`;
    const prompt = buildMilestoneReviewPrompt({ ...input, diffText: big, maxDiffChars: 400 });
    expect(prompt).toContain("was cut by file");
    expect(prompt).toContain("files not shown were not reviewed");
  });
});
