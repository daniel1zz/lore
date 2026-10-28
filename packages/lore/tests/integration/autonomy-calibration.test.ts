// @spawns packages/lore/src/index.ts
// @reads packages/lore/src/service/**
/**
 * AC-AU-8 oracle — calibration tightens by itself and loosens only by the human.
 *
 * Everything runs in THROWAWAY corpora (mkdtemp + `lore init`), never the repo's own `.lore/`. The CLI is the real one;
 * the decision log is read and written through the real DecisionService; the human answer is the real `lore decide`
 * flow driven through the injectable human-channel ports.
 *
 * Halves (spec AC-AU-8): (1) a class whose computed C is just above its threshold escalates once reversed outcomes
 * pull the Wilson bound below it; (2) `lore autonomy set <class> --threshold <lower>` escalates as governance-loosen and
 * changes nothing until the human-tty accept; (3) raising a threshold applies at once with an auto record; (3b) a class
 * that auto-escalated returns to auto only through a human-tty governance-loosen accept, which empties the real-outcome
 * window (pseudo-outcomes stay); (4) `lore calibration --stats` shows outcome counts per class.
 * Beyond the halves: exact C numbers for a fresh class, the 50-outcome window, the isAutoDecisionRow exclusions, no
 * caller-supplied C, the outcome observers, and the three callers carrying no placeholder C.
 *
 * @spec_ref AC-AU-8
 */
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import type { DecisionLogRow } from "../../src/store/decision-log.js";
import {
  CALIBRATION_WINDOW,
  OUTCOME_CLASS,
  classConfidence,
  createAuditReversalProbe,
  createGitReversalProbes,
  isAutoDecisionRow,
  loosenBoundaryOf,
} from "../../src/service/autonomy-calibration-service.js";
import { DecisionService } from "../../src/service/decision-service.js";
import { scriptedHumanPorts } from "./fixtures/scripted-human-ports.js";
import { AUTO_FACTS, lore, newCorpus, observeReversal, readLog, removeCorpora, runDecide, seedDecisions, withService } from "./fixtures/autonomy-calibration-helpers.js";
import { actedStore } from "../live-invocation.js";

import { ensureRequirementsDocSlug } from "../helpers/parented-create.js";
const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

afterAll(removeCorpora);

/** A hand-built log row (no hashes: the pure calibration functions never verify the chain). */
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

function outcomeRow(id: number, decisionId: number, result: "reversed" | "stood", channel: DecisionLogRow["channel"] = "machine"): DecisionLogRow {
  return row({
    id,
    class: OUTCOME_CLASS,
    subject_id: `decision:${decisionId}`,
    channel,
    facts: JSON.stringify({ outcome: { decision_id: decisionId, result, source: "merge-reverted", detail: "" } }),
  });
}

