// @spawns packages/lore/src/index.ts
// @reads packages/lore/src/service/**
/**
 * AC-AU-10 oracle — the human sampling floor is permanent (PRD I2).
 *
 * Everything runs in THROWAWAY corpora (mkdtemp + `lore init`), never the repo's own `.lore/`. The CLI is the real one;
 * the human answer is the real `lore decide` flow driven through the injectable human-channel ports.
 *
 * Halves (spec AC-AU-10): (1) 20 auto decisions of one class -> exactly 2 audit items, listed by `lore pending`
 * separately from blocking escalations; (2) the audited operation was not blocked (it already ran: its effective
 * verdict is auto and it is not pending); (3) a human-tty audit 'wrong' lowers C by the same amount as an observed
 * reversal ('right' records stood); (4) an agent-asserted audit answer changes nothing.
 * Beyond the halves: sampling is deterministic per class (other classes, escalations and bookkeeping rows never shift or
 * join the sequence), an answered item leaves the queue and cannot be answered twice.
 *
 * @spec_ref AC-AU-10
 */
import { afterAll, describe, expect, it } from "vitest";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import type { DecisionLogRow } from "../../src/store/decision-log.js";
import { AUDIT_EVERY, OUTCOME_CLASS, deriveAuditQueue } from "../../src/service/autonomy-calibration-service.js";
import { scriptedHumanPorts } from "./fixtures/scripted-human-ports.js";
import { AUTO_FACTS, lore, newCorpus, observeReversal, readLog, removeCorpora, runDecide, seedDecisions, withService, type Corpus } from "./fixtures/autonomy-calibration-helpers.js";

afterAll(removeCorpora);

const WEAK = { recoverability: "loss-free-by-proof", blast: "calling-session", evidence: "none" } as const;

interface PendingJson {
  readonly data: { readonly decisions: Array<{ id: number; class: string }>; readonly audit: Array<{ id: number; class: string; sequence: number }> };
}

function pendingJson(corpus: Corpus): PendingJson {
  const run = lore(corpus, ["pending", "--json"]);
  if (run.exitCode !== 0) throw new Error(`lore pending failed: ${run.stderr}`);
  return JSON.parse(run.stdout) as PendingJson;
}

async function auditQueue(corpus: Corpus) {
  return withService(corpus, async (service) => {
    const q = await service.listAudit();
    if (!q.ok) throw new Error("listAudit failed");
    return q.value;
  });
}

async function nextC(corpus: Corpus, classId: string, subject: string): Promise<number> {
  const seeded = await seedDecisions(corpus, classId, 1, subject);
  return seeded.confidences[0] as number;
}

function row(partial: Partial<DecisionLogRow> & Pick<DecisionLogRow, "id" | "class">): DecisionLogRow {
  return {
    ts: "2026-10-18T00:00:00.000Z",
    subject_id: `s-${partial.id}`,
    subject_version: "v1",
    facts: "{}",
    factors: "{}",
    score: 1,
    threshold: 0.8,
    verdict: "auto",
    reasons: "[]",
    executor_run: null,
    channel: "machine",
    prev_hash: "",
    entry_hash: "",
    ...partial,
  };
}

