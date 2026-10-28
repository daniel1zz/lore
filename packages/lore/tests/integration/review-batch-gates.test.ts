/**
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-6, BR-1379, BR-1500)
 *
 * The review batch under `--close` holds a plan open for a failed or not-measured gate and closes it with known defects
 * for any other failure; the facts fingerprint moves with exactly the facts a verdict reads. Everything is injected: a
 * fake judge that stores reviews of the plan's current fingerprint, a fake issue tracker and a real lease over an
 * in-memory store, wired to the real `ReviewBatchRunner` and the real fingerprint functions.
 *
 * Dimensions: HAPPY (non-gate failures close as accepted with known defects; an accepted gate closes), NEGATIVE (a failed
 * or not-measured gate keeps the plan open with its issue filed; a plain known defect never closes a gate), BOUNDARY (`na`
 * never blocks), STATE (an unchanged facts fingerprint is not re-judged, a changed one is), REGRESSION (the fingerprint
 * ignores main's HEAD).
 */

import { describe, expect, it } from "vitest";
import {
  MILESTONE_DIMENSIONS,
  blockingGates,
  err,
  filableDimensions,
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
import { MILESTONE_REVIEW_SUB_TYPE, milestoneFactsFingerprint, planStateFingerprint, type FactsFingerprintInput } from "../../src/service/milestone-review.js";
import { REVIEW_BATCH_LEASE_NAME, ReviewBatchLease } from "../../src/service/review-batch-lease.js";
import { ReviewBatchRunner, type BatchErrorRecord, type BatchPlanRow, type BatchRunPorts } from "../../src/service/review-batch-service.js";
import type { MilestoneReviewResult } from "../../src/service/milestone-review-service.js";

const T0 = Date.parse("2026-10-29T12:00:00.000Z");
void REVIEW_BATCH_LEASE_NAME;

type Verdict = "fail" | "not-measured" | "na";

interface WorldPlan {
  readonly slug: string;
  readonly bundle: PlanBundle;
  readonly docs: DocRecord[];
  archived: boolean;
  /** Non-pass verdicts the fake judge gives this plan's dimensions. */
  verdicts: Partial<Record<MilestoneDimension, Verdict>>;
}

function stubDoc(partial: Record<string, unknown>): DocRecord {
  return { deleted_at: null, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", version: 1, content: "", tags: [], parent_id: null, ...partial } as unknown as DocRecord;
}

function makePlan(slug: string, verdicts: WorldPlan["verdicts"] = {}): WorldPlan {
  const progress = { state: "complete", open: 0, total: 1, at: "2026-10-01T00:00:00.000Z" };
  const plan = stubDoc({ id: `id-${slug}`, slug, type: "plan", status: "active", title: slug, extra: { progress } });
  const task = stubDoc({ id: `id-${slug}-t1`, slug: `${slug}-t1`, type: "task", status: "archived", title: "t", extra: {} });
  const spec = stubDoc({ id: `id-spec-${slug}`, slug: `spec-${slug}`, type: "spec", status: "approved", title: "s", extra: { acceptance_criteria: [{ id: "AC-W-1", statement: "works", verify: { mode: "human" } }] } });
  return { slug, bundle: { plan, spec, tasks: [task] } as unknown as PlanBundle, docs: [], archived: false, verdicts };
}

class FakeIssuePort implements IssuePort {
  readonly open: { number: number; title: string }[] = [];
  readonly links: { plan: string; issue: number; dimensions: string[] }[] = [];
  filed = 0;
  async findOpenByFingerprint(short: string) {
    const hit = this.open.find((i) => i.title.includes(`[fp:${short}]`));
    return ok<IssueRef | undefined>(hit === undefined ? undefined : { number: hit.number });
  }
  async file(input: { title: string }) {
    this.filed += 1;
    const number = 100 + this.filed;
    this.open.push({ number, title: input.title });
    return ok<IssueRef>({ number });
  }
  async recordKnownDefects(plan: string, issue: IssueRef, findings: readonly { dimension: string; fingerprint: string }[]) {
    for (const finding of findings) {
      const hit = this.links.find((l) => l.plan === plan && l.issue === issue.number);
      if (hit === undefined) this.links.push({ plan, issue: issue.number, dimensions: [finding.dimension] });
      else if (!hit.dimensions.includes(finding.dimension)) hit.dimensions.push(finding.dimension);
    }
    return ok(undefined);
  }
}

class World {
  readonly plans = new Map<string, WorldPlan>();
  readonly issues = new FakeIssuePort();
  readonly errors: BatchErrorRecord[] = [];
  readonly store = new InMemoryStore();
  judgeCalls = 0;
  /** The facts fingerprint a review made now would carry; tests move it to model a changed fact. */
  factsFingerprint = "facts-1";
  now = T0;

  add(plan: WorldPlan): WorldPlan {
    this.plans.set(plan.slug, plan);
    return plan;
  }

  private find(ref: string): WorldPlan {
    const plan = [...this.plans.values()].find((p) => p.slug === ref || p.bundle.plan.id === ref);
    if (plan === undefined) throw new Error(`unknown plan ${ref}`);
    return plan;
  }

  runner(): ReviewBatchRunner {
    return new ReviewBatchRunner({
      getPlanBundle: async (ref) => ok(this.find(ref).bundle),
      listReviewDocs: async (planId) => ok(this.find(planId).docs),
      issueCoverage: async (planId, failed) => {
        const slug = this.find(planId).slug;
        const entries = this.issues.links
          .filter((l) => l.plan === slug)
          .flatMap((l) => l.dimensions.map((dimension) => ({ number: l.issue, dimension, state: "open" as const })));
        return ok(coverFailedDimensions(failed, entries));
      },
    });
  }

  ports(holder: string, overrides: Partial<BatchRunPorts> = {}): BatchRunPorts {
    const lease = new ReviewBatchLease(this.store, holder, () => this.now, () => () => undefined);
    return {
      acquireLease: () => lease.acquire(),
      settleRetirement: async () => ok({ state: "none" as const }),
      measureSuite: async () => undefined,
      factsFingerprint: async () => ok(this.factsFingerprint),
      reviewPlan: async (ref) => this.judge(ref),
      closePlan: async (ref) => {
        this.find(ref).archived = true;
        return ok(undefined);
      },
      recordError: async (record) => {
        this.errors.push(record);
        return ok(undefined);
      },
      filing: new IssueFilingService(this.issues),
      now: () => new Date(this.now).toISOString(),
      ...overrides,
    };
  }

  async judge(ref: string) {
    const plan = this.find(ref);
    this.judgeCalls += 1;
    const dimensions = Object.fromEntries(
      MILESTONE_DIMENSIONS.map((d) => {
        const verdict = plan.verdicts[d] ?? "pass";
        const cites = verdict === "fail" ? [`src/${d}.ts`] : verdict === "not-measured" ? [`${d}:subject`] : undefined;
        return [d, { verdict, reason: `${d} ${verdict}`, reference: "fixture", ...(cites !== undefined ? { cites } : {}) }];
      }),
    ) as MilestoneReview["dimensions"];
    const failing = MILESTONE_DIMENSIONS.filter((d) => plan.verdicts[d] === "fail");
    const review: MilestoneReview = {
      plan_id: plan.bundle.plan.id,
      fingerprint: planStateFingerprint(plan.bundle.plan, plan.bundle.tasks, plan.bundle.spec),
      facts_fingerprint: this.factsFingerprint,
      overall: failing.length > 0 ? "fail" : "pass",
      dimensions,
      decisions: [],
      prompt_version: "fixture",
      diff_source: "fixture",
    };
    const doc = stubDoc({
      id: `rev-${this.judgeCalls}`,
      slug: `review-${plan.slug}-${this.judgeCalls}`,
      type: "knowledge",
      created_at: new Date(this.now + this.judgeCalls).toISOString(),
      extra: { sub_type: MILESTONE_REVIEW_SUB_TYPE, milestone_review: review },
    });
    plan.docs.push(doc);
    return ok<MilestoneReviewResult>({ doc, review });
  }
}

async function runOne(world: World, slug: string, holder = "batch"): Promise<BatchPlanRow> {
  const run = await world.runner().runBatch([slug], world.ports(holder));
  if (!run.ok || run.value.state !== "ran") throw new Error(`batch did not run: ${JSON.stringify(run)}`);
  const row = run.value.rows[0];
  if (row === undefined) throw new Error("no row");
  return row;
}

/** Records the plan's acceptance of a gate the way `GateAcceptanceService` does: a flagged known defect of that dimension. */
function acceptGate(plan: WorldPlan, dimension: MilestoneDimension, issue: number): void {
  const extra = plan.bundle.plan.extra as Record<string, unknown>;
  const existing = (extra["known_defects"] as unknown[] | undefined) ?? [];
  extra["known_defects"] = [...existing, { repo_id: 1, number: issue, dimension, fingerprint: "fp", gate_accepted: true }];
}

describe("AC-AF-6 a failed or not-measured gate keeps the plan open", () => {
  it("AC-AF-6 NEGATIVE: a failed security gate stays open with its issue filed, and the next batch changes nothing", async () => {
    const world = new World();
    const plan = world.add(makePlan("p-sec", { security: "fail" }));
    const row = await runOne(world, "p-sec");
    expect(row).toMatchObject({ outcome: "kept-open", reviewed: true, failed: ["security"] });
    expect(row.issues).toEqual([101]);
    expect(plan.archived).toBe(false);
    expect(world.issues.filed).toBe(1);
    expect(world.errors).toEqual([]);
    const again = await runOne(world, "p-sec", "batch-2");
    expect(again).toMatchObject({ outcome: "kept-open", reviewed: false });
    expect(world.judgeCalls).toBe(1);
    expect(world.issues.filed).toBe(1);
    expect(plan.archived).toBe(false);
  });

  it("AC-AF-6 NEGATIVE: a failed regression gate stays open with its issue filed", async () => {
    const world = new World();
    const plan = world.add(makePlan("p-reg", { regression: "fail" }));
    // a failed regression needs its measured causes to be filed; the fake judge stores them through its own review
    const judge = world.judge.bind(world);
    const row = await world.runner().runBatch(["p-reg"], world.ports("b", {
      reviewPlan: async (ref) => {
        const judged = await judge(ref);
        if (!judged.ok) return judged;
        const review = { ...judged.value.review, causes: { regression_files: ["a.test.ts"], suite_failing_files: ["a.test.ts"] } };
        judged.value.doc.extra["milestone_review"] = review;
        return ok({ doc: judged.value.doc, review });
      },
    }));
    const rows = row.ok && row.value.state === "ran" ? row.value.rows : [];
    expect(rows[0]).toMatchObject({ outcome: "kept-open", failed: ["regression"] });
    expect(plan.archived).toBe(false);
    expect(world.issues.filed).toBe(1);
  });

  it("AC-AF-6 NEGATIVE: a not-measured gate stays open and its issue is filed (a not-measured gate is not a pass)", async () => {
    const world = new World();
    const plan = world.add(makePlan("p-nm", { correctness_vs_acs: "not-measured" }));
    const row = await runOne(world, "p-nm");
    expect(row).toMatchObject({ outcome: "kept-open", reviewed: true, failed: ["correctness_vs_acs"] });
    expect(row.detail).toContain("correctness_vs_acs not-measured");
    expect(row.issues).toEqual([101]);
    expect(plan.archived).toBe(false);
  });

  it("AC-AF-6 NEGATIVE: a plain known defect (an issue the batch filed) never closes a failed gate; only an accepted gate does", async () => {
    const world = new World();
    const plan = world.add(makePlan("p-sec", { security: "fail" }));
    expect((await runOne(world, "p-sec")).outcome).toBe("kept-open");
    expect(world.issues.links).toEqual([{ plan: "p-sec", issue: 101, dimensions: ["security"] }]);
    expect(plan.archived).toBe(false);
    acceptGate(plan, "security", 101);
    const closed = await runOne(world, "p-sec", "batch-3");
    expect(closed).toMatchObject({ outcome: "accepted-with-known-defects", failed: ["security"] });
    expect(plan.archived).toBe(true);
  });

  it("AC-AF-6 BOUNDARY: an accepted gate does not hide a second, unaccepted gate", async () => {
    const world = new World();
    const plan = world.add(makePlan("p-two", { security: "fail", correctness_vs_acs: "not-measured" }));
    acceptGate(plan, "security", 101);
    const row = await runOne(world, "p-two");
    expect(row.outcome).toBe("kept-open");
    expect(row.detail).toContain("correctness_vs_acs");
    expect(row.detail).not.toContain("security failed");
    expect(plan.archived).toBe(false);
  });

  it("AC-AF-6 BOUNDARY: a gate that is n/a never blocks the close", async () => {
    const world = new World();
    const plan = world.add(makePlan("p-na", { correctness_vs_acs: "na" }));
    const row = await runOne(world, "p-na");
    expect(row).toMatchObject({ outcome: "accepted", failed: [] });
    expect(plan.archived).toBe(true);
    expect(world.issues.filed).toBe(0);
  });
});

describe("AC-AF-6 failures of the other dimensions close as accepted with known defects", () => {
  it("AC-AF-6 HAPPY: spec_conformance, design_necessity, concurrency_safety and snapshot_accuracy failures close the plan with their issues", async () => {
    const world = new World();
    const plan = world.add(makePlan("p-soft", { spec_conformance: "fail", design_necessity: "fail", concurrency_safety: "fail", snapshot_accuracy: "fail" }));
    const row = await runOne(world, "p-soft");
    expect(row.outcome).toBe("accepted-with-known-defects");
    expect(row.failed).toEqual(["spec_conformance", "design_necessity", "snapshot_accuracy", "concurrency_safety"]);
    expect(row.issues.length).toBeGreaterThan(0);
    expect(plan.archived).toBe(true);
  });

  it("AC-AF-6 REGRESSION: the pure helpers agree: gates block, other failures only need an issue", () => {
    const dims = (verdicts: Partial<Record<MilestoneDimension, Verdict | "pass">>): MilestoneReview["dimensions"] =>
      Object.fromEntries(MILESTONE_DIMENSIONS.map((d) => [d, { verdict: verdicts[d] ?? "pass", reason: "r", reference: "" }])) as MilestoneReview["dimensions"];
    expect(blockingGates(dims({ security: "fail", regression: "not-measured", correctness_vs_acs: "na" }))).toEqual(["regression", "security"]);
    expect(blockingGates(dims({ design_necessity: "fail", concurrency_safety: "not-measured" }))).toEqual([]);
    // a not-measured gate needs an issue; a not-measured judgment dimension does not
    expect(filableDimensions(dims({ regression: "not-measured", concurrency_safety: "not-measured", design_necessity: "fail" }))).toEqual(["regression", "design_necessity"]);
  });
});

describe("AC-AF-6 the review is re-made when its facts changed, never because main moved", () => {
  it("AC-AF-6 STATE: an unchanged facts fingerprint is not re-judged; a changed one is", async () => {
    const world = new World();
    world.add(makePlan("p-sec", { security: "fail" }));
    await runOne(world, "p-sec");
    expect(world.judgeCalls).toBe(1);
    expect((await runOne(world, "p-sec", "b2")).reviewed).toBe(false);
    expect(world.judgeCalls).toBe(1);
    world.factsFingerprint = "facts-2";
    expect((await runOne(world, "p-sec", "b3")).reviewed).toBe(true);
    expect(world.judgeCalls).toBe(2);
  });

  it("AC-AF-6 STATE: a review stored before the facts fingerprint existed is re-made once", async () => {
    const world = new World();
    const plan = world.add(makePlan("p-old", { security: "fail" }));
    await runOne(world, "p-old");
    const review = plan.docs[0]?.extra["milestone_review"] as Record<string, unknown>;
    delete review["facts_fingerprint"];
    expect((await runOne(world, "p-old", "b2")).reviewed).toBe(true);
    expect((await runOne(world, "p-old", "b3")).reviewed).toBe(false);
  });

  const base: FactsFingerprintInput = {
    landingResultIds: [{ landing: "c1", id: "r1" }],
    attestationIds: [{ subject: "spec:AC-1", id: "t@1" }],
    citedRules: [{ rule_id: "BR-1", state: "verified" }],
    promptVersion: "milestone-6",
    regressionUncleared: false,
  };

  it("AC-AF-6 the facts fingerprint changes with a landing's suite result id", () => {
    expect(milestoneFactsFingerprint({ ...base, landingResultIds: [{ landing: "c1", id: "r2" }] })).not.toBe(milestoneFactsFingerprint(base));
  });

  it("AC-AF-6 the facts fingerprint changes with a criterion's deciding attestation id", () => {
    expect(milestoneFactsFingerprint({ ...base, attestationIds: [{ subject: "spec:AC-1", id: "t@2" }] })).not.toBe(milestoneFactsFingerprint(base));
  });

  it("AC-AF-6 the facts fingerprint changes with a cited rule's state", () => {
    expect(milestoneFactsFingerprint({ ...base, citedRules: [{ rule_id: "BR-1", state: "stale" }] })).not.toBe(milestoneFactsFingerprint(base));
  });

  it("AC-AF-6 the facts fingerprint changes with the prompt version", () => {
    expect(milestoneFactsFingerprint({ ...base, promptVersion: "milestone-7" })).not.toBe(milestoneFactsFingerprint(base));
  });

  it("AC-AF-6 the newest main suite result matters only while regression has uncleared files", () => {
    // nothing uncleared: a newer stored main result (another clearing id) changes nothing
    expect(milestoneFactsFingerprint({ ...base, clearingResultId: "main-2" })).toBe(milestoneFactsFingerprint({ ...base, clearingResultId: "main-1" }));
    expect(milestoneFactsFingerprint({ ...base, clearingResultId: "main-1" })).toBe(milestoneFactsFingerprint(base));
    // uncleared files: a newer stored main result changes it
    const uncleared = { ...base, regressionUncleared: true };
    expect(milestoneFactsFingerprint({ ...uncleared, clearingResultId: "main-2" })).not.toBe(milestoneFactsFingerprint({ ...uncleared, clearingResultId: "main-1" }));
    expect(milestoneFactsFingerprint({ ...uncleared, clearingResultId: "main-1" })).not.toBe(milestoneFactsFingerprint({ ...base, clearingResultId: "main-1" }));
  });

  it("AC-AF-6 REGRESSION: main's HEAD alone is not an input (no field of the input can carry it) and key order is irrelevant", () => {
    expect(Object.keys(base).sort()).toEqual(["attestationIds", "citedRules", "landingResultIds", "promptVersion", "regressionUncleared"]);
    const reordered: FactsFingerprintInput = {
      ...base,
      landingResultIds: [{ landing: "c2", id: "r2" }, { landing: "c1", id: "r1" }],
      citedRules: [{ rule_id: "BR-2", state: "stale" }, { rule_id: "BR-1", state: "verified" }],
    };
    const sorted: FactsFingerprintInput = {
      ...base,
      landingResultIds: [{ landing: "c1", id: "r1" }, { landing: "c2", id: "r2" }],
      citedRules: [{ rule_id: "BR-1", state: "verified" }, { rule_id: "BR-2", state: "stale" }],
    };
    expect(milestoneFactsFingerprint(reordered)).toBe(milestoneFactsFingerprint(sorted));
  });
});

describe("AC-AF-6 errors never read as a pass", () => {
  it("AC-AF-6 ERROR: a failing facts measurement is an errored attempt (audit row), the plan is not closed", async () => {
    const world = new World();
    const plan = world.add(makePlan("p-err"));
    await runOne(world, "p-err");
    plan.archived = false;
    const failing = world.ports("b2", { factsFingerprint: async () => err<LoreError>({ code: "STORE_ERROR", message: "suite store unreadable" }) });
    const run = await world.runner().runBatch(["p-err"], failing);
    const row = run.ok && run.value.state === "ran" ? run.value.rows[0] : undefined;
    expect(row).toMatchObject({ outcome: "error", stage: "review" });
    expect(plan.archived).toBe(false);
    expect(world.errors.at(-1)?.message).toContain("suite store unreadable");
  });
});
