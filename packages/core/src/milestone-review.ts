/**
 * Milestone review: the shapes of the one binding review `lore assess` stores per plan (BR-1372).
 *
 * Purpose: the single home of the seven review dimensions, the judge's output shape, the stored review shape and the
 *   deterministic verdict rules. Plan close reads the stored review; nothing else decides it.
 * Public surface: GATE_DIMENSIONS, isGateDimension, blockingGates, filableDimensions, MILESTONE_DIMENSIONS, MEASURED_CAUSE_DIMENSIONS, MilestoneDimension, DimensionVerdict, dimensionJudgmentSchema,
 *   llmMilestoneOutputSchema, LlmMilestoneOutput, milestoneReviewSchema, MilestoneReview, applyDeterministicDimensionRules,
 *   overallMilestoneVerdict, failedDimensions, renderMilestoneReviewContent, retiredAcRefSchema, RetiredAcRef.
 * Invariants:
 *   - Exactly seven dimensions; the judge must return all seven (a missing one is a parse failure, never "pass").
 *   - Overall verdict is `pass` iff no dimension is `fail` (`na` never fails a review).
 *   - `design_necessity` passes only with a non-empty reference: a technical choice that names no external practice
 *     it follows is a fail, whatever the judge said (ADR adr-ai-decision-standard-four-checks-references-from-excellent).
 * Side-effect class: pure (no IO, no clock).
 *
 * Source: spec-lean-governance-batch-verbs-judgment-only-at-milestones Part D, AC-LG-12, BR-1372.
 */

import { z } from "zod";

/** The seven dimensions, in render order. */
export const MILESTONE_DIMENSIONS = [
  "correctness_vs_acs",
  "spec_conformance",
  "regression",
  "design_necessity",
  "snapshot_accuracy",
  "concurrency_safety",
  "security",
] as const;

export type MilestoneDimension = (typeof MILESTONE_DIMENSIONS)[number];

/** Dimensions whose root cause is measured (the files charged to the plan, contradicted rules), never taken from the judge's cites. */
export const MEASURED_CAUSE_DIMENSIONS: readonly MilestoneDimension[] = ["regression", "snapshot_accuracy"];

/**
 * One dimension's verdict. `not-measured` means the fact could not be established (a file never shown to the judge, a
 * criterion with no bound attestation): it is carried through as its own value and is never collapsed into `pass`.
 * `overallMilestoneVerdict` still fails only on `fail`; what a not-measured gate does to plan close is decided by the
 * gate rules, not here.
 */
export const dimensionVerdictSchema = z.enum(["pass", "fail", "na", "not-measured"]);
export type DimensionVerdict = z.infer<typeof dimensionVerdictSchema>;

/** The four dimensions only the AI judges (no tool measures them); the other three are facts the tools measure. */
export const JUDGED_DIMENSIONS = ["spec_conformance", "design_necessity", "concurrency_safety", "security"] as const;
export type JudgedDimension = (typeof JUDGED_DIMENSIONS)[number];

/** The dimensions computed from measured facts; an AI verdict on one of them is ignored. */
export const FACT_DIMENSIONS = ["correctness_vs_acs", "regression", "snapshot_accuracy"] as const;

/** A verdict the AI judge may give: it can never answer `not-measured` (only the review can know that). */
export const judgeVerdictSchema = z.enum(["pass", "fail", "na"]);

/** A dimension judgment: verdict, the reason for it, and the reference (an external practice, a doc, a commit). */
export const dimensionJudgmentSchema = z.object({
  verdict: dimensionVerdictSchema,
  reason: z.string().trim().min(1),
  /** May be empty only where no reference applies; `design_necessity` needs one to pass. */
  reference: z.string().trim(),
  /**
   * Stable cites of a failed finding: AC ids, rule ids, file paths or symbols it names. They are the root-cause identity
   * of a judge-text finding (never its wording). Optional in the stored shape only because reviews stored before this
   * field exist; `llmMilestoneOutputSchema` requires them on a failed non-measured dimension.
   */
  cites: z.array(z.string().trim().min(1)).optional(),
});
export type DimensionJudgment = z.infer<typeof dimensionJudgmentSchema>;

