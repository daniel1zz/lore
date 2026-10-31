/**
 * @spec_ref spec-a-corpus-only-task-has-nothing-to-measure-and-a-closed (AC-AQ-2, AC-AQ-3, BR-1510)
 *
 * A closing plan keeps only the known defects its closing review still fails or did not measure; the others are
 * detached in the audited close, their issues commented and closed unless another open plan references them, and a
 * failed issue write is retried by every later batch until it succeeds. Everything is real except GitHub (a fake reader
 * and a fake writer) and the judge (reviews are stored directly).
 *
 * Dimensions: HAPPY (detach + comment + close), NEGATIVE (not-measured / na / accepted gate keep; unreadable refuses),
 * BOUNDARY (shared issue comment-only; different fingerprint detaches), ERROR (failed write pending), STATE (pending
 * stays pending on the second failing batch, completes on a later one), REGRESSION (every close path detaches alike).
 */

import { describe, expect, it } from "vitest";
import { ulid } from "ulidx";
import {
  DOC_TYPE_ROLE_MAP,
  MILESTONE_DIMENSIONS,
  err,
  ok,
  partitionKnownDefectsAtClose,
  readKnownDefects,
  renderMilestoneReviewContent,
  type DocId,
  type DocRecord,
  type KnownDefectEntry,
  type LoreError,
  type MilestoneDimension,
  type MilestoneReview,
  type Result,
} from "@lore/core";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import { CorpusService } from "../../src/service/corpus-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import { rootCauseOf } from "../../src/service/root-cause-fingerprint.js";
import { IssueFilingService, type IssuePort, type IssueRef } from "../../src/service/issue-filing-service.js";
import { KNOWN_DEFECT_ISSUE_WRITES_AUDIT_ACTION } from "../../src/service/known-defects-at-close.js";
import { MILESTONE_REVIEW_SUB_TYPE, planStateFingerprint } from "../../src/service/milestone-review.js";
import { ReviewLeases, planLeaseKey } from "../../src/service/review-batch-lease.js";
import { ReviewBatchRunner, type BatchRunPorts } from "../../src/service/review-batch-service.js";
import type { IssueRead } from "../../src/service/milestone-review-inputs.js";
import { actedStore } from "../live-invocation.js";

const REPO_ID = 7;
const T0 = Date.parse("2026-10-30T12:00:00.000Z");

type Verdict = "fail" | "not-measured" | "na";

/** What the fake judge cites for a dimension's failure (a fail cites a file, a not-measured gate its subject). */
function citesOf(dimension: MilestoneDimension, verdict: Verdict, variant = ""): string[] {
  return verdict === "fail" ? [`src/${dimension}${variant}.ts`] : [`${dimension}:subject${variant}`];
}

function fingerprintOf(dimension: MilestoneDimension, verdict: Verdict, variant = ""): string {
  const cause = rootCauseOf({ plan: "p", dimension, reason: "x", reference: "r", cites: citesOf(dimension, verdict, variant), reviewSlug: "r" });
  if (!cause.ok) throw new Error(JSON.stringify(cause.error));
  return cause.value.fingerprint;
}

function docOf(type: DocRecord["type"], title: string, extra: Record<string, unknown>, status: DocRecord["status"], parentId: DocId | null = null): DocRecord {
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  return { id, slug: `${type}-${title.toLowerCase().replace(/\s+/g, "-")}-${id.slice(-6).toLowerCase()}`, type, role: DOC_TYPE_ROLE_MAP[type], title, status, priority: "medium", content: "", parent_id: parentId, created_at: now, updated_at: now, created_by: "close-test", version: 1, deleted_at: null, tags: [], extra };
}

async function seed(store: InMemoryStore, doc: DocRecord): Promise<DocRecord> {
  const inserted = await store.insertWithProvenance(
    doc,
    { doc_id: doc.id, version: 1, content: doc.content, extra: doc.extra, status: doc.status, title: doc.title, action: "create", created_at: doc.created_at, created_by: "close-test", slug: doc.slug },
    { timestamp: doc.created_at, actor: "close-test", session_id: doc.id, action: "create", doc_id: doc.id, details: { version: 1 } },
  );
  if (!inserted.ok) throw new Error(`seed failed: ${JSON.stringify(inserted.error)}`);
  return inserted.value;
}