describe("AC-AU-8 C is the Wilson lower bound over outcomes plus pseudo-outcomes at the prior", () => {
  it("a fresh class scores C 0.851409 at prior 0.95, 0.879889 at prior 0.97 and 0.366443 at prior 0.5 (no outcomes: 50 pseudo-outcomes only)", () => {
    const c = (prior: number) => {
      const r = classConfidence([], "any", prior);
      if (!r.ok) throw new Error("classConfidence failed");
      return r.value;
    };
    expect(c(0.95).confidence).toBe(0.851409);
    expect(c(0.97).confidence).toBe(0.879889);
    expect(c(0.5).confidence).toBe(0.366443);
    expect(c(0.95)).toMatchObject({ stood: 0, reversed: 0, window: 0, pseudo: 50 });
  });

  it("only the LAST 50 observed decisions count: 10 old reversals fall out of the window behind 50 newer stood outcomes", () => {
    const rows: DecisionLogRow[] = [];
    for (let i = 1; i <= 60; i++) rows.push(row({ id: i, class: "stash-drop" }));
    for (let i = 1; i <= 60; i++) rows.push(outcomeRow(100 + i, i, i <= 10 ? "reversed" : "stood"));
    const r = classConfidence(rows, "stash-drop", 0.95);
    if (!r.ok) throw new Error("classConfidence failed");
    expect(CALIBRATION_WINDOW).toBe(50);
    expect(r.value).toMatchObject({ stood: 50, reversed: 0, window: 50, confidence: 0.922635 });
  });

  it("a decision counts once and a reversal beats a stood record of the same decision", () => {
    const rows = [row({ id: 1, class: "stash-drop" }), outcomeRow(2, 1, "stood"), outcomeRow(3, 1, "reversed"), outcomeRow(4, 1, "stood")];
    const r = classConfidence(rows, "stash-drop", 0.95);
    if (!r.ok) throw new Error("classConfidence failed");
    expect(r.value).toMatchObject({ stood: 0, reversed: 1, window: 1, confidence: 0.827736 });
  });

  it("an agent-asserted outcome row is invisible to C", () => {
    const rows = [row({ id: 1, class: "stash-drop" }), outcomeRow(2, 1, "reversed", "agent-asserted")];
    const r = classConfidence(rows, "stash-drop", 0.95);
    if (!r.ok) throw new Error("classConfidence failed");
    expect(r.value).toMatchObject({ reversed: 0, window: 0, confidence: 0.851409 });
  });

  it("an outcome row whose facts do not parse is a loud STORE_ERROR, never an empty window", () => {
    const broken = row({ id: 2, class: OUTCOME_CLASS, facts: "not json" });
    const r = classConfidence([row({ id: 1, class: "stash-drop" }), broken], "stash-drop", 0.95);
    expect(r.ok).toBe(false);
  });
});

describe("AC-AU-8 exclusions: one isAutoDecisionRow predicate", () => {
  it("counts a machine auto row of a real class; never threshold-write, threshold-integrity, outcome, superseded, human-tty or non-auto rows", () => {
    expect(isAutoDecisionRow(row({ id: 1, class: "stash-drop" }))).toBe(true);
    expect(isAutoDecisionRow(row({ id: 2, class: "autonomy-threshold-write" }))).toBe(false);
    expect(isAutoDecisionRow(row({ id: 3, class: "threshold-integrity" }))).toBe(false);
    expect(isAutoDecisionRow(row({ id: 4, class: OUTCOME_CLASS }))).toBe(false);
    expect(isAutoDecisionRow(row({ id: 5, class: "stash-drop", verdict: "superseded" as unknown as DecisionLogRow["verdict"] }))).toBe(false);
    expect(isAutoDecisionRow(row({ id: 6, class: "stash-drop", channel: "human-tty" }))).toBe(false);
    expect(isAutoDecisionRow(row({ id: 7, class: "stash-drop", channel: "agent-asserted" }))).toBe(false);
    expect(isAutoDecisionRow(row({ id: 8, class: "stash-drop", verdict: "escalate" }))).toBe(false);
  });

  it("threshold-write rows never calibrate: a recorded tightening leaves the class's C and counts untouched", async () => {
    const corpus = newCorpus("lore-au8-excl-");
    expect(lore(corpus, ["autonomy", "set", "stash-drop", "--threshold", "0.82"]).exitCode).toBe(0);
    const stats = JSON.parse(lore(corpus, ["calibration", "--stats", "--json"]).stdout) as { data: { autonomy: Array<{ class: string; auto_decisions: number; confidence: number }> } };
    const stash = stats.data.autonomy.find((c) => c.class === "stash-drop");
    expect(stash).toMatchObject({ auto_decisions: 0, confidence: 0.851409 });
    const log = await readLog(corpus);
    expect(log.some((r) => r.class === "autonomy-threshold-write" && r.verdict === "auto")).toBe(true);
  }, 120_000);
});