const dimensionsShape = Object.fromEntries(MILESTONE_DIMENSIONS.map((d) => [d, dimensionJudgmentSchema])) as Record<
  MilestoneDimension,
  typeof dimensionJudgmentSchema
>;

/** The shape the judge returns. */
export const llmMilestoneOutputSchema = z
  .object({
    dimensions: z.object(dimensionsShape),
  })
  .superRefine((output, ctx) => {
    // reason: a failed judge-text finding's fingerprint is its cites; without them the plan's review errors and retries
    // instead of falling back to wording (#405; Sentry groups by stack frames, not message text).
    for (const d of MILESTONE_DIMENSIONS) {
      if (MEASURED_CAUSE_DIMENSIONS.includes(d) || output.dimensions[d].verdict !== "fail") continue;
      if ((output.dimensions[d].cites ?? []).length === 0) {
        ctx.addIssue({ code: "custom", path: ["dimensions", d, "cites"], message: "a failed finding must cite at least one AC id, rule id, file path or symbol" });
      }
    }
  });
export type LlmMilestoneOutput = z.infer<typeof llmMilestoneOutputSchema>;

/** One judged dimension as the AI returns it. */
export const judgedDimensionAnswerSchema = z.object({
  verdict: judgeVerdictSchema,
  reason: z.string().trim().min(1),
  reference: z.string().trim(),
  cites: z.array(z.string().trim().min(1)).optional(),
});

/**
 * One changed file's answer (BR-1535): the file's own security and concurrency_safety verdicts, judged on that file's net diff
 * alone. Both keys are optional in the shape; the judgment layer requires every dimension a call asked for every file it asked.
 */
export const fileUnitAnswerSchema = z.object({
  path: z.string().min(1),
  security: judgedDimensionAnswerSchema.optional(),
  concurrency_safety: judgedDimensionAnswerSchema.optional(),
});
export type FileUnitAnswer = z.infer<typeof fileUnitAnswerSchema>;

/** One AI-mode criterion's verdict from the judge. */
export const aiCriterionAnswerSchema = z.object({
  spec: z.string().min(1).optional(),
  ac: z.string().min(1),
  verdict: z.enum(["pass", "fail"]),
  reason: z.string().trim().min(1),
});
export type AiCriterionAnswer = z.infer<typeof aiCriterionAnswerSchema>;

/**
 * The judge's answer to one call over a subset of the judged dimensions (all four for a one-call review, security and
 * concurrency_safety for a file chunk, the other two for the summary call). Keys outside `dimensions` are stripped, so
 * an AI verdict on a facts dimension never reaches the review. A failed finding must cite what it is about.
 *
 * @param dimensions - the judged dimensions this call asked
 * @returns the zod schema of the answer
 */
export function judgmentAnswerSchema(dimensions: readonly JudgedDimension[]) {
  const shape = Object.fromEntries(dimensions.map((d) => [d, judgedDimensionAnswerSchema])) as Record<string, typeof judgedDimensionAnswerSchema>;
  return z
    .object({ dimensions: z.object(shape), criteria: z.array(aiCriterionAnswerSchema).optional(), files: z.array(fileUnitAnswerSchema).optional() })
    .superRefine((output, ctx) => {
      (output.files ?? []).forEach((file, index) => {
        for (const d of ["security", "concurrency_safety"] as const) {
          const j = file[d];
          if (j !== undefined && j.verdict === "fail" && (j.cites ?? []).length === 0) {
            ctx.addIssue({ code: "custom", path: ["files", index, d, "cites"], message: "a failed finding must cite at least one AC id, rule id, file path or symbol" });
          }
        }
      });
      for (const d of dimensions) {
        const j = output.dimensions[d];
        if (j !== undefined && j.verdict === "fail" && (j.cites ?? []).length === 0) {
          ctx.addIssue({ code: "custom", path: ["dimensions", d, "cites"], message: "a failed finding must cite at least one AC id, rule id, file path or symbol" });
        }
      }
    });
}

