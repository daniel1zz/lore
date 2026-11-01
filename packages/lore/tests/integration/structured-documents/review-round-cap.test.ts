// @reads packages/lore/src/service/review-round-cap-service.ts
// @reads packages/lore/src/service/review-service.ts
// @reads assets/project/lore-config-template.yaml
// @reads assets/governance/write-spec-rule.md
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
/**
 * spec-every-document-is-stored-as-structured-fields-validated-by#AC-ST-6 (BR-1531): TWO ROUNDS, THEN A HUMAN.
 *
 * A judgment-required document (spec, adr) gets two review rounds per approval cycle; a round is one judged DISTINCT
 * version. The third round is refused (exit 4, naming the cap and `lore pending --ask`) and a human decides through the
 * pending route (class review-round-cap): accept approves, reject returns to draft, direct records the direction and
 * allows one more round. `lore reopen` starts a new cycle. A plan is not capped. Only the human-tty channel records the
 * answer; an agent run cannot, and an agent-usable `--override-judgment` cannot bypass the cap.
 *
 * Throwaway corpus per case (mkdtemp + `lore init`); judgments are seeded by a direct insert into `review_judgments`
 * (no AI is configured or called); the human answer is appended through the production writer
 * (`DecisionService.resolvePending`) with the injectable human-party proof, as tests/helpers/gate-acceptance-log.ts does.
 *
 * Every case and every false-green clause below is an assertion:
 *   - two judgments of ONE version count as one round (counting judgments would cap early);
 *   - an agent run recording the decision itself is refused (`lore decide` exit 4, forged proof refused);
 *   - a plan with three rejected versions is not capped.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";
import { asyncLoreRunnerFor, citeSpecViaAsyncCli } from "../../helpers/cli-live-rule.js";
import { actedStore, liveInvocation } from "../../live-invocation.js";
import { runPendingAsk } from "../../../src/adapters/cli/pending-ask.js";
import { recordHarnessAnswers } from "../../../src/service/harness-ask.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { DecisionService } from "../../../src/service/decision-service.js";
import { issueHumanPartyProof } from "../../../src/service/human-channel.js";

const TIMEOUT_MS = 420_000;
let dir = "";
let seed = 0;
let prdSlug = "";

async function lore(args: readonly string[]) {
  return runLoreInProcess([...args], { cwd: dir, home: dir, env: { ...process.env, HOME: dir, EDITOR: "true", CLAUDECODE: "1" } });
}

async function must(args: readonly string[]): Promise<string> {
  const r = await lore(args);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

interface Doc {
  readonly id: string;
  readonly slug: string;
  readonly version: number;
  readonly status: string;
}

async function getDoc(slug: string): Promise<Doc> {
  const out = JSON.parse(await must(["get", slug, "--json"])) as { data: { doc: Doc } };
  return out.data.doc;
}

/** A spec with one script-mode AC that cites a live rule, so only the judgment gate stands between it and approval. */
async function createSpec(title: string): Promise<Doc> {
  const created = JSON.parse(await must(["create", "spec", "--title", title, "--content", "## Overview\n\nBody.", "--json"])) as { data: Doc };
  const slug = created.data.slug;
  await must(["ac", "add", slug, "AC-1", "--statement", "the parser round-trips every fixture file", "--mode", "script", "--oracle", "test", "--command", "true"]);
  await citeSpecViaAsyncCli(asyncLoreRunnerFor(lore, dir), dir, undefined, slug, "AC-1");
  return getDoc(slug);
}

/** Bumps the document's version by a content edit and returns it. */
async function bump(slug: string, text: string): Promise<Doc> {
  await must(["set", slug, "--content", `## Overview\n\n${text}`]);
  return getDoc(slug);
}