describe("AC-AU-8 half 1: reversed outcomes pull C below the threshold and the class escalates", () => {
  it("C 0.851409 is just above threshold 0.85 -> auto; one reversal -> C 0.827736 -> the next decide escalates and is pending", async () => {
    const corpus = newCorpus("lore-au8-h1-");
    const tightened = lore(corpus, ["autonomy", "set", "stash-drop", "--threshold", "0.85"]);
    expect(tightened.exitCode, tightened.stderr).toBe(0);

    const first = await seedDecisions(corpus, "stash-drop", 1, "h1-a");
    expect(first.verdicts).toEqual(["auto"]);
    expect(first.confidences).toEqual([0.851409]);

    await observeReversal(corpus, first.ids[0] as number);

    const second = await withService(corpus, async (service) => {
      const out = await service.decide("stash-drop", { id: "h1-b", version: "v1" }, AUTO_FACTS);
      if (!out.ok) throw new Error("decide failed");
      return out.value;
    });
    expect(second.decision.factors.C).toBe(0.827736);
    expect(second.decision.score).toBe(0.827736);
    expect(second.decision.verdict).toBe("escalate");
    expect(second.effective.verdict).toBe("escalate");
    expect(second.decision.reasons[0]).toMatch(/^calibration: C=0\.827736 \(Wilson LB over 1 observed outcome\(s\): 0 stood \/ 1 reversed, plus 50 pseudo-outcomes at prior 0\.95\)/);

    const pending = await withService(corpus, async (service) => {
      const p = await service.listPending();
      if (!p.ok) throw new Error("listPending failed");
      return p.value;
    });
    expect(pending.map((p) => p.subject_id)).toEqual(["h1-b"]);
  }, 120_000);

  it("CONTROL: with no reversal the same class stays auto at C 0.851409", async () => {
    const corpus = newCorpus("lore-au8-h1c-");
    lore(corpus, ["autonomy", "set", "stash-drop", "--threshold", "0.85"]);
    const seeded = await seedDecisions(corpus, "stash-drop", 3, "h1c");
    expect(seeded.verdicts).toEqual(["auto", "auto", "auto"]);
    expect(seeded.confidences).toEqual([0.851409, 0.851409, 0.851409]);
  }, 120_000);

  it("a caller-supplied confidence is refused and writes nothing (C is never caller-supplied)", async () => {
    const corpus = newCorpus("lore-au8-nocaller-");
    const before = (await readLog(corpus)).length;
    const refused = await withService(corpus, (service) => service.decide("stash-drop", { id: "x", version: "v1" }, { ...AUTO_FACTS, confidence: 1 }));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatchObject({ code: "VALIDATION_ERROR", field: "facts.confidence" });
    expect((await readLog(corpus)).length).toBe(before);
  }, 120_000);
});

describe("AC-AU-8 half 2: loosening escalates as governance-loosen and changes nothing until the human-tty accept", () => {
  it("lore autonomy set stash-drop --threshold 0.7 -> exit 4, class governance-loosen pending, record unchanged; accept + re-run applies", async () => {
    const corpus = newCorpus("lore-au8-h2-");
    const loosen = lore(corpus, ["autonomy", "set", "stash-drop", "--threshold", "0.7"]);
    expect(loosen.exitCode).toBe(4);
    expect(loosen.stderr).toMatch(/governance-loosen/);
    const pendingId = Number(/Pending decision (\d+) created/.exec(loosen.stderr)?.[1]);
    expect(pendingId).toBeGreaterThan(0);

    const shown = () => JSON.parse(lore(corpus, ["autonomy", "show", "--json"]).stdout) as { data: { record: { classes: Record<string, { threshold: number }> } } };
    expect(shown().data.record.classes["stash-drop"]?.threshold).toBe(0.8);
    expect(lore(corpus, ["autonomy", "set", "stash-drop", "--threshold", "0.7"]).exitCode, "re-running without the human changes nothing").toBe(4);
    expect(shown().data.record.classes["stash-drop"]?.threshold).toBe(0.8);

    const accepted = await runDecide(corpus, pendingId, "accept");
    expect(accepted.code, accepted.stderr).toBe(0);
    const applied = lore(corpus, ["autonomy", "set", "stash-drop", "--threshold", "0.7"]);
    expect(applied.exitCode, applied.stderr).toBe(0);
    expect(shown().data.record.classes["stash-drop"]?.threshold).toBe(0.7);
  }, 180_000);
});

