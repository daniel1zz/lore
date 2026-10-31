/**
 * @spec_ref spec-a-failed-regression-is-filed-tracked-accepted-and-closed (AC-PF-1, AC-PF-2, AC-PF-3, AC-PF-4, BR-1513, BR-1421)
 *
 * A failed regression is filed, tracked, accepted and closed per charged test file (#556). Real `IssueFilingService`,
 * `CorpusService` (plan close, coverage), `ReviewBatchRunner`, `GateAcceptanceService` and the decision log over an
 * in-memory store; only GitHub is a fake. The expected fingerprints are computed here with `node:crypto`, never with
 * the code under test.
 *
 * Dimensions: HAPPY (one issue per file, a fixed file closes alone), NEGATIVE (one accept never closes the gate),
 * BOUNDARY (a second plan links the same issue; a newly red file is the only one filed), STATE (c turns red after an
 * accept), REGRESSION (a set-keyed or plan-scoped fingerprint, dimension-level coverage).
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ulid } from "ulidx";
import {
  DOC_TYPE_ROLE_MAP,
  MILESTONE_DIMENSIONS,
  err,
  ok,
  readKnownDefects,
  renderMilestoneReviewContent,
  type DocId,
  type DocRecord,
  type LoreError,
  type MilestoneReview,
  type ReviewCauses,
} from "@lore/core";
import { exitCode } from "../../src/adapters/cli/utils.js";
import { CorpusService } from "../../src/service/corpus-service.js";
import { DecisionGate } from "../../src/service/decision-gate.js";
import { DecisionService } from "../../src/service/decision-service.js";
import { GateAcceptanceService, createGateAcceptanceLog, acceptedGatesOf, gateAcceptanceSubject } from "../../src/service/gate-acceptance-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { IssueFilingService, type IssuePort, type IssueRef } from "../../src/service/issue-filing-service.js";
import { MILESTONE_REVIEW_SUB_TYPE, planStateFingerprint, selectLatestMilestoneReview } from "../../src/service/milestone-review.js";
import { measuredCauses } from "../../src/service/milestone-review-service.js";
import { ReviewLeases, planLeaseKey } from "../../src/service/review-batch-lease.js";
import { ReviewBatchRunner, type BatchPlanRow } from "../../src/service/review-batch-service.js";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import { actedStore } from "../live-invocation.js";
import { humanAcceptGate } from "../helpers/gate-acceptance-log.js";
import { parseDecisionFlags } from "../../src/adapters/cli/decision-flags.js";

const REPO_ID = 7;
const FILE_A = "packages/x/tests/a.test.ts";
const FILE_B = "packages/x/tests/b.test.ts";
const FILE_C = "packages/x/tests/c.test.ts";

/** The fingerprint the spec names: sha256 of `regression|file:<path>`, no plan and no other file in the key. */
function fingerprintOfFile(file: string): string {
  return createHash("sha256").update(`regression|file:${file}`).digest("hex");
}

function titleOfFile(file: string): string {
  return `regression: main red: ${file} [fp:${fingerprintOfFile(file).slice(0, 12)}]`;
}

// ─── a tracker that remembers what it filed ───────────────────────────────────

class FakeTracker implements IssuePort {
  readonly open: { number: number; title: string }[] = [];
  readonly filedTitles: string[] = [];
  readonly links: { plan: string; issue: number; fingerprints: string[] }[] = [];
  private next = 100;

  seedOpen(number: number, title: string): void {
    this.open.push({ number, title });
  }
  async findOpenByFingerprint(short: string) {
    const hit = this.open.find((i) => i.title.includes(`[fp:${short}]`));
    return ok<IssueRef | undefined>(hit === undefined ? undefined : { number: hit.number });
  }
  async file(input: { title: string }) {
    this.next += 1;
    this.filedTitles.push(input.title);
    this.open.push({ number: this.next, title: input.title });
    return ok<IssueRef>({ number: this.next });
  }
  async recordKnownDefects(plan: string, issue: IssueRef, findings: readonly { dimension: string; fingerprint: string }[]) {
    this.links.push({ plan, issue: issue.number, fingerprints: findings.map((f) => f.fingerprint) });
    return ok(undefined);
  }
}