/**
 * Why a regression fact row is `not-measured` (written by `regression-at-head.ts`, stored on the review as `regression_causes`).
 *   - `unrunnable`: a run or read that could not complete (the head suite, a single-file run, the history or stored results); a
 *     retry can complete it.
 *   - `unlanded`: a task of the plan has no landing record, so its changes have no measured diff; only the plan's own landing changes that.
 *   - `unmappable`: a landing (or the history) cannot be placed on main, so a transition cannot be attributed; a retry reads the same git.
 *   - `flaky-bisection`: the confirmation runs disagree with the bisection; single-file runs are stored per commit and reused, so a retry
 *     at the same head reads the same stored runs and reaches the same disagreement.
 *   - `timeout`: the file's runs at a point ended only in test or hook timeouts (inconclusive, BR-1533): no conclusive run decides
 *     there, the file is never charged, and the next review runs the point again.
 *   - `no-report`: the file's run wrote no readable outcome report, so nothing reliable says how it went (the console text is never read as a
 *     result); like `timeout` it is never charged and the next review runs the point again.
 */
export const NOT_MEASURED_CAUSES = ["unrunnable", "unlanded", "unmappable", "flaky-bisection", "timeout", "no-report"] as const;
export type RegressionNotMeasuredCause = (typeof NOT_MEASURED_CAUSES)[number];

/**
 * Whether the next batch re-reviewing a plan kept open by a not-measured regression can change the outcome (spec "Fingerprint":
 * only "a plan whose gate is not measured because the suite could not complete" is retried).
 *
 * @param causes - the stored `regression_causes` of the review (absent: none recorded)
 * @returns `true` iff some cause is `unrunnable`, `timeout` or `no-report` (a retry runs the point again, BR-1533); every other cause
 *   waits for the plan's own landing, a landing touching its failing facts, or a manual `lore assess`
 */
export function regressionRetryCanChange(causes: readonly RegressionNotMeasuredCause[] | undefined): boolean {
  return causes?.some((cause) => cause === "unrunnable" || cause === "timeout" || cause === "no-report") === true;
}

/** One row of the facts table: a criterion's attestation, or one landing's regression. */
export interface MilestoneFactRow {
  /** Criterion `<spec>:<ac>` or landing commit, whichever the row is about. */
  readonly subject: string;
  /** `na` = nothing of this kind is in scope (no criterion in the plan's task scopes): it neither blocks nor reads as pass. */
  readonly verdict: "pass" | "fail" | "not-measured" | "na";
  /** What decided it (attestation id, failing files, why not measured). */
  readonly detail: string;
  /** Why a `not-measured` regression row is not measured (absent on other rows). */
  readonly cause?: RegressionNotMeasuredCause;
}

/** An AI-mode criterion the judge rules on, with its rubric. */
export interface AiCriterionInput {
  readonly spec: string;
  readonly ac: string;
  readonly rubric: string;
  /** The criterion's statement; part of its verdict key (BR-1535). Absent = the rubric alone is its text. */
  readonly statement?: string;
}

/**
 * Which worktree ran the plan's script criteria: the review's suite worktree (`suite`), or a throwaway worktree at the assessed
 * commit made for the criteria alone (`own`) with the reason the suite worktree was not used (a stored head result means no
 * suite worktree exists; or the suite worktree's work failed).
 */
export const criteriaRunRecordSchema = z.object({ worktree: z.enum(["suite", "own"]), reason: z.string().min(1).optional() });
export type CriteriaRunRecord = z.infer<typeof criteriaRunRecordSchema>;

/**
 * The measured facts the judgment prompt carries as a table and the review reads to compute the facts dimensions.
 * Each part is optional: a part nobody measured is absent, which the review reports as not measured, never as pass.
 */