function judge(docId: string, docVersion: number, decision: "approve" | "reject"): string {
  const id = `judgment-cap-${++seed}`;
  const db = new Database(join(dir, ".lore", "lore.db"));
  try {
    db.run(
      `INSERT INTO review_judgments (id, doc_id, doc_version, decision, confidence, reasons, checks, blocking_questions,
         judge_provider, judge_model, judge_prompt_version, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, docId, docVersion, decision, 0.9, JSON.stringify([{ dimension: "completeness", finding: "seeded" }]), JSON.stringify([{ check: "schema", outcome: "pass" }]), "[]", "test-judge", "test-model", "v1", new Date().toISOString(), "ai:test-judge:test-model:v1"],
    );
  } finally {
    db.close();
  }
  return id;
}

/** A spec rejected at two distinct versions, left at a third unjudged version. Returns the doc at that third version. */
async function cappedSpec(title: string): Promise<Doc> {
  const spec = await createSpec(title);
  judge(spec.id, spec.version, "reject");
  const second = await bump(spec.slug, "second draft");
  judge(spec.id, second.version, "reject");
  return bump(spec.slug, "third draft");
}

async function withDecisions<T>(body: (decisions: DecisionService, store: SQLiteStore) => Promise<T>): Promise<T> {
  const store = actedStore(new SQLiteStore(join(dir, ".lore", "lore.db")));
  try {
    return await body(new DecisionService({ store, executorRun: null }), store);
  } finally {
    store.close();
  }
}

async function capPending(): Promise<{ id: number; subject_id: string }[]> {
  return withDecisions(async (decisions) => {
    const pending = await decisions.listPending();
    if (!pending.ok) throw new Error(JSON.stringify(pending.error));
    return pending.value.filter((p) => p.class === "review-round-cap").map((p) => ({ id: p.id, subject_id: p.subject_id }));
  });
}

async function humanAnswers(pendingId: number, answer: "accept" | "reject" | "direct", reason?: string): Promise<void> {
  await withDecisions(async (decisions) => {
    const r = await decisions.resolvePending(pendingId, answer, reason, issueHumanPartyProof(new Date().toISOString()));
    if (!r.ok) throw new Error(`human answer failed: ${JSON.stringify(r.error)}`);
  });
}

async function newCorpus(): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), "review-round-cap-"));
  await must(["init"]);
  const prd = JSON.parse(await must(["create", "prd", "--title", "Round cap product", "--content", "# P\n\nA product.\n", "--json"])) as { data: { slug: string } };
  prdSlug = prd.data.slug;
}

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("spec-every-document-is-stored-as-structured-fields-validated-by#AC-ST-6 review round cap", () => {
  it("a third review of a spec rejected at two distinct versions exits 4 naming the cap and lore pending --ask, and opens a review-round-cap decision", async () => {
    await newCorpus();
    const spec = await cappedSpec("Capped spec");
    const r = await lore(["review", spec.slug]);
    expect(r.exitCode, r.stderr).toBe(4);
    expect(r.stderr).toContain("review-round-cap");
    expect(r.stderr).toContain("lore pending --ask");
    const pending = await capPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.subject_id).toBe(spec.id);
    // re-running asks the same decision again, never a second one
    await lore(["review", spec.slug]);
    expect(await capPending()).toHaveLength(1);
  }, TIMEOUT_MS);

  it("two judgments of ONE version count as one round: counting judgments would cap the second review", async () => {
    await newCorpus();
    const spec = await createSpec("One version twice");
    judge(spec.id, spec.version, "reject");
    judge(spec.id, spec.version, "reject");
    const second = await bump(spec.slug, "second draft");
    const r = await lore(["review", spec.slug]);
    expect(r.stderr + r.stdout).not.toContain("review-round-cap");
    expect(await capPending()).toHaveLength(0);
    expect(second.version).toBeGreaterThan(spec.version);
  }, TIMEOUT_MS);

  it("re-reviewing an already judged version is not a new round, even with the rounds spent", async () => {
    await newCorpus();
    const spec = await cappedSpec("Rejudge");
    judge(spec.id, spec.version, "reject");
    const r = await lore(["review", spec.slug]);
    expect(r.stderr + r.stdout).not.toContain("review-round-cap");
    expect(await capPending()).toHaveLength(0);
  }, TIMEOUT_MS);

  it("human accept approves the current version (a judgment-less version approves on lore approve)", async () => {
    await newCorpus();
    const spec = await cappedSpec("Accepted at the cap");
    expect((await lore(["approve", spec.slug])).exitCode).toBe(4);
    const refused = await lore(["review", spec.slug]);
    expect(refused.exitCode).toBe(4);
    const [pending] = await capPending();
    expect(pending).toBeDefined();
    await humanAnswers(pending?.id ?? 0, "accept", "good enough");
    const approved = await lore(["approve", spec.slug]);
    expect(approved.exitCode, approved.stderr).toBe(0);
    expect((await getDoc(spec.slug)).status).toBe("approved");
  }, TIMEOUT_MS);

  it("human reject returns the in-review document to draft and the review stays refused", async () => {
    await newCorpus();
    const spec = await cappedSpec("Rejected at the cap");
    await must(["set", spec.slug, "--status", "in-review"]);
    const at = await getDoc(spec.slug);
    expect(at.status).toBe("in-review");
    expect((await lore(["review", spec.slug])).exitCode).toBe(4);
    const [pending] = await capPending();
    await humanAnswers(pending?.id ?? 0, "reject", "start over");
    const again = await lore(["review", spec.slug]);
    expect(again.exitCode).toBe(4);
    expect(again.stderr).toContain("back in draft");
    expect((await getDoc(spec.slug)).status).toBe("draft");
  }, TIMEOUT_MS);

  it("human direct records the direction and allows exactly one more round", async () => {
    await newCorpus();
    const spec = await cappedSpec("Directed at the cap");
    expect((await lore(["review", spec.slug])).exitCode).toBe(4);
    const [pending] = await capPending();
    await humanAnswers(pending?.id ?? 0, "direct", "split the scope in two");
    const third = await lore(["review", spec.slug]);
    expect(third.stderr + third.stdout).not.toContain("review-round-cap");
    // the direction is on the record
    const rows = await withDecisions(async (_d, store) => {
      const log = await store.listDecisionLog();
      if (!log.ok) throw new Error(JSON.stringify(log.error));
      return log.value.filter((r) => r.channel === "human-tty" && r.class === "review-round-cap");
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.facts).toContain("split the scope in two");
    // judge the third round, then a fourth version is capped again: one more round, not unlimited
    judge(spec.id, (await getDoc(spec.slug)).version, "reject");
    const fourth = await bump(spec.slug, "fourth draft");
    const capped = await lore(["review", fourth.slug]);
    expect(capped.exitCode).toBe(4);
    expect(capped.stderr).toContain("review-round-cap");
  }, TIMEOUT_MS);

  it("lore reopen starts a new cycle with zero rounds", async () => {
    await newCorpus();
    const spec = await createSpec("Reopened");
    judge(spec.id, spec.version, "reject");
    const second = await bump(spec.slug, "second draft");
    judge(spec.id, second.version, "approve");
    expect((await lore(["approve", spec.slug])).exitCode).toBe(0);
    await must(["reopen", spec.slug, "--reason", "needs rework"]);
    // the two earlier rounds do not carry over: two more rounds are available
    const reopened = await getDoc(spec.slug);
    const first = await lore(["review", spec.slug]);
    expect(first.stderr + first.stdout).not.toContain("review-round-cap");
    judge(spec.id, reopened.version, "reject");
    const next = await bump(spec.slug, "after reopen");
    const secondRound = await lore(["review", next.slug]);
    expect(secondRound.stderr + secondRound.stdout).not.toContain("review-round-cap");
    judge(spec.id, next.version, "reject");
    const third = await bump(spec.slug, "after reopen again");
    const capped = await lore(["review", third.slug]);
    expect(capped.exitCode).toBe(4);
    expect(capped.stderr).toContain("review-round-cap");
  }, TIMEOUT_MS);

  it("a plan (not judgment-required) is not capped", async () => {
    await newCorpus();
    const planOut = JSON.parse(await must(["create", "plan", "--title", "Uncapped plan", "--parent", prdSlug, "--content", "x", "--json"])) as { data: Doc };
    const plan = planOut.data;
    judge(plan.id, plan.version, "reject");
    const v2 = await bump(plan.slug, "second");
    judge(plan.id, v2.version, "reject");
    const v3 = await bump(plan.slug, "third");
    judge(plan.id, v3.version, "reject");
    const v4 = await bump(plan.slug, "fourth");
    const r = await lore(["review", v4.slug]);
    expect(r.stderr + r.stdout).not.toContain("review-round-cap");
    expect(await capPending()).toHaveLength(0);
    expect((await lore(["approve", v4.slug])).exitCode).toBe(0);
  }, TIMEOUT_MS);

  it("an agent run cannot record the decision: lore decide is refused, a forged proof is refused, and the decision stays pending", async () => {
    await newCorpus();
    const spec = await cappedSpec("Agent cannot answer");
    expect((await lore(["review", spec.slug])).exitCode).toBe(4);
    const [pending] = await capPending();
    const viaCli = await lore(["decide", String(pending?.id), "--accept"]);
    expect(viaCli.exitCode).toBe(4);
    const direct = await lore(["decide", String(pending?.id), "--direct", "go ahead"]);
    expect(direct.exitCode).toBe(4);
    const forged = await withDecisions((decisions) => decisions.resolvePending(pending?.id ?? 0, "accept", "forged", { via: "tty" } as never));
    expect(forged.ok).toBe(false);
    expect(await capPending()).toHaveLength(1);
    const approve = await lore(["approve", spec.slug]);
    expect(approve.exitCode).toBe(4);
  }, TIMEOUT_MS);

  it("--override-judgment by an agent run does not bypass the cap; the human accept does", async () => {
    await newCorpus();
    const spec = await createSpec("Override at the cap");
    const first = judge(spec.id, spec.version, "reject");
    const second = await bump(spec.slug, "second draft");
    judge(spec.id, second.version, "reject");
    const third = await bump(spec.slug, "third draft");
    const overridden = await lore(["approve", third.slug, "--override-judgment", first]);
    expect(overridden.exitCode, overridden.stderr).toBe(4);
    expect(overridden.stderr).toContain("review-round-cap");
    expect((await getDoc(spec.slug)).status).toBe("draft");
    const [pending] = await capPending();
    expect(pending).toBeDefined();
    const noJudgment = await lore(["approve", third.slug, "--override-no-judgment"]);
    expect(noJudgment.exitCode).toBe(4);
    await humanAnswers(pending?.id ?? 0, "accept");
    expect((await lore(["approve", third.slug])).exitCode).toBe(0);
  }, TIMEOUT_MS);
});

// ─── The in-session path: lore pending --ask -> AskUserQuestion -> decide --from-harness ────────────────────────────

interface AskedQuestion {
  readonly question: string;
  readonly options: readonly { readonly label: string }[];
}

/**
 * A throwaway store holding one open decision of `classId`; returns the question `lore pending --ask` writes for it and a
 * recorder for the hook payload a human's answer produces (`recordHarnessAnswers`, the code `decide --from-harness` runs).
 */
async function askedDecision(classId: string): Promise<{ store: SQLiteStore; pendingId: number; asked: AskedQuestion; answerWith: (text: string, edit?: (q: AskedQuestion) => AskedQuestion) => Promise<{ exit: number; lines: readonly string[] }>; humanRows: () => Promise<{ verdict: string; facts: string }[]> }> {
  const root = mkdtempSync(join(tmpdir(), "review-round-cap-ask-"));
  const dbPath = join(root, "lore.db");
  const store = actedStore(new SQLiteStore(dbPath));
  const decisions = new DecisionService({ store, executorRun: null });
  const detail = { summary: "Decide the doc at the cap", requested_by: "a test session", change: { document: "doc-x" }, on_accept: "Approved on re-run.", on_reject: "Back to draft." };
  const facts = classId === "review-round-cap" ? { recoverability: "irreversible-external", blast: "calling-session", evidence: "lore-evaluated" } : {};
  const decided = await decisions.decide(classId, { id: "doc-x", version: "c0:a2:v3" }, facts, detail);
  if (!decided.ok) throw new Error(JSON.stringify(decided.error));
  const output = await runPendingAsk(liveInvocation(), dbPath, new Map());
  if (!output.ok) throw new Error(JSON.stringify(output.error));
  const asked = output.value.questions[0] as AskedQuestion;
  const pendingId = output.value.decision_ids[0] as number;
  const answerWith = async (text: string, edit?: (q: AskedQuestion) => AskedQuestion) => {
    const sent = edit === undefined ? asked : edit(asked);
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "AskUserQuestion",
      tool_input: { questions: [{ ...sent, header: `Decision ${pendingId}`, multiSelect: false }] },
      tool_response: { answers: { [sent.question]: text } },
    });
    const report = await recordHarnessAnswers({ store, now: () => new Date().toISOString() }, payload);
    if (!report.ok) throw new Error(JSON.stringify(report.error));
    return { exit: report.value.exit, lines: report.value.lines };
  };
  const humanRows = async () => {
    const log = await store.listDecisionLog();
    if (!log.ok) throw new Error(JSON.stringify(log.error));
    return log.value.filter((r) => r.channel === "human-tty").map((r) => ({ verdict: r.verdict, facts: r.facts }));
  };
  return { store, pendingId, asked, answerWith, humanRows };
}

describe("spec-every-document-is-stored-as-structured-fields-validated-by#AC-ST-6 the in-session answer path", () => {
  it("lore pending --ask writes Accept, Reject and Direct for a review-round-cap decision, and only Accept and Reject for any other class", async () => {
    const cap = await askedDecision("review-round-cap");
    expect(cap.asked.options.map((o) => o.label)).toEqual(["Accept", "Reject", "Direct"]);
    cap.store.close();
    const other = await askedDecision("governance-loosen");
    expect(other.asked.options.map((o) => o.label)).toEqual(["Accept", "Reject"]);
    other.store.close();
  }, TIMEOUT_MS);

  it("an Accept answer is recorded as a human accept", async () => {
    const d = await askedDecision("review-round-cap");
    const r = await d.answerWith("Accept");
    expect(r.exit, r.lines.join("\n")).toBe(0);
    const rows = await d.humanRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verdict).toBe("auto");
    expect(rows[0]?.facts).toContain('"answer":"accept"');
    d.store.close();
  }, TIMEOUT_MS);

  it("a Reject answer is recorded as a human reject", async () => {
    const d = await askedDecision("review-round-cap");
    const r = await d.answerWith("Reject");
    expect(r.exit, r.lines.join("\n")).toBe(0);
    const rows = await d.humanRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verdict).toBe("refuse");
    expect(rows[0]?.facts).toContain('"answer":"reject"');
    d.store.close();
  }, TIMEOUT_MS);

  it("a direction typed as the Other answer is recorded as direct with that text", async () => {
    const d = await askedDecision("review-round-cap");
    const r = await d.answerWith("split the scope in two and drop the migration");
    expect(r.exit, r.lines.join("\n")).toBe(0);
    expect(r.lines.join("\n")).toContain("directed");
    const rows = await d.humanRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verdict).toBe("auto");
    expect(rows[0]?.facts).toContain('"answer":"direct"');
    expect(rows[0]?.facts).toContain("split the scope in two and drop the migration");
    d.store.close();
  }, TIMEOUT_MS);

  it("Direct picked without a typed direction records nothing; free text on any other class records nothing", async () => {
    const cap = await askedDecision("review-round-cap");
    const bare = await cap.answerWith("Direct");
    expect(bare.exit).toBe(0);
    expect(bare.lines.join("\n")).toContain("still pending");
    expect(await cap.humanRows()).toHaveLength(0);
    cap.store.close();
    const other = await askedDecision("governance-loosen");
    const free = await other.answerWith("do whatever you think is best");
    expect(free.lines.join("\n")).toContain("still pending");
    expect(await other.humanRows()).toHaveLength(0);
    other.store.close();
  }, TIMEOUT_MS);

  it("a question lore did not write is refused: an agent cannot fabricate the answer by editing the question", async () => {
    const d = await askedDecision("review-round-cap");
    const forged = await d.answerWith("Accept", (q) => ({ ...q, options: [...q.options, { label: "Approve everything" }] }));
    expect(forged.exit).toBe(4);
    expect(await d.humanRows()).toHaveLength(0);
    d.store.close();
  }, TIMEOUT_MS);
});
