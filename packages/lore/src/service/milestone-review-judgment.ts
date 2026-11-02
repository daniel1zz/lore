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
  type AiCriterionInput,
  type JudgeUnitRecord,
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
import { splitDiffByFile } from "../ai/diff-truncation.js";
import {
  askedDimensionsOf,
  buildMilestoneReviewPrompt,
  type DiffChunkSummary,
  type JudgedDecisionInput,
  type MilestonePromptMode,
  type MilestoneReviewPromptInput,
  type PromptUnits,
} from "../ai/milestone-review-template.js";
import { noCodeSecurityJudgment } from "./corpus-only-task.js";
import { judgedFindingsOf } from "./decision-recheck.js";
import {
  criterionAnswerSchema,
  fileAnswerSchema,
  rawCriterionAnswer,
  rawFileAnswer,
  type CriterionAnswer,
  type FileAnswer,
  type SettledUnit,
  type UnitDescriptor,
  type UnitLedger,
} from "./judge-unit-ledger.js";
import { canonicalEvidenceRowsOf, criterionUnitInput, fileUnitInput, type JudgeIdentity } from "./judge-unit-keys.js";

/** One judge reply with what the call cost. */
export interface JudgeReply {
  readonly text: string;
  readonly duration_ms: number;
  readonly tokens_in?: number;
  readonly tokens_out?: number;
  /** The model that answered, when the provider can name it (spec S5); absent for a provider that cannot. */
  readonly model?: string;
}

/** What per-unit reuse needs: the ledger over the verdict store, the judge's identity, the unit-instruction text and the repository facts. */
export interface JudgmentReuse {
  readonly ledger: UnitLedger;
  readonly identity: JudgeIdentity | undefined;
  /** The unfilled unit instructions: sent in every call AND (with the dimension guide) hashed into every key. */
  readonly unitInstructions: string;
  /** The dimension guide sent in every call and hashed into every key; default the shipped one. */
  readonly dimensionGuide?: Readonly<Record<JudgedDimension, string>>;
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
  /** Per-unit reuse (BR-1535). */
  readonly reuse: JudgmentReuse;
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
  /** The per-file answers, by path (only the files the call asked). */
  readonly files: ReadonlyMap<string, FileAnswer>;
  /** The model the last reply named, when it did. */
  readonly model: string | undefined;
}

/** The units a call must answer (those not reused). */
interface AskedUnits {
  readonly files: readonly string[];
  readonly criteria: readonly AiCriterionInput[];
}

/** One unit of this review: its descriptor, its recorded answer once settled or reused, and the answer parsed. */
interface UnitState {
  readonly desc: UnitDescriptor;
  settled?: SettledUnit;
  /** The stored raw answer a reused unit is shown to the judge with. */
  reusedAnswer?: string;
  file?: FileAnswer;
  criterion?: CriterionAnswer;
}

/** Parses a unit's recorded raw answer into `file` / `criterion` (it was checked to parse before it was recorded). */
function parseStored(state: UnitState): void {
  const raw: unknown = JSON.parse((state.settled as SettledUnit).raw_answer);
  if (state.desc.kind === "file") state.file = fileAnswerSchema.parse(raw);
  else state.criterion = criterionAnswerSchema.parse(raw);
}

