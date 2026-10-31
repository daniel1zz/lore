/**
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (BR-1379)
 *
 * A review batch whose run was not asked to file issues (`lore assess` without `--file-issues`, so `ports.filing` is
 * undefined) cannot file a failed review's findings. `assess` already refuses `--file-issues` without a configured tracker
 * up front, so an undefined filing port always means "this run does not file issues" — never "no tracker is configured".
 * The error must say so and name `--file-issues`.
 *
 * Dimensions: NEGATIVE (the failed review is a filing error, the plan stays open), REGRESSION (the old "no issue tracker
 * is configured" wording is gone; the passing review is not a filing error).
 */

import { describe, expect, it } from "vitest";
import { MILESTONE_DIMENSIONS, ok, type DocRecord, type MilestoneDimension, type MilestoneReview, type PlanBundle } from "@lore/core";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import { coverFailedDimensions } from "../../src/service/milestone-review-inputs.js";
import { ReviewLeases, planLeaseKey } from "../../src/service/review-batch-lease.js";
import { ReviewBatchRunner, type BatchErrorRecord, type BatchRunPorts } from "../../src/service/review-batch-service.js";
import { MILESTONE_REVIEW_SUB_TYPE, planStateFingerprint } from "../../src/service/milestone-review.js";
import type { MilestoneReviewResult } from "../../src/service/milestone-review-service.js";

const T0 = Date.parse("2026-10-29T12:00:00.000Z");

function stubDoc(partial: Record<string, unknown>): DocRecord {
  return { deleted_at: null, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", version: 1, content: "", tags: [], parent_id: null, ...partial } as unknown as DocRecord;
}

function makeBundle(slug: string): PlanBundle {
  const progress = { state: "complete", open: 0, total: 1, at: "2026-10-01T00:00:00.000Z" };
  const plan = stubDoc({ id: `id-${slug}`, slug, type: "plan", status: "active", title: slug, extra: { progress } });
  const task = stubDoc({ id: `id-${slug}-t1`, slug: `${slug}-t1`, type: "task", status: "archived", title: "t", extra: {} });
  const spec = stubDoc({ id: `id-spec-${slug}`, slug: `spec-${slug}`, type: "spec", status: "approved", title: "s", extra: { acceptance_criteria: [{ id: "AC-W-1", statement: "works", verify: { mode: "human" } }] } });
  return { plan, spec, tasks: [task] } as unknown as PlanBundle;
}

/** Runs one plan through the real batch runner with a judge that fails `failing` and NO filing port. */
async function runWithoutFiling(slug: string, failing: MilestoneDimension | undefined) {
  const bundle = makeBundle(slug);
  const docs: DocRecord[] = [];
  const errors: BatchErrorRecord[] = [];
  let archived = false;
  const lease = new ReviewLeases(new InMemoryStore(), "batch", () => T0, () => () => undefined);
  const runner = new ReviewBatchRunner({
    getPlanBundle: async () => ok(bundle),
    listReviewDocs: async () => ok(docs),
    issueCoverage: async (_planId, failed) => ok(coverFailedDimensions(failed, [])),
  });
  const ports: BatchRunPorts = {
    acquirePlanLease: (planId) => lease.acquire(planLeaseKey(planId)),
    settleRetirement: async () => ok({ state: "none" as const }),
    measureSuite: async () => undefined,
    reviewPlan: async () => {
      const dimensions = Object.fromEntries(
        MILESTONE_DIMENSIONS.map((d) => {
          const fails = d === failing;
          return [d, { verdict: fails ? "fail" : "pass", reason: `${d} ${fails ? "fail" : "pass"}`, reference: "fixture", ...(fails ? { cites: [`src/${d}.ts`] } : {}) }];
        }),
      ) as MilestoneReview["dimensions"];
      const review: MilestoneReview = {
        plan_id: bundle.plan.id,
        fingerprint: planStateFingerprint(bundle.plan, bundle.tasks, bundle.spec),
        facts_fingerprint: "facts-1",
        overall: failing === undefined ? "pass" : "fail",
        dimensions,
        decisions: [],
        prompt_version: "fixture",
        diff_source: "fixture",
      };
      const doc = stubDoc({ id: "rev-1", slug: `review-${slug}-1`, type: "knowledge", created_at: new Date(T0 + 1).toISOString(), extra: { sub_type: MILESTONE_REVIEW_SUB_TYPE, milestone_review: review } });
      docs.push(doc);
      return ok<MilestoneReviewResult>({ doc, review });
    },
    closePlan: async () => {
      archived = true;
      return ok(undefined);
    },
    recordError: async (record) => {
      errors.push(record);
      return ok(undefined);
    },
    filing: undefined,
    now: () => new Date(T0).toISOString(),
  };
  const run = await runner.runBatch([slug], ports);
  return { run, errors, archived: () => archived };
}

describe("a batch run that does not file issues says so (BR-1379)", () => {
  it("NEGATIVE: a failed review without a filing port is a filing error naming --file-issues, and the plan stays open", async () => {
    const world = await runWithoutFiling("p-nofile", "security");
    expect(world.run.ok && world.run.value.state === "ran" && world.run.value.rows[0]).toMatchObject({ outcome: "error", stage: "filing" });
    expect(world.archived()).toBe(false);
    expect(world.errors.map((e) => e.stage)).toEqual(["filing"]);
    const message = world.errors[0]?.message ?? "";
    expect(message).toContain("does not file issues");
    expect(message).toContain("--file-issues");
  });

  it("REGRESSION: the error no longer claims no issue tracker is configured", async () => {
    const world = await runWithoutFiling("p-nofile-2", "regression");
    const message = world.errors[0]?.message ?? "";
    expect(message).not.toContain("no issue tracker is configured");
    expect(message).not.toContain("feedback.upstream");
  });

  it("REGRESSION: a passing review needs no filing, so a run that does not file issues records no error", async () => {
    const world = await runWithoutFiling("p-pass", undefined);
    expect(world.errors).toEqual([]);
  });
});