describe("AC-AU-8 half 3: raising a threshold applies at once with an auto record", () => {
  it("lore autonomy set stash-drop --threshold 0.9 -> exit 0, an auto autonomy-threshold-write row, record changed, nothing pending", async () => {
    const corpus = newCorpus("lore-au8-h3-");
    const before = (await readLog(corpus)).length;
    const raised = lore(corpus, ["autonomy", "set", "stash-drop", "--threshold", "0.9"]);
    expect(raised.exitCode, raised.stderr).toBe(0);
    expect(raised.stdout).toMatch(/tightening/);
    const rows = (await readLog(corpus)).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ class: "autonomy-threshold-write", verdict: "auto", channel: "machine" });
    const shown = JSON.parse(lore(corpus, ["autonomy", "show", "--json"]).stdout) as { data: { record: { classes: Record<string, { threshold: number }> } } };
    expect(shown.data.record.classes["stash-drop"]?.threshold).toBe(0.9);
    const pending = await withService(corpus, async (service) => {
      const p = await service.listPending();
      return p.ok ? p.value : null;
    });
    expect(pending).toEqual([]);
  }, 120_000);
});

describe("AC-AU-8 half 3b: an auto-escalated class returns to auto only through a human-tty governance-loosen accept", () => {
  it("3 reversals -> C 0.785765 < 0.8 escalates; the human accepts a loosening -> the real window empties, C returns to the pseudo-only 0.851409, auto again", async () => {
    const corpus = newCorpus("lore-au8-h3b-");
    const seeded = await seedDecisions(corpus, "stash-drop", 3, "h3b");
    expect(seeded.verdicts).toEqual(["auto", "auto", "auto"]);
    for (const id of seeded.ids) await observeReversal(corpus, id);

    const escalated = await seedDecisions(corpus, "stash-drop", 1, "h3b-after");
    expect(escalated.verdicts).toEqual(["escalate"]);
    expect(escalated.confidences).toEqual([0.785765]);

    // The agent-reachable paths do not bring it back: more tightening, or a loosening nobody accepted.
    const proposal = lore(corpus, ["autonomy", "set", "stash-drop", "--threshold", "0.75"]);
    expect(proposal.exitCode).toBe(4);
    const pendingId = Number(/Pending decision (\d+) created/.exec(proposal.stderr)?.[1]);
    const stillEscalated = await seedDecisions(corpus, "stash-drop", 1, "h3b-unaccepted");
    expect(stillEscalated.verdicts).toEqual(["escalate"]);
    expect(stillEscalated.confidences).toEqual([0.785765]);

    // An agent-identified channel cannot accept.
    const refused = await runDecide(corpus, pendingId, "accept", scriptedHumanPorts({ env: { CLAUDECODE: "1" } }));
    expect(refused.code).toBe(4);
    expect((await seedDecisions(corpus, "stash-drop", 1, "h3b-agent")).confidences).toEqual([0.785765]);

    // The human accepts; the same command now applies; the window is empty, pseudo-outcomes stay.
    const accepted = await runDecide(corpus, pendingId, "accept");
    expect(accepted.code, accepted.stderr).toBe(0);
    const applied = lore(corpus, ["autonomy", "set", "stash-drop", "--threshold", "0.75"]);
    expect(applied.exitCode, applied.stderr).toBe(0);

    const back = await seedDecisions(corpus, "stash-drop", 1, "h3b-back");
    expect(back.verdicts).toEqual(["auto"]);
    expect(back.confidences).toEqual([0.851409]);

    const stats = JSON.parse(lore(corpus, ["calibration", "--stats", "--json"]).stdout) as { data: { autonomy: Array<{ class: string; stood: number; reversed: number; window: number; boundary_record_id: number }> } };
    const stash = stats.data.autonomy.find((c) => c.class === "stash-drop");
    expect(stash).toMatchObject({ stood: 0, reversed: 0, window: 0 });
    expect(stash?.boundary_record_id).toBeGreaterThan(0);

    // A NEW reversal after the accept counts again (the window restarted, it is not disabled).
    await observeReversal(corpus, back.ids[0] as number);
    const next = await seedDecisions(corpus, "stash-drop", 1, "h3b-next");
    expect(next.confidences).toEqual([0.827736]);
  }, 240_000);

  it("loosenBoundaryOf names exactly the loosened classes of a human-tty accepted governance-loosen decision", () => {
    const subject = "autonomy-thresholds: stash-drop.threshold: 0.8 -> 0.7; worktree-remove.priorConfidence: 0.97 -> 0.99; worktreeRemoveRegenerable: + out/";
    const rows = [
      row({ id: 10, class: "governance-loosen", subject_id: subject, channel: "machine", verdict: "escalate" }),
      row({ id: 11, class: "governance-loosen", subject_id: subject, channel: "human-tty", verdict: "auto" }),
      row({ id: 12, class: "governance-loosen", subject_id: "autonomy-thresholds: process-reap.threshold: 0.85 -> 0.8", channel: "human-tty", verdict: "refuse" }),
    ];
    expect(loosenBoundaryOf(rows, "stash-drop")).toBe(11);
    expect(loosenBoundaryOf(rows, "worktree-remove")).toBe(11);
    expect(loosenBoundaryOf(rows, "process-reap"), "a rejected loosening empties nothing").toBe(0);
    expect(loosenBoundaryOf(rows, "run-end-stale")).toBe(0);
  });
});

