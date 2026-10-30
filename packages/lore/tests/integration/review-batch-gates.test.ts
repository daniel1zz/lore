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
 * never blocks), STATE (a kept-open plan is re-judged only on the triggers of spec AO, see review-batch-no-per-landing.test.ts),
 * REGRESSION (the fingerprint ignores main's HEAD).
 */

import { describe, expect, it } from "vitest";
import { ulid } from "ulidx";
import {
  DOC_TYPE_ROLE_MAP,
  MILESTONE_DIMENSIONS,
  renderMilestoneReviewContent,
  type DocId,
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
import { CorpusService } from "../../src/service/corpus-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import { rootCauseOf } from "../../src/service/root-cause-fingerprint.js";
import { actedStore } from "../live-invocation.js";
import { IssueFilingService, type IssuePort, type IssueRef } from "../../src/service/issue-filing-service.js";
import { coverFailedDimensions } from "../../src/service/milestone-review-inputs.js";
import { MILESTONE_REVIEW_SUB_TYPE, milestoneFactsFingerprint, planStateFingerprint, type FactsFingerprintInput } from "../../src/service/milestone-review.js";
import { ReviewLeases, planLeaseKey } from "../../src/service/review-batch-lease.js";
import { ReviewBatchRunner, type BatchErrorRecord, type BatchPlanRow, type BatchRunPorts } from "../../src/service/review-batch-service.js";
import type { MilestoneReviewResult } from "../../src/service/milestone-review-service.js";

const T0 = Date.parse("2026-10-29T12:00:00.000Z");

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
    const lease = new ReviewLeases(this.store, holder, () => this.now, () => () => undefined);
    return {
      acquirePlanLease: (planId) => lease.acquire(planLeaseKey(planId)),
      settleRetirement: async () => ok({ state: "none" as const }),
      measureSuite: async () => undefined,
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
  // the acceptance is bound to the root cause of the failure the fake judge gives this dimension (its cites)
  const verdict = plan.verdicts[dimension];
  const cites = verdict === "fail" ? [`src/${dimension}.ts`] : [`${dimension}:subject`];
  const cause = rootCauseOf({ plan: plan.slug, dimension, reason: `${dimension} ${String(verdict)}`, reference: "fixture", cites, reviewSlug: "fixture" });
  if (!cause.ok) throw new Error(JSON.stringify(cause.error));
  extra["known_defects"] = [...existing, { repo_id: 1, number: issue, dimension, fingerprint: cause.value.fingerprint, gate_accepted: true }];
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
  it("AC-AF-6 STATE: a kept-open plan with unchanged facts is not re-judged by a later batch", async () => {
    const world = new World();
    world.add(makePlan("p-sec", { security: "fail" }));
    await runOne(world, "p-sec");
    expect(world.judgeCalls).toBe(1);
    expect((await runOne(world, "p-sec", "b2")).reviewed).toBe(false);
    expect((await runOne(world, "p-sec", "b3")).reviewed).toBe(false);
    expect(world.judgeCalls).toBe(1);
  });

  const base: FactsFingerprintInput = {
    headSuiteResultId: "r1",
    singleFileRunIds: [{ key: "a.test.ts@c1:bisect", id: "t1#1" }],
    criteriaAttestationIds: [{ subject: "spec:AC-1", id: "t@1" }],
    citedRules: [{ rule_id: "BR-1", state: "verified" }],
    promptVersion: "milestone-6",
  };

  it("AC-AF-6 the facts fingerprint changes with the head suite result id", () => {
    expect(milestoneFactsFingerprint({ ...base, headSuiteResultId: "r2" })).not.toBe(milestoneFactsFingerprint(base));
  });

  it("AC-AF-6 the facts fingerprint changes with a single-file run it read", () => {
    expect(milestoneFactsFingerprint({ ...base, singleFileRunIds: [{ key: "a.test.ts@c1:bisect", id: "t2#0" }] })).not.toBe(milestoneFactsFingerprint(base));
    expect(milestoneFactsFingerprint({ ...base, singleFileRunIds: [] })).not.toBe(milestoneFactsFingerprint(base));
  });

  it("AC-AF-6 a head suite that was not run differs from one that was", () => {
    const { headSuiteResultId: _omitted, ...withoutHead } = base;
    expect(milestoneFactsFingerprint(withoutHead)).not.toBe(milestoneFactsFingerprint(base));
  });

  it("AC-AF-6 the facts fingerprint changes with a criterion's attestation id at the assessed commit", () => {
    expect(milestoneFactsFingerprint({ ...base, criteriaAttestationIds: [{ subject: "spec:AC-1", id: "t@2" }] })).not.toBe(milestoneFactsFingerprint(base));
  });

  it("AC-AF-6 the facts fingerprint changes with a cited rule's state", () => {
    expect(milestoneFactsFingerprint({ ...base, citedRules: [{ rule_id: "BR-1", state: "stale" }] })).not.toBe(milestoneFactsFingerprint(base));
  });

  it("AC-AF-6 the facts fingerprint changes with the prompt version", () => {
    expect(milestoneFactsFingerprint({ ...base, promptVersion: "milestone-7" })).not.toBe(milestoneFactsFingerprint(base));
  });

  it("AC-AF-6 REGRESSION: main's HEAD alone is not an input (no field of the input can carry it), no retired field exists, and key order is irrelevant", () => {
    expect(Object.keys(base).sort()).toEqual(["citedRules", "criteriaAttestationIds", "headSuiteResultId", "promptVersion", "singleFileRunIds"]);
    const reordered: FactsFingerprintInput = {
      ...base,
      singleFileRunIds: [{ key: "b@c:bisect", id: "2" }, { key: "a@c:bisect", id: "1" }],
      citedRules: [{ rule_id: "BR-2", state: "stale" }, { rule_id: "BR-1", state: "verified" }],
    };
    const sorted: FactsFingerprintInput = {
      ...base,
      singleFileRunIds: [{ key: "a@c:bisect", id: "1" }, { key: "b@c:bisect", id: "2" }],
      citedRules: [{ rule_id: "BR-1", state: "verified" }, { rule_id: "BR-2", state: "stale" }],
    };
    expect(milestoneFactsFingerprint(reordered)).toBe(milestoneFactsFingerprint(sorted));
  });
});

describe("AC-AF-6 errors never read as a pass", () => {
  it("AC-AF-6 ERROR: a landing lookup that fails is an errored attempt (audit row), the plan is not closed", async () => {
    const world = new World();
    const plan = world.add(makePlan("p-err", { regression: "fail" }));
    const judge = world.judge.bind(world);
    const withCauses = async (ref: string) => {
      const judged = await judge(ref);
      if (!judged.ok) return judged;
      const review = { ...judged.value.review, assessed_commit: "a".repeat(40), failing_fact_files: ["a.test.ts"], causes: { regression_files: ["a.test.ts"], suite_failing_files: ["a.test.ts"] } };
      judged.value.doc.extra["milestone_review"] = review;
      return ok({ doc: judged.value.doc, review });
    };
    await world.runner().runBatch(["p-err"], world.ports("b1", { reviewPlan: withCauses }));
    const failing = world.ports("b2", { changedFilesSince: async () => err<LoreError>({ code: "STORE_ERROR", message: "git diff failed" }) });
    const run = await world.runner().runBatch(["p-err"], failing);
    const row = run.ok && run.value.state === "ran" ? run.value.rows[0] : undefined;
    expect(row).toMatchObject({ outcome: "error", stage: "review" });
    expect(plan.archived).toBe(false);
    expect(world.errors.at(-1)?.message).toContain("git diff failed");
  });
});

// ─── A hand close (`lore set <plan> --status archived`) holds the same gates ──────────────────────────────

const HAND_REPO_ID = 7;
const HAND_ISSUE = 11;

function handDoc(type: DocRecord["type"], title: string, extra: Record<string, unknown>, status: DocRecord["status"], parentId: DocId | null = null): DocRecord {
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  return { id, slug: `${type}-${title.toLowerCase().replace(/\s+/g, "-")}-${id.slice(-6).toLowerCase()}`, type, role: DOC_TYPE_ROLE_MAP[type], title, status, priority: "medium", content: "", parent_id: parentId, created_at: now, updated_at: now, created_by: "hand-close-test", version: 1, deleted_at: null, tags: [], extra };
}

async function seedDoc(store: InMemoryStore, doc: DocRecord): Promise<DocRecord> {
  const inserted = await store.insertWithProvenance(
    doc,
    { doc_id: doc.id, version: 1, content: doc.content, extra: doc.extra, status: doc.status, title: doc.title, action: "create", created_at: doc.created_at, created_by: "hand-close-test", slug: doc.slug },
    { timestamp: doc.created_at, actor: "hand-close-test", session_id: doc.id, action: "create", doc_id: doc.id, details: { version: 1 } },
  );
  if (!inserted.ok) throw new Error(`seed failed: ${JSON.stringify(inserted.error)}`);
  return inserted.value;
}

/** What a stored failure of `dimension` carries (a fail cites a file, a not-measured gate its subject). */
function handCites(dimension: MilestoneDimension, verdict: "fail" | "not-measured", variant = ""): string[] {
  return verdict === "fail" ? [`src/${dimension}${variant}.ts`] : [`${dimension}:subject${variant}`];
}

interface HandEntry {
  readonly dimension: MilestoneDimension;
  /** The failure the entry's fingerprint names (cites variant); default: the review's own failure. */
  readonly causeVariant?: string;
  readonly gateAccepted?: boolean;
}

/** A plan with one archived task, a current stored review with the given verdicts, and the given known-defect entries (issue open). */
async function handWorld(verdicts: Partial<Record<MilestoneDimension, "fail" | "not-measured">>, entries: HandEntry[]) {
  const store = actedStore(new InMemoryStore());
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, new GateEnforcer(undefined));
  const known = entries.map((entry) => {
    const verdict = verdicts[entry.dimension] ?? "fail";
    const cause = rootCauseOf({ plan: "p", dimension: entry.dimension, reason: "x", reference: "r", cites: handCites(entry.dimension, verdict, entry.causeVariant ?? ""), reviewSlug: "r" });
    if (!cause.ok) throw new Error(JSON.stringify(cause.error));
    return { repo_id: HAND_REPO_ID, number: HAND_ISSUE, dimension: entry.dimension, fingerprint: cause.value.fingerprint, ...(entry.gateAccepted === true ? { gate_accepted: true } : {}) };
  });
  const plan = await seedDoc(store, handDoc("plan", "Hand plan", known.length > 0 ? { known_defects: known } : {}, "approved"));
  await seedDoc(store, handDoc("task", "Landed task", { plan_id: plan.id }, "archived", plan.id));
  const bundle = await corpus.getPlanBundle(plan.id);
  if (!bundle.ok) throw new Error(JSON.stringify(bundle.error));
  const dimensions = Object.fromEntries(
    MILESTONE_DIMENSIONS.map((d) => {
      const verdict = verdicts[d] ?? "pass";
      return [d, { verdict, reason: `${d} ${verdict}`, reference: "r", ...(verdict === "pass" ? {} : { cites: handCites(d, verdict) }) }];
    }),
  ) as MilestoneReview["dimensions"];
  const review: MilestoneReview = {
    plan_id: plan.id,
    fingerprint: planStateFingerprint(bundle.value.plan, bundle.value.tasks, bundle.value.spec),
    overall: MILESTONE_DIMENSIONS.some((d) => verdicts[d] === "fail") ? "fail" : "pass",
    dimensions,
    decisions: [],
    prompt_version: "test",
    diff_source: "test",
  };
  const doc = await corpus.createMilestoneReviewDoc({ type: "knowledge", title: "Review of hand plan", parent_id: plan.id, extra: { sub_type: MILESTONE_REVIEW_SUB_TYPE, milestone_review: review }, content: renderMilestoneReviewContent(review) });
  if (!doc.ok) throw new Error(JSON.stringify(doc.error));
  const informs = await corpus.link(doc.value.id, plan.id, "informs");
  if (!informs.ok) throw new Error(JSON.stringify(informs.error));
  corpus.setPlanCloseIssuePort({
    listOpenIssues: async () => ok({ repoId: HAND_REPO_ID, open: [] }),
    readIssue: async () => ok({ repoId: HAND_REPO_ID, state: "open" as const }),
  });
  return {
    plan,
    close: () => corpus.set(plan.id, { status: "archived" }, { by: "t" }),
    status: async () => {
      const found = await store.find(plan.id);
      if (!found.ok || found.value === null) throw new Error("plan missing");
      return found.value.status;
    },
  };
}