interface EntrySpec {
  readonly number: number;
  readonly dimension: MilestoneDimension;
  /** The failure the entry's fingerprint names; default: the review's own failure of the dimension. */
  readonly variant?: string;
  readonly gateAccepted?: boolean;
}

interface WorldSpec {
  readonly verdicts: Partial<Record<MilestoneDimension, Verdict>>;
  readonly entries: readonly EntrySpec[];
  /** The review's failure variant per failing dimension (the cause a different-fingerprint entry no longer matches). */
  readonly reviewVariants?: Partial<Record<MilestoneDimension, string>>;
  /** Issue numbers another open plan lists as its known defects. */
  readonly otherPlanIssues?: readonly number[];
}

class FakeGithub {
  readonly comments: { issue: number; body: string }[] = [];
  readonly closed: number[] = [];
  readonly reads: number[] = [];
  readonly unreadable = new Set<number>();
  readonly failing = new Set<string>();
  readIssue = async (issue: number): Promise<Result<IssueRead, LoreError>> => {
    this.reads.push(issue);
    if (this.unreadable.has(issue)) return err<LoreError>({ code: "STORE_ERROR", message: "gh: HTTP 502 bad gateway" });
    return ok({ repoId: REPO_ID, state: "open" as const });
  };
  commentIssue = async (issue: number, body: string): Promise<Result<void, LoreError>> => {
    if (this.failing.has(`comment:${String(issue)}`)) return err<LoreError>({ code: "STORE_ERROR", message: `gh: comment on #${String(issue)} failed` });
    this.comments.push({ issue, body });
    return ok(undefined);
  };
  closeIssue = async (issue: number): Promise<Result<void, LoreError>> => {
    if (this.failing.has(`close:${String(issue)}`)) return err<LoreError>({ code: "STORE_ERROR", message: `gh: close of #${String(issue)} failed` });
    this.closed.push(issue);
    return ok(undefined);
  };
}

async function buildWorld(spec: WorldSpec) {
  const store = actedStore(new InMemoryStore());
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, new GateEnforcer(undefined));
  const github = new FakeGithub();
  const known = spec.entries.map((e) => {
    const verdict = spec.verdicts[e.dimension] ?? "fail";
    const variant = e.variant ?? spec.reviewVariants?.[e.dimension] ?? "";
    return { repo_id: REPO_ID, number: e.number, dimension: e.dimension, fingerprint: fingerprintOf(e.dimension, verdict === "na" ? "fail" : verdict, variant), ...(e.gateAccepted === true ? { gate_accepted: true, accepted_source: "human" } : {}) };
  });
  const plan = await seed(store, docOf("plan", "Closing plan", known.length > 0 ? { known_defects: known } : {}, "approved"));
  await seed(store, docOf("task", "Landed task", { plan_id: plan.id }, "archived", plan.id));
  if (spec.otherPlanIssues !== undefined) {
    const other = known.filter((k) => spec.otherPlanIssues?.includes(k.number)).map((k) => ({ ...k }));
    await seed(store, docOf("plan", "Other plan", { known_defects: other }, "approved"));
  }
  const bundle = await corpus.getPlanBundle(plan.id);
  if (!bundle.ok) throw new Error(JSON.stringify(bundle.error));
  const dimensions = Object.fromEntries(
    MILESTONE_DIMENSIONS.map((d) => {
      const verdict = spec.verdicts[d] ?? "pass";
      return [d, { verdict, reason: `${d} ${verdict}`, reference: "r", ...(verdict === "pass" || verdict === "na" ? {} : { cites: citesOf(d, verdict, spec.reviewVariants?.[d] ?? "") }) }];
    }),
  ) as MilestoneReview["dimensions"];
  const review: MilestoneReview = {
    plan_id: plan.id,
    fingerprint: planStateFingerprint(bundle.value.plan, bundle.value.tasks, bundle.value.spec),
    overall: MILESTONE_DIMENSIONS.some((d) => spec.verdicts[d] === "fail") ? "fail" : "pass",
    dimensions,
    decisions: [],
    prompt_version: "test",
    diff_source: "test",
  };
  const doc = await corpus.createMilestoneReviewDoc({ type: "knowledge", title: "Review of closing plan", parent_id: plan.id, extra: { sub_type: MILESTONE_REVIEW_SUB_TYPE, milestone_review: review }, content: renderMilestoneReviewContent(review) });
  if (!doc.ok) throw new Error(JSON.stringify(doc.error));
  const informs = await corpus.link(doc.value.id, plan.id, "informs");
  if (!informs.ok) throw new Error(JSON.stringify(informs.error));
  corpus.setPlanCloseIssuePort({ listOpenIssues: async () => ok({ repoId: REPO_ID, open: [] }), readIssue: github.readIssue });
  corpus.setKnownDefectIssueWriter({ commentIssue: github.commentIssue, closeIssue: github.closeIssue });
  const current = async (): Promise<DocRecord> => {
    const found = await store.find(plan.id);
    if (!found.ok || found.value === null) throw new Error("plan missing");
    return found.value;
  };
  return {
    store,
    corpus,
    github,
    plan,
    reviewSlug: doc.value.slug,
    close: () => corpus.set(plan.id, { status: "archived" }, { by: "t" }),
    current,
    keptNumbers: async () => readKnownDefects((await current()).extra).map((e) => e.number),
    detachRows: async () => {
      const rows = await store.listAuditRowsByAction("update", plan.id as DocId);
      if (!rows.ok) throw new Error("audit read failed");
      return rows.value.filter((r) => r.details?.["known_defects_detached"] !== undefined);
    },
    writeRows: async () => {
      const rows = await store.listAuditRowsByAction(KNOWN_DEFECT_ISSUE_WRITES_AUDIT_ACTION);
      if (!rows.ok) throw new Error("audit read failed");
      return rows.value;
    },
  };
}

