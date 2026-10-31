/**
 * Review round cap — a judgment-required document gets two review rounds per approval cycle, then a human decides.
 *
 * Purpose: BR-1531. For a type in `judgment_required_types` an approval cycle allows at most {@link BASE_REVIEW_ROUNDS}
 *   review rounds, where a ROUND is one judged distinct document version. Once the rounds are used up, the next step is a
 *   human decision asked through the pending route (decision class `review-round-cap`, subject = the document id):
 *   accept approves the current version, reject returns the document to draft, direct records the direction and allows
 *   one more round. Reopening a spec starts a new cycle.
 * Public surface: REVIEW_ROUND_CAP_CLASS, BASE_REVIEW_ROUNDS, ReviewRoundCap, RoundCapState, HumanRoundCapAnswer.
 * Invariants:
 *   - Rounds count DISTINCT `doc_version` values of the doc's review judgments from the cycle start, never judgments:
 *     two judgments of one version are one round (BR-1531 false-green clause).
 *   - The cycle starts at the version written by the doc's latest reopen (audit `details.operation === "reopen"`), else at 0.
 *   - The decision subject is `(doc id, c<cycle>:a<allowed>:v<doc version>)`: `allowed` grows by one per human `direct`
 *     answer of the cycle, so a direct opens a NEW subject (the next cap bite asks again) and an answer binds one version.
 *   - The answer is read ONLY from the decision log's human-tty rows (`DecisionService.resolvePending` is the single
 *     writer); nothing stored on the document counts.
 *   - Reject is NOT a cycle boundary: only a reopen is (BR-1531). A reworked version after a reject is a further round
 *     and, the rounds being spent, asks the human again.
 * Side-effect class: IO (reads judgments, audit and the decision log; `ask` appends one machine decision row).
 *
 * Source: spec-every-document-is-stored-as-structured-fields-validated-by AC-ST-6; BR-1531.
 */
import { err, ok, type DocRecord, type LoreError, type Result } from "@lore/core";
import { effectiveDecisionVerdict } from "../store/decision-log.js";
import type { DecisionDetail } from "../store/decision-log.js";
import type { StoreInterface } from "../store/store-interface.js";
import type { DecisionService, DecisionSubject } from "./decision-service.js";
import type { JudgmentService } from "./judgment-service.js";
import { OVERRIDE_MEASURED_FACTS } from "./override-decision.js";
import { REOPEN_AUDIT_ACTION, REOPEN_OPERATION } from "./record-lock-service.js";

/** The decision class of the human decision after the second non-approving round (registered in core classes.ts). */
export const REVIEW_ROUND_CAP_CLASS = "review-round-cap";

/** Review rounds an approval cycle allows before a human `direct` adds more. */
export const BASE_REVIEW_ROUNDS = 2;

/** What the human answered for one subject: accept (approve), reject (back to draft), direct (one more round). */
export type HumanRoundCapAnswer = "accept" | "reject" | "direct";

/** The measured round state of one document in its current approval cycle. */
export interface RoundCapState {
  /** Version written by the latest reopen, 0 when never reopened: judgments below it belong to an earlier cycle. */
  readonly cycleStart: number;
  /** Judged distinct versions in this cycle. */
  readonly roundsUsed: number;
  /** Rounds allowed now: the base plus one per human `direct` of this cycle. */
  readonly allowed: number;
  /** True when the current version was already judged in this cycle (re-reviewing it is not a new round). */
  readonly currentVersionJudged: boolean;
  /** The decision subject of the current version at the current allowance. */
  readonly subject: DecisionSubject;
  /** The human's effective answer for {@link subject}, or null when none (pending or never asked). */
  readonly humanAnswer: HumanRoundCapAnswer | null;
  /** True when the rounds are spent: a further round is not allowed without a human `direct`. */
  readonly spent: boolean;
}

export interface ReviewRoundCapDeps {
  readonly store: Pick<StoreInterface, "queryAudit" | "listDecisionLog">;
  readonly judgments: Pick<JudgmentService, "listFor">;
  readonly decisions: Pick<DecisionService, "decide" | "listPending">;
}

/** The answer a human-tty row carries in `facts.human.answer`, or null when the row is not a readable human answer. */
function humanAnswerOfFacts(facts: string): HumanRoundCapAnswer | null {
  try {
    const parsed: unknown = JSON.parse(facts);
    const human = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)["human"] : undefined;
    const answer = typeof human === "object" && human !== null ? (human as Record<string, unknown>)["answer"] : undefined;
    return answer === "accept" || answer === "reject" || answer === "direct" ? answer : null;
  } catch {
    // reason: an unreadable facts column is not an answer; it must never read as an accept.
    return null;
  }
}