describe("AC-AU-8 half 4: lore calibration --stats shows outcome counts per class (BR-1005)", () => {
  it("--json and the table carry auto decisions, stood/reversed, window, C, threshold and the escalating state per class", async () => {
    const corpus = newCorpus("lore-au8-h4-");
    const seeded = await seedDecisions(corpus, "stash-drop", 3, "h4");
    for (const id of seeded.ids) await observeReversal(corpus, id);

    const json = JSON.parse(lore(corpus, ["calibration", "--stats", "--json"]).stdout) as { data: { autonomy: Array<Record<string, unknown>> } };
    const stash = json.data.autonomy.find((c) => c["class"] === "stash-drop");
    expect(stash).toMatchObject({
      class: "stash-drop",
      auto_decisions: 3,
      stood: 0,
      reversed: 3,
      window: 3,
      pseudo: 50,
      prior: 0.95,
      confidence: 0.785765,
      threshold: 0.8,
      escalating: true,
    });
    const fresh = json.data.autonomy.find((c) => c["class"] === "worktree-remove");
    expect(fresh).toMatchObject({ auto_decisions: 0, reversed: 0, confidence: 0.879889, escalating: false });

    const table = lore(corpus, ["calibration", "--stats"]);
    expect(table.exitCode).toBe(0);
    expect(table.stdout).toMatch(/Autonomy outcome calibration/);
    expect(table.stdout).toMatch(/stash-drop\s+3\s+0 \/ 3\s+3\s+0\.95\s+0\.786\s+0\.8\s+ESCALATING/);
  }, 180_000);
});