/** The file units' verdicts of one gate dimension, as dimension judgments (a unit's cites are its own). */
function unitJudgments(states: ReadonlyMap<string, UnitState>, dimension: "security" | "concurrency_safety"): DimensionJudgment[] {
  return [...states.values()].map((s) => {
    const j = (s.file as FileAnswer)[dimension];
    return { verdict: j.verdict, reason: j.reason, reference: j.reference, ...(j.cites !== undefined && j.cites.length > 0 ? { cites: [...j.cites] } : {}) };
  });
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
  units: AskedUnits,
): Promise<Result<CallResult, LoreError>> {
  const asked = askedDimensionsOf(mode);
  const schema = judgmentAnswerSchema(asked);
  // reason: BR-1535 — a call answers only the units it was not given as already judged.
  const expectedCriteria = mode === "chunk" ? [] : units.criteria;
  const expectedDecisions = mode === "chunk" ? [] : input.recorded;
  let current = prompt;
  let lastProblem = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reply = await input.judge(current, input.title);
    if (!reply.ok) return reply;
    tally(t, reply.value);
    const model = reply.value.model;
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
        const files = new Map<string, FileAnswer>();
        for (const entry of parsed.data.files ?? []) {
          if (entry.security !== undefined && entry.concurrency_safety !== undefined && !files.has(entry.path)) {
            files.set(entry.path, { security: entry.security, concurrency_safety: entry.concurrency_safety });
          }
        }
        const missingFiles = units.files.filter((path) => !files.has(path));
        if (missing.length > 0) lastProblem = `\`criteria\` has no verdict for: ${missing.map((c) => `${c.spec}:${c.ac}`).join(", ")}`;
        else if (missingFiles.length > 0) lastProblem = `\`files\` has no security and concurrency_safety verdict for: ${missingFiles.join(", ")}`;
        else if (!decisions.ok) lastProblem = decisions.error;
        else {
          return ok({
            dimensions: parsed.data.dimensions as Partial<Record<JudgedDimension, DimensionJudgment>>,
            criteria: answered,
            findings: decisions.value,
            files,
            model,
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
  let findings: readonly DecisionFinding[] = [];

  // ── per-unit state (BR-1535): one unit per shown changed file and per AI criterion, looked up before any call ──
  const { ledger, unitInstructions } = input.reuse;
  const diffByFile = new Map<string, string>(hasDiff ? splitDiffByFile(input.diffText as string).map((f) => [f.filePath, f.text]) : []);
  const shownFiles = oneCall ? (chunking?.allFiles ?? []) : (chunking?.chunks ?? []).flatMap((c) => c.files.map((f) => f.path));
  const expectedCriteria = input.base.facts?.ai_criteria ?? [];
  const fileStates = new Map<string, UnitState>();
  const criterionStates = new Map<string, UnitState>();
  const register = async (states: Map<string, UnitState>, desc: UnitDescriptor): Promise<Result<void, LoreError>> => {
    const found = await ledger.lookup(desc);
    if (!found.ok) return found;
    const state: UnitState = { desc };
    if (found.value.state === "reused") {
      state.settled = ledger.reused(found.value.row);
      state.reusedAnswer = found.value.row.raw_answer;
      parseStored(state);
    }
    states.set(desc.id, state);
    return ok(undefined);
  };
  for (const path of shownFiles) {
    const registered = await register(fileStates, { kind: "file", id: path, canonical: fileUnitInput(diffByFile.get(path) ?? "") });
    if (!registered.ok) return registered;
  }
  // reason: BR-1535 S2 — an AI criterion's verdict may depend on any changed file, so its input is its text and the WHOLE plan diff.
  const planDiff = hasDiff ? (input.diffText as string) : "";
  for (const c of expectedCriteria) {
    const registered = await register(criterionStates, { kind: "criterion", id: `${c.spec}:${c.ac}`, canonical: criterionUnitInput(c, planDiff, canonicalEvidenceRowsOf(input.base.tasks, c)) });
    if (!registered.ok) return registered;
  }
  const askedFilesOf = (paths: readonly string[]): string[] => paths.filter((p) => fileStates.get(p)?.reusedAnswer === undefined);
  const askedCriteria = expectedCriteria.filter((c) => criterionStates.get(`${c.spec}:${c.ac}`)?.reusedAnswer === undefined);
  const promptUnits = (paths: readonly string[], withCriteria: boolean): PromptUnits => ({
    files: paths.map((p) => ({ id: p, ...(fileStates.get(p)?.reusedAnswer !== undefined ? { reusedAnswer: fileStates.get(p)?.reusedAnswer as string } : {}) })),
    criteria: withCriteria
      ? expectedCriteria.map((c) => {
          const id = `${c.spec}:${c.ac}`;
          const reused = criterionStates.get(id)?.reusedAnswer;
          return { id, ...(reused !== undefined ? { reusedAnswer: reused } : {}) };
        })
      : [],
  });
  /** Records a call's fresh unit answers in the store (first writer wins) and keeps the recorded answer as the unit's verdict. */
  const settleCall = async (answered: CallResult, askedPaths: readonly string[], criteriaAsked: readonly AiCriterionInput[]): Promise<Result<void, LoreError>> => {
    // reason: BR-1535 S5 — a verdict is stored under the model the REPLY named, never the configured one.
    for (const path of askedPaths) {
      const state = fileStates.get(path) as UnitState;
      const settled = await ledger.settle(state.desc, rawFileAnswer(answered.files.get(path) as FileAnswer), answered.model);
      if (!settled.ok) return settled;
      state.settled = settled.value;
      parseStored(state);
    }
    for (const c of criteriaAsked) {
      const state = criterionStates.get(`${c.spec}:${c.ac}`) as UnitState;
      const given = answered.criteria.find((a) => a.ac === c.ac && (a.spec === undefined || a.spec === c.spec)) as AiCriterionAnswer;
      const settled = await ledger.settle(state.desc, rawCriterionAnswer({ verdict: given.verdict, reason: given.reason }), answered.model);
      if (!settled.ok) return settled;
      state.settled = settled.value;
      parseStored(state);
    }
    return ok(undefined);
  };
  const unitOpts = { unitInstructions, ...(input.reuse.dimensionGuide !== undefined ? { dimensionGuide: input.reuse.dimensionGuide } : {}) };

  if (oneCall) {
    const askedPaths = askedFilesOf(shownFiles);
    const prompt = buildMilestoneReviewPrompt({
      ...input.base,
      ...unitOpts,
      mode: "full",
      ...(hasDiff ? { diffText: input.diffText as string } : {}),
      unseenFiles: unseen,
      recordedDecisions: input.recorded,
      units: promptUnits(shownFiles, true),
    });
    const answered = await judgeCall(input, t, "full", prompt, { files: askedPaths, criteria: askedCriteria });
    if (!answered.ok) return answered;
    const settledCall = await settleCall(answered.value, askedPaths, askedCriteria);
    if (!settledCall.ok) return settledCall;
    for (const d of askedDimensionsOf("full")) dimensions[d] = answered.value.dimensions[d] as DimensionJudgment;
    for (const d of ["concurrency_safety", "security"] as const) dimensions[d] = combineWorst([dimensions[d], ...unitJudgments(fileStates, d)]);
    findings = answered.value.findings;
  } else {
    const plan = chunking as NonNullable<typeof chunking>;
    const perChunk: Record<"concurrency_safety" | "security", DimensionJudgment[]> = { concurrency_safety: [], security: [] };
    for (const chunk of plan.chunks) {
      const paths = chunk.files.map((f) => f.path);
      const askedPaths = askedFilesOf(paths);
      const prompt = buildMilestoneReviewPrompt({
        ...input.base,
        ...unitOpts,
        mode: "chunk",
        diffText: chunk.text,
        unseenFiles: unseen,
        recordedDecisions: [],
        units: promptUnits(paths, false),
      });
      const answered = await judgeCall(input, t, "chunk", prompt, { files: askedPaths, criteria: [] });
      if (!answered.ok) return answered;
      const settledCall = await settleCall(answered.value, askedPaths, []);
      if (!settledCall.ok) return settledCall;
      perChunk.concurrency_safety.push(answered.value.dimensions.concurrency_safety as DimensionJudgment);
      perChunk.security.push(answered.value.dimensions.security as DimensionJudgment);
    }
    const summaries: DiffChunkSummary[] = plan.chunks.map((c, index) => ({ index, files: c.files }));
    const summaryPrompt = buildMilestoneReviewPrompt({
      ...input.base,
      ...unitOpts,
      mode: "summary",
      allFiles: plan.allFiles,
      chunkSummaries: summaries,
      unseenFiles: unseen,
      recordedDecisions: input.recorded,
      units: promptUnits([], true),
    });
    const answered = await judgeCall(input, t, "summary", summaryPrompt, { files: [], criteria: askedCriteria });
    if (!answered.ok) return answered;
    const settledCall = await settleCall(answered.value, [], askedCriteria);
    if (!settledCall.ok) return settledCall;
    dimensions.spec_conformance = answered.value.dimensions.spec_conformance as DimensionJudgment;
    dimensions.design_necessity = answered.value.dimensions.design_necessity as DimensionJudgment;
    for (const d of ["concurrency_safety", "security"] as const) {
      const all = [...perChunk[d], ...unitJudgments(fileStates, d)];
      dimensions[d] = all.length > 0 ? combineWorst(all) : notMeasured("no file fit a call, so none was judged");
    }
    findings = answered.value.findings;
  }

  dimensions.security = withUnlandedTasks(withUnseen(dimensions.security, unseen), input.base.facts?.unlanded_tasks ?? []);
  // reason: BR-1509 — a plan whose every task is corpus-only has no code to review: security is `na`, never the judge's pass.
  if (input.base.facts?.no_task_changes_code === true) dimensions.security = noCodeSecurityJudgment(input.base.facts.no_code_tasks ?? []);
  dimensions.concurrency_safety = withUnseen(dimensions.concurrency_safety, unseen);

  const aiCriteria = expectedCriteria.map((c) => {
    const given = (criterionStates.get(`${c.spec}:${c.ac}`) as UnitState).criterion as CriterionAnswer;
    const unseenNamed = unseen.filter((f) => c.rubric.includes(f));
    if (unseenNamed.length > 0) {
      return { spec: c.spec, ac: c.ac, verdict: "not-measured" as const, reason: `its rubric names a file not seen in any call: ${unseenNamed.join(", ")}` };
    }
    return { spec: c.spec, ac: c.ac, verdict: given.verdict, reason: given.reason };
  });

  const units: JudgeUnitRecord[] = [...fileStates.values(), ...criterionStates.values()].map((state) => {
    const settled = state.settled as SettledUnit;
    return {
      kind: state.desc.kind,
      id: state.desc.id,
      source: settled.source,
      key: settled.key,
      first_review: settled.first_review,
      answer_sha256: settled.answer_sha256,
      verdicts:
        state.file !== undefined
          ? { security: state.file.security.verdict, concurrency_safety: state.file.concurrency_safety.verdict }
          : { verdict: (state.criterion as CriterionAnswer).verdict },
    };
  });
  const identity = input.reuse.identity;

  return ok({
    dimensions,
    findings,
    record: {
      review_token: ledger.reviewToken,
      ...(identity !== undefined
        ? {
            judge: {
              provider: identity.provider,
              ...(identity.model !== undefined ? { model: identity.model } : {}),
              ...(ledger.answeringModel !== undefined ? { answering_model: ledger.answeringModel } : {}),
              settings: { ...identity.settings },
            },
          }
        : {}),
      reuse: ledger.enabled ? { enabled: true as const, ...(ledger.note !== undefined ? { note: ledger.note } : {}) } : { enabled: false as const, cause: ledger.disabledCause as string },
      units,
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
  // reason: a regression selection row carries the selector's multi-line accounting after its first line (stored on the review's
  // facts); the dimension's reason names only that first line, which states "N selected test files of M" (spec "Accounting").
  const firstLine = (detail: string): string => detail.split("\n", 1)[0] ?? detail;
  const fold = (items: readonly { subject: string; verdict: string; detail: string }[], absent: string, label: string): DimensionJudgment => {
    if (items.length === 0) return notMeasured(absent, [`${label}:not-supplied`]);
    // reason: `na` rows say nothing of this kind is in scope (e.g. "no criterion in scope"); a fold of only `na` is `na`, never pass.
    if (items.every((r) => r.verdict === "na")) {
      return { verdict: "na", reason: items.map((r) => firstLine(r.detail)).join("; "), reference: "" };
    }
    const failed = items.filter((r) => r.verdict === "fail");
    if (failed.length > 0) {
      return { verdict: "fail", reason: `${label} failing: ${failed.map((r) => `${r.subject} (${firstLine(r.detail)})`).join("; ")}`, reference: "attested evidence", cites: failed.map((r) => r.subject) };
    }
    const unmeasured = items.filter((r) => r.verdict === "not-measured");
    if (unmeasured.length > 0) {
      return notMeasured(`${label} not measured: ${unmeasured.map((r) => `${r.subject} (${firstLine(r.detail)})`).join("; ")}`, unmeasured.map((r) => r.subject));
    }
    return { verdict: "pass", reason: `${label}: all ${String(items.length)} pass`, reference: "attested evidence" };
  };
  const regressionRows = facts?.regression ?? [];
  const regressionFold = fold(regressionRows, "regression per landing was not supplied to this review", "landings");
  const selectionRow = regressionRows.find((r) => r.subject.startsWith("selection@"));
  const regression: DimensionJudgment =
    selectionRow !== undefined && regressionFold.verdict !== "na" && regressionFold.verdict !== "not-measured"
      ? { ...regressionFold, reason: `${regressionFold.reason}; ${firstLine(selectionRow.detail)}` }
      : regressionFold;
  return {
    correctness_vs_acs: fold(rows, "criteria attestation was not supplied to this review", "criteria"),
    regression,
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