export interface MilestoneFacts {
  /** Script criteria attestation (`correctness_vs_acs` input). */
  readonly attestation?: readonly MilestoneFactRow[];
  /** The attestation made at the assessed commit that decided each criterion (`subject` = `<spec>:<ac>`); the review fingerprint hashes these (BR-1498). */
  readonly criteria_attestation_ids?: readonly { readonly subject: string; readonly id: string }[];
  /** Regression at the assessed commit: one row for the head suite, one per red file (BR-1496). */
  readonly regression?: readonly MilestoneFactRow[];
  /** Files charged to the plan as regressions (the regression finding's root cause), from `regression-at-head`. */
  readonly regression_files?: readonly string[];
  /** Distinct causes of the not-measured regression rows; the batch re-reviews a kept-open plan only when a cause is `unrunnable` (spec "Fingerprint"). */
  readonly regression_causes?: readonly RegressionNotMeasuredCause[];
  /** Main's head when the review measured (the assessed commit); stored on the review so the batch can tell which landings came after it. */
  readonly assessed_commit?: string;
  /** Files named by the failing facts (red test files; a file a failing criterion's command names); a later landing changing one re-opens the review. */
  readonly failing_fact_files?: readonly string[];
  /** Files each landing touched outside its task's anchors. */
  readonly outside_anchors?: readonly { readonly landing: string; readonly files: readonly string[] }[];
  /** Tasks of the plan with no landing yet. */
  readonly unlanded_tasks?: readonly string[];
  /** Corpus-only tasks (BR-1509): no file anchors, never claimed on a branch, no landing record. Listed as having no code; never unlanded. */
  readonly no_code_tasks?: readonly string[];
  /** `true` when every task of the plan is corpus-only: regression and security are `na`, never pass (BR-1509). */
  readonly no_task_changes_code?: boolean;
  /** Files of landings that could not be mapped to main (BR-1508): no call shows them, so security and concurrency_safety are not-measured over them. */
  readonly not_seen_files?: readonly string[];
  /** AI-mode criteria of the plan's task scopes. */
  readonly ai_criteria?: readonly AiCriterionInput[];
  /** The stored suite result id of M, the suite the regression read: the newest stored measured suite containing every landing, else the one run at head (BR-1496, BR-1497); the review fingerprint hashes it. Absent when no suite was read. */
  readonly head_suite_result_id?: string;
  /** Every stored run the regression verdict read or made, keyed `<file>@<commit>:<kind>` (kinds `bisect`, `confirm`, and `batch` for the head recheck only; none of the recheck's when M is head); the review fingerprint hashes them (BR-1496). */
  readonly single_file_run_ids?: readonly { readonly key: string; readonly id: string }[];
  /** Where the criteria ran and why that worktree; stored on the review so a fallback from the suite's worktree is never silent (BR-1498). */
  readonly criteria_run?: CriteriaRunRecord;
}

/**
 * One judged unit of a review (BR-1535, spec S6): a changed file (`security` and `concurrency_safety` verdicts) or an AI criterion
 * (`verdict`), whether this review asked the judge (`fresh`) or took the stored answer (`reused`), the review the answer was first
 * produced in, and the sha256 of the stored raw answer, so two reviews that recorded one stored answer carry the same digest.
 */
export const judgeUnitRecordSchema = z.object({
  kind: z.enum(["file", "criterion"]),
  /** The file's repo-relative path, or `<spec slug>:<ac id>`. */
  id: z.string().min(1),
  source: z.enum(["fresh", "reused"]),
  key: z.string().min(1),
  /** The review token (`judgment.review_token`) of the review that first produced the answer. */
  first_review: z.string().min(1),
  answer_sha256: z.string().min(1),
  /** sha256 of the unit's canonical input (a file's net diff; a criterion's statement, rubric, plan diff and evidence rows): the model-independent part of `key` (BR-1552); absent on a review stored before it. */
  input_sha256: z.string().min(1).optional(),
  verdicts: z.record(z.string(), z.enum(["pass", "fail", "na"])),
});
export type JudgeUnitRecord = z.infer<typeof judgeUnitRecordSchema>;

