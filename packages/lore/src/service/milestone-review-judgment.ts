/**
 * Milestone judgment layer: runs the judge calls of one review and folds them into the four judged dimensions.
 *
 * Purpose: one call when the diff fits the per-call budget; otherwise security and concurrency_safety once per file
 *   chunk (worst verdict wins) plus one summary call (spec_conformance, design_necessity, AI-mode criteria) on the full
 *   file list and chunk summaries. Files no call shows are listed as unseen and make the gates not-measured (BR-1499).
 * Public surface: runJudgment, JudgeReply, JudgePort, JudgmentInput, JudgmentOutcome, combineWorst,
 *   factsDimensions, mergeDimensions.
 * Invariants:
 *   - A judged dimension on a file set with any unseen file is `fail` (a seen chunk failed) or `not-measured`, never `pass`.
 *   - An AI verdict on a facts dimension is stripped by the answer schema; `factsDimensions` computes those from facts.
 *   - A judge answer that does not parse (or misses a criterion/decision) is retried ONCE with the problem; a second
 *     failure is an AI error and nothing is returned (a half-formed review is never a review).
 *   - Every judge invocation, retries included, counts in `record.calls`; tokens are summed only over calls that reported
 *     usage and are absent (never 0) when none did.
 * Side-effect class: IO through the injected `judge` port only.
 *
 * Reference: Kayenta automated canary analysis (worst metric wins); first-fit chunking in `ai/diff-chunking.ts`.
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (Judgment layer, D6, BR-1499)
 */

import {
  err,
  extractAssessmentJson,
  judgmentAnswerSchema,
  ok,
  type AiCriterionAnswer,
  type DecisionFinding,
  type DimensionJudgment,
  type JudgedDimension,
  type JudgmentRecord,
  type LlmMilestoneOutput,
  type LoreError,
  type MilestoneFacts,
  type Result,
} from "@lore/core";
import { chunkDiffByFile } from "../ai/diff-chunking.js";
import {
  askedDimensionsOf,
  buildMilestoneReviewPrompt,
  type DiffChunkSummary,
  type JudgedDecisionInput,
  type MilestonePromptMode,
  type MilestoneReviewPromptInput,
} from "../ai/milestone-review-template.js";
import { judgedFindingsOf } from "./decision-recheck.js";

/** One judge reply with what the call cost. */
export interface JudgeReply {
  readonly text: string;
  readonly duration_ms: number;
  readonly tokens_in?: number;
  readonly tokens_out?: number;
}

/** Sends one prompt to the configured judge. */
export type JudgePort = (prompt: string, title: string) => Promise<Result<JudgeReply, LoreError>>;

/** What `runJudgment` needs. */
export interface JudgmentInput {
  /** The prompt parts shared by every call (plan, spec, tasks, facts, rules, decisions, diff source). */
  readonly base: Omit<MilestoneReviewPromptInput, "mode" | "diffText" | "allFiles" | "chunkSummaries" | "unseenFiles">;
  readonly title: string;
  readonly diffText?: string;
  /** Per-call character budget for diff text (`ai.assess.max_diff_chars`). */
  readonly maxDiffChars: number;
  readonly judge: JudgePort;
  readonly recorded: readonly JudgedDecisionInput[];
}

/** The folded result of the judgment layer. */
export interface JudgmentOutcome {
  readonly dimensions: Record<JudgedDimension, DimensionJudgment>;
  readonly findings: readonly DecisionFinding[];
  readonly record: JudgmentRecord;
}

function aiError(message: string): LoreError {
  return { code: "AI_PROVIDER_ERROR", message, provider: "milestone-review" };
}

const VERDICT_RANK: Readonly<Record<DimensionJudgment["verdict"], number>> = { fail: 3, "not-measured": 2, pass: 1, na: 0 };

/**
 * The worst of several judgments of one dimension: fail over not-measured over pass over na. A failure's cites are
 * the union of every failing judgment's cites.
 *
 * @param judgments - at least one judgment of the same dimension
 * @returns the worst judgment (first among equals)
 */
export function combineWorst(judgments: readonly DimensionJudgment[]): DimensionJudgment {
  const first = judgments[0];
  if (first === undefined) throw new RangeError("combineWorst needs at least one judgment");
  const worst = judgments.reduce((a, b) => (VERDICT_RANK[b.verdict] > VERDICT_RANK[a.verdict] ? b : a), first);
  if (worst.verdict !== "fail") return worst;
  const cites = [...new Set(judgments.filter((j) => j.verdict === "fail").flatMap((j) => j.cites ?? []))];
  return { ...worst, cites };
}

