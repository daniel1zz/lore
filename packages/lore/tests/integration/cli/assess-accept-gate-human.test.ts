// @reads assets/project/lore-config-template.yaml
/**
 * @spec_ref spec-an-agent-s-gate-acceptance-waits-for-a-human-decision (AC-HG-1, AC-HG-2, AC-HG-3, AC-HG-4, AC-HG-5, BR-1500)
 *
 * An agent run's `lore assess <plan> --accept-gate <dimension>` creates a pending human decision (class governance-loosen,
 * subject `<plan id>:<dimension>` at the root-cause fingerprint) and accepts nothing; the acceptance takes effect only after a
 * human accepted that decision, and every reader of an accepted gate counts only a human-backed acceptance.
 *
 * The real `GateAcceptanceService`, `DecisionService`, `CorpusService` and `ReviewBatchRunner` run over an in-memory store with
 * a fake GitHub reader (the same world as assess-accept-gate.test.ts). The human answer is the production writer
 * `DecisionService.resolvePending` with a harness-ask proof. Exit codes are the CLI's own `exitCode` mapping of the refusal.
 *
 * Dimensions: HAPPY (human accept applies), NEGATIVE (agent / rejected / forged), BOUNDARY (changed cause), STATE (pending reuse).
 */

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../../helpers/clean-tree-repo.js";
import { DECIDED_FLAGS } from "../../helpers/decision-flags.js";
import { runLoreInProcess } from "../../helpers/run-lore-in-process.js";
import { ulid } from "ulidx";
import { DOC_TYPE_ROLE_MAP, KNOWN_DEFECTS_FIELD, MILESTONE_DIMENSIONS, err, ok, readKnownDefects, renderMilestoneReviewContent, type DocId, type DocRecord, type LoreError, type MilestoneReview, type Result } from "@lore/core";
import { createGithubIssuePort } from "../../../src/adapters/cli/assess-file-issues.js";
import type { GithubFilingContext, GithubUpstreamCfg } from "../../../src/adapters/cli/report-issue-wiring.js";
import { exitCode } from "../../../src/adapters/cli/utils.js";
import { parseDecisionFlags } from "../../../src/adapters/cli/decision-flags.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { DecisionGate, type DecisionDraft } from "../../../src/service/decision-gate.js";
import { DecisionService } from "../../../src/service/decision-service.js";
import { GateAcceptanceService, acceptedGatesOf, createGateAcceptanceLog, unwiredGateAcceptanceLog } from "../../../src/service/gate-acceptance-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { issueHarnessAskProof } from "../../../src/service/human-channel.js";
import { IssueFilingService } from "../../../src/service/issue-filing-service.js";
import { MILESTONE_REVIEW_SUB_TYPE, planStateFingerprint, selectLatestMilestoneReview } from "../../../src/service/milestone-review.js";
import { ReviewLeases, planLeaseKey } from "../../../src/service/review-batch-lease.js";
import { ReviewBatchRunner } from "../../../src/service/review-batch-service.js";
import { issueTitleOf, rootCauseOf } from "../../../src/service/root-cause-fingerprint.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { actedStore } from "../../live-invocation.js";

const REPO_ID = 7;
const ISSUE = 11;
const GATE_CLASS = "governance-loosen";

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
    created_by: "accept-gate-human-test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra,
  };
}

async function seed(store: StoreInterface, doc: DocRecord): Promise<DocRecord> {
  const inserted = await store.insertWithProvenance(
    doc,
    { doc_id: doc.id, version: 1, content: doc.content, extra: doc.extra, status: doc.status, title: doc.title, action: "create", created_at: doc.created_at, created_by: "accept-gate-human-test", slug: doc.slug },
    { timestamp: doc.created_at, actor: "accept-gate-human-test", session_id: doc.id, action: "create", doc_id: doc.id, details: { version: 1 } },
  );
  if (!inserted.ok) throw new Error(`seed failed: ${JSON.stringify(inserted.error)}`);
  return inserted.value;
}