function regressionFinding(plan: string, files: readonly string[]) {
  const causes: ReviewCauses = { regression_files: [...files] };
  return { plan, dimension: "regression" as const, reason: "main is red", reference: "", reviewSlug: `review-${plan}`, causes };
}

// ─── a plan with a stored review, over the real corpus ────────────────────────

function docOf(type: DocRecord["type"], title: string, extra: Record<string, unknown>, status: DocRecord["status"], parentId: DocId | null = null): DocRecord {
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  return { id, slug: `${type}-${title.toLowerCase().replace(/\s+/g, "-")}-${id.slice(-6).toLowerCase()}`, type, role: DOC_TYPE_ROLE_MAP[type], title, status, priority: "medium", content: "", parent_id: parentId, created_at: now, updated_at: now, created_by: "pf-test", version: 1, deleted_at: null, tags: [], extra };
}

async function seed(store: InMemoryStore, doc: DocRecord): Promise<DocRecord> {
  const inserted = await store.insertWithProvenance(
    doc,
    { doc_id: doc.id, version: 1, content: doc.content, extra: doc.extra, status: doc.status, title: doc.title, action: "create", created_at: doc.created_at, created_by: "pf-test", slug: doc.slug },
    { timestamp: doc.created_at, actor: "pf-test", session_id: doc.id, action: "create", doc_id: doc.id, details: { version: 1 } },
  );
  if (!inserted.ok) throw new Error(`seed failed: ${JSON.stringify(inserted.error)}`);
  return inserted.value;
}

/** A decision gate that never asks git (the fixture's premise is an issue source). */
const gate = new DecisionGate({ headSha: () => ({ ok: false, reason: "no git" }), hasUncommittedChanges: () => ({ ok: false, reason: "no git" }), readLinesAt: () => ({ ok: false, reason: "no git" }) });
const FULL_DECISION = (() => {
  const parsed = parseDecisionFlags({ reason: "known flaky infrastructure", premise: "the red file is outside this plan|issue:#1|A", alt: "fix the file|out of scope" });
  if (!parsed.ok || parsed.value === undefined) throw new Error("fixture decision did not parse");
  return parsed.value;
})();

interface FakeGithub {
  readonly comments: { issue: number; body: string }[];
  readonly closed: number[];
}

interface World {
  readonly store: InMemoryStore;
  readonly corpus: CorpusService;
  readonly plan: DocRecord;
  readonly github: FakeGithub;
  /** Issue numbers open on GitHub. */
  readonly openIssues: Set<number>;
  reload(): Promise<DocRecord>;
  close(): ReturnType<CorpusService["set"]>;
  accept(file: string): Promise<number>;
  latest(): Promise<{ doc: DocRecord; review: MilestoneReview }>;
  service(tracker: FakeTracker, writerSource?: string): GateAcceptanceService;
  runBatch(tracker: FakeTracker): Promise<{ row: BatchPlanRow; judgments: number }>;
}

/**
 * A plan whose stored review charged `charged` to its regression gate, with one open known-defect entry per file in
 * `entries` (file -> issue number).
 */