interface CallResult {
  readonly dimensions: Partial<Record<JudgedDimension, DimensionJudgment>>;
  readonly criteria: readonly AiCriterionAnswer[];
  readonly findings: readonly DecisionFinding[];
}

interface CallTally {
  calls: number;
  duration_ms: number;
  tokens_in?: number;
  tokens_out?: number;
}

function tally(t: CallTally, reply: JudgeReply): void {
  t.calls += 1;
  t.duration_ms += reply.duration_ms;
  if (reply.tokens_in !== undefined) t.tokens_in = (t.tokens_in ?? 0) + reply.tokens_in;
  if (reply.tokens_out !== undefined) t.tokens_out = (t.tokens_out ?? 0) + reply.tokens_out;
}

/** One judged call with one retry that shows the judge its own parse problem. */
async function judgeCall(
  input: JudgmentInput,
  t: CallTally,
  mode: MilestonePromptMode,
  prompt: string,
): Promise<Result<CallResult, LoreError>> {
  const asked = askedDimensionsOf(mode);
  const schema = judgmentAnswerSchema(asked);
  const expectedCriteria = mode === "chunk" ? [] : (input.base.facts?.ai_criteria ?? []);
  const expectedDecisions = mode === "chunk" ? [] : input.recorded;
  let current = prompt;
  let lastProblem = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reply = await input.judge(current, input.title);
    if (!reply.ok) return reply;
    tally(t, reply.value);
    const extracted = extractAssessmentJson(reply.value.text);
    if (!extracted.ok) {
      lastProblem = "message" in extracted.error ? extracted.error.message : extracted.error.code;
    } else {
      const parsed = schema.safeParse(extracted.value);
      if (!parsed.success) {
        lastProblem = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      } else {
        const answered = parsed.data.criteria ?? [];
        const missing = expectedCriteria.filter((c) => !answered.some((a) => a.ac === c.ac && (a.spec === undefined || a.spec === c.spec)));
        // reason: llmMilestoneOutputSchema-style stripping drops `decisions`, so it is read from the raw object.
        const decisions = judgedFindingsOf(expectedDecisions, (extracted.value as { decisions?: unknown }).decisions);
        if (missing.length > 0) lastProblem = `\`criteria\` has no verdict for: ${missing.map((c) => `${c.spec}:${c.ac}`).join(", ")}`;
        else if (!decisions.ok) lastProblem = decisions.error;
        else {
          return ok({
            dimensions: parsed.data.dimensions as Partial<Record<JudgedDimension, DimensionJudgment>>,
            criteria: answered,
            findings: decisions.value,
          });
        }
      }
    }
    current = `${prompt}\n\nYour previous answer was rejected: ${lastProblem}\nAnswer again with ONE JSON object in the shape given under Output.`;
  }
  return err(aiError(`the judge did not return a valid review (${mode} call) after one retry: ${lastProblem}`));
}

/** A not-measured verdict; `cites` (what was not measured) give the finding a stable root-cause identity when it is filed. */
function notMeasured(reason: string, cites?: readonly string[]): DimensionJudgment {
  return { verdict: "not-measured", reason, reference: "", ...(cites !== undefined && cites.length > 0 ? { cites: [...cites] } : {}) };
}

/** A gate judged with an unseen file is never a pass: it keeps a fail, otherwise it is not-measured and names the files. */
function withUnseen(judgment: DimensionJudgment, unseen: readonly string[]): DimensionJudgment {
  if (unseen.length === 0 || judgment.verdict === "fail") return judgment;
  return notMeasured(`not seen by any call: ${unseen.join(", ")} (judge said: ${judgment.verdict}, ${judgment.reason})`, unseen);
}

/**
 * Security is a gate judged on the plan's diff; a task with no landing record has no measured diff, so a security pass (or
 * n/a) over the rest is not a pass over the plan: it is not-measured, naming the tasks. A fail stays a fail (spec D3, A6).
 *
 * @param judgment - the judged security verdict
 * @param unlandedTasks - tasks of the plan with no landing record
 */