const gate = new DecisionGate({ headSha: () => ({ ok: false, reason: "no git" }), hasUncommittedChanges: () => ({ ok: false, reason: "no git" }), readLinesAt: () => ({ ok: false, reason: "no git" }) });

const FULL_DECISION: DecisionDraft = (() => {
  const parsed = parseDecisionFlags({ reason: "the finding is a false positive", premise: "the flagged call is behind an allowlist|issue:#1|A", alt: "fix the finding|no defect to fix" });
  if (!parsed.ok || parsed.value === undefined) throw new Error("fixture decision did not parse");
  return parsed.value;
})();

interface World {
  readonly store: InMemoryStore | SQLiteStore;
  readonly corpus: CorpusService;
  readonly plan: DocRecord;
  readonly decisions: DecisionService;
  /** How many times the tracker was asked to FILE an issue (the one open issue is reused by root cause, so 0 is expected). */
  filings: number;
  service(writerSource: string, opts?: { decisions?: boolean }): GateAcceptanceService;
  runBatch(): Promise<{ outcome: string; detail: string }>;
  reload(): Promise<DocRecord>;
  pendingGateDecisions(): Promise<{ id: number; subject_id: string; subject_version: string }[]>;
  /** The human's answer through the production writer; returns the human record's id. */
  answer(pendingId: number, answer: "accept" | "reject"): Promise<number>;
  reReviewWithOtherCause(cite: string): Promise<void>;
}