/**
 * Whether the review could reuse stored unit verdicts; a disabled review names the cause (spec S5). An enabled review may carry a
 * `note`: why nothing could be reused although it was on (a configured alias is not the answering model; `--rejudge`).
 */
export const judgeReuseRecordSchema = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(true), note: z.string().min(1).optional() }),
  /** A disabled review also notes that its judged causes may vary (spec S7): nothing stored anchors them. */
  z.object({ enabled: z.literal(false), cause: z.string().min(1), note: z.string().min(1).optional() }),
]);
export type JudgeReuseRecord = z.infer<typeof judgeReuseRecordSchema>;

/** What the judgment layer did, stored on the review: calls, tokens, time, and the files no call showed. */
export const judgmentRecordSchema = z.object({
  /** Names this review in the units of later reviews (`first_review`); stored with the review so its document can be found from a unit. */
  review_token: z.string().min(1).optional(),
  /** The judge that answered: provider, the answering model when the provider can name it, the model-behaviour settings. */
  judge: z
    .object({
      provider: z.string().min(1),
      /** The configured `ai.assess.model` (what lookups key by). */
      model: z.string().min(1).optional(),
      /** The model the provider's reply named for the answering call(s); stored verdicts are keyed by it. */
      answering_model: z.string().min(1).optional(),
      settings: z.record(z.string(), z.union([z.string(), z.number()])),
    })
    .optional(),
  /** Whether stored unit verdicts were used; absent on a review stored before per-unit verdicts. */
  reuse: judgeReuseRecordSchema.optional(),
  /** Every unit judged by this review, fresh or reused; absent on a review stored before per-unit verdicts. */
  units: z.array(judgeUnitRecordSchema).optional(),
  calls: z.number().int().min(0),
  /** Summed over the calls that reported usage; absent when no call reported any (never 0 for "unknown"). */
  tokens_in: z.number().int().min(0).optional(),
  tokens_out: z.number().int().min(0).optional(),
  duration_ms: z.number().int().min(0),
  files_total: z.number().int().min(0),
  /** Files shown in no call; any gate judged with one of these is `not-measured`. */
  unseen_files: z.array(z.string().min(1)),
  ai_criteria: z.array(
    z.object({ spec: z.string().min(1), ac: z.string().min(1), verdict: z.enum(["pass", "fail", "not-measured"]), reason: z.string().min(1) }),
  ),
});
export type JudgmentRecord = z.infer<typeof judgmentRecordSchema>;

/** A `milestone` decision (BR-1370) the review lists under correctness. */
export const milestoneDecisionRefSchema = z.object({
  class: z.string().min(1),
  document: z.string().min(1),
  summary: z.string(),
});
export type MilestoneDecisionRef = z.infer<typeof milestoneDecisionRefSchema>;

/**
 * One acceptance criterion retired during the plan (adr-an-acceptance-criterion-retires-with-the-feature-it): superseded by
 * another criterion, or belonging to a spec deprecated while the plan was open. The owner confirms the list at the milestone.
 */
export const retiredAcRefSchema = z.object({
  kind: z.enum(["superseded", "deprecated-spec"]),
  /** Slug of the spec that declared the criterion. */
  spec: z.string().min(1),
  ac: z.string().min(1),
  reason: z.string().min(1),
  /** Superseding criterion (kind `superseded` only): `<spec slug>:<ac id>`. */
  superseded_by: z.string().min(1).optional(),
  /** Status the spec had before it was deprecated (kind `deprecated-spec` only); a rejection restores it. */
  previous_status: z.string().min(1).optional(),
  /** ISO time of the retirement; one retirement instance is identified by (kind, spec, ac, at). */
  at: z.string().min(1),
});
export type RetiredAcRef = z.infer<typeof retiredAcRefSchema>;