describe("AC-AU-8 the outcome observers", () => {
  it("git probes: a dropped stash that is a stash again (restored from its archive ref) and a reverted commit are reversals; git failures are errors", async () => {
    const sha = "a".repeat(40);
    const stashRow = row({ id: 1, class: "stash-drop", subject_id: sha, subject_version: sha });
    const mergeRow = row({ id: 2, class: "worktree-remove", subject_id: "/wt", subject_version: `${"b".repeat(40)}:fp` });
    const mergeShaRow = row({ id: 3, class: "verify-new-command", subject_id: "c".repeat(40), subject_version: "v1" });

    const restoredGit = (args: readonly string[]) => ({ status: 0, stdout: args[0] === "stash" ? `${"f".repeat(40)}\n${sha}\n` : `${"d".repeat(40)}\n`, stderr: "" });
    const [archiveProbe, revertProbe] = createGitReversalProbes(restoredGit);
    const restored = await (archiveProbe as NonNullable<typeof archiveProbe>).check(stashRow);
    expect(restored.ok && restored.value?.source).toBe("archive-restore");
    const reverted = await (revertProbe as NonNullable<typeof revertProbe>).check(mergeShaRow);
    expect(reverted.ok && reverted.value?.source).toBe("merge-reverted");
    const notSha = await (revertProbe as NonNullable<typeof revertProbe>).check(mergeRow);
    expect(notSha.ok && notSha.value, "a subject that is no commit sha is never a reverted merge").toBeNull();

    const quietGit = () => ({ status: 0, stdout: "", stderr: "" });
    const [quietArchive, quietRevert] = createGitReversalProbes(quietGit);
    expect((await (quietArchive as NonNullable<typeof quietArchive>).check(stashRow)).ok).toBe(true);
    const none = await (quietArchive as NonNullable<typeof quietArchive>).check(stashRow);
    expect(none.ok && none.value).toBeNull();
    const noRevert = await (quietRevert as NonNullable<typeof quietRevert>).check(mergeShaRow);
    expect(noRevert.ok && noRevert.value).toBeNull();

    const failingGit = () => ({ status: 128, stdout: "", stderr: "fatal: boom" });
    const [failArchive] = createGitReversalProbes(failingGit);
    const failed = await (failArchive as NonNullable<typeof failArchive>).check(stashRow);
    expect(failed.ok, "a git failure is an error, never 'not reversed'").toBe(false);
  });

  it("observe(): audit-log evidence (restore, invalidate, reopen, correction after the decision) records reversed outcomes; aged decisions with none record stood", async () => {
    const corpus = newCorpus("lore-au8-obs-");
    // Subjects are real docs so the audit rows are legal.
    const created = lore(corpus, ["create", "knowledge", "--parent", ensureRequirementsDocSlug((a) => lore(corpus, a)), "--sub-type", "reference", "--title", "Observer subject", "--content", "x", "--json"]);
    expect(created.exitCode, created.stderr).toBe(0);
    const docId = (JSON.parse(created.stdout) as { data: { id: string } }).data.id;

    const store = actedStore(new SQLiteStore(corpus.dbPath));
    try {
      // decisions at t0 (clock in the past), audit evidence after, sweep at t0 + 8 days
      const t0 = "2026-01-01T00:00:00.000Z";
      const decisions = new DecisionService({ store, executorRun: null, now: () => t0 });
      const decided = await decisions.decide("stash-drop", { id: docId, version: "v1" }, AUTO_FACTS);
      const quiet = await decisions.decide("stash-drop", { id: "no-evidence-subject", version: "v1" }, AUTO_FACTS);
      if (!decided.ok || !quiet.ok) throw new Error("decide failed");

      const audit = async (action: string, details: Record<string, unknown>) =>
        store.appendAuditEntry({ timestamp: "2026-01-02T00:00:00.000Z", actor: "test", session_id: "s", action, doc_id: docId as never, details });
      expect((await audit("update", { operation: "reopen", version: 2 })).ok).toBe(true);

      const sweeper = new DecisionService({ store, executorRun: null, now: () => "2026-01-09T00:00:00.000Z", reversalProbes: [createAuditReversalProbe(store)] });
      const report = await sweeper.calibration().observe();
      if (!report.ok) throw new Error(`observe failed: ${JSON.stringify(report.error)}`);
      expect(report.value).toEqual({ reversed: 1, stood: 1, probed: 2 });

      const log = await readLog({ dir: "", dbPath: corpus.dbPath });
      const outcomes = log.filter((r) => r.class === OUTCOME_CLASS).map((r) => (JSON.parse(r.facts) as { outcome: { decision_id: number; result: string; source: string } }).outcome);
      expect(outcomes).toEqual([
        { decision_id: decided.value.record_id, result: "reversed", source: "doc-reopen", detail: expect.any(String) },
        { decision_id: quiet.value.record_id, result: "stood", source: "no-reversal-observed", detail: expect.any(String) },
      ]);

      // Idempotent: a second sweep finds nothing open.
      const again = await sweeper.calibration().observe();
      expect(again.ok && again.value).toEqual({ reversed: 0, stood: 0, probed: 0 });
    } finally {
      store.close();
    }
  }, 180_000);

  it("audit probe covers each reversal kind and ignores audit rows from BEFORE the decision", async () => {
    const corpus = newCorpus("lore-au8-kinds-");
    const created = lore(corpus, ["create", "knowledge", "--parent", ensureRequirementsDocSlug((a) => lore(corpus, a)), "--sub-type", "reference", "--title", "Kinds subject", "--content", "x", "--json"]);
    const docId = (JSON.parse(created.stdout) as { data: { id: string } }).data.id;
    const store = actedStore(new SQLiteStore(corpus.dbPath));
    try {
      const probe = createAuditReversalProbe(store);
      const decision = row({ id: 1, class: "stash-drop", subject_id: docId, ts: "2026-02-01T00:00:00.000Z" });
      const append = (timestamp: string, action: string, details: Record<string, unknown>) =>
        store.appendAuditEntry({ timestamp, actor: "t", session_id: "s", action, doc_id: docId as never, details });

      await append("2026-01-01T00:00:00.000Z", "restore", {});
      const before = await probe.check(decision);
      expect(before.ok && before.value, "evidence from before the decision is not a reversal").toBeNull();

      for (const [action, details, source] of [
        ["restore", {}, "doc-restore"],
        ["invalidate", {}, "doc-invalidate"],
        ["update", { operation: "reopen" }, "doc-reopen"],
        ["update", { correction: { reason: "fix" } }, "doc-correction"],
      ] as const) {
        const fresh = newCorpus("lore-au8-kind-");
        const doc = (JSON.parse(lore(fresh, ["create", "knowledge", "--parent", ensureRequirementsDocSlug((a) => lore(fresh, a)), "--sub-type", "reference", "--title", `K ${source}`, "--content", "x", "--json"]).stdout) as { data: { id: string } }).data.id;
        const s2 = actedStore(new SQLiteStore(fresh.dbPath));
        try {
          await s2.appendAuditEntry({ timestamp: "2026-03-01T00:00:00.000Z", actor: "t", session_id: "s", action, doc_id: doc as never, details });
          const found = await createAuditReversalProbe(s2).check(row({ id: 1, class: "stash-drop", subject_id: doc, ts: "2026-02-01T00:00:00.000Z" }));
          expect(found.ok && found.value?.source, action).toBe(source);
        } finally {
          s2.close();
        }
      }
      const plain = await append("2026-03-01T00:00:00.000Z", "update", { note: "ordinary edit" });
      expect(plain.ok).toBe(true);
    } finally {
      store.close();
    }
  }, 240_000);
});

describe("AC-AU-8 the three callers carry no placeholder C", () => {
  const read = (name: string) => readFileSync(join(PACKAGE_ROOT, "src", "service", name), "utf8");

  it("stash-prune, worktree-removal and run-reap services neither read a class prior nor put `confidence` into facts", () => {
    for (const name of ["stash-prune-service.ts", "worktree-removal-service.ts", "run-reap-service.ts"]) {
      const code = read(name)
        .split("\n")
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
        .join("\n");
      expect(code, name).not.toMatch(/priorConfidence/);
      expect(code, name).not.toMatch(/\bconfidence\s*:/);
    }
  });

  it("DecisionService is the only writer of C: its recorded facts carry the computed bound", async () => {
    const corpus = newCorpus("lore-au8-callers-");
    const seeded = await seedDecisions(corpus, "worktree-remove", 1, "/wt/a");
    expect(seeded.confidences).toEqual([0.879889]);
    const log = await readLog(corpus);
    const decisionRow = log.find((r) => r.class === "worktree-remove");
    expect(JSON.parse(decisionRow?.facts ?? "{}")).toMatchObject({ confidence: 0.879889 });
  }, 120_000);
});
