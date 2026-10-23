/**
 * `lore pending --ask` — the questions a human answers in the agent session (BR-1374, AC-ASK-1).
 *
 * Purpose: turn every open decision into an AskUserQuestion-ready question object lore wrote itself, with a fresh
 * single-use nonce stored beside the decision, and parse the agent's optional `--recommend` lines.
 * Public surface: parseRecommendations, runPendingAsk, AskRecommendation, PendingAskOutput, ASK_QUESTIONS_PER_CALL.
 * Invariants:
 *   - The question text is lore's, in the `--lang` language: id, what (summary), facts (class, subject, version, score,
 *     factors), consequence (`If you accept` / `If you reject`), and lore's measured recommendation only for a class it
 *     scores (a human-always class has none). No line sends the human elsewhere (BR-1375).
 *   - The agent's recommendation enters only through `--recommend`: that option comes FIRST, its label ends with the
 *     language's recommendation marker and its description starts with the reason.
 *   - Every issue draws a new nonce, so a second `lore pending --ask` makes the first one's answers stale.
 *   - The output holds the questions exactly as they must be passed on; changing one character makes the answer refused.
 *   - A `--recommend` naming a decision that is not open is an error (exit 2), never silently dropped.
 * Side-effect class: IO (opens the corpus store; appends pending_asks rows).
 */
import type { Invocation, LoreError, Result } from "@lore/core";
import { err, ok, validationError } from "@lore/core";
import { DecisionService } from "../../service/decision-service.js";
import { ASK_DECISION_MARKER, askNonceMarker, issuePendingQuestion, type HarnessQuestion } from "../../service/harness-ask.js";
import type { PendingDecision } from "../../service/pending-decisions.js";
import { SQLiteStore } from "../../store/sqlite-store.js";
import { wrapStoreError } from "../../store/store-shared.js";
import { renderDecisionDetailLines } from "./decision-detail-lines.js";
import { ASK_TEXT, type AskLanguage } from "./pending-ask-text.js";

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

function questionFor(pending: PendingDecision, nonce: string, recommendation: AskRecommendation | undefined, lang: AskLanguage): HarnessQuestion {
  const t = ASK_TEXT[lang];
  const factors = Object.entries(pending.factors).map(([name, value]) => `${name}=${value}`).join(" ");
  const text = [
    `${ASK_DECISION_MARKER}${pending.id} ${askNonceMarker(nonce)}: ${t.question}`,
    ...renderDecisionDetailLines(pending, lang),
    t.facts({ class: pending.class, subject: pending.subject_id, version: pending.subject_version, score: pending.score, factors }),
    // reason: a human-always class (threshold null) has no measured scoring; its "reject" line was boilerplate that read as a recommendation (BR-1375 owner feedback 2026-10-23).
    ...(pending.threshold === null ? [] : [t.measured(pending.recommended, pending.recommended_reason)]),
  ].join("\n");
  const option = (side: "accept" | "reject"): HarnessQuestion["options"][number] => {
    const label = side === "accept" ? t.acceptLabel : t.rejectLabel;
    const description = side === "accept" ? t.acceptDescription : t.rejectDescription;
    if (recommendation === undefined || recommendation.answer !== side) return { label, description };
    return { label: `${label} ${t.recommendedMarker}`, description: `${recommendation.reason} ${description}` };
  };
  const options = recommendation?.answer === "reject" ? [option("reject"), option("accept")] : [option("accept"), option("reject")];
  return { question: text, header: `Decision ${pending.id}`.slice(0, 12), options, multiSelect: false };
}

/**
 * Issues one question per open decision.
 *
 * @param dbPath - the corpus database
 * @param recommendations - the agent's `--recommend` lines (decision id -> recommendation)
 * @param lang - the question language
 */
export async function runPendingAsk(
  _inv: Invocation,
  dbPath: string,
  recommendations: ReadonlyMap<number, AskRecommendation>,
  lang: AskLanguage = "en",
): Promise<Result<PendingAskOutput, LoreError>> {
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
    const questions: HarnessQuestion[] = [];
    for (const pending of open) {
      const issued = await issuePendingQuestion(store, pending, (nonce) => questionFor(pending, nonce, recommendations.get(pending.id), lang), new Date().toISOString());
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