/** One root cause of a judged dimension: its key, its label, the failing units with their input hashes, and for a cross-file cause the cited files. */
export const judgedCauseSchema = z.object({
  /** The cause key hashed into the fingerprint with the dimension (`unit:...`, `cross-file:...`, `plan:...`, `criterion:...`, or a legacy `cites:...`). */
  key: z.string().min(1),
  /** The title label: the file path for a unit cause, otherwise the judge's summary (never part of the key). */
  label: z.string().min(1),
  units: z.array(z.object({ id: z.string().min(1), input_sha256: z.string().min(1) })),
  cited_files: z.array(z.string().min(1)).optional(),
});
export type JudgedCause = z.infer<typeof judgedCauseSchema>;

/**
 * The measured causes of a review's failed findings, stored so a later batch can file them by root cause without
 * re-reviewing (BR-1379: issues are grouped by fingerprint, and a filing error retries only the filing).
 */
export const reviewCausesSchema = z.object({
  /**
   * The test files that were red at the plan's last landing and that the selection charged to the plan, sorted (BR-1513).
   * Each file is its own root cause (`file:<path>`, independent of the plan), so a plan charged with several files
   * files, links, covers, closes and accepts one root cause per file.
   */
  regression_files: z.array(z.string().min(1)).optional(),
  /** Cited rule ids whose state is contradicted (the snapshot-accuracy finding's root cause), sorted. */
  contradicted_rules: z.array(z.string().min(1)).optional(),
  /**
   * The root causes of the JUDGED dimensions, by dimension id (BR-1552, #629): each is keyed by recorded unit input hashes
   * (`unit:<path>:<hash>`, `cross-file:<hash>`, `plan:<hash>`, `criterion:<spec>:<ac>:<hash>`), never by the judge's cites.
   * A dimension absent here keeps the cites-keyed cause.
   */
  judged: z.record(z.string(), z.array(judgedCauseSchema)).optional(),
});
export type ReviewCauses = z.infer<typeof reviewCausesSchema>;

/**
 * The structured address of the source a decision finding is about (#500), so a finding is identified without reading
 * its wording: a pinned file span, a re-run command, an issue or a document.
 */
export const decisionFindingSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string().min(1), lines: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional(), sha: z.string().min(1).optional() }),
  z.object({ kind: z.literal("cmd"), command: z.string().min(1) }),
  z.object({ kind: z.literal("issue"), number: z.number().int().min(1) }),
  z.object({ kind: z.literal("doc"), slug: z.string().min(1), version: z.number().int().min(1).optional() }),
]);
export type DecisionFindingSource = z.infer<typeof decisionFindingSourceSchema>;

/** One finding of the recorded-decision re-check (spec-a-decision-carrying-write-records-its-decision-on-its). */
export const decisionFindingSchema = z.object({
  /** The decision's address, `<slug>@<version>`. */
  decision: z.string().min(1),
  /** Which part was checked: a premise, gate id or score dimension. */
  part: z.string().min(1),
  /** The finding kind, e.g. `wrong-when-written`, `stale-since`, `unverifiable`, `not-rerunnable`. */
  kind: z.string().min(1),
  fact: z.string().min(1),
  /** The source the finding is about, when it has a structured address; absent on a finding stored before this field or about no source. */
  source: decisionFindingSourceSchema.optional(),
});
export type DecisionFinding = z.infer<typeof decisionFindingSchema>;

/** A traced escaped defect: the issue that exposed it, the decision that let it through, and the part at fault. */
export const tracedDecisionSchema = z.object({
  issue: z.number().int().min(1),
  decision: z.string().min(1),
  part: z.string().min(1),
});
export type TracedDecision = z.infer<typeof tracedDecisionSchema>;

