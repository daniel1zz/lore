/**
 * Harness ask — lore writes the question a human answers in the agent session, and records the answer the harness
 * reports (spec-human-decisions-are-asked-in-the-session-and-recorded-by; AC-ASK-1, AC-ASK-2; BR-1374).
 *
 * Purpose: the issue side (`issuePendingQuestion`: nonce + sha256 of the exact question object, stored with the
 * pending decision) and the record side (`recordHarnessAnswers`: verify every answered question against what was
 * issued, then resolve the decision through `DecisionService.resolvePending` with a harness-ask proof).
 * Public surface: HarnessQuestion, ASK_ACCEPT_LABEL, ASK_REJECT_LABEL, ASK_DECISION_MARKER, askNonceMarker,
 *   canonicalQuestion, hashQuestion, issuePendingQuestion, recordHarnessAnswers, QuestionOutcome, HarnessAnswerReport,
 *   HARNESS_ANSWER_REFUSAL_EXIT.
 * Invariants:
 *   - lore writes the whole question. A question is accepted only when sha256(canonicalQuestion(it)) equals the hash
 *     stored under its nonce: one changed character in the text, an option label or a description is refused.
 *   - A nonce is honoured when it was issued, is the LATEST ask of its decision, is unused, the decision is still
 *     pending on the same subject version, and the id named in the question text is that decision's. It is consumed
 *     (single use) BEFORE the decision is resolved, so a failed resolve burns it rather than leaving it replayable.
 *   - Payload: only a PostToolUse payload of the AskUserQuestion tool counts. The answers are read from
 *     `tool_response.answers` (question text -> chosen option label), the shape Claude Code writes for this tool.
 *   - A question without the lore marker is not ours and is ignored (exit 0). A question carrying the marker that fails
 *     any check is refused and the call exits HARNESS_ANSWER_REFUSAL_EXIT (4); the other questions of the same call are
 *     still processed. An answer that is not exactly Accept or Reject (free-text Other, nothing chosen) records nothing,
 *     leaves the nonce unused and reports the decision as still pending (exit 0).
 *   - There is no agent-identity check here: the caller is a hook under the harness by design. The barrier against an
 *     agent forging an answer is the git-safety gate refusing `lore decide`; see the residual in the spec.
 * Side-effect class: IO through the injected store (pending_asks rows, decision_log append).
 */
import { createHash } from "node:crypto";
import { err, ok, type LoreError, type Result } from "@lore/core";
import { z } from "zod";
import { canonicalJson } from "./autonomy-threshold-service.js";
import { DecisionService } from "./decision-service.js";
import { generateNonce, issueHarnessAskProof } from "./human-channel.js";
import type { PendingDecision } from "./pending-decisions.js";
import type { StoreInterface } from "../store/store-interface.js";

/** Exit code of a call that refused at least one question (same bucket as every `lore decide` refusal). */
export const HARNESS_ANSWER_REFUSAL_EXIT = 4;

export const ASK_ACCEPT_LABEL = "Accept";
export const ASK_REJECT_LABEL = "Reject";

/** Text that opens every lore-written question; the decision id follows. Its absence means "not a lore question". */
export const ASK_DECISION_MARKER = "Lore decision #";

/** The bracketed nonce marker inside the question text. */
export function askNonceMarker(nonce: string): string {
  return `[ask ${nonce}]`;
}

const questionSchema = z.object({
  question: z.string(),
  header: z.string(),
  options: z.array(z.object({ label: z.string(), description: z.string() })),
  multiSelect: z.boolean().optional(),
});

/** The AskUserQuestion question object (`tool_input.questions[]`). */
export type HarnessQuestion = z.infer<typeof questionSchema>;

/** The fields that make a question: nothing the harness may add around it takes part in the hash. */
export function canonicalQuestion(question: HarnessQuestion): HarnessQuestion & { multiSelect: boolean } {
  return {
    question: question.question,
    header: question.header,
    options: question.options.map((o) => ({ label: o.label, description: o.description })),
    multiSelect: question.multiSelect === true,
  };
}

/** sha256 (hex) of the canonical JSON of the question object. */
export function hashQuestion(question: HarnessQuestion): string {
  return createHash("sha256").update(canonicalJson(canonicalQuestion(question))).digest("hex");
}

/**
 * Issues the question for one pending decision: draws a fresh nonce, lets `buildQuestion` write the question around it,
 * and stores (decision id, subject version, nonce, hash) so the answer can be verified later. A newer issue makes every
 * older ask of the decision stale.
 *
 * @returns the question exactly as it must be passed to the interactive question tool
 */
export async function issuePendingQuestion(
  store: StoreInterface,
  pending: PendingDecision,
  buildQuestion: (nonce: string) => HarnessQuestion,
  now: string,
): Promise<Result<HarnessQuestion, LoreError>> {
  const nonce = generateNonce();
  const question = canonicalQuestion(buildQuestion(nonce));
  const stored = await store.issuePendingAsk({
    decision_id: pending.id,
    subject_version: pending.subject_version,
    nonce,
    question_hash: hashQuestion(question),
    issued_at: now,
  });
  if (!stored.ok) return stored;
  return ok(question);
}

/** What happened to one question of the payload. */
export type QuestionOutcome =
  | { readonly kind: "ignored"; readonly line: string }
  | { readonly kind: "refused"; readonly line: string }
  | { readonly kind: "pending"; readonly line: string }
  | { readonly kind: "recorded"; readonly line: string; readonly decision_id: number; readonly answer: "accept" | "reject" };

