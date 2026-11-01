/**
 * @spec_ref spec-a-plan-s-tests-and-criteria-are-measured-once-at-its (AC-AO-4, BR-1379)
 *
 * The post-landing review batch measures nothing per landing: no suite and no criterion attestation at a landing commit,
 * and it reviews only complete plans. A plan kept open by a failed or not-measured gate is re-reviewed when one of its own
 * tasks lands, when a landing changed a file its failing facts name, or (suite not completed) by the next batch; an
 * unrelated landing triggers nothing. Everything is injected into the real `ReviewBatchRunner` / `ReviewTriggerService`.
 *
 * Dimensions: HAPPY (a named file changed: re-review), NEGATIVE (unrelated landing: nothing; in-progress plan: not in the
 * set), BOUNDARY (own task landed; review stored before assessed_commit; no landing port), ERROR (landing lookup fails:
 * errored attempt), STATE (not-measured regression retried next batch, a clean or accepted review never re-opened),
 * REGRESSION (today's batch runs the suite and attestation at the landing commit and re-reviews on every landing).
 */

import { describe, expect, it } from "vitest";
import {
  MILESTONE_DIMENSIONS,
  err,
  ok,
  type DocRecord,
  type LoreError,
  type MilestoneDimension,
  type MilestoneReview,
  type PlanBundle,
} from "@lore/core";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import { IssueFilingService, type IssuePort, type IssueRef } from "../../src/service/issue-filing-service.js";
import { coverFailedDimensions } from "../../src/service/milestone-review-inputs.js";
import { MILESTONE_REVIEW_SUB_TYPE, planStateFingerprint } from "../../src/service/milestone-review.js";
import { ReviewLeases, planLeaseKey } from "../../src/service/review-batch-lease.js";
import { refuseBatchLeaseForRead } from "../../src/adapters/cli/review-batch-wiring.js";
import { noDecisionLog } from "../helpers/gate-acceptance-log.js";
import { ReviewBatchRunner, ReviewTriggerService, type BatchErrorRecord, type BatchRunPorts } from "../../src/service/review-batch-service.js";
import type { MilestoneReviewResult } from "../../src/service/milestone-review-service.js";

const T0 = Date.parse("2026-10-29T12:00:00.000Z");
const ASSESSED = "a".repeat(40);
const RED_FILE = "packages/x/tests/red.test.ts";
const UNRELATED_FILE = "packages/y/src/unrelated.ts";