/** The stored review (`extra.milestone_review` of a knowledge doc with sub_type `milestone-review`). */
export const milestoneReviewSchema = z.object({
  plan_id: z.string().min(1),
  /** The plan-state fingerprint this review judged; close compares it with the fingerprint at close time. */
  fingerprint: z.string().min(1),
  overall: z.enum(["pass", "fail"]),
  dimensions: z.object(dimensionsShape),
  decisions: z.array(milestoneDecisionRefSchema),
  /** ACs retired during the plan; absent on a review stored before the list existed (never read as "none retired"). */
  retired_acs: z.array(retiredAcRefSchema).optional(),
  /** Measured root causes of the failed findings (absent on a review stored before BR-1379 grouping). */
  causes: reviewCausesSchema.optional(),
  /** Findings of the recorded-decision re-check, each naming `<slug>@<version>`; written only by the milestone assess (absent = none recorded). */
  decision_findings: z.array(decisionFindingSchema).optional(),
  /** Escaped defects traced to a decision; written only by `lore decision trace`, idempotent by the triple. */
  traced_decisions: z.array(tracedDecisionSchema).optional(),
  /** Main's head when the review measured; the batch compares it with main to see whether a landing touched `failing_fact_files`. Absent on a review stored before it existed. */
  assessed_commit: z.string().min(1).optional(),
  /** Which worktree ran the criteria and why (absent when no criterion was run or the review predates the field). */
  criteria_run: criteriaRunRecordSchema.optional(),
  /** Files named by the failing facts, sorted; absent when nothing failed or the review predates the field. */
  failing_fact_files: z.array(z.string().min(1)).optional(),
  /** Distinct causes of the not-measured regression rows (see NOT_MEASURED_CAUSES); the batch retries only on `unrunnable`. */
  regression_causes: z.array(z.enum(NOT_MEASURED_CAUSES)).optional(),
  /** The judgment layer's calls, tokens, time and unseen files; absent on a review stored before it was recorded. */
  judgment: judgmentRecordSchema.optional(),
  prompt_version: z.string().min(1),
  /**
   * Fingerprint of the measured facts this review read (head suite result id, single-file run ids, criteria attestation ids made at
   * the assessed commit, cited-rule states, prompt version). `fingerprint` stays the plan-state fingerprint plan close compares; the batch
   * re-reviews when this one changes. Absent on a review stored before it existed (then re-made once).
   */
  facts_fingerprint: z.string().min(1).optional(),
  /** How the diff was obtained, e.g. `auto_derived:derived` or `none`. */
  diff_source: z.string().min(1),
});
export type MilestoneReview = z.infer<typeof milestoneReviewSchema>;

/**
 * One line of fresh and reused counts per judged dimension, for `lore assess` (BR-1535, spec S6). `security` and
 * `concurrency_safety` count changed-file units, `criteria` counts AI-criterion units.
 *
 * @param review - a stored review
 * @returns e.g. `security: 1 fresh, 2 reused; concurrency_safety: 1 fresh, 2 reused; criteria: 0 fresh, 0 reused`; a review stored
 *   before per-unit verdicts says so instead of printing zeros
 */
export function renderUnitCounts(review: MilestoneReview): string {
  const units = review.judgment?.units;
  if (units === undefined) return "units: not recorded (the review predates per-unit verdicts)";
  const count = (kind: JudgeUnitRecord["kind"]): string => {
    const of = units.filter((u) => u.kind === kind);
    return `${String(of.filter((u) => u.source === "fresh").length)} fresh, ${String(of.filter((u) => u.source === "reused").length)} reused`;
  };
  return `security: ${count("file")}; concurrency_safety: ${count("file")}; criteria: ${count("criterion")}`;
}

/**
 * Applies the rules the judge cannot waive: `design_necessity` without a reference fails.
 *
 * @param dimensions - the judge's seven judgments
 * @returns the same judgments, with a referenceless `design_necessity` pass turned into a named fail
 */
export function applyDeterministicDimensionRules(
  dimensions: LlmMilestoneOutput["dimensions"],
): LlmMilestoneOutput["dimensions"] {
  const design = dimensions.design_necessity;
  if (design.verdict === "pass" && design.reference.length === 0) {
    return {
      ...dimensions,
      design_necessity: {
        verdict: "fail",
        reason: `No external reference named for the technical choices (judge said: ${design.reason})`,
        reference: "",
      },
    };
  }
  return dimensions;
}