async function worldWith(charged: readonly string[], entries: Readonly<Record<string, number>>): Promise<World> {
  const store = actedStore(new InMemoryStore());
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, new GateEnforcer(undefined));
  const known = Object.entries(entries).map(([file, number]) => ({ repo_id: REPO_ID, number, dimension: "regression", fingerprint: fingerprintOfFile(file) }));
  const plan = await seed(store, docOf("plan", "Regression plan", known.length > 0 ? { known_defects: known } : {}, "approved"));
  await seed(store, docOf("task", "Landed task", { plan_id: plan.id }, "archived", plan.id));
  const bundle = await corpus.getPlanBundle(plan.id);
  if (!bundle.ok) throw new Error(JSON.stringify(bundle.error));
  const dimensions = Object.fromEntries(
    MILESTONE_DIMENSIONS.map((d) => [d, d === "regression" ? { verdict: "fail", reason: `main red: ${charged.join(", ")}`, reference: "r" } : { verdict: "pass", reason: `${d} pass`, reference: "r" }]),
  ) as MilestoneReview["dimensions"];
  const review: MilestoneReview = {
    plan_id: plan.id,
    fingerprint: planStateFingerprint(bundle.value.plan, bundle.value.tasks, bundle.value.spec),
    overall: "fail",
    dimensions,
    causes: { regression_files: [...charged].sort() },
    decisions: [],
    prompt_version: "test",
    diff_source: "test",
  };
  const doc = await corpus.createMilestoneReviewDoc({ type: "knowledge", title: "Review of regression plan", parent_id: plan.id, extra: { sub_type: MILESTONE_REVIEW_SUB_TYPE, milestone_review: review }, content: renderMilestoneReviewContent(review) });
  if (!doc.ok) throw new Error(JSON.stringify(doc.error));
  const informs = await corpus.link(doc.value.id, plan.id, "informs");
  if (!informs.ok) throw new Error(JSON.stringify(informs.error));

  const openIssues = new Set<number>(Object.values(entries));
  const github: FakeGithub = { comments: [], closed: [] };
  corpus.setPlanCloseIssuePort({
    listOpenIssues: async () => ok({ repoId: REPO_ID, open: [] }),
    readIssue: async (n) => (openIssues.has(n) ? ok({ repoId: REPO_ID, state: "open" as const }) : err<LoreError>({ code: "STORE_ERROR", message: `no issue #${String(n)}` })),
  });
  corpus.setKnownDefectIssueWriter({
    commentIssue: async (issue, body) => {
      github.comments.push({ issue, body });
      return ok(undefined);
    },
    closeIssue: async (issue) => {
      github.closed.push(issue);
      return ok(undefined);
    },
  });
  const reload = async (): Promise<DocRecord> => {
    const found = await store.find(plan.id);
    if (!found.ok || found.value === null) throw new Error("plan missing");
    return found.value;
  };
  const latest = async () => {
    const docs = await corpus.listMilestoneReviewDocs(plan.id);
    if (!docs.ok) throw new Error(JSON.stringify(docs.error));
    const found = selectLatestMilestoneReview(docs.value);
    if (found === undefined) throw new Error("no review");
    return found;
  };
  return {
    store,
    corpus,
    plan,
    github,
    openIssues,
    reload,
    close: () => corpus.set(plan.id, { status: "archived" }, { by: "t" }),
    accept: (file) => humanAcceptGate(store, plan.id, "regression", fingerprintOfFile(file)),
    latest,
    service: (tracker, writerSource = "run") =>
      new GateAcceptanceService({
        getPlanBundle: (ref) => corpus.getPlanBundle(ref),
        listReviewDocs: (planId) => corpus.listMilestoneReviewDocs(planId),
        gate,
        filing: new IssueFilingService(tracker),
        writer: corpus,
        by: "t",
        writerSource,
        decisions: new DecisionService({ store, executorRun: null }),
        log: createGateAcceptanceLog(store),
      }),
    runBatch: async (tracker) => {
      let judgments = 0;
      const lease = new ReviewLeases(store, "batch", () => Date.now(), () => () => undefined);
      const runner = new ReviewBatchRunner({
        getPlanBundle: (ref) => corpus.getPlanBundle(ref),
        listReviewDocs: (planId) => corpus.listMilestoneReviewDocs(planId),
        issueCoverage: (planId, failed) => corpus.coverageOfFailedDimensions(planId, failed),
        acceptanceLog: createGateAcceptanceLog(store),
      });
      const run = await runner.runBatch([plan.slug], {
        acquirePlanLease: (planId) => lease.acquire(planLeaseKey(planId)),
        settleRetirement: async () => ok({ state: "none" as const }),
        measureSuite: async () => undefined,
        reviewPlan: async () => {
          judgments += 1;
          return err<LoreError>({ code: "STORE_ERROR", message: "the batch judged a plan whose current review stands" });
        },
        closePlan: async (ref) => {
          const closed = await corpus.set(ref, { status: "archived" }, { by: "t" });
          return closed.ok ? ok(undefined) : closed;
        },
        recordError: async () => ok(undefined),
        filing: new IssueFilingService(tracker),
        now: () => new Date().toISOString(),
      });
      if (!run.ok || run.value.state !== "ran") throw new Error(`batch did not run: ${JSON.stringify(run)}`);
      const row = run.value.rows[0];
      if (row === undefined) throw new Error("no row");
      return { row, judgments };
    },
  };
}