/** A plan with one archived task and a stored review failing security; `onStore` (default in-memory) is where it lives. */
async function worldWithFailedSecurity(onStore?: InMemoryStore | SQLiteStore): Promise<World> {
  const store = actedStore(onStore ?? new InMemoryStore());
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, new GateEnforcer(undefined));
  const plan = await seed(store, rawDoc("plan", "Gate plan", {}, "approved"));
  await seed(store, rawDoc("task", "Landed task", { plan_id: plan.id }, "archived", plan.id));
  const bundle = await corpus.getPlanBundle(plan.id);
  if (!bundle.ok) throw new Error(JSON.stringify(bundle.error));
  const dimensions = Object.fromEntries(
    MILESTONE_DIMENSIONS.map((d) => {
      const verdict = d === "security" ? "fail" : "pass";
      return [d, { verdict, reason: `${d} ${verdict}`, reference: "r", ...(verdict === "fail" ? { cites: [`src/${d}.ts`] } : {}) }];
    }),
  ) as MilestoneReview["dimensions"];
  const review: MilestoneReview = {
    plan_id: plan.id,
    fingerprint: planStateFingerprint(bundle.value.plan, bundle.value.tasks, bundle.value.spec),
    overall: "fail",
    dimensions,
    decisions: [],
    prompt_version: "test",
    diff_source: "test",
  };
  const doc = await corpus.createMilestoneReviewDoc({ type: "knowledge", title: "Review of gate plan", parent_id: plan.id, extra: { sub_type: MILESTONE_REVIEW_SUB_TYPE, milestone_review: review }, content: renderMilestoneReviewContent(review) });
  if (!doc.ok) throw new Error(JSON.stringify(doc.error));
  const informs = await corpus.link(doc.value.id, plan.id, "informs");
  if (!informs.ok) throw new Error(JSON.stringify(informs.error));
  const judgment = dimensions.security;
  const cause = rootCauseOf({ plan: plan.slug, dimension: "security", reason: judgment.reason, reference: judgment.reference, cites: judgment.cites, reviewSlug: doc.value.slug });
  if (!cause.ok) throw new Error(JSON.stringify(cause.error));
  corpus.setPlanCloseIssuePort({
    listOpenIssues: async () => ok({ repoId: REPO_ID, open: [{ number: ISSUE, title: issueTitleOf(cause.value) }] }),
    readIssue: async (n) => (n === ISSUE ? ok({ repoId: REPO_ID, state: "open" as const }) : err<LoreError>({ code: "STORE_ERROR", message: `no issue #${String(n)}` })),
  });
  const decisions = new DecisionService({ store, executorRun: null });
  const log = createGateAcceptanceLog(store);
  const world: World = {
    store,
    corpus,
    plan,
    decisions,
    filings: 0,
    service: (writerSource, opts) => {
      const port = createGithubIssuePort({ repo: "owner/repo" } as GithubUpstreamCfg, { actor: "t" } as GithubFilingContext, corpus, corpus.getPlanCloseIssuePort());
      const counting = { ...port, file: async (input: Parameters<typeof port.file>[0]) => { world.filings += 1; return port.file(input); } };
      return new GateAcceptanceService({
        getPlanBundle: (ref) => corpus.getPlanBundle(ref),
        listReviewDocs: (planId) => corpus.listMilestoneReviewDocs(planId),
        gate,
        filing: new IssueFilingService(counting),
        writerSource,
        decisions: opts?.decisions === false ? undefined : decisions,
        log,
      });
    },
    runBatch: async () => {
      const lease = new ReviewLeases(store, "batch", () => Date.now(), () => () => undefined);
      const runner = new ReviewBatchRunner({
        getPlanBundle: (ref) => corpus.getPlanBundle(ref),
        listReviewDocs: (planId) => corpus.listMilestoneReviewDocs(planId),
        issueCoverage: (planId, failed) => corpus.coverageOfFailedDimensions(planId, failed),
        acceptanceLog: log,
      });
      const port = createGithubIssuePort({ repo: "owner/repo" } as GithubUpstreamCfg, { actor: "t" } as GithubFilingContext, corpus, corpus.getPlanCloseIssuePort());
      const counting = { ...port, file: async (input: Parameters<typeof port.file>[0]) => { world.filings += 1; return port.file(input); } };
      const run = await runner.runBatch([plan.slug], {
        acquirePlanLease: (planId) => lease.acquire(planLeaseKey(planId)),
        settleRetirement: async () => ok({ state: "none" as const }),
        measureSuite: async () => undefined,
        reviewPlan: async () => {
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
        filing: new IssueFilingService(counting),
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
    pendingGateDecisions: async () => {
      const pending = await decisions.listPending();
      if (!pending.ok) throw new Error(JSON.stringify(pending.error));
      return pending.value.filter((p) => p.class === GATE_CLASS).map((p) => ({ id: p.id, subject_id: p.subject_id, subject_version: p.subject_version }));
    },
    answer: async (pendingId, answer) => {
      const row = await decisions.resolvePending(pendingId, answer, "answered by the human", issueHarnessAskProof(new Date().toISOString()));
      if (!row.ok) throw new Error(JSON.stringify(row.error));
      return row.value.id;
    },
    reReviewWithOtherCause: async (cite) => {
      const docs = await corpus.listMilestoneReviewDocs(plan.id);
      if (!docs.ok) throw new Error(JSON.stringify(docs.error));
      const latest = selectLatestMilestoneReview(docs.value);
      if (latest === undefined) throw new Error("no review");
      const later: MilestoneReview = { ...latest.review, dimensions: { ...latest.review.dimensions, security: { ...latest.review.dimensions.security, cites: [cite] } } };
      await new Promise((resolve) => setTimeout(resolve, 5));
      const created = await corpus.createMilestoneReviewDoc({ type: "knowledge", title: "Later review", parent_id: plan.id, extra: { sub_type: MILESTONE_REVIEW_SUB_TYPE, milestone_review: later }, content: renderMilestoneReviewContent(later) });
      if (!created.ok) throw new Error(JSON.stringify(created.error));
      const linked = await corpus.link(created.value.id, plan.id, "informs");
      if (!linked.ok) throw new Error(JSON.stringify(linked.error));
    },
  };
  return world;
}

/** The refusal of an acceptance: asserts it is a failure and returns its text and CLI exit code. */
function refusalOf<T>(result: Result<T, LoreError>): { text: string; exit: number } {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a refusal");
  return { text: JSON.stringify(result.error), exit: exitCode(result.error) };
}

function pendingIdIn(text: string): number {
  const id = Number(/pending decision (\d+)/.exec(text)?.[1]);
  expect(id).toBeGreaterThan(0);
  return id;
}

describe("AC-HG-1 an agent's --accept-gate only creates a pending human decision", () => {
  it("AC-HG-1 HAPPY: exits 4 naming the pending id and `lore pending --ask`, writes no known defect, the next --close keeps the plan open; a repeat reuses the same pending decision", async () => {
    const w = await worldWithFailedSecurity();
    const before = await w.reload();
    const first = refusalOf(await w.service("run").acceptGate(w.plan.slug, "security", FULL_DECISION));
    expect(first.exit).toBe(4);
    expect(first.text).toContain("lore pending --ask");
    const pendingId = pendingIdIn(first.text);

    // false-green guard: accepting at once AND creating a pending decision fails here
    const after = await w.reload();
    expect(after.version).toBe(before.version);
    expect(readKnownDefects(after.extra)).toEqual([]);
    expect(w.filings).toBe(0);

    const closed = await w.runBatch();
    expect(closed.outcome).toBe("kept-open");
    expect((await w.reload()).status).toBe("approved");

    // false-green guard: a call that escalates afresh each time leaves two pending decisions
    const second = refusalOf(await w.service("run").acceptGate(w.plan.slug, "security", FULL_DECISION));
    expect(second.exit).toBe(4);
    expect(pendingIdIn(second.text)).toBe(pendingId);
    const pending = await w.pendingGateDecisions();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.subject_id).toBe(`${w.plan.id}:security`);
  });

  it("AC-HG-1 ERROR: with no decision service wired an agent's call is refused (exit 4) and never accepted", async () => {
    const w = await worldWithFailedSecurity();
    const refused = refusalOf(await w.service("run", { decisions: false }).acceptGate(w.plan.slug, "security", FULL_DECISION));
    expect(refused.exit).toBe(4);
    expect(refused.text).toContain("no decision service");
    expect(readKnownDefects((await w.reload()).extra)).toEqual([]);
    expect(await w.pendingGateDecisions()).toEqual([]);
  });

  it("AC-HG-1 NEGATIVE: an incomplete decision is still refused before any pending decision is created", async () => {
    const w = await worldWithFailedSecurity();
    const refused = refusalOf(await w.service("run").acceptGate(w.plan.slug, "security", undefined));
    expect(refused.exit).toBe(4);
    expect(await w.pendingGateDecisions()).toEqual([]);
  });
});

describe("AC-HG-2 a human's answer applies to its own root-cause fingerprint only", () => {
  it("AC-HG-2 HAPPY: after a human accepts, the same command exits 0 and writes the known defect carrying the decision record id; --close archives the plan", async () => {
    const w = await worldWithFailedSecurity();
    const pendingId = pendingIdIn(refusalOf(await w.service("run").acceptGate(w.plan.slug, "security", FULL_DECISION)).text);
    const humanRecord = await w.answer(pendingId, "accept");

    const accepted = await w.service("run").acceptGate(w.plan.slug, "security", FULL_DECISION);
    // the CLI's exit code for this result: 0 for a success, `exitCode(error)` for a refusal
    expect(accepted.ok ? 0 : exitCode(accepted.error)).toBe(0);
    expect(accepted).toMatchObject({ ok: true, value: { dimension: "security", issue: ISSUE, decision_record: humanRecord } });
    // the acceptance is the human record in the log; the plan carries no `gate_accepted`
    expect(readKnownDefects((await w.reload()).extra).some((e) => e.gate_accepted === true)).toBe(false);

    const closed = await w.runBatch();
    expect(closed.outcome).toBe("accepted-with-known-defects");
    expect((await w.reload()).status).toBe("archived");
  });

  it("AC-HG-2 NEGATIVE: after a human rejects, the same command exits 4 and writes nothing", async () => {
    const w = await worldWithFailedSecurity();
    const pendingId = pendingIdIn(refusalOf(await w.service("run").acceptGate(w.plan.slug, "security", FULL_DECISION)).text);
    await w.answer(pendingId, "reject");
    const before = await w.reload();
    const refused = refusalOf(await w.service("run").acceptGate(w.plan.slug, "security", FULL_DECISION));
    expect(refused.exit).toBe(4);
    expect(refused.text).toContain("rejected");
    const after = await w.reload();
    expect(after.version).toBe(before.version);
    expect(readKnownDefects(after.extra)).toEqual([]);
    expect((await w.runBatch()).outcome).toBe("kept-open");
  });

  it("AC-HG-2 BOUNDARY: a later review whose failure has a different fingerprint is not covered by the earlier accept and gets a new pending decision", async () => {
    const w = await worldWithFailedSecurity();
    const firstPending = pendingIdIn(refusalOf(await w.service("run").acceptGate(w.plan.slug, "security", FULL_DECISION)).text);
    await w.answer(firstPending, "accept");
    expect((await w.service("run").acceptGate(w.plan.slug, "security", FULL_DECISION)).ok).toBe(true);
    const oldVersion = (await w.pendingGateDecisions()).length;
    expect(oldVersion).toBe(0);

    await w.reReviewWithOtherCause("src/another-flaw.ts");
    // false-green guard: matching the human decision by plan and dimension only would accept this too
    const hand = refusalOf(await w.corpus.set(w.plan.id, { status: "archived" }, { by: "t" }));
    expect(hand.exit).toBe(4);
    expect(hand.text).toContain("security");
    expect((await w.reload()).status).toBe("approved");

    const again = refusalOf(await w.service("run").acceptGate(w.plan.slug, "security", FULL_DECISION));
    expect(again.exit).toBe(4);
    const secondPending = pendingIdIn(again.text);
    expect(secondPending).not.toBe(firstPending);
    const pending = await w.pendingGateDecisions();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.subject_version).not.toBe("");
  });
});

describe("AC-HG-3 only a human-backed acceptance counts", () => {
  /** Writes the shape agent runs wrote before this change: gate_accepted with no human behind it. */
  async function plantAgentAcceptance(w: World, extraFields: Record<string, unknown> = {}): Promise<void> {
    const docs = await w.corpus.listMilestoneReviewDocs(w.plan.id);
    if (!docs.ok) throw new Error(JSON.stringify(docs.error));
    const latest = selectLatestMilestoneReview(docs.value);
    if (latest === undefined) throw new Error("no review");
    const j = latest.review.dimensions.security;
    const cause = rootCauseOf({ plan: w.plan.slug, dimension: "security", reason: j.reason, reference: j.reference, cites: j.cites, reviewSlug: latest.doc.slug });
    if (!cause.ok) throw new Error(JSON.stringify(cause.error));
    const current = await w.reload();
    const written = await w.corpus.set(w.plan.id, { extra: { ...(current.extra as Record<string, unknown>), [KNOWN_DEFECTS_FIELD]: [{ repo_id: REPO_ID, number: ISSUE, dimension: "security", fingerprint: cause.value.fingerprint, gate_accepted: true, ...extraFields }] } }, { by: "t" });
    if (!written.ok) throw new Error(JSON.stringify(written.error));
  }

  it("AC-HG-3 NEGATIVE: gate_accepted with no human decision or party does not count: a hand close exits 4 naming the gate and the batch keeps the plan open", async () => {
    const w = await worldWithFailedSecurity();
    await plantAgentAcceptance(w);
    const hand = refusalOf(await w.corpus.set(w.plan.id, { status: "archived" }, { by: "t" }));
    expect(hand.exit).toBe(4);
    expect(hand.text).toContain("security");
    expect((await w.reload()).status).toBe("approved");
    const held = await w.runBatch();
    expect(["kept-open", "skipped"]).toContain(held.outcome);
    expect(held.detail).toContain("security");
    expect((await w.reload()).status).toBe("approved");
  });

  it("AC-HG-3 NEGATIVE: a forged human party or decision record id stored on the plan does not count either", async () => {
    const w = await worldWithFailedSecurity();
    await plantAgentAcceptance(w, { accepted_source: "human", accepted_decision: 999 });
    // the same write that plants the field and archives in one call is refused too (the close reads that write's extra)
    const current = await w.reload();
    const oneShot = refusalOf(await w.corpus.set(w.plan.id, { extra: current.extra as Record<string, unknown>, status: "archived" }, { by: "t" }));
    expect(oneShot.exit).toBe(4);
    expect(refusalOf(await w.corpus.set(w.plan.id, { status: "archived" }, { by: "t" })).exit).toBe(4);
    const held = await w.runBatch();
    expect(["kept-open", "skipped"]).toContain(held.outcome);
    expect((await w.reload()).status).toBe("approved");
  });

  it("AC-HG-3 HAPPY: a human party's direct call with a decision record is accepted at once and the plan closes", async () => {
    const w = await worldWithFailedSecurity();
    const accepted = await w.service("human").acceptGate(w.plan.slug, "security", FULL_DECISION);
    expect(accepted.ok ? 0 : exitCode(accepted.error)).toBe(0);
    expect(accepted).toMatchObject({ ok: true, value: { dimension: "security" } });
    expect(await w.pendingGateDecisions()).toEqual([]);
    // it appended its human decision to the log (class, subject, fingerprint), and wrote no flag on the plan
    const rows = await w.store.listDecisionLog();
    if (!rows.ok) throw new Error(JSON.stringify(rows.error));
    const human = rows.value.filter((r) => r.channel === "human-tty");
    expect(human).toHaveLength(1);
    expect(human[0]).toMatchObject({ class: "governance-loosen", subject_id: `${w.plan.id}:security`, verdict: "auto" });
    expect(accepted.ok && accepted.value.decision_record).toBe(human[0]?.id);
    expect(readKnownDefects((await w.reload()).extra).some((e) => e.gate_accepted === true)).toBe(false);
    expect((await w.runBatch()).outcome).toBe("accepted-with-known-defects");
    expect((await w.reload()).status).toBe("archived");
  });

  it("AC-HG-3 NEGATIVE: a human party's call without a decision record is still refused", async () => {
    const w = await worldWithFailedSecurity();
    const refused = refusalOf(await w.service("human").acceptGate(w.plan.slug, "security", undefined));
    expect(refused.exit).toBe(4);
    expect(readKnownDefects((await w.reload()).extra)).toEqual([]);
  });

  it("AC-HG-3 ERROR: with no decision log wired a hand close fails loud naming the cause, never a silent not-accepted", async () => {
    const w = await worldWithFailedSecurity();
    // the plan-close read goes through the store's own log; an unwired log is the batch's port and the CLI composition's
    const unwired = unwiredGateAcceptanceLog();
    const read = await unwired.humanAcceptedRecord({ id: `${w.plan.id}:security`, version: "x" });
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(exitCode(read.error)).toBe(4);
      expect(JSON.stringify(read.error)).toContain("no decision log is wired");
    }
    const docs = await w.corpus.listMilestoneReviewDocs(w.plan.id);
    const latest = docs.ok ? selectLatestMilestoneReview(docs.value) : undefined;
    if (latest === undefined) throw new Error("no review");
    const accepted = await acceptedGatesOf(w.plan, latest, unwired);
    expect(accepted.ok).toBe(false);
  });
});