/** The five-entry scenario of AC-AQ-2 as data the pure rule reads. */
const FIVE: KnownDefectEntry[] = [
  { repo_id: REPO_ID, number: 1, dimension: "security", fingerprint: "F1" },
  { repo_id: REPO_ID, number: 2, dimension: "spec_conformance", fingerprint: "F2" },
  { repo_id: REPO_ID, number: 3, dimension: "regression", fingerprint: "F3" },
  { repo_id: REPO_ID, number: 4, dimension: "concurrency_safety", fingerprint: "F4" },
  { repo_id: REPO_ID, number: 5, dimension: "design_necessity", fingerprint: "F5" },
];

describe("AC-AQ-2 which known defects a closing plan keeps", () => {
  it("AC-AQ-2 HAPPY: the five-entry scenario keeps #2, #3 and #5 and detaches #1 and #4", () => {
    const split = partitionKnownDefectsAtClose(
      FIVE,
      {
        security: { verdict: "pass", failingFingerprints: [] },
        spec_conformance: { verdict: "fail", failingFingerprints: ["F2"] },
        regression: { verdict: "not-measured", failingFingerprints: [] },
        concurrency_safety: { verdict: "fail", failingFingerprints: ["F9"] },
        design_necessity: { verdict: "na", failingFingerprints: [] },
      },
      [],
    );
    expect(split.kept.map((e) => e.number)).toEqual([2, 3, 5]);
    expect(split.detached.map((d) => d.entry.number)).toEqual([1, 4]);
    expect(split.detached.map((d) => d.verdict)).toEqual(["pass", "fail"]);
  });

  it("AC-AQ-2 NEGATIVE: a gate accepted with --accept-gate keeps its entry, and a dimension with no fact keeps its entries", () => {
    const split = partitionKnownDefectsAtClose(FIVE, { security: { verdict: "pass", failingFingerprints: [] } }, ["security"]);
    expect(split.kept.map((e) => e.number)).toEqual([1, 2, 3, 4, 5]);
    expect(split.detached).toEqual([]);
  });

  it("AC-AQ-2 HAPPY: a close detaches #1 and #4, comments each naming the closing review, closes both, and keeps #2, #5 and the new #6", async () => {
    const w = await buildWorld({
      verdicts: { spec_conformance: "fail", concurrency_safety: "fail", design_necessity: "na" },
      reviewVariants: { concurrency_safety: "-F9" },
      entries: [
        { number: 1, dimension: "security" },
        { number: 2, dimension: "spec_conformance" },
        { number: 4, dimension: "concurrency_safety", variant: "-F4" },
        { number: 5, dimension: "design_necessity" },
        { number: 6, dimension: "concurrency_safety" },
      ],
    });
    const closed = await w.close();
    expect(closed.ok).toBe(true);
    expect((await w.current()).status).toBe("archived");
    expect(await w.keptNumbers()).toEqual([2, 5, 6]);
    expect(w.github.comments.map((c) => c.issue)).toEqual([1, 4]);
    for (const comment of w.github.comments) expect(comment.body).toContain(w.reviewSlug);
    expect(w.github.closed).toEqual([1, 4]);
  });

  it("AC-AQ-2 BOUNDARY: an issue another open plan lists is commented only, never closed", async () => {
    const w = await buildWorld({
      verdicts: { concurrency_safety: "fail" },
      reviewVariants: { concurrency_safety: "-F9" },
      entries: [
        { number: 1, dimension: "security" },
        { number: 4, dimension: "concurrency_safety", variant: "-F4" },
        { number: 6, dimension: "concurrency_safety" },
      ],
      otherPlanIssues: [1],
    });
    expect((await w.close()).ok).toBe(true);
    expect(w.github.comments.map((c) => c.issue)).toEqual([1, 4]);
    expect(w.github.closed).toEqual([4]);
  });

  it("AC-AQ-2 NEGATIVE: a failed security gate accepted for this failure keeps its entry and writes nothing to GitHub", async () => {
    const w = await buildWorld({ verdicts: { security: "fail" }, entries: [{ number: 1, dimension: "security", gateAccepted: true }] });
    expect((await w.close()).ok).toBe(true);
    expect(await w.keptNumbers()).toEqual([1]);
    expect(w.github.comments).toEqual([]);
    expect(w.github.closed).toEqual([]);
    expect(await w.detachRows()).toEqual([]);
  });

  it("AC-AQ-2 ERROR: an unreadable issue refuses the close naming it, and nothing is written", async () => {
    const w = await buildWorld({
      verdicts: {},
      entries: [
        { number: 1, dimension: "security" },
        { number: 2, dimension: "spec_conformance" },
      ],
    });
    w.github.unreadable.add(2);
    const before = await w.current();
    const closed = await w.close();
    expect(closed.ok).toBe(false);
    if (closed.ok) return;
    expect(JSON.stringify(closed.error)).toContain("#2");
    const after = await w.current();
    expect(after.status).toBe("approved");
    expect(after.version).toBe(before.version);
    expect(readKnownDefects(after.extra).map((e) => e.number)).toEqual([1, 2]);
    expect(w.github.comments).toEqual([]);
    expect(w.github.closed).toEqual([]);
    expect(await w.writeRows()).toEqual([]);
  });

  it("AC-AQ-2 STATE: a write that fails after the record changed is pending, stays pending on a second failing batch, and completes on a later one", async () => {
    const w = await buildWorld({ verdicts: {}, entries: [{ number: 1, dimension: "security" }] });
    w.github.failing.add("close:1");
    expect((await w.close()).ok).toBe(true);
    expect(await w.keptNumbers()).toEqual([]);
    expect(w.github.comments.map((c) => c.issue)).toEqual([1]);
    const first = await w.writeRows();
    expect(first).toHaveLength(1);
    expect(JSON.stringify(first[0]?.details)).toContain("\"status\":\"pending\"");
    expect(JSON.stringify(first[0]?.details)).toContain("close of #1 failed");

    const second = await w.corpus.retryPendingKnownDefectIssueWrites("t");
    expect(second.ok && second.value.map((r) => r.status)).toEqual(["pending"]);
    expect(w.github.closed).toEqual([]);
    expect(await w.writeRows()).toHaveLength(2);

    w.github.failing.clear();
    const third = await w.corpus.retryPendingKnownDefectIssueWrites("t");
    expect(third.ok && third.value.map((r) => r.status)).toEqual(["done"]);
    expect(w.github.closed).toEqual([1]);
    // the comment was done at the close and is never posted twice
    expect(w.github.comments).toHaveLength(1);
    expect(await w.writeRows()).toHaveLength(3);

    const fourth = await w.corpus.retryPendingKnownDefectIssueWrites("t");
    expect(fourth.ok && fourth.value).toEqual([]);
    expect(await w.writeRows()).toHaveLength(3);
  });

  it("AC-AQ-2 STATE: every review batch retries pending issue writes before it reviews any plan", async () => {
    const store = new InMemoryStore();
    const order: string[] = [];
    const runner = new ReviewBatchRunner({
      getPlanBundle: async () => {
        order.push("bundle");
        return err<LoreError>({ code: "DOC_NOT_FOUND", id: "x" });
      },
      listReviewDocs: async () => ok([]),
      issueCoverage: async () => err<LoreError>({ code: "STORE_ERROR", message: "unused" }),
    });
    const lease = new ReviewLeases(store, "b", () => T0, () => () => undefined);
    const ports = {
      acquirePlanLease: (planId: string) => lease.acquire(planLeaseKey(planId)),
      retryPendingIssueWrites: async () => {
        order.push("retry");
        return ok(undefined);
      },
    } as unknown as BatchRunPorts;
    await runner.runBatch(["any"], ports);
    expect(order).toEqual(["retry", "bundle"]);
  });
});