// ─── AC-PF-1 ──────────────────────────────────────────────────────────────────

describe("AC-PF-1 one regression issue per charged file, shared across plans", () => {
  it("AC-PF-1 HAPPY: a review charging a and b files two issues titled by file, fingerprinted by the path alone", async () => {
    const tracker = new FakeTracker();
    const filing = new IssueFilingService(tracker);
    const filed = await filing.fileFindings([regressionFinding("plan-one", [FILE_A, FILE_B])]);
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;
    expect(filed.value.map((g) => g.error)).toEqual([undefined, undefined]);
    expect(tracker.filedTitles).toEqual([titleOfFile(FILE_A), titleOfFile(FILE_B)]);
    expect(filed.value.map((g) => g.cause.fingerprint)).toEqual([fingerprintOfFile(FILE_A), fingerprintOfFile(FILE_B)]);
    expect(filed.value.map((g) => g.cause.label)).toEqual([`main red: ${FILE_A}`, `main red: ${FILE_B}`]);
    // one known-defect link per (plan, issue): plan-one links both issues, each carrying its own fingerprint
    expect(tracker.links).toEqual([
      { plan: "plan-one", issue: 101, fingerprints: [fingerprintOfFile(FILE_A)] },
      { plan: "plan-one", issue: 102, fingerprints: [fingerprintOfFile(FILE_B)] },
    ]);
  });

  it("AC-PF-1 BOUNDARY: a second plan charged with a links a's open issue and files nothing new", async () => {
    const tracker = new FakeTracker();
    const filing = new IssueFilingService(tracker);
    const first = await filing.fileFindings([regressionFinding("plan-one", [FILE_A, FILE_B])]);
    const second = await filing.fileFindings([regressionFinding("plan-two", [FILE_A])]);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(tracker.filedTitles).toHaveLength(2);
    expect(second.value).toHaveLength(1);
    expect(second.value[0]?.reused).toBe(true);
    expect(second.value[0]?.issue?.number).toBe(101);
    expect(second.value[0]?.cause.fingerprint).toBe(first.value[0]?.cause.fingerprint);
    expect(tracker.links.filter((l) => l.plan === "plan-two")).toEqual([{ plan: "plan-two", issue: 101, fingerprints: [fingerprintOfFile(FILE_A)] }]);
  });

  it("AC-PF-1 REGRESSION: the same file under a changed set or another plan keeps one issue (no set-keyed or plan-scoped fingerprint)", async () => {
    const tracker = new FakeTracker();
    const filing = new IssueFilingService(tracker);
    await filing.fileFindings([regressionFinding("plan-one", [FILE_A, FILE_B])]);
    await filing.fileFindings([regressionFinding("plan-two", [FILE_A, FILE_B, FILE_C])]);
    await filing.fileFindings([regressionFinding("plan-three", [FILE_B])]);
    expect(tracker.filedTitles).toEqual([titleOfFile(FILE_A), titleOfFile(FILE_B), titleOfFile(FILE_C)]);
  });

  it("AC-PF-1 NEGATIVE: a review's measured causes carry the charged files once, with no duplicate suite_failing_files field", () => {
    const dimensions = { regression: { verdict: "fail" }, snapshot_accuracy: { verdict: "pass" } } as unknown as Parameters<typeof measuredCauses>[0];
    const causes = measuredCauses(dimensions, [FILE_B, FILE_A], []);
    expect(causes?.regression_files).toEqual([FILE_A, FILE_B]);
    expect(Object.keys(causes ?? {})).toEqual(["regression_files"]);
  });
});

// ─── AC-PF-2 ──────────────────────────────────────────────────────────────────