function stubDoc(partial: Record<string, unknown>): DocRecord {
  return { deleted_at: null, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", version: 1, content: "", tags: [], parent_id: null, ...partial } as unknown as DocRecord;
}

class FakeIssuePort implements IssuePort {
  readonly open: { number: number; title: string }[] = [];
  readonly links: { plan: string; issue: number; dimensions: string[] }[] = [];
  async findOpenByFingerprint(short: string) {
    const hit = this.open.find((i) => i.title.includes(`[fp:${short}]`));
    return ok<IssueRef | undefined>(hit === undefined ? undefined : { number: hit.number });
  }
  async file(input: { title: string }) {
    const number = 100 + this.open.length + 1;
    this.open.push({ number, title: input.title });
    return ok<IssueRef>({ number });
  }
  async recordKnownDefects(plan: string, issue: IssueRef, findings: readonly { dimension: string }[]) {
    for (const finding of findings) {
      const hit = this.links.find((l) => l.plan === plan && l.issue === issue.number);
      if (hit === undefined) this.links.push({ plan, issue: issue.number, dimensions: [finding.dimension] });
      else if (!hit.dimensions.includes(finding.dimension)) hit.dimensions.push(finding.dimension);
    }
    return ok(undefined);
  }
}

interface JudgeShape {
  readonly verdicts: Partial<Record<MilestoneDimension, "fail" | "not-measured">>;
  /** Stored on the review the judge makes (what a real review records from its facts). */
  readonly assessedCommit?: string;
  readonly failingFactFiles?: readonly string[];
  /** The structured `regression_causes` stored when regression is not-measured (what regression-at-head.ts reports); absent means `unrunnable`. */
  readonly regressionCauses?: NonNullable<MilestoneReview["regression_causes"]>;
}

class World {
  readonly issues = new FakeIssuePort();
  readonly errors: BatchErrorRecord[] = [];
  readonly store = new InMemoryStore();
  readonly docs: DocRecord[] = [];
  judgeCalls = 0;
  suiteRuns = 0;
  landingLookups: string[] = [];
  /** What the next judgment stores. */
  shape: JudgeShape = { verdicts: {} };
  /** Whether the plan's tasks changed since the last review (its own task landed). */
  planProgress: "complete" | "in-progress" = "complete";
  private taskVersion = 1;

  /** The plan and its tasks as the corpus holds them now. */
  bundle(): PlanBundle {
    const progress = { state: this.planProgress, open: 0, total: 1, at: "2026-10-01T00:00:00.000Z" };
    const plan = stubDoc({ id: "id-plan", slug: "plan-one", type: "plan", status: "active", title: "plan", extra: { progress } });
    const task = stubDoc({ id: "id-task", slug: "task-one", type: "task", status: "archived", title: "t", version: this.taskVersion, extra: { landing: { commit: `landing-${String(this.taskVersion)}` } } });
    const spec = stubDoc({ id: "id-spec", slug: "spec-one", type: "spec", status: "approved", title: "s", extra: { acceptance_criteria: [{ id: "AC-W-1", statement: "works", verify: { mode: "human" } }] } });
    return { plan, spec, tasks: [task] } as unknown as PlanBundle;
  }

  /** One of the plan's own tasks lands (its stored state changes, so the plan-state fingerprint does). */
  landOwnTask(): void {
    this.taskVersion += 1;
  }

  runner(): ReviewBatchRunner {
    return new ReviewBatchRunner({
      getPlanBundle: async () => ok(this.bundle()),
      listReviewDocs: async () => ok(this.docs),
      acceptanceLog: noDecisionLog(),
      issueCoverage: async (_planId, failed) => {
        const entries = this.issues.links.flatMap((l) => l.dimensions.map((dimension) => ({ number: l.issue, dimension, state: "open" as const })));
        return ok(coverFailedDimensions(failed, entries));
      },
    });
  }

  trigger(): ReviewTriggerService {
    return new ReviewTriggerService({
      listPlans: async () => ok([this.bundle().plan]),
      getPlanBundle: async () => ok(this.bundle()),
      listReviewDocs: async () => ok(this.docs),
      pendingDecisionSubjects: async () => ok(new Set<string>()),
      issueCoverage: async (_planId, failed) => ok(coverFailedDimensions(failed, [])),
      spawnBatch: () => ok({ pid: undefined }),
      batchLease: refuseBatchLeaseForRead,
    });
  }

  ports(holder: string, overrides: Partial<BatchRunPorts> = {}): BatchRunPorts {
    const lease = new ReviewLeases(this.store, holder, () => T0, () => () => undefined);
    return {
      acquirePlanLease: (planId) => lease.acquire(planLeaseKey(planId)),
      settleRetirement: async () => ok({ state: "none" as const }),
      measureSuite: async () => {
        this.suiteRuns += 1;
        return undefined;
      },
      reviewPlan: async () => this.judge(),
      closePlan: async () => ok(undefined),
      recordError: async (record) => {
        this.errors.push(record);
        return ok(undefined);
      },
      filing: new IssueFilingService(this.issues),
      now: () => new Date(T0).toISOString(),
      ...overrides,
    };
  }

  async judge() {
    this.judgeCalls += 1;
    const bundle = this.bundle();
    const dimensions = Object.fromEntries(
      MILESTONE_DIMENSIONS.map((d) => {
        const verdict = this.shape.verdicts[d] ?? "pass";
        const cites = verdict === "fail" ? [`src/${d}.ts`] : verdict === "not-measured" ? [`${d}:subject`] : undefined;
        return [d, { verdict, reason: `${d} ${verdict}`, reference: "fixture", ...(cites !== undefined ? { cites } : {}) }];
      }),
    ) as MilestoneReview["dimensions"];
    const regressionFails = this.shape.verdicts.regression === "fail";
    const review: MilestoneReview = {
      plan_id: bundle.plan.id,
      fingerprint: planStateFingerprint(bundle.plan, bundle.tasks, bundle.spec),
      overall: Object.values(this.shape.verdicts).includes("fail") ? "fail" : "pass",
      dimensions,
      decisions: [],
      ...(regressionFails ? { causes: { regression_files: [RED_FILE], suite_failing_files: [RED_FILE] } } : {}),
      ...(this.shape.verdicts.regression === "not-measured" ? { regression_causes: [...(this.shape.regressionCauses ?? ["unrunnable" as const])] } : {}),
      ...(this.shape.assessedCommit !== undefined ? { assessed_commit: this.shape.assessedCommit } : {}),
      ...(this.shape.failingFactFiles !== undefined ? { failing_fact_files: [...this.shape.failingFactFiles] } : {}),
      prompt_version: "fixture",
      diff_source: "fixture",
    };
    const doc = stubDoc({
      id: `rev-${String(this.judgeCalls)}`,
      slug: `review-${String(this.judgeCalls)}`,
      type: "knowledge",
      created_at: new Date(T0 + this.judgeCalls).toISOString(),
      extra: { sub_type: MILESTONE_REVIEW_SUB_TYPE, milestone_review: review },
    });
    this.docs.push(doc);
    return ok<MilestoneReviewResult>({ doc, review });
  }
}

async function batch(world: World, holder: string, overrides: Partial<BatchRunPorts> = {}) {
  const run = await world.runner().runBatch(["plan-one"], world.ports(holder, overrides));
  if (!run.ok || run.value.state !== "ran") throw new Error(`batch did not run: ${JSON.stringify(run)}`);
  const row = run.value.rows[0];
  if (row === undefined) throw new Error("no row");
  return row;
}

/** A world whose first batch stored a kept-open review naming `RED_FILE`, measured at ASSESSED. */
async function keptOpenWorld(extra: Partial<JudgeShape> = {}): Promise<World> {
  const world = new World();
  world.shape = { verdicts: { regression: "fail" }, assessedCommit: ASSESSED, failingFactFiles: [RED_FILE], ...extra };
  const first = await batch(world, "first");
  expect(first).toMatchObject({ outcome: "kept-open", reviewed: true });
  world.suiteRuns = 0;
  world.judgeCalls = 0;
  return world;
}

const changedFiles = (files: readonly string[]) => async (commit: string) => {
  expect(commit).toBe(ASSESSED);
  return ok<readonly string[]>(files);
};

describe("the post-landing batch measures nothing per landing", () => {
  it("AC-AO-4 an unrelated landing runs no suite and re-reviews nothing (the batch has no criteria step at all)", async () => {
    const world = await keptOpenWorld();
    const row = await batch(world, "after-unrelated", { changedFilesSince: changedFiles([UNRELATED_FILE]) });
    // BR-1511: a batch reaching a kept-open plan already reviewed at its current state skips it as "already reviewed" (was: a kept-open row)
    expect(row).toMatchObject({ outcome: "skipped", reviewed: false });
    expect(row.detail).toContain("already reviewed");
    expect(world.suiteRuns).toBe(0);
    expect(world.judgeCalls).toBe(0);
  });

  it("AC-AO-4 a landing that changes a file the failing facts name re-reviews the plan", async () => {
    const world = await keptOpenWorld();
    const row = await batch(world, "after-touch", { changedFilesSince: changedFiles([UNRELATED_FILE, RED_FILE]) });
    expect(row).toMatchObject({ outcome: "kept-open", reviewed: true });
    expect(world.judgeCalls).toBe(1);
    // the one measurement of a re-review is the review's own (once per batch, at head), not a landing's
    expect(world.suiteRuns).toBe(1);
  });

  it("AC-AO-4 a landing of the plan's own task re-reviews it (its state changed)", async () => {
    const world = await keptOpenWorld();
    world.landOwnTask();
    const row = await batch(world, "after-own", { changedFilesSince: changedFiles([UNRELATED_FILE]) });
    expect(row).toMatchObject({ reviewed: true });
    expect(world.judgeCalls).toBe(1);
  });

  it("AC-AO-4 a regression gate that was not measured (the suite could not complete) is re-reviewed by the next batch with no landing at all", async () => {
    const world = new World();
    world.shape = { verdicts: { regression: "not-measured" }, assessedCommit: ASSESSED };
    expect(await batch(world, "first")).toMatchObject({ outcome: "kept-open", reviewed: true });
    world.shape = { verdicts: {}, assessedCommit: ASSESSED };
    const next = await batch(world, "next");
    expect(next).toMatchObject({ reviewed: true });
    expect(world.judgeCalls).toBe(2);
  });

  it("AC-AO-4 a regression not measured because a task has no landing record is not re-judged by the next batch (a retry cannot change it)", async () => {
    const world = new World();
    world.shape = { verdicts: { regression: "not-measured" }, assessedCommit: ASSESSED, regressionCauses: ["unlanded"] };
    expect(await batch(world, "first")).toMatchObject({ outcome: "kept-open", reviewed: true });
    world.judgeCalls = 0;
    world.suiteRuns = 0;
    // BR-1511: skipped as "already reviewed" (was: a kept-open row)
    expect(await batch(world, "next")).toMatchObject({ outcome: "skipped", reviewed: false });
    expect(world.judgeCalls).toBe(0);
    expect(world.suiteRuns).toBe(0);
  });

  it("AC-AO-4 a regression not measured because a landing is not on main's history is not re-judged by the next batch", async () => {
    const world = new World();
    world.shape = { verdicts: { regression: "not-measured" }, assessedCommit: ASSESSED, regressionCauses: ["unmappable"] };
    await batch(world, "first");
    world.judgeCalls = 0;
    expect(await batch(world, "next")).toMatchObject({ reviewed: false });
    expect(world.judgeCalls).toBe(0);
  });

  it("AC-AO-4 an unrunnable head suite alongside an unlanded task is still re-judged by the next batch", async () => {
    const world = new World();
    world.shape = { verdicts: { regression: "not-measured" }, assessedCommit: ASSESSED, regressionCauses: ["unlanded", "unrunnable"] };
    await batch(world, "first");
    world.judgeCalls = 0;
    expect(await batch(world, "next")).toMatchObject({ reviewed: true });
    expect(world.judgeCalls).toBe(1);
  });

  it("AC-AO-4 a clean review is never re-opened by a landing, even one that changes a named file", async () => {
    const world = new World();
    world.shape = { verdicts: {}, assessedCommit: ASSESSED, failingFactFiles: [RED_FILE] };
    const first = await batch(world, "first");
    expect(first.outcome).toBe("accepted");
    world.judgeCalls = 0;
    const again = await batch(world, "again", { changedFilesSince: changedFiles([RED_FILE]) });
    expect(again.reviewed).toBe(false);
    expect(world.judgeCalls).toBe(0);
  });

  it("AC-AO-4 a review stored before assessed_commit existed is re-made once, then follows the triggers", async () => {
    const world = await keptOpenWorld({ assessedCommit: undefined as unknown as string });
    const review = world.docs[0]?.extra["milestone_review"] as Record<string, unknown>;
    delete review["assessed_commit"];
    const reopened = await batch(world, "legacy", { changedFilesSince: async () => err<LoreError>({ code: "STORE_ERROR", message: "must not be asked" }) });
    expect(reopened.reviewed).toBe(true);
  });

  it("AC-AO-4 with no landing source wired nothing is guessed: the kept-open plan is not re-reviewed", async () => {
    const world = await keptOpenWorld();
    const row = await batch(world, "no-port");
    expect(row.reviewed).toBe(false);
    expect(world.judgeCalls).toBe(0);
  });

  it("AC-AO-4 a landing lookup that fails is an errored attempt (audit row), never a skipped or a passed re-review", async () => {
    const world = await keptOpenWorld();
    const row = await batch(world, "git-down", { changedFilesSince: async () => err<LoreError>({ code: "STORE_ERROR", message: "git diff failed" }) });
    expect(row).toMatchObject({ outcome: "error", stage: "review" });
    expect(world.errors.at(-1)?.message).toContain("git diff failed");
  });

  it("AC-AO-4 only complete plans are reviewed: an in-progress plan is not in the trigger set, a complete one is", async () => {
    const world = new World();
    world.planProgress = "in-progress";
    const set = await world.trigger().computeTriggerSet();
    expect(set.ok && set.value).toEqual([]);
    world.planProgress = "complete";
    const complete = await world.trigger().computeTriggerSet();
    expect(complete.ok && complete.value).toEqual([{ plan: "plan-one", need: "review" }]);
  });

  it("AC-AO-4 a batch with nothing to judge never opens a suite run", async () => {
    const world = await keptOpenWorld();
    const run = await world.runner().runBatch(["plan-one"], world.ports("quiet", { changedFilesSince: changedFiles([]) }));
    expect(run.ok && run.value.state === "ran" && run.value.suiteRuns).toBe(0);
  });
});