describe("AC-AU-10 half 1: 1 in 10 auto decisions per class is queued for human audit", () => {
  it("20 auto decisions of one class -> exactly 2 audit items (the 10th and the 20th), listed by `lore pending` apart from blocking escalations", async () => {
    const corpus = newCorpus("lore-au10-h1-");
    const seeded = await seedDecisions(corpus, "stash-drop", 20);
    expect(seeded.verdicts).toEqual(Array<string>(20).fill("auto"));
    expect(AUDIT_EVERY).toBe(10);

    const queue = await auditQueue(corpus);
    expect(queue.map((i) => [i.id, i.sequence, i.class, i.subject_id])).toEqual([
      [seeded.ids[9], 10, "stash-drop", "subject-10"],
      [seeded.ids[19], 20, "stash-drop", "subject-20"],
    ]);

    // one blocking escalation exists too: the two lists stay separate
    const weak = await withService(corpus, (service) => service.decide("stash-drop", { id: "blocked-one", version: "v1" }, WEAK));
    expect(weak.ok && weak.value.effective.verdict).toBe("escalate");

    const json = pendingJson(corpus);
    expect(json.data.audit.map((i) => i.id)).toEqual([seeded.ids[9], seeded.ids[19]]);
    expect(json.data.decisions.map((d) => d.class)).toEqual(["stash-drop"]);
    expect(json.data.decisions.map((d) => d.id)).not.toContain(seeded.ids[9]);

    const text = lore(corpus, ["pending"]).stdout;
    const openAt = text.indexOf("Open decisions (1)");
    const auditAt = text.indexOf("Awaiting audit (2");
    expect(openAt).toBeGreaterThanOrEqual(0);
    expect(auditAt).toBeGreaterThan(openAt);
    expect(text).toMatch(new RegExp(`lore decide ${seeded.ids[9]} --accept\\|--reject\\s+\\(audit:`));
  }, 180_000);

  it("19 decisions -> 1 item; a second class counts its own sequence (9 + 9 interleaved, then one more of the first -> one item)", async () => {
    const corpus = newCorpus("lore-au10-h1b-");
    await seedDecisions(corpus, "stash-drop", 19);
    expect((await auditQueue(corpus)).map((i) => i.sequence)).toEqual([10]);

    const other = newCorpus("lore-au10-h1c-");
    await seedDecisions(other, "stash-drop", 9, "a");
    await seedDecisions(other, "worktree-remove", 9, "/wt/b");
    expect(await auditQueue(other)).toEqual([]);
    await seedDecisions(other, "stash-drop", 1, "a-tenth");
    const queue = await auditQueue(other);
    expect(queue.map((i) => [i.class, i.sequence])).toEqual([["stash-drop", 10]]);
  }, 180_000);

  it("deterministic and unsteerable: escalations, threshold-write, threshold-integrity and outcome rows never take a sequence number", () => {
    const rows: DecisionLogRow[] = [];
    let id = 0;
    const push = (partial: Partial<DecisionLogRow> & Pick<DecisionLogRow, "class">) => rows.push(row({ id: ++id, ...partial }));
    for (let i = 0; i < 9; i++) push({ class: "stash-drop" });
    for (let i = 0; i < 25; i++) push({ class: "autonomy-threshold-write" });
    for (let i = 0; i < 5; i++) push({ class: "threshold-integrity", verdict: "escalate" });
    for (let i = 0; i < 4; i++) push({ class: "stash-drop", verdict: "escalate" });
    push({ class: OUTCOME_CLASS, facts: JSON.stringify({ outcome: { decision_id: 1, result: "stood", source: "no-reversal-observed", detail: "" } }) });
    push({ class: "stash-drop", verdict: "superseded" as unknown as DecisionLogRow["verdict"] });
    push({ class: "stash-drop", channel: "human-tty" });
    expect(deriveAuditQueue(rows)).toEqual({ ok: true, value: [] });
    push({ class: "stash-drop" }); // the 10th real auto decision
    const queue = deriveAuditQueue(rows);
    expect(queue.ok && queue.value.map((i) => [i.id, i.sequence])).toEqual([[id, 10]]);
    // the same log always yields the same queue
    expect(deriveAuditQueue(rows)).toEqual(queue);
  });
});

describe("AC-AU-10 half 2: the audited operation was not blocked", () => {
  it("every sampled decision already returned auto (it ran), has no pending escalation, and the audit changes no verdict", async () => {
    const corpus = newCorpus("lore-au10-h2-");
    const seeded = await seedDecisions(corpus, "stash-drop", 20);
    const [first, second] = [seeded.ids[9] as number, seeded.ids[19] as number];
    expect(seeded.verdicts[9]).toBe("auto");
    expect(seeded.verdicts[19]).toBe("auto");

    const state = await withService(corpus, async (service) => {
      const pending = await service.listPending();
      const eff = await service.effectiveVerdict("stash-drop", { id: "subject-10", version: "v1" });
      return { pending: pending.ok ? pending.value : null, effective: eff.ok ? eff.value : "error" };
    });
    expect(state.pending).toEqual([]);
    expect(state.effective).toMatchObject({ verdict: "auto", channel: "machine", record_id: first });

    // answering 'wrong' later does not retroactively block or change the decision's effective verdict either
    const wrong = await runDecide(corpus, second, "reject");
    expect(wrong.code, wrong.stderr).toBe(0);
    const after = await withService(corpus, (service) => service.effectiveVerdict("stash-drop", { id: "subject-20", version: "v1" }));
    expect(after.ok && after.value).toMatchObject({ verdict: "auto", channel: "machine", record_id: second });
  }, 180_000);
});