describe("AC-PF-2 a fixed file closes only its own issue", () => {
  it("AC-PF-2 HAPPY: the latest review charges only b, so closing detaches a's entry and closes a's issue; b's stays", async () => {
    const w = await worldWith([FILE_B], { [FILE_A]: 1, [FILE_B]: 2 });
    await w.accept(FILE_B);
    const closed = await w.close();
    expect(closed.ok).toBe(true);
    const stored = await w.reload();
    expect(stored.status).toBe("archived");
    expect(readKnownDefects(stored.extra).map((e) => [e.number, e.fingerprint])).toEqual([[2, fingerprintOfFile(FILE_B)]]);
    expect(w.github.comments.map((c) => c.issue)).toEqual([1]);
    expect(w.github.closed).toEqual([1]);
  });

  it("AC-PF-2 BOUNDARY: a review charging a, b and c files only c", async () => {
    const tracker = new FakeTracker();
    tracker.seedOpen(1, titleOfFile(FILE_A));
    tracker.seedOpen(2, titleOfFile(FILE_B));
    const filed = await new IssueFilingService(tracker).fileFindings([regressionFinding("plan-one", [FILE_A, FILE_B, FILE_C])]);
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;
    expect(tracker.filedTitles).toEqual([titleOfFile(FILE_C)]);
    expect(filed.value.map((g) => g.reused)).toEqual([true, true, false]);
  });

  it("AC-PF-2 REGRESSION: still-red a and b keep both entries, so a failing set that did not shrink detaches nothing", async () => {
    const w = await worldWith([FILE_A, FILE_B], { [FILE_A]: 1, [FILE_B]: 2 });
    await w.accept(FILE_A);
    await w.accept(FILE_B);
    expect((await w.close()).ok).toBe(true);
    expect(readKnownDefects((await w.reload()).extra).map((e) => e.number)).toEqual([1, 2]);
    expect(w.github.closed).toEqual([]);
  });
});

// ─── AC-PF-3 ──────────────────────────────────────────────────────────────────

describe("AC-PF-3 coverage is per root cause", () => {
  it("AC-PF-3 HAPPY: with a's issue open and c newly charged, the dimension is uncovered and names c's cause", async () => {
    const w = await worldWith([FILE_A, FILE_C], { [FILE_A]: 1 });
    const coverage = await w.corpus.coverageOfFailedDimensions(w.plan.id, ["regression"]);
    expect(coverage.ok).toBe(true);
    if (!coverage.ok) return;
    expect(coverage.value.accepted).toBe(false);
    expect(coverage.value.uncovered).toEqual(["regression"]);
    expect(coverage.value.uncoveredCauses?.map((c) => c.fingerprint)).toEqual([fingerprintOfFile(FILE_C)]);
    expect(coverage.value.issues).toEqual([1]);
  });

  it("AC-PF-3 REGRESSION: the review batch does not skip the plan as covered and files c, linking a's open issue", async () => {
    const w = await worldWith([FILE_A, FILE_C], { [FILE_A]: 1 });
    const tracker = new FakeTracker();
    tracker.seedOpen(1, titleOfFile(FILE_A));
    const { row, judgments } = await w.runBatch(tracker);
    expect(judgments).toBe(0);
    expect(row.outcome).not.toBe("skipped");
    expect(tracker.filedTitles).toEqual([titleOfFile(FILE_C)]);
    expect(row.issues).toEqual([1, 101]);
  });

  it("AC-PF-3 NEGATIVE: hand close with c uncovered exits 4 naming c's cause and writes nothing", async () => {
    const w = await worldWith([FILE_A, FILE_C], { [FILE_A]: 1 });
    await w.accept(FILE_A);
    await w.accept(FILE_C);
    const before = await w.reload();
    const closed = await w.close();
    expect(closed.ok).toBe(false);
    if (closed.ok) return;
    expect(exitCode(closed.error)).toBe(4);
    expect(JSON.stringify(closed.error)).toContain(`main red: ${FILE_C}`);
    expect(JSON.stringify(closed.error)).not.toContain(`main red: ${FILE_A}`);
    const after = await w.reload();
    expect(after.status).toBe("approved");
    expect(after.version).toBe(before.version);
  });
});

// ─── AC-PF-4 ──────────────────────────────────────────────────────────────────