describe("AC-AF-6 a hand close holds a failed or not-measured gate that was not accepted for this failure", () => {
  it("AC-AF-6 NEGATIVE: a failed security gate with an OPEN known-defect issue is refused (exit 4) naming the gate; the plan stays open", async () => {
    const w = await handWorld({ security: "fail" }, [{ dimension: "security" }]);
    const closed = await w.close();
    expect(closed.ok).toBe(false);
    if (closed.ok) return;
    expect(closed.error).toMatchObject({ code: "VALIDATION_ERROR", field: "gate:plan-close" });
    expect(JSON.stringify(closed.error)).toContain("security");
    expect(JSON.stringify(closed.error)).toContain("--accept-gate");
    expect(await w.status()).toBe("approved");
  });

  it("AC-AF-6 NEGATIVE: a not-measured gate (overall pass) is refused naming the gate, with or without an open issue", async () => {
    for (const entries of [[], [{ dimension: "regression" as const }]]) {
      const w = await handWorld({ regression: "not-measured" }, entries);
      const closed = await w.close();
      expect(closed.ok).toBe(false);
      if (!closed.ok) expect(JSON.stringify(closed.error)).toContain("regression");
      expect(await w.status()).toBe("approved");
    }
  });

  it("AC-AF-6 NEGATIVE: a failed correctness gate cannot be covered by an issue either", async () => {
    const w = await handWorld({ correctness_vs_acs: "fail" }, [{ dimension: "correctness_vs_acs" }]);
    const closed = await w.close();
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(JSON.stringify(closed.error)).toContain("correctness_vs_acs");
  });

  it("AC-AF-6 HAPPY: a gate accepted for this very failure closes by hand", async () => {
    const w = await handWorld({ security: "fail" }, [{ dimension: "security", gateAccepted: true }]);
    expect((await w.close()).ok).toBe(true);
    expect(await w.status()).toBe("archived");
  });

  it("AC-AF-6 BOUNDARY: a gate accepted for a DIFFERENT failure of the same dimension does not close", async () => {
    const w = await handWorld({ security: "fail" }, [{ dimension: "security", causeVariant: "-older", gateAccepted: true }]);
    const closed = await w.close();
    expect(closed.ok).toBe(false);
    expect(await w.status()).toBe("approved");
  });

  it("AC-AF-6 REGRESSION: a failure of a non-gate dimension with an open issue still closes by hand", async () => {
    const w = await handWorld({ design_necessity: "fail" }, [{ dimension: "design_necessity" }]);
    expect((await w.close()).ok).toBe(true);
    expect(await w.status()).toBe("archived");
  });
});