export function withUnlandedTasks(judgment: DimensionJudgment, unlandedTasks: readonly string[]): DimensionJudgment {
  if (unlandedTasks.length === 0 || judgment.verdict === "fail") return judgment;
  const unlandedCites = unlandedTasks.map((slug) => `unlanded:${slug}`);
  const note = `no measured diff for task(s) without a landing record: ${unlandedTasks.join(", ")}`;
  if (judgment.verdict === "not-measured") return notMeasured(`${judgment.reason}; ${note}`, [...(judgment.cites ?? []), ...unlandedCites]);
  return notMeasured(`${note} (judge said: ${judgment.verdict}, ${judgment.reason})`, unlandedCites);
}

/**
 * Runs the judgment layer for one plan.
 *
 * @param input - shared prompt parts, the diff, the per-call budget and the judge port
 * @returns the four judged dimensions, decision findings and the judgment record (calls, tokens, duration, unseen files,
 *   AI-criteria verdicts); `err` when the judge fails or twice answers unparseably (nothing is partially returned)
 */
export async function runJudgment(input: JudgmentInput): Promise<Result<JudgmentOutcome, LoreError>> {
  const t: CallTally = { calls: 0, duration_ms: 0 };
  const hasDiff = input.diffText !== undefined && input.diffText.length > 0;
  const chunking = hasDiff ? chunkDiffByFile(input.diffText as string, input.maxDiffChars) : undefined;
  // reason: BR-1508 — a landing that could not be mapped to main puts its files in no call; they join the files too large
  // for a call, so the same gates refuse to pass over them.
  const unseen = [...new Set([...(chunking?.unseen ?? []), ...(input.base.facts?.not_seen_files ?? [])])];
  const oneCall = chunking === undefined || (chunking.chunks.length === 1 && chunking.unseen.length === 0);

  const dimensions = {} as Record<JudgedDimension, DimensionJudgment>;
  let criteria: readonly AiCriterionAnswer[] = [];
  let findings: readonly DecisionFinding[] = [];

  if (oneCall) {
    const prompt = buildMilestoneReviewPrompt({ ...input.base, mode: "full", ...(hasDiff ? { diffText: input.diffText as string } : {}), unseenFiles: unseen, recordedDecisions: input.recorded });
    const answered = await judgeCall(input, t, "full", prompt);
    if (!answered.ok) return answered;
    for (const d of askedDimensionsOf("full")) dimensions[d] = answered.value.dimensions[d] as DimensionJudgment;
    criteria = answered.value.criteria;
    findings = answered.value.findings;
  } else {
    const plan = chunking as NonNullable<typeof chunking>;
    const perChunk: Record<"concurrency_safety" | "security", DimensionJudgment[]> = { concurrency_safety: [], security: [] };
    for (const chunk of plan.chunks) {
      const prompt = buildMilestoneReviewPrompt({ ...input.base, mode: "chunk", diffText: chunk.text, unseenFiles: unseen, recordedDecisions: [] });
      const answered = await judgeCall(input, t, "chunk", prompt);
      if (!answered.ok) return answered;
      perChunk.concurrency_safety.push(answered.value.dimensions.concurrency_safety as DimensionJudgment);
      perChunk.security.push(answered.value.dimensions.security as DimensionJudgment);
    }
    const summaries: DiffChunkSummary[] = plan.chunks.map((c, index) => ({ index, files: c.files }));
    const summaryPrompt = buildMilestoneReviewPrompt({
      ...input.base,
      mode: "summary",
      allFiles: plan.allFiles,
      chunkSummaries: summaries,
      unseenFiles: unseen,
      recordedDecisions: input.recorded,
    });
    const answered = await judgeCall(input, t, "summary", summaryPrompt);
    if (!answered.ok) return answered;
    dimensions.spec_conformance = answered.value.dimensions.spec_conformance as DimensionJudgment;
    dimensions.design_necessity = answered.value.dimensions.design_necessity as DimensionJudgment;
    for (const d of ["concurrency_safety", "security"] as const) {
      dimensions[d] = perChunk[d].length > 0 ? combineWorst(perChunk[d]) : notMeasured("no file fit a call, so none was judged");
    }
    criteria = answered.value.criteria;
    findings = answered.value.findings;
  }

  dimensions.security = withUnlandedTasks(withUnseen(dimensions.security, unseen), input.base.facts?.unlanded_tasks ?? []);
  dimensions.concurrency_safety = withUnseen(dimensions.concurrency_safety, unseen);

  const expected = input.base.facts?.ai_criteria ?? [];
  const aiCriteria = expected.map((c) => {
    const given = criteria.find((a) => a.ac === c.ac && (a.spec === undefined || a.spec === c.spec)) as AiCriterionAnswer;
    const unseenNamed = unseen.filter((f) => c.rubric.includes(f));
    if (unseenNamed.length > 0) {
      return { spec: c.spec, ac: c.ac, verdict: "not-measured" as const, reason: `its rubric names a file not seen in any call: ${unseenNamed.join(", ")}` };
    }
    return { spec: c.spec, ac: c.ac, verdict: given.verdict, reason: given.reason };
  });

  return ok({
    dimensions,
    findings,
    record: {
      calls: t.calls,
      ...(t.tokens_in !== undefined ? { tokens_in: t.tokens_in } : {}),
      ...(t.tokens_out !== undefined ? { tokens_out: t.tokens_out } : {}),
      duration_ms: t.duration_ms,
      files_total: chunking?.allFiles.length ?? 0,
      unseen_files: [...unseen],
      ai_criteria: aiCriteria,
    },
  });
}