export interface HarnessAnswerReport {
  /** 0, or HARNESS_ANSWER_REFUSAL_EXIT when anything was refused or the payload was not an AskUserQuestion PostToolUse. */
  readonly exit: number;
  /** One line per question (a single line when the payload itself was refused). */
  readonly lines: readonly string[];
  readonly outcomes: readonly QuestionOutcome[];
}

const payloadSchema = z.object({
  hook_event_name: z.literal("PostToolUse"),
  tool_name: z.literal("AskUserQuestion"),
  tool_input: z.object({ questions: z.array(z.unknown()) }),
  tool_response: z.unknown().optional(),
});

const answersSchema = z.object({ answers: z.record(z.string(), z.string()) });

function payloadRefusal(detail: string): HarnessAnswerReport {
  return { exit: HARNESS_ANSWER_REFUSAL_EXIT, lines: [`refused (BR-1374): ${detail}; nothing was recorded`], outcomes: [] };
}

/**
 * Verifies and records the answers of one PostToolUse AskUserQuestion payload.
 *
 * @param payloadText - the hook's stdin, verbatim
 * @returns the report; a store failure is returned as err, never folded into a refusal
 */
export async function recordHarnessAnswers(deps: { readonly store: StoreInterface; readonly now: () => string }, payloadText: string): Promise<Result<HarnessAnswerReport, LoreError>> {
  let json: unknown;
  try {
    json = JSON.parse(payloadText);
  } catch {
    return ok(payloadRefusal("stdin is not JSON"));
  }
  const payload = payloadSchema.safeParse(json);
  if (!payload.success) return ok(payloadRefusal("stdin is not a PostToolUse payload of the AskUserQuestion tool"));
  const answered = answersSchema.safeParse(payload.data.tool_response);
  const answers: Readonly<Record<string, string>> = answered.success ? answered.data.answers : {};

  const outcomes: QuestionOutcome[] = [];
  for (const [index, raw] of payload.data.tool_input.questions.entries()) {
    const label = `question ${index + 1}`;
    const parsed = questionSchema.safeParse(raw);
    if (!parsed.success) {
      outcomes.push({ kind: "refused", line: `${label}: refused: not a question object` });
      continue;
    }
    const outcome = await recordOneQuestion(deps, parsed.data, answers, label);
    if (!outcome.ok) return outcome;
    outcomes.push(outcome.value);
  }
  const refused = outcomes.some((o) => o.kind === "refused");
  return ok({ exit: refused ? HARNESS_ANSWER_REFUSAL_EXIT : 0, lines: outcomes.map((o) => o.line), outcomes });
}

async function recordOneQuestion(
  deps: { readonly store: StoreInterface; readonly now: () => string },
  question: HarnessQuestion,
  answers: Readonly<Record<string, string>>,
  label: string,
): Promise<Result<QuestionOutcome, LoreError>> {
  const refuse = (why: string): Result<QuestionOutcome, LoreError> => ok({ kind: "refused", line: `${label}: refused: ${why}` });
  const markerAt = question.question.indexOf(ASK_DECISION_MARKER);
  if (markerAt < 0) return ok({ kind: "ignored", line: `${label}: not a lore decision question; ignored` });

  const named = /^(\d+)/.exec(question.question.slice(markerAt + ASK_DECISION_MARKER.length));
  const nonce = /\[ask ([A-Z2-9]+)\]/.exec(question.question)?.[1];
  if (named === null) return refuse("the question names no decision id");
  const decisionId = Number(named[1]);
  if (nonce === undefined) return refuse(`decision ${decisionId}: the question carries no nonce`);

  const ask = await deps.store.readPendingAsk(nonce);
  if (!ask.ok) return ask;
  if (ask.value === null) return refuse(`decision ${decisionId}: unknown nonce`);
  const issued = ask.value;
  if (issued.decision_id !== decisionId) return refuse(`decision ${decisionId}: the nonce was issued for another decision`);
  if (!issued.is_latest) return refuse(`decision ${decisionId}: stale nonce (a newer question was issued)`);
  if (issued.used_at !== null) return refuse(`decision ${decisionId}: the nonce was already used`);
  if (hashQuestion(question) !== issued.question_hash) return refuse(`decision ${decisionId}: the question differs from the one lore issued`);

  const service = new DecisionService({ store: deps.store, executorRun: null });
  const pending = await service.getPending(decisionId);
  if (!pending.ok) return pending;
  if (pending.value === null) return refuse(`decision ${decisionId}: not pending`);
  if (pending.value.subject_version !== issued.subject_version) return refuse(`decision ${decisionId}: the subject changed since the question was issued`);

  const chosen = answers[question.question];
  const answer = chosen === ASK_ACCEPT_LABEL ? "accept" : chosen === ASK_REJECT_LABEL ? "reject" : null;
  if (answer === null) return ok({ kind: "pending", line: `${label}: decision ${decisionId} still pending (no Accept or Reject chosen)` });

  const consumed = await deps.store.consumePendingAsk(nonce, deps.now());
  if (!consumed.ok) return consumed;
  if (!consumed.value) return refuse(`decision ${decisionId}: the nonce was already used`);
  const resolved = await service.resolvePending(decisionId, answer, "answered in the agent session through the interactive question", issueHarnessAskProof(deps.now()));
  if (!resolved.ok) return err(resolved.error);
  return ok({
    kind: "recorded",
    decision_id: decisionId,
    answer,
    line: `${label}: decision ${decisionId} ${answer === "accept" ? "accepted" : "rejected"} (record ${resolved.value.id}); carry out the answer: ${answer === "accept" ? "re-run the operation now" : "do not re-run the operation"}`,
  });
}