describe("AC-PF-4 the regression gate is accepted file by file", () => {
  it("AC-PF-4 NEGATIVE: a human accept of a alone leaves the gate unaccepted and close exits 4 naming b", async () => {
    const w = await worldWith([FILE_A, FILE_B], { [FILE_A]: 1, [FILE_B]: 2 });
    await w.accept(FILE_A);
    const accepted = await acceptedGatesOf(w.plan, await w.latest(), createGateAcceptanceLog(w.store));
    expect(accepted).toEqual({ ok: true, value: [] });
    const closed = await w.close();
    expect(closed.ok).toBe(false);
    if (closed.ok) return;
    expect(exitCode(closed.error)).toBe(4);
    expect(JSON.stringify(closed.error)).toContain(`main red: ${FILE_B}`);
    expect(JSON.stringify(closed.error)).not.toContain(`main red: ${FILE_A}`);
    expect((await w.reload()).status).toBe("approved");
  });

  it("AC-PF-4 HAPPY: after b is accepted too, the gate is accepted and close proceeds", async () => {
    const w = await worldWith([FILE_A, FILE_B], { [FILE_A]: 1, [FILE_B]: 2 });
    await w.accept(FILE_A);
    expect((await w.close()).ok).toBe(false);
    await w.accept(FILE_B);
    const accepted = await acceptedGatesOf(w.plan, await w.latest(), createGateAcceptanceLog(w.store));
    expect(accepted).toEqual({ ok: true, value: ["regression"] });
    expect((await w.close()).ok).toBe(true);
    expect((await w.reload()).status).toBe("archived");
  });

  it("AC-PF-4 STATE: a newly red c makes the gate unaccepted again; an agent's accept-gate asks for c only", async () => {
    const w = await worldWith([FILE_A, FILE_B, FILE_C], { [FILE_A]: 1, [FILE_B]: 2, [FILE_C]: 3 });
    await w.accept(FILE_A);
    await w.accept(FILE_B);
    const log = createGateAcceptanceLog(w.store);
    const accepted = await acceptedGatesOf(w.plan, await w.latest(), log);
    expect(accepted).toEqual({ ok: true, value: [] });

    const tracker = new FakeTracker();
    tracker.seedOpen(1, titleOfFile(FILE_A));
    tracker.seedOpen(2, titleOfFile(FILE_B));
    tracker.seedOpen(3, titleOfFile(FILE_C));
    const asked = await w.service(tracker, "run").acceptGate(w.plan.slug, "regression", FULL_DECISION);
    expect(asked.ok).toBe(false);
    if (asked.ok) return;
    expect(exitCode(asked.error)).toBe(4);
    const pendingOf = async (file: string) => {
      const id = await log.pendingId(gateAcceptanceSubject(w.plan.id, "regression", fingerprintOfFile(file)));
      if (!id.ok) throw new Error(JSON.stringify(id.error));
      return id.value;
    };
    expect(await pendingOf(FILE_A)).toBeNull();
    expect(await pendingOf(FILE_B)).toBeNull();
    expect(await pendingOf(FILE_C)).not.toBeNull();
    expect((await w.reload()).status).toBe("approved");
  });

  it("AC-PF-4 REGRESSION: a human party's accept-gate accepts every red file and flags each known defect as a record", async () => {
    const w = await worldWith([FILE_A, FILE_B], { [FILE_A]: 1, [FILE_B]: 2 });
    const tracker = new FakeTracker();
    tracker.seedOpen(1, titleOfFile(FILE_A));
    tracker.seedOpen(2, titleOfFile(FILE_B));
    const accepted = await w.service(tracker, "human").acceptGate(w.plan.slug, "regression", FULL_DECISION);
    expect(accepted.ok).toBe(true);
    const gates = await acceptedGatesOf(w.plan, await w.latest(), createGateAcceptanceLog(w.store));
    expect(gates).toEqual({ ok: true, value: ["regression"] });
    expect(readKnownDefects((await w.reload()).extra).map((e) => [e.number, e.gate_accepted])).toEqual([
      [1, true],
      [2, true],
    ]);
  });
});