/**
 * Computes the three facts dimensions from measured facts alone: correctness_vs_acs from criteria attestation and
 * AI-criteria verdicts, regression from per-landing results. An absent measurement is `not-measured`, never `pass`.
 * (snapshot_accuracy is computed by `applySnapshotRule` from cited-rule state; this returns it as a neutral pass for
 * that rule to refine.)
 *
 * @param facts - the measured facts (may be absent or partial)
 * @param aiCriteria - the AI-mode criteria verdicts of this review
 * @returns the three facts dimensions
 */
export function factsDimensions(
  facts: MilestoneFacts | undefined,
  aiCriteria: JudgmentRecord["ai_criteria"],
): Pick<LlmMilestoneOutput["dimensions"], "correctness_vs_acs" | "regression" | "snapshot_accuracy"> {
  const rows = [
    ...(facts?.attestation ?? []).map((r) => ({ subject: r.subject, verdict: r.verdict, detail: r.detail })),
    ...aiCriteria.map((c) => ({ subject: `${c.spec}:${c.ac}`, verdict: c.verdict, detail: c.reason })),
  ];
  const fold = (items: readonly { subject: string; verdict: string; detail: string }[], absent: string, label: string): DimensionJudgment => {
    if (items.length === 0) return notMeasured(absent, [`${label}:not-supplied`]);
    // reason: `na` rows say nothing of this kind is in scope (e.g. "no criterion in scope"); a fold of only `na` is `na`, never pass.
    if (items.every((r) => r.verdict === "na")) {
      return { verdict: "na", reason: items.map((r) => r.detail).join("; "), reference: "" };
    }
    const failed = items.filter((r) => r.verdict === "fail");
    if (failed.length > 0) {
      return { verdict: "fail", reason: `${label} failing: ${failed.map((r) => `${r.subject} (${r.detail})`).join("; ")}`, reference: "attested evidence", cites: failed.map((r) => r.subject) };
    }
    const unmeasured = items.filter((r) => r.verdict === "not-measured");
    if (unmeasured.length > 0) {
      return notMeasured(`${label} not measured: ${unmeasured.map((r) => `${r.subject} (${r.detail})`).join("; ")}`, unmeasured.map((r) => r.subject));
    }
    return { verdict: "pass", reason: `${label}: all ${String(items.length)} pass`, reference: "attested evidence" };
  };
  return {
    correctness_vs_acs: fold(rows, "criteria attestation was not supplied to this review", "criteria"),
    regression: fold(facts?.regression ?? [], "regression per landing was not supplied to this review", "landings"),
    snapshot_accuracy: { verdict: "pass", reason: "computed from cited-rule state alone", reference: "" },
  };
}

/**
 * Merges the judged and the facts dimensions into the seven of a review.
 *
 * @param judged - the four judged dimensions
 * @param facts - the three facts dimensions
 * @returns all seven dimensions
 */
export function mergeDimensions(
  judged: Record<JudgedDimension, DimensionJudgment>,
  facts: ReturnType<typeof factsDimensions>,
): LlmMilestoneOutput["dimensions"] {
  return { ...facts, ...judged };
}