describe("AC-HG-5 a stored acceptance field cannot close a plan (real CLI)", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  async function lore(dir: string, args: string[]) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined || /^(CLAUDE|LORE|ANTHROPIC)/.test(key)) continue;
      env[key] = value;
    }
    const proc = await runLoreInProcess(args, { cwd: dir, home: FIXTURE_HOME_OUTSIDE_REPO, env: { ...env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDE_CODE_SESSION_ID: "hg5", EDITOR: "true" } });
    return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.exitCode };
  }

  it("AC-HG-5 NEGATIVE: gate_accepted + accepted_source human planted with `lore set --extra` and no log entry: hand close exits 4 naming the gate, `--close` keeps the plan open", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-hg5-")));
    dirs.push(dir);
    makeCleanTreeRepo(dir);
    const init = await lore(dir, ["init"]);
    expect(init.exitCode, init.stderr).toBe(0);
    // the stored review of a plan failing security lives in the throwaway corpus's own database
    const store = new SQLiteStore(join(dir, ".lore", "lore.db"));
    const w = await worldWithFailedSecurity(store);
    const docs = await w.corpus.listMilestoneReviewDocs(w.plan.id);
    const latest = docs.ok ? selectLatestMilestoneReview(docs.value) : undefined;
    if (latest === undefined) throw new Error("no review");
    const j = latest.review.dimensions.security;
    const cause = rootCauseOf({ plan: w.plan.slug, dimension: "security", reason: j.reason, reference: j.reference, cites: j.cites, reviewSlug: latest.doc.slug });
    if (!cause.ok) throw new Error(JSON.stringify(cause.error));
    store.close();

    // reason: `lore set` has no `--extra` flag (the spec's example); plan `extra` is writable through the MCP `lore_set` tool, the
    // HTTP patch and a hand edit alike, so the forgery is planted in the throwaway database exactly as plan-known-defects-display does.
    const forged = [{ repo_id: REPO_ID, number: ISSUE, dimension: "security", fingerprint: cause.value.fingerprint, gate_accepted: true, accepted_source: "human" }];
    const db = new Database(join(dir, ".lore", "lore.db"));
    try {
      const row = db.query("SELECT extra FROM docs WHERE id = ?").get(w.plan.id) as { extra: string };
      const extra = JSON.parse(row.extra) as Record<string, unknown>;
      extra["known_defects"] = forged;
      db.prepare("UPDATE docs SET extra = ? WHERE id = ?").run(JSON.stringify(extra), w.plan.id);
    } finally {
      db.close();
    }

    const hand = await lore(dir, ["set", w.plan.slug, "--status", "archived", ...DECIDED_FLAGS]);
    expect(hand.exitCode, hand.stderr).toBe(4);
    expect(hand.stderr).toContain("security");

    const batch = await lore(dir, ["assess", "--where", "type=plan", "--close"]);
    expect(batch.stdout + batch.stderr).not.toContain("accepted-with-known-defects");
    const shown = JSON.parse((await lore(dir, ["get", w.plan.slug, "--json"])).stdout) as { data?: { doc?: { status: string } }; status?: string };
    expect(shown.data?.doc?.status ?? shown.status).not.toBe("archived");
  }, 240_000);
});

