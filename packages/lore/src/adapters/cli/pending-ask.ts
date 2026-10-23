/**
 * `lore pending --ask` — the questions a human answers in the agent session (BR-1374, AC-ASK-1).
 *
 * Purpose: turn every open decision into an AskUserQuestion-ready question object lore wrote itself, with a fresh
 * single-use nonce stored beside the decision, and parse the agent's optional `--recommend` lines.
 * Public surface: parseRecommendations, runPendingAsk, AskRecommendation, PendingAskOutput, ASK_QUESTIONS_PER_CALL.
 * Invariants:
 *   - The question text is lore's: id, what (summary), facts (class, subject, version, score, factors), consequence
 *     (`If you accept` / `If you reject`), lore's measured recommendation. The agent's recommendation enters only
 *     through `--recommend` and appears as one labelled line in the matching option's description.
 *   - Every issue draws a new nonce, so a second `lore pending --ask` makes the first one's answers stale.
 *   - The output holds the questions exactly as they must be passed on; changing one character makes the answer refused.
 *   - A `--recommend` naming a decision that is not open is an error (exit 2), never silently dropped.
 * Side-effect class: IO (opens the corpus store; appends pending_asks rows).
 */
import type { Invocation, LoreError, Result } from "@lore/core";
import { err, ok, validationError } from "@lore/core";
import { DecisionService } from "../../service/decision-service.js";
import { ASK_ACCEPT_LABEL, ASK_DECISION_MARKER, ASK_REJECT_LABEL, askNonceMarker, issuePendingQuestion, type HarnessQuestion } from "../../service/harness-ask.js";
import type { PendingDecision } from "../../service/pending-decisions.js";
import { SQLiteStore } from "../../store/sqlite-store.js";
import { wrapStoreError } from "../../store/store-shared.js";
import { renderDecisionDetailLines, renderDetailsLine, resolveDetailBase } from "./decision-detail-lines.js";

/** AskUserQuestion takes at most four questions per call. */
export const ASK_QUESTIONS_PER_CALL = 4;

export interface AskRecommendation {
  readonly answer: "accept" | "reject";
  readonly reason: string;
}

export interface PendingAskOutput {
  /** Every question, in decision id order. */
  readonly questions: readonly HarnessQuestion[];
  /** The same questions grouped for the question tool, at most ASK_QUESTIONS_PER_CALL per call. */
  readonly batches: readonly (readonly HarnessQuestion[])[];
  /** Decision ids, aligned with `questions`. */
  readonly decision_ids: readonly number[];
}

/**
 * Parses repeated `--recommend <id>=accept|reject:<reason>` values.
 *
 * @returns decision id -> recommendation, or a VALIDATION_ERROR naming the offending value
 */
export function parseRecommendations(raw: readonly string[]): Result<ReadonlyMap<number, AskRecommendation>, LoreError> {
  const parsed = new Map<number, AskRecommendation>();
  for (const value of raw) {
    const match = /^(\d+)=(accept|reject):(.+)$/s.exec(value);
    if (match === null) return err(validationError("recommend", `expected <id>=accept|reject:<reason>, got ${JSON.stringify(value)}`));
    parsed.set(Number(match[1]), { answer: match[2] as "accept" | "reject", reason: (match[3] as string).trim() });
  }
  return ok(parsed);
}

function questionFor(pending: PendingDecision, nonce: string, recommendation: AskRecommendation | undefined, detailBase: string | null): HarnessQuestion {
  const factors = Object.entries(pending.factors).map(([name, value]) => `${name}=${value}`).join(" ");
  const text = [
    `${ASK_DECISION_MARKER}${pending.id} ${askNonceMarker(nonce)}: do you accept it?`,
    ...renderDecisionDetailLines(pending),
    `Facts: class ${pending.class}; subject ${pending.subject_id} (${pending.subject_version}); score ${pending.score}${factors === "" ? "" : `; factors ${factors}`}.`,
    `Lore's measured recommendation: ${pending.recommended} (${pending.recommended_reason}).`,
    renderDetailsLine(detailBase, pending.id),
  ].join("\n");
  const agentLine = (side: "accept" | "reject"): string =>
    recommendation !== undefined && recommendation.answer === side ? ` Agent recommendation (not lore's): ${recommendation.reason}` : "";
  return {
    question: text,
    header: `Decision ${pending.id}`.slice(0, 12),
    options: [
      { label: ASK_ACCEPT_LABEL, description: `Accept: the operation may proceed when it is re-run.${agentLine("accept")}` },
      { label: ASK_REJECT_LABEL, description: `Reject: the operation stays refused.${agentLine("reject")}` },
    ],
    multiSelect: false,
  };
}

/**
 * Issues one question per open decision.
 *
 * @param dbPath - the corpus database
 * @param recommendations - the agent's `--recommend` lines (decision id -> recommendation)
 */
export async function runPendingAsk(inv: Invocation, dbPath: string, recommendations: ReadonlyMap<number, AskRecommendation>): Promise<Result<PendingAskOutput, LoreError>> {
  let store: SQLiteStore;
  try {
    store = new SQLiteStore(dbPath);
  } catch (cause) {
    return wrapStoreError(cause);
  }
  try {
    const listed = await new DecisionService({ store, executorRun: null }).listPending();
    if (!listed.ok) return listed;
    const open = listed.value;
    const unknown = [...recommendations.keys()].filter((id) => !open.some((p) => p.id === id));
    if (unknown.length > 0) return err(validationError("recommend", `no open decision with id ${unknown.join(", ")} (see lore pending)`));
    const detailBase = resolveDetailBase(inv);
    const questions: HarnessQuestion[] = [];
    for (const pending of open) {
      const issued = await issuePendingQuestion(store, pending, (nonce) => questionFor(pending, nonce, recommendations.get(pending.id), detailBase), new Date().toISOString());
      if (!issued.ok) return issued;
      questions.push(issued.value);
    }
    const batches: HarnessQuestion[][] = [];
    for (let i = 0; i < questions.length; i += ASK_QUESTIONS_PER_CALL) batches.push(questions.slice(i, i + ASK_QUESTIONS_PER_CALL));
    return ok({ questions, batches, decision_ids: open.map((p) => p.id) });
  } finally {
    store.close();
  }
}
