// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-7, BR-1500)
 *
 * `lore assess <plan> --accept-gate <dimension>` records a decision and a known defect of that gate on the plan, the only
 * way the review batch closes a plan past a failed or not-measured gate. Two layers:
 *   - the real CLI in a throwaway corpus (`lore init`, never the repo's `.lore`): the exit codes and messages of the refusals;
 *   - the real `GateAcceptanceService`, `CorpusService`, decision gate, known-defect port and `ReviewBatchRunner` over an
 *     in-memory store, with a fake GitHub reader: nothing is written on a refusal; a full decision records the decision on
 *     the plan's version row and a `gate_accepted` known defect, and the next `--close` archives the plan.
 *
 * Dimensions: HAPPY (accepted gate closes), NEGATIVE (missing decision parts, correctness, a non-gate, nothing to accept),
 * BOUNDARY (a plain issue never closes the gate), ERROR (no tracker configured, stale review), STATE (before/after).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ulid } from "ulidx";
import { DOC_TYPE_ROLE_MAP, MILESTONE_DIMENSIONS, err, ok, readKnownDefects, renderMilestoneReviewContent, type DocId, type DocRecord, type LoreError, type MilestoneReview } from "@lore/core";
import { createGithubIssuePort } from "../../../src/adapters/cli/assess-file-issues.js";
import type { GithubFilingContext, GithubUpstreamCfg } from "../../../src/adapters/cli/report-issue-wiring.js";
import { parseDecisionFlags } from "../../../src/adapters/cli/decision-flags.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { DecisionGate, type DecisionDraft } from "../../../src/service/decision-gate.js";
import { GateAcceptanceService } from "../../../src/service/gate-acceptance-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { IssueFilingService } from "../../../src/service/issue-filing-service.js";
import { DecisionOutcomeService } from "../../../src/service/decision-outcome-service.js";
import { selectPlanDecisions } from "../../../src/service/decision-recheck.js";
import { MILESTONE_REVIEW_SUB_TYPE, planStateFingerprint, selectLatestMilestoneReview } from "../../../src/service/milestone-review.js";
import { ReviewLeases, planLeaseKey } from "../../../src/service/review-batch-lease.js";
import { ReviewBatchRunner } from "../../../src/service/review-batch-service.js";
import { issueTitleOf, rootCauseOf } from "../../../src/service/root-cause-fingerprint.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { actedStore } from "../../live-invocation.js";
import { DECIDED_FLAGS } from "../../helpers/decision-flags.js";
import { installStubClaude, stubClaudeEnv } from "../../helpers/stub-claude.js";
import { ensureRequirementsDocSlug } from "../../helpers/parented-create.js";


// ─── The real CLI ─────────────────────────────────────────────────────────────

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let tmpDir: string;

function runLore(args: string[]): RunResult {
  // reason: an agent harness exports its own per-call LORE_HARNESS_RUN (a run unknown to this throwaway corpus); the test
  // run's spawn wrapper names the test's own known run when none is set, so the leaked one is removed.
  const env = stubClaudeEnv(tmpDir, join(tmpDir, "stub-bin"));
  delete env["LORE_HARNESS_RUN"];
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], { cwd: tmpDir, env, encoding: "utf8" });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

function createPlan(title: string): string {
  const parent = ensureRequirementsDocSlug((a) => runLore(a));
  const r = runLore(["create", "plan", "--parent", parent, "--title", title, "--no-ai", "--content", "body"]);
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  const slug = r.stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`no plan slug in: ${r.stdout}`);
  return slug;
}