describe("AC-HG-4 a pending acceptance is not re-asked or re-filed by --close", () => {
  it("AC-HG-4 STATE: a second --close keeps the plan open, reports acceptance pending with the id, creates no second pending decision and files no second issue", async () => {
    const w = await worldWithFailedSecurity();
    const pendingId = pendingIdIn(refusalOf(await w.service("run").acceptGate(w.plan.slug, "security", FULL_DECISION)).text);

    const first = await w.runBatch();
    expect(first.outcome).toBe("kept-open");
    expect(first.detail).toContain(`acceptance pending ${String(pendingId)}`);
    const defectsAfterFirst = readKnownDefects((await w.reload()).extra);
    const filingsAfterFirst = w.filings;

    const second = await w.runBatch();
    expect(["kept-open", "skipped"]).toContain(second.outcome);
    expect(second.detail).toContain(`acceptance pending ${String(pendingId)}`);
    expect((await w.reload()).status).toBe("approved");
    // false-green guard: a batch that re-runs the gate-issue path files a duplicate issue / second known defect
    expect(w.filings).toBe(filingsAfterFirst);
    expect(readKnownDefects((await w.reload()).extra)).toEqual(defectsAfterFirst);
    const pending = await w.pendingGateDecisions();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe(pendingId);
  });
});