describe("AC-AU-10 half 3: a human-tty 'wrong' lowers C by the same amount as an observed reversal", () => {
  it("wrong -> reversed: C 0.827736, identical to one observed reversal; right -> stood: C 0.854095; the answered item leaves the queue", async () => {
    const audited = newCorpus("lore-au10-h3a-");
    const a = await seedDecisions(audited, "stash-drop", 20);
    const wrong = await runDecide(audited, a.ids[9] as number, "reject", scriptedHumanPorts());
    expect(wrong.code, wrong.stderr).toBe(0);
    expect(wrong.stdout).toMatch(/recorded: reversed \(channel human-tty/);
    const cWrong = await nextC(audited, "stash-drop", "after-wrong");

    const observed = newCorpus("lore-au10-h3b-");
    const b = await seedDecisions(observed, "stash-drop", 20);
    await observeReversal(observed, b.ids[9] as number);
    const cObserved = await nextC(observed, "stash-drop", "after-observed");

    expect(cWrong).toBe(0.827736);
    expect(cObserved).toBe(0.827736);
    expect(cWrong).toBe(cObserved);

    const rightCorpus = newCorpus("lore-au10-h3c-");
    const r = await seedDecisions(rightCorpus, "stash-drop", 20);
    const right = await runDecide(rightCorpus, r.ids[9] as number, "accept");
    expect(right.code, right.stderr).toBe(0);
    expect(right.stdout).toMatch(/recorded: stood/);
    expect(await nextC(rightCorpus, "stash-drop", "after-right")).toBe(0.854095);

    // the answered item left the queue (only #20 remains; the new decisions are #21 and #22) and cannot be answered twice
    expect((await auditQueue(rightCorpus)).map((i) => i.sequence)).toEqual([20]);
    const before = (await readLog(rightCorpus)).length;
    const twice = await runDecide(rightCorpus, r.ids[9] as number, "reject");
    expect(twice.code).toBe(4);
    expect(twice.stderr).toMatch(/neither pending nor awaiting audit/);
    expect((await readLog(rightCorpus)).length).toBe(before);
  }, 240_000);

  it("enough wrong audits escalate the class (feeds C like any reversal)", async () => {
    const corpus = newCorpus("lore-au10-h3d-");
    const seeded = await seedDecisions(corpus, "stash-drop", 30);
    for (const index of [9, 19, 29]) {
      const answered = await runDecide(corpus, seeded.ids[index] as number, "reject");
      expect(answered.code, answered.stderr).toBe(0);
    }
    const next = await seedDecisions(corpus, "stash-drop", 1, "after-three-wrong");
    expect(next.confidences).toEqual([0.785765]);
    expect(next.verdicts).toEqual(["escalate"]);
  }, 240_000);
});

describe("AC-AU-10 half 4: an agent-asserted audit answer changes nothing", () => {
  it("an agent identity in the environment, an agent ancestor and a non-TTY stdin are each refused with exit 4 and write nothing", async () => {
    const corpus = newCorpus("lore-au10-h4-");
    const seeded = await seedDecisions(corpus, "stash-drop", 10);
    const id = seeded.ids[9] as number;
    const before = (await readLog(corpus)).length;

    for (const [label, ports] of [
      ["agent env", scriptedHumanPorts({ env: { CLAUDECODE: "1" } })],
      ["agent ancestor", scriptedHumanPorts({ parentCommand: "claude" })],
      ["no tty", scriptedHumanPorts({ stdinIsTty: false })],
      ["wrong nonce", scriptedHumanPorts({ typeBack: () => "WRONG000" })],
    ] as const) {
      const refused = await runDecide(corpus, id, "reject", ports);
      expect(refused.code, label).toBe(4);
    }
    expect((await readLog(corpus)).length).toBe(before);
    expect((await auditQueue(corpus)).map((i) => i.id)).toEqual([id]);
    expect(await nextC(corpus, "stash-drop", "still-pristine")).toBe(0.851409);
  }, 240_000);

  it("a forged proof is refused by the service; an agent-asserted outcome row in the log is ignored by C and the queue", async () => {
    const corpus = newCorpus("lore-au10-h4b-");
    const seeded = await seedDecisions(corpus, "stash-drop", 10);
    const id = seeded.ids[9] as number;

    const forged = await withService(corpus, (service) =>
      service.resolveAudit(id, "wrong", undefined, { channel: "human-tty", ancestry: [], verified_at: "2026-10-18T00:00:00.000Z" } as never),
    );
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.error).toMatchObject({ code: "VALIDATION_ERROR", field: "proof" });

    const store = new SQLiteStore(corpus.dbPath);
    try {
      const appended = await store.appendDecisionRecord({
        ts: "2026-10-18T00:00:00.000Z",
        class: OUTCOME_CLASS,
        subject_id: `decision:${id}`,
        subject_version: "human-audit",
        facts: JSON.stringify({ outcome: { decision_id: id, result: "reversed", source: "human-audit", detail: "" } }),
        factors: "{}",
        score: 0,
        threshold: null,
        verdict: "auto",
        reasons: "[]",
        executor_run: "run-agent",
        channel: "agent-asserted",
      });
      expect(appended.ok).toBe(true);
    } finally {
      store.close();
    }
    expect((await auditQueue(corpus)).map((i) => i.id), "still awaiting the human").toEqual([id]);
    expect(await nextC(corpus, "stash-drop", "unmoved")).toBe(0.851409);
  }, 180_000);

  it("the agent-reachable CLI has no outcome setter: calibration/pending/autonomy verbs never write an outcome row", async () => {
    const corpus = newCorpus("lore-au10-h4c-");
    await seedDecisions(corpus, "stash-drop", 10);
    for (const args of [["calibration", "--stats"], ["pending"], ["autonomy", "show"], ["calibration", "--record-outcome", "1", "--reversed"]]) lore(corpus, args);
    const attempt = lore(corpus, ["calibration", "--record-outcome", "1", "--reversed"]);
    expect(attempt.exitCode, "an unknown flag alone is not a mode").toBe(2);
    expect((await readLog(corpus)).filter((r) => r.class === OUTCOME_CLASS)).toEqual([]);
  }, 240_000);
});