export class ReviewRoundCap {
  constructor(private readonly deps: ReviewRoundCapDeps) {}

  /**
   * Measures `doc`'s rounds in its current cycle. Pure reads.
   *
   * @param doc - a document of a judgment-required type (the caller owns that check)
   * @returns err(STORE_ERROR) when judgments, audit or the decision log cannot be read
   */
  async measure(doc: Pick<DocRecord, "id" | "slug" | "version">): Promise<Result<RoundCapState, LoreError>> {
    const cycleStart = await this.cycleStartOf(doc.id);
    if (!cycleStart.ok) return cycleStart;
    const judged = await this.deps.judgments.listFor(doc.id as Parameters<JudgmentService["listFor"]>[0], "review");
    if (!judged.ok) return judged;
    const versions = new Set(judged.value.filter((j) => j.doc_version >= cycleStart.value).map((j) => j.doc_version));

    const log = await this.deps.store.listDecisionLog();
    if (!log.ok) return log;
    const mine = log.value.filter((r) => r.class === REVIEW_ROUND_CAP_CLASS && r.subject_id === doc.id);
    const cyclePrefix = `c${cycleStart.value}:`;
    const directedSubjects = new Set(
      mine.filter((r) => r.channel === "human-tty" && r.subject_version.startsWith(cyclePrefix) && humanAnswerOfFacts(r.facts) === "direct").map((r) => r.subject_version),
    );
    const allowed = BASE_REVIEW_ROUNDS + directedSubjects.size;
    const subject: DecisionSubject = { id: doc.id, version: `${cyclePrefix}a${allowed}:v${doc.version}` };
    const effective = effectiveDecisionVerdict(mine, { class: REVIEW_ROUND_CAP_CLASS, subject_id: subject.id, subject_version: subject.version });
    let humanAnswer: HumanRoundCapAnswer | null = null;
    if (effective !== null && effective.channel === "human-tty") {
      const row = mine.find((r) => r.id === effective.record_id);
      humanAnswer = effective.verdict === "refuse" ? "reject" : row === undefined ? null : humanAnswerOfFacts(row.facts);
    }
    return ok({
      cycleStart: cycleStart.value,
      roundsUsed: versions.size,
      allowed,
      currentVersionJudged: versions.has(doc.version),
      subject,
      humanAnswer,
      spent: versions.size >= allowed,
    });
  }

  /**
   * Opens (or finds again) the pending human decision of `state.subject` and returns its id.
   *
   * @param doc - the capped document
   * @param state - its measured state
   * @param asked - the command the refused caller ran, named in the decision detail
   * @returns the pending decision id; err when the decision cannot be recorded or has no pending row
   */
  async ask(doc: Pick<DocRecord, "slug" | "version">, state: RoundCapState, asked: string): Promise<Result<number, LoreError>> {
    const detail: DecisionDetail = {
      summary: `Decide ${doc.slug} after ${state.roundsUsed} review round(s) (cap ${state.allowed}) at version ${doc.version}`,
      requested_by: `the session that ran ${asked}`,
      change: { document: doc.slug, version: doc.version, rounds_used: state.roundsUsed, rounds_allowed: state.allowed },
      on_accept: "The current version is approved when `lore approve` is re-run; no further review is needed.",
      on_reject: "The document returns to draft; reworking it is a further round and asks again.",
    };
    const decided = await this.deps.decisions.decide(REVIEW_ROUND_CAP_CLASS, state.subject, { ...OVERRIDE_MEASURED_FACTS, recoverability: "irreversible-external" }, detail);
    if (!decided.ok) return decided;
    const pending = await this.deps.decisions.listPending();
    if (!pending.ok) return pending;
    const open = pending.value.find(
      (p) => p.class === REVIEW_ROUND_CAP_CLASS && p.subject_id === state.subject.id && p.subject_version === state.subject.version,
    );
    if (open === undefined) return err({ code: "STORE_ERROR", message: `review-round-cap escalated (record ${decided.value.record_id}) but has no pending decision` });
    return ok(open.id);
  }

  /** The version written by `docId`'s latest reopen, 0 when it was never reopened. */
  private async cycleStartOf(docId: string): Promise<Result<number, LoreError>> {
    const rows = await this.deps.store.queryAudit({ doc_id: docId, action: REOPEN_AUDIT_ACTION });
    if (!rows.ok) return rows;
    let latest = 0;
    for (const row of rows.value) {
      const details = row.details as Record<string, unknown> | undefined;
      if (details?.["operation"] !== REOPEN_OPERATION) continue;
      const version = details["version"];
      if (typeof version === "number" && version > latest) latest = version;
    }
    return ok(latest);
  }
}