describe("AC-AF-7 the CLI refuses an acceptance without its decision or for a gate that cannot be accepted", () => {
  beforeEach(() => {
    tmpDir = join(tmpdir(), `lore-accept-gate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    installStubClaude(tmpDir);
    const init = runLore(["init"]);
    if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("AC-AF-7 NEGATIVE: --accept-gate security without --reason/--premise/--alt exits 4 naming the missing parts and writes nothing", () => {
    const plan = createPlan("Gate plan");
    const before = runLore(["get", plan, "--json"]).stdout;
    const refused = runLore(["assess", plan, "--accept-gate", "security"]);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("reason");
    expect(refused.stderr).toContain("premise");
    expect(refused.stderr).toContain("alternative");
    expect(refused.stderr).toContain("Nothing was written");
    expect(runLore(["get", plan, "--json"]).stdout).toBe(before);
    expect(runLore(["log", plan]).stdout).not.toContain("accept-gate");
  });

  it("AC-AF-7 NEGATIVE: a decision missing only its alternative names only the alternative", () => {
    const plan = createPlan("Partial decision plan");
    const refused = runLore(["assess", plan, "--accept-gate", "security", "--reason", "r", "--premise", "p|issue:#1|A"]);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("alternative");
    expect(refused.stderr).not.toContain("missing: reason");
  });

  it("AC-AF-7 NEGATIVE: --accept-gate correctness_vs_acs exits 4 naming `lore ac supersede`, even with a full decision", () => {
    const plan = createPlan("Correctness plan");
    const refused = runLore(["assess", plan, "--accept-gate", "correctness_vs_acs", ...DECIDED_FLAGS]);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("lore ac supersede");
  });

  it("AC-AF-7 NEGATIVE: a dimension that is not a gate exits 4 naming the gates", () => {
    const plan = createPlan("Soft plan");
    const refused = runLore(["assess", plan, "--accept-gate", "design_necessity", ...DECIDED_FLAGS]);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("not a gate");
  });

  it("AC-AF-7 NEGATIVE: a full decision for a plan with no review exits 4 telling to assess first, and writes nothing", () => {
    const plan = createPlan("Unreviewed plan");
    const before = runLore(["get", plan, "--json"]).stdout;
    const refused = runLore(["assess", plan, "--accept-gate", "security", ...DECIDED_FLAGS]);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("no milestone review");
    expect(runLore(["get", plan, "--json"]).stdout).toBe(before);
  });

  it("AC-AF-7 NEGATIVE: --accept-gate with more than one plan or with --close is a usage error (exit 2)", () => {
    expect(runLore(["assess", "a", "b", "--accept-gate", "security"]).exitCode).toBe(2);
    expect(runLore(["assess", "a", "--accept-gate", "security", "--close"]).exitCode).toBe(2);
  });
});

// ─── The real services over an in-memory store ────────────────────────────────

const REPO_ID = 7;
const ISSUE = 11;

function rawDoc(type: DocRecord["type"], title: string, extra: Record<string, unknown>, status: DocRecord["status"], parentId: DocId | null = null): DocRecord {
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  return {
    id,
    slug: `${type}-${title.toLowerCase().replace(/\s+/g, "-")}-${id.slice(-6).toLowerCase()}`,
    type,
    role: DOC_TYPE_ROLE_MAP[type],
    title,
    status,
    priority: "medium",
    content: "",
    parent_id: parentId,
    created_at: now,
    updated_at: now,
    created_by: "accept-gate-test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra,
  };
}

async function seed(store: StoreInterface, doc: DocRecord): Promise<DocRecord> {
  const inserted = await store.insertWithProvenance(
    doc,
    { doc_id: doc.id, version: 1, content: doc.content, extra: doc.extra, status: doc.status, title: doc.title, action: "create", created_at: doc.created_at, created_by: "accept-gate-test", slug: doc.slug },
    { timestamp: doc.created_at, actor: "accept-gate-test", session_id: doc.id, action: "create", doc_id: doc.id, details: { version: 1 } },
  );
  if (!inserted.ok) throw new Error(`seed failed: ${JSON.stringify(inserted.error)}`);
  return inserted.value;
}

/** A decision gate that never asks git (the fixture's premise is an issue source). */
const gate = new DecisionGate({ headSha: () => ({ ok: false, reason: "no git" }), hasUncommittedChanges: () => ({ ok: false, reason: "no git" }), readLinesAt: () => ({ ok: false, reason: "no git" }) });

const FULL_DECISION: DecisionDraft = (() => {
  const parsed = parseDecisionFlags({ reason: "the finding is a false positive", premise: "the flagged call is behind an allowlist|issue:#1|A", alt: "fix the finding|no defect to fix" });
  if (!parsed.ok || parsed.value === undefined) throw new Error("fixture decision did not parse");
  return parsed.value;
})();

interface World {
  readonly store: InMemoryStore;
  readonly corpus: CorpusService;
  readonly plan: DocRecord;
  readonly open: { current: boolean };
  filings: number;
  service(opts?: { tracker?: boolean }): GateAcceptanceService;
  runBatch(): Promise<{ outcome: string; detail: string }>;
  reload(): Promise<DocRecord>;
  /** How many times the batch asked the judge to re-make the review. */
  judgments: number;
}

/** A plan with one archived task and a stored review whose `verdicts` are failing / not measured / passing. */
async function worldWith(
  verdicts: Partial<Record<(typeof MILESTONE_DIMENSIONS)[number], "fail" | "not-measured" | "pass">>,
  /** The structured causes stored when regression is not-measured (absent: `unrunnable`, what a suite that could not complete reports). */
  regressionCauses: NonNullable<MilestoneReview["regression_causes"]> = ["unrunnable"],
): Promise<World> {
  const store = actedStore(new InMemoryStore());
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, new GateEnforcer(undefined));
  const plan = await seed(store, rawDoc("plan", "Gate plan", {}, "approved"));
  await seed(store, rawDoc("task", "Landed task", { plan_id: plan.id }, "archived", plan.id));
  const bundle = await corpus.getPlanBundle(plan.id);
  if (!bundle.ok) throw new Error(JSON.stringify(bundle.error));
  const dimensions = Object.fromEntries(
    MILESTONE_DIMENSIONS.map((d) => {
      const verdict = verdicts[d] ?? "pass";
      return [d, { verdict, reason: `${d} ${verdict}`, reference: "r", ...(verdict === "fail" ? { cites: [`src/${d}.ts`] } : verdict === "not-measured" ? { cites: [`${d}:subject`] } : {}) }];
    }),
  ) as MilestoneReview["dimensions"];
  const review: MilestoneReview = {
    plan_id: plan.id,
    fingerprint: planStateFingerprint(bundle.value.plan, bundle.value.tasks, bundle.value.spec),
    overall: MILESTONE_DIMENSIONS.some((d) => verdicts[d] === "fail") ? "fail" : "pass",
    dimensions,
    decisions: [],
    ...(verdicts.regression === "not-measured" ? { regression_causes: [...regressionCauses] } : {}),
    prompt_version: "test",
    diff_source: "test",
  };
  const doc = await corpus.createMilestoneReviewDoc({ type: "knowledge", title: "Review of gate plan", parent_id: plan.id, extra: { sub_type: MILESTONE_REVIEW_SUB_TYPE, milestone_review: review }, content: renderMilestoneReviewContent(review) });
  if (!doc.ok) throw new Error(JSON.stringify(doc.error));
  const informs = await corpus.link(doc.value.id, plan.id, "informs");
  if (!informs.ok) throw new Error(JSON.stringify(informs.error));

  // the tracker: ONE open issue (#ISSUE) carrying the finding's fingerprint, so filing reuses it and files nothing
  const open = { current: true };
  const dimension = MILESTONE_DIMENSIONS.find((d) => verdicts[d] === "fail" || verdicts[d] === "not-measured") ?? "security";
  const judgment = dimensions[dimension];
  const cause = rootCauseOf({ plan: plan.slug, dimension, reason: judgment.reason, reference: judgment.reference, cites: judgment.cites, reviewSlug: doc.value.slug });
  if (!cause.ok) throw new Error(JSON.stringify(cause.error));
  corpus.setPlanCloseIssuePort({
    listOpenIssues: async () => ok({ repoId: REPO_ID, open: [{ number: ISSUE, title: issueTitleOf(cause.value) }] }),
    readIssue: async (n) => (n === ISSUE ? ok({ repoId: REPO_ID, state: open.current ? ("open" as const) : ("closed" as const) }) : err<LoreError>({ code: "STORE_ERROR", message: `no issue #${String(n)}` })),
  });
  const world: World = {
    store,
    corpus,
    plan,
    open,
    filings: 0,
    judgments: 0,
    service: (opts) => {
      const port = createGithubIssuePort({ repo: "owner/repo" } as GithubUpstreamCfg, { actor: "t" } as GithubFilingContext, corpus, corpus.getPlanCloseIssuePort());
      const counting = { ...port, file: async (input: Parameters<typeof port.file>[0]) => { world.filings += 1; return port.file(input); } };
      return new GateAcceptanceService({
        getPlanBundle: (ref) => corpus.getPlanBundle(ref),
        listReviewDocs: (planId) => corpus.listMilestoneReviewDocs(planId),
        gate,
        filing: opts?.tracker === false ? undefined : new IssueFilingService(counting),
        writer: corpus,
        by: "t",
      });
    },
    runBatch: async () => {
      const lease = new ReviewLeases(store, "batch", () => Date.now(), () => () => undefined);
      const runner = new ReviewBatchRunner({
        getPlanBundle: (ref) => corpus.getPlanBundle(ref),
        listReviewDocs: (planId) => corpus.listMilestoneReviewDocs(planId),
        issueCoverage: (planId, failed) => corpus.coverageOfFailedDimensions(planId, failed),
      });
      const port = createGithubIssuePort({ repo: "owner/repo" } as GithubUpstreamCfg, { actor: "t" } as GithubFilingContext, corpus, corpus.getPlanCloseIssuePort());
      const run = await runner.runBatch([plan.slug], {
        acquirePlanLease: (planId) => lease.acquire(planLeaseKey(planId)),
        settleRetirement: async () => ok({ state: "none" as const }),
        measureSuite: async () => undefined,
        // reason: a judgment re-makes the stored review unchanged (same facts), and is counted so a test can assert WHEN the batch re-judges.
        reviewPlan: async () => {
          world.judgments += 1;
          const docs = await corpus.listMilestoneReviewDocs(plan.id);
          if (!docs.ok) return docs;
          const stored = selectLatestMilestoneReview(docs.value);
          return stored === undefined ? err<LoreError>({ code: "STORE_ERROR", message: "no stored review to re-make" }) : ok({ doc: stored.doc, review: stored.review });
        },
        closePlan: async (ref) => {
          const closed = await corpus.set(ref, { status: "archived" }, { by: "t" });
          return closed.ok ? ok(undefined) : closed;
        },
        recordError: async () => ok(undefined),
        filing: new IssueFilingService(port),
        now: () => new Date().toISOString(),
      });
      if (!run.ok || run.value.state !== "ran") throw new Error(`batch did not run: ${JSON.stringify(run)}`);
      const row = run.value.rows[0];
      if (row === undefined) throw new Error("no row");
      return { outcome: row.outcome, detail: row.detail };
    },
    reload: async () => {
      const found = await store.find(plan.id);
      if (!found.ok || found.value === null) throw new Error("plan missing");
      return found.value;
    },
  };
  return world;
}

async function decisionVersionsOf(w: World): Promise<number> {
  const versions = await w.store.listAllVersions();
  if (!versions.ok) throw new Error(JSON.stringify(versions.error));
  return versions.value.filter((v) => v.doc_id === w.plan.id && v.decision !== undefined).length;
}

describe("AC-AF-7 accepting a gate records the decision and a known defect, and the next close archives the plan", () => {
  it("AC-AF-7 HAPPY: a full decision records a gate_accepted known defect of security and its decision; the next --close archives the plan", async () => {
    const w = await worldWith({ security: "fail" });
    // before: the batch files/links the issue (a plain known defect) but a failed gate keeps the plan open
    const held = await w.runBatch();
    expect(held.outcome).toBe("kept-open");
    expect((await w.reload()).status).toBe("approved");
    expect(readKnownDefects((await w.reload()).extra).map((e) => [e.dimension, e.gate_accepted])).toEqual([["security", undefined]]);

    const accepted = await w.service().acceptGate(w.plan.slug, "security", FULL_DECISION);
    expect(accepted).toMatchObject({ ok: true, value: { dimension: "security", issue: ISSUE } });
    const stored = await w.reload();
    expect(readKnownDefects(stored.extra)).toEqual([expect.objectContaining({ repo_id: REPO_ID, number: ISSUE, dimension: "security", gate_accepted: true })]);
    expect(await decisionVersionsOf(w)).toBe(1);
    const versions = await w.store.listAllVersions();
    const decided = versions.ok ? versions.value.find((v) => v.doc_id === w.plan.id && v.decision !== undefined) : undefined;
    expect(decided?.decision?.reason).toBe("the finding is a false positive");

    const closed = await w.runBatch();
    expect(closed.outcome).toBe("accepted-with-known-defects");
    expect((await w.reload()).status).toBe("archived");
  });

  it("AC-AF-7 NEGATIVE: a failed (measured) security gate is not re-judged by the batch, and a not-measured one is, until accepted", async () => {
    const failed = await worldWith({ security: "fail" });
    expect((await failed.runBatch()).outcome).toBe("kept-open");
    expect(failed.judgments).toBe(0);
    const unmeasured = await worldWith({ regression: "not-measured" });
    await unmeasured.runBatch();
    expect((await unmeasured.service().acceptGate(unmeasured.plan.slug, "regression", FULL_DECISION)).ok).toBe(true);
    await unmeasured.runBatch();
    expect(unmeasured.judgments).toBe(1);
  });

  it("AC-AF-7 NEGATIVE: a not-measured regression caused by an unlanded task is not re-judged by the next batch (a retry cannot change it)", async () => {
    const w = await worldWith({ regression: "not-measured" }, ["unlanded"]);
    expect((await w.runBatch()).outcome).toBe("kept-open");
    // BR-1511: the next batch skips the plan as "already reviewed" (was: a kept-open row)
    expect((await w.runBatch()).outcome).toBe("skipped");
    expect(w.judgments).toBe(0);
  });

  it("AC-AF-7 NEGATIVE: a not-measured regression caused by an unmappable landing is not re-judged by the next batch", async () => {
    const w = await worldWith({ regression: "not-measured" }, ["unmappable"]);
    expect((await w.runBatch()).outcome).toBe("kept-open");
    expect(w.judgments).toBe(0);
  });

  it("AC-AF-7 HAPPY: a not-measured regression whose suite could not complete is re-judged by the next batch, together with an unlanded task", async () => {
    const w = await worldWith({ regression: "not-measured" }, ["unlanded", "unrunnable"]);
    expect((await w.runBatch()).outcome).toBe("kept-open");
    expect(w.judgments).toBe(1);
  });

  it("AC-AF-7 HAPPY: a not-measured regression gate is accepted the same way", async () => {
    const w = await worldWith({ regression: "not-measured" });
    // reason: spec "Fingerprint" — a plan kept open by a not-measured regression is re-judged by EVERY batch (the suite may
    // complete next time), so the first batch calls the judge once; the judge here re-makes the same not-measured review.
    const first = await w.runBatch();
    expect(first.outcome).toBe("kept-open");
    expect(w.judgments).toBe(1);
    expect((await w.service().acceptGate(w.plan.slug, "regression", FULL_DECISION)).ok).toBe(true);
    expect((await w.runBatch()).outcome).toBe("accepted-with-known-defects");
  });

  it("AC-AF-7 NEGATIVE: an incomplete decision is refused naming the missing parts, and nothing is written", async () => {
    const w = await worldWith({ security: "fail" });
    const versionBefore = (await w.reload()).version;
    const refused = await w.service().acceptGate(w.plan.slug, "security", undefined);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatchObject({ code: "VALIDATION_ERROR", field: "decision" });
    const text = JSON.stringify(refused.error);
    for (const part of ["reason", "premise", "alternative"]) expect(text).toContain(part);
    expect((await w.reload()).version).toBe(versionBefore);
    expect(w.filings).toBe(0);
    expect(await decisionVersionsOf(w)).toBe(0);
  });

  it("AC-AF-7 NEGATIVE: correctness_vs_acs is refused naming `lore ac supersede`, nothing written, even with a full decision", async () => {
    const w = await worldWith({ correctness_vs_acs: "fail" });
    const versionBefore = (await w.reload()).version;
    const refused = await w.service().acceptGate(w.plan.slug, "correctness_vs_acs", FULL_DECISION);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(JSON.stringify(refused.error)).toContain("lore ac supersede");
    expect((await w.reload()).version).toBe(versionBefore);
    expect(readKnownDefects((await w.reload()).extra)).toEqual([]);
  });

  it("AC-AF-7 NEGATIVE: a dimension that is not a gate, and a gate that is not blocking, are refused", async () => {
    const w = await worldWith({ security: "fail" });
    const soft = await w.service().acceptGate(w.plan.slug, "concurrency_safety", FULL_DECISION);
    expect(soft.ok).toBe(false);
    if (!soft.ok) expect(JSON.stringify(soft.error)).toContain("not a gate");
    const passing = await w.service().acceptGate(w.plan.slug, "regression", FULL_DECISION);
    expect(passing.ok).toBe(false);
    if (!passing.ok) expect(JSON.stringify(passing.error)).toContain("nothing to accept");
    expect(readKnownDefects((await w.reload()).extra)).toEqual([]);
  });

  it("AC-AF-7 ERROR: no issue tracker configured refuses without writing; a review of an older plan state refuses to accept", async () => {
    const w = await worldWith({ security: "fail" });
    const versionBefore = (await w.reload()).version;
    const noTracker = await w.service({ tracker: false }).acceptGate(w.plan.slug, "security", FULL_DECISION);
    expect(noTracker.ok).toBe(false);
    if (!noTracker.ok) expect(JSON.stringify(noTracker.error)).toContain("feedback.upstream");
    expect((await w.reload()).version).toBe(versionBefore);

    const edited = await w.corpus.set(w.plan.id, { content: "the plan changed after its review" }, { by: "t" });
    expect(edited.ok).toBe(true);
    const stale = await w.service().acceptGate(w.plan.slug, "security", FULL_DECISION);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(JSON.stringify(stale.error)).toContain("not of its current state");
    expect(await decisionVersionsOf(w)).toBe(0);
  });

  it("AC-AF-7 BOUNDARY: an accepted gate whose issue is later closed no longer lets the plan close", async () => {
    const w = await worldWith({ security: "fail" });
    expect((await w.service().acceptGate(w.plan.slug, "security", FULL_DECISION)).ok).toBe(true);
    w.open.current = false;
    // the closed issue means the defect was fixed: the batch does not close on it (the plan needs a new review)
    const run = await w.runBatch();
    expect(run.outcome).not.toBe("accepted-with-known-defects");
    expect((await w.reload()).status).toBe("approved");
  });
});

describe("AC-AF-7 the acceptance is bound to the failure it accepted", () => {
  /** Stores a newer review of the same plan state whose `dimension` failure cites `cite` instead (another root cause). */
  async function reReviewWithOtherCause(w: World, dimension: "security" | "regression", cite: string): Promise<void> {
    const docs = await w.corpus.listMilestoneReviewDocs(w.plan.id);
    if (!docs.ok) throw new Error(JSON.stringify(docs.error));
    const latest = selectLatestMilestoneReview(docs.value);
    if (latest === undefined) throw new Error("no review");
    const review: MilestoneReview = { ...latest.review, dimensions: { ...latest.review.dimensions, [dimension]: { ...latest.review.dimensions[dimension], cites: [cite] } } };
    await new Promise((resolve) => setTimeout(resolve, 5));
    const doc = await w.corpus.createMilestoneReviewDoc({ type: "knowledge", title: "Later review", parent_id: w.plan.id, extra: { sub_type: MILESTONE_REVIEW_SUB_TYPE, milestone_review: review }, content: renderMilestoneReviewContent(review) });
    if (!doc.ok) throw new Error(JSON.stringify(doc.error));
    const informs = await w.corpus.link(doc.value.id, w.plan.id, "informs");
    if (!informs.ok) throw new Error(JSON.stringify(informs.error));
  }

  it("AC-AF-7 STATE: a later review whose security failure has a different root-cause fingerprint keeps the plan open, by hand and in the batch", async () => {
    const w = await worldWith({ security: "fail" });
    expect((await w.service().acceptGate(w.plan.slug, "security", FULL_DECISION)).ok).toBe(true);
    const accepted = readKnownDefects((await w.reload()).extra)[0];
    expect(accepted).toMatchObject({ dimension: "security", gate_accepted: true });

    await reReviewWithOtherCause(w, "security", "src/another-flaw.ts");
    const hand = await w.corpus.set(w.plan.id, { status: "archived" }, { by: "t" });
    expect(hand.ok).toBe(false);
    if (!hand.ok) {
      expect(hand.error).toMatchObject({ code: "VALIDATION_ERROR", field: "gate:plan-close" });
      expect(JSON.stringify(hand.error)).toContain("security");
    }
    expect((await w.reload()).status).toBe("approved");
    // the stored acceptance still names the OLD failure: nothing re-flagged it
    expect(readKnownDefects((await w.reload()).extra)).toEqual([accepted]);
  });

  it("AC-AF-7 STATE: the same failure re-reviewed (same cites, other wording) stays accepted and closes", async () => {
    const w = await worldWith({ security: "fail" });
    expect((await w.service().acceptGate(w.plan.slug, "security", FULL_DECISION)).ok).toBe(true);
    await reReviewWithOtherCause(w, "security", "src/security.ts");
    expect((await w.corpus.set(w.plan.id, { status: "archived" }, { by: "t" })).ok).toBe(true);
    expect((await w.reload()).status).toBe("archived");
  });

  it("AC-AF-7 REGRESSION: the accept-gate decision is on the plan's version row where `lore decision rates` and the re-check read it", async () => {
    const w = await worldWith({ security: "fail" });
    expect((await w.service().acceptGate(w.plan.slug, "security", FULL_DECISION)).ok).toBe(true);
    const bundle = await w.corpus.getPlanBundle(w.plan.id);
    if (!bundle.ok) throw new Error(JSON.stringify(bundle.error));
    const selected = await selectPlanDecisions({ store: w.store }, bundle.value);
    expect(selected).toMatchObject({ ok: true });
    if (!selected.ok) return;
    expect(selected.value.map((d) => d.address)).toEqual([`${w.plan.slug}@${String((await w.reload()).version)}`]);

    const outcome = new DecisionOutcomeService({
      store: w.store,
      writer: w.corpus,
      listMilestoneReviewDocs: (planId) => w.corpus.listMilestoneReviewDocs(planId),
      getPlanBundle: (planId) => w.corpus.getPlanBundle(planId),
    });
    const rates = await outcome.rates({ kind: "document revision" });
    expect(rates).toMatchObject({ ok: true, value: { decisions: 1, decisionsInNoPlan: 0 } });
  });
});