/** The gates (spec "Verdict and close"): a failed or not-measured gate keeps the plan open instead of closing it with a known defect. */
export const GATE_DIMENSIONS = ["correctness_vs_acs", "regression", "security"] as const satisfies readonly MilestoneDimension[];
export type GateDimension = (typeof GATE_DIMENSIONS)[number];

/** Whether `dimension` is a gate. */
export function isGateDimension(dimension: string): dimension is GateDimension {
  return (GATE_DIMENSIONS as readonly string[]).includes(dimension);
}

/**
 * The gates that block a close: `fail` or `not-measured`. `na` and `pass` never block.
 *
 * @param dimensions - a review's seven verdicts
 * @returns the blocking gates in render order
 */
export function blockingGates(dimensions: LlmMilestoneOutput["dimensions"]): GateDimension[] {
  return GATE_DIMENSIONS.filter((d) => dimensions[d].verdict === "fail" || dimensions[d].verdict === "not-measured");
}

/**
 * The dimensions that need an issue: every failed dimension plus every not-measured gate (a not-measured gate holds the
 * plan open and so needs the same record a failure gets).
 *
 * @param dimensions - a review's seven verdicts
 * @returns the dimensions in render order
 */
export function filableDimensions(dimensions: LlmMilestoneOutput["dimensions"]): MilestoneDimension[] {
  return MILESTONE_DIMENSIONS.filter((d) => dimensions[d].verdict === "fail" || (dimensions[d].verdict === "not-measured" && isGateDimension(d)));
}

/** `pass` iff no dimension is `fail`. */
export function overallMilestoneVerdict(dimensions: LlmMilestoneOutput["dimensions"]): "pass" | "fail" {
  return MILESTONE_DIMENSIONS.some((d) => dimensions[d].verdict === "fail") ? "fail" : "pass";
}

/** The dimensions whose verdict is `fail`, in render order. */
export function failedDimensions(dimensions: LlmMilestoneOutput["dimensions"]): MilestoneDimension[] {
  return MILESTONE_DIMENSIONS.filter((d) => dimensions[d].verdict === "fail");
}

/** Deterministic Markdown of a stored review; its SSOT is `extra.milestone_review`. */
export function renderMilestoneReviewContent(review: MilestoneReview): string {
  const lines = [`# Milestone review: ${review.overall.toUpperCase()}`, "", `Fingerprint: ${review.fingerprint}`, `Diff: ${review.diff_source}`, ...(review.criteria_run !== undefined ? [`Criteria ran in: ${review.criteria_run.worktree === "suite" ? "the suite's worktree" : "a worktree of their own"}${review.criteria_run.reason !== undefined ? ` (${review.criteria_run.reason})` : ""}`] : []), ""];
  lines.push("| Dimension | Verdict | Reason | Reference |", "|---|---|---|---|");
  for (const d of MILESTONE_DIMENSIONS) {
    const j = review.dimensions[d];
    lines.push(`| ${d} | ${j.verdict} | ${j.reason.replace(/\|/g, "/")} | ${j.reference.replace(/\|/g, "/")} |`);
  }
  if (review.decisions.length > 0) {
    lines.push("", "## Milestone decisions", "");
    for (const dec of review.decisions) lines.push(`- ${dec.class} on ${dec.document}: ${dec.summary}`);
  }
  if (review.retired_acs !== undefined && review.retired_acs.length > 0) {
    lines.push("", "## Retired ACs", "");
    for (const ac of review.retired_acs) {
      const via = ac.superseded_by !== undefined ? ` (superseded by ${ac.superseded_by})` : " (spec deprecated)";
      lines.push(`- ${ac.spec}:${ac.ac}${via}: ${ac.reason}`);
    }
  }
  return lines.join("\n");
}