describe("AC-AQ-3 the detach runs on every close path with one audit row", () => {
  const spec: WorldSpec = {
    verdicts: { spec_conformance: "fail" },
    entries: [
      { number: 1, dimension: "security" },
      { number: 2, dimension: "spec_conformance" },
    ],
  };

  it("AC-AQ-3 REGRESSION: a hand close detaches #1, keeps #2 and writes one audit row naming #1", async () => {
    const w = await buildWorld(spec);
    expect((await w.close()).ok).toBe(true);
    expect(await w.keptNumbers()).toEqual([2]);
    const rows = await w.detachRows();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]?.details?.["known_defects_detached"])).toContain("\"number\":1");
    expect(JSON.stringify(rows[0]?.details?.["known_defects_detached"])).not.toContain("\"number\":2");
  });

  it("AC-AQ-3 REGRESSION: a plan closing accepted (no failing dimension) detaches every entry whose dimension passes", async () => {
    const w = await buildWorld({ verdicts: {}, entries: spec.entries });
    expect((await w.close()).ok).toBe(true);
    expect(await w.keptNumbers()).toEqual([]);
    const rows = await w.detachRows();
    expect(rows).toHaveLength(1);
    expect((rows[0]?.details?.["known_defects_detached"] as unknown[]).length).toBe(2);
    expect(w.github.closed).toEqual([1, 2]);
  });

  it("AC-AQ-3 REGRESSION: the review batch under --close detaches the same way and records one audit row", async () => {
    const w = await buildWorld(spec);
    const filingPort: IssuePort = {
      findOpenByFingerprint: async () => ok<IssueRef | undefined>({ number: 2 }),
      file: async () => ok<IssueRef>({ number: 99 }),
      recordKnownDefects: async () => ok(undefined),
    };
    const lease = new ReviewLeases(w.store, "batch", () => T0, () => () => undefined);
    const runner = new ReviewBatchRunner({
      getPlanBundle: (ref) => w.corpus.getPlanBundle(ref),
      listReviewDocs: (planId) => w.corpus.listMilestoneReviewDocs(planId),
      issueCoverage: (planId, failed) => w.corpus.coverageOfFailedDimensions(planId, failed),
    });
    const run = await runner.runBatch([w.plan.slug], {
      acquirePlanLease: (planId) => lease.acquire(planLeaseKey(planId)),
      settleRetirement: async () => ok({ state: "none" as const }),
      measureSuite: async () => undefined,
      reviewPlan: async () => err<LoreError>({ code: "STORE_ERROR", message: "the stored review is current; nothing is judged" }),
      closePlan: async (ref) => {
        const closed = await w.corpus.set(ref, { status: "archived" }, { by: "t" });
        return closed.ok ? ok(undefined) : closed;
      },
      recordError: async () => ok(undefined),
      filing: new IssueFilingService(filingPort),
      now: () => new Date(T0).toISOString(),
    });
    const row = run.ok && run.value.state === "ran" ? run.value.rows[0] : undefined;
    expect(row).toMatchObject({ outcome: "accepted-with-known-defects" });
    expect(await w.keptNumbers()).toEqual([2]);
    expect(await w.detachRows()).toHaveLength(1);
    expect(w.github.closed).toEqual([1]);
  });
});
