/**
 * MilestoneReviewService — the SOLE writer of a plan's milestone review (BR-1372), behind `lore assess`.
 *
 * Purpose: judge a plan on the seven dimensions from its landed diff, documents, attested task evidence, cited-rule
 *   state and the `milestone` decisions that belong to it; store the review with the plan-state fingerprint it judged.
 * Public surface: `MilestoneReviewService.review(planRef, opts)`, `MilestoneReviewService.recordMainRed(suite)`,`MilestoneReviewDeps`, `MilestoneReviewResult`.
 * Invariants:
 *   - The judge never writes the fingerprint, the overall verdict or the decision list; this service computes them.
 *   - A judge answer that does not parse as all seven dimensions is retried ONCE with the parse error; a second
 *     failure is an AI error and NOTHING is stored (a half-formed review is never a review).
 *   - `design_necessity` without a reference is a fail whatever the judge said (`applyDeterministicDimensionRules`).
 *   - Main red is recorded in the local ledger at detection, BEFORE the judge runs and before any issue is filed, so a
 *     judge failure or a failing issue filer never loses it (BR-1412); a ledger failure fails the review loudly.
 *   - The review doc is written through the guarded `createMilestoneReviewDoc` seam only, then informs-linked to the
 *     plan; a link failure after the doc exists is LOUD (names the repair command), never an orphan.
 * Side-effect class: IO through the injected ports (services never import each other; `app.ts` binds the real ones).
 *
 * Reference: Kayenta automated canary analysis; Google's engineering code review guide.
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D, AC-LG-12, BR-1372)
 */

import {
  applyDeterministicDimensionRules,
  err,
  extractAssessmentJson,
  extractEvidence,
  llmMilestoneOutputSchema,
  ok,
  overallMilestoneVerdict,
  renderMilestoneReviewContent,
  type CreateDocInput,
  type DecisionFinding,
  type DocRecord,
  type LinkType,
  type LlmMilestoneOutput,
  type ReviewCauses,
  type LoreError,
  type MilestoneDecisionRef,
  type MilestoneReview,
  type PlanBundle,
  type Result,
  type RetiredAcRef,
} from "@lore/core";
import {
  buildMilestoneReviewPrompt,
  MILESTONE_REVIEW_PROMPT_VERSION,
  type JudgedDecisionInput,
  type MilestoneTaskInput,
} from "../ai/milestone-review-template.js";
import { decisionDetailSchema, type DecisionLogRow } from "../store/decision-log.js";
import {
  classifySuiteForMainRed,
  foldMainRedRecords,
  MILESTONE_REVIEW_SUB_TYPE,
  planMainRedWrites,
  planStateFingerprint,
  type CitedRuleStateRow,
  type MainRedLedgerPort,
} from "./milestone-review.js";
import { applyDecisionFindings, judgedFindingsOf, rerunCitingCriteria, type CriterionRerunPort } from "./decision-recheck.js";
import {
  applyRegressionFloor,
  applySnapshotRule,
  attributeSuiteFailures,
  renderSuiteSection,
  touchedFilesOfDiff,
  staleCitingAcIds,
  type StaleAcRefresherPort,
  type StaleRefreshReport,
  type SuiteRun,
} from "./milestone-review-inputs.js";

/** The narrow ports this service needs; `app.ts` binds the real services into them. */
export interface MilestoneReviewDeps {
  readonly getPlanBundle: (planRef: string) => Promise<Result<PlanBundle, LoreError>>;
  readonly getCitedRuleStates: (spec: DocRecord) => Promise<Result<CitedRuleStateRow[], LoreError>>;
  /** Every decision-log row (`store.listDecisionLog()`); this service keeps the `milestone` ones. */
  readonly listDecisionLog: () => Promise<Result<DecisionLogRow[], LoreError>>;
  /** Sends `prompt` to the configured judge and returns its raw text. */
  readonly judge: (prompt: string, title: string) => Promise<Result<string, LoreError>>;
  /** The ACs retired during the plan (adr-an-acceptance-criterion-retires-with-the-feature-it), listed in the review. */
  readonly listRetiredAcs?: (bundle: PlanBundle) => Promise<Result<RetiredAcRef[], LoreError>>;
  readonly createReviewDoc: (input: CreateDocInput) => Promise<Result<DocRecord, LoreError>>;
  readonly link: (fromId: string, toId: string, type: LinkType) => Promise<Result<unknown, LoreError>>;
  /**
   * The local main-red ledger (BR-1412). Optional so hand-built services (unit tests, MCP stubs) stay valid; `app.ts`
   * always wires it, and a service without it records nothing.
   */
  readonly mainRedLedger?: MainRedLedgerPort;
  /**
   * The deterministic re-check of the plan's recorded decisions (`decision-recheck.ts`). Optional like the other
   * measured ports: a service without it records no decision findings.
   */
  readonly recheckDecisions?: (bundle: PlanBundle) => Promise<Result<DecisionFinding[], LoreError>>;
  /**
   * The plan's recorded decisions as the judge reads them (`buildJudgedDecisionInputs`, spec D6). Optional like the
   * other measured ports: a service without it puts no decisions section to the judge and records no judged findings.
   */
  readonly judgedDecisionInputs?: (bundle: PlanBundle) => Promise<Result<JudgedDecisionInput[], LoreError>>;
}

/** Per-run inputs the adapter measured. */
export interface MilestoneReviewOptions {
  /** The plan's landed diff; `undefined` when none could be derived. */
  readonly diffText?: string;
  /** How the diff was obtained, or why it is absent (stored on the review). */
  readonly diffSource: string;
  readonly maxDiffChars: number;
  /** The batch's one full-suite run (`lore assess` measures it once); absent = none supplied for this review. */
  readonly suite?: SuiteRun;
  /** Runs one criterion in this run's execution context; absent = the re-run of criteria citing a reworded rule is not done. */
  readonly rerunCriterion?: CriterionRerunPort;
}

/** A stored review and its document. */
export interface MilestoneReviewResult {
  readonly doc: DocRecord;
  readonly review: MilestoneReview;
}

function aiError(message: string): LoreError {
  return { code: "AI_PROVIDER_ERROR", message, provider: "milestone-review" };
}

/**
 * The measured root causes of a review's failed findings: the failing suite files attributed to the plan (when
 * `regression` failed) and the contradicted cited rule ids (when `snapshot_accuracy` failed); `undefined` when neither.
 */
export function measuredCauses(
  dimensions: LlmMilestoneOutput["dimensions"],
  attributedFailingFiles: readonly string[],
  cited: readonly CitedRuleStateRow[],
  suiteFailingFiles: readonly string[] = [],
): ReviewCauses | undefined {
  const regression =
    dimensions.regression.verdict === "fail" && attributedFailingFiles.length > 0 ? [...new Set(attributedFailingFiles)].sort() : undefined;
  const contradicted = cited.filter((r) => r.state === "contradicted").map((r) => r.rule_id);
  const rules = dimensions.snapshot_accuracy.verdict === "fail" && contradicted.length > 0 ? [...new Set(contradicted)].sort() : undefined;
  if (regression === undefined && rules === undefined) return undefined;
  // reason: BR-1379 / #345 — one failing main suite is ONE root cause, so the whole run's failing set is stored beside
  // the plan's attributed subset; the fingerprint reads the whole set.
  const suiteSet = regression !== undefined ? [...new Set(suiteFailingFiles)].sort() : undefined;
  return { ...(regression !== undefined ? { regression_files: regression } : {}), ...(suiteSet !== undefined ? { suite_failing_files: suiteSet } : {}), ...(rules !== undefined ? { contradicted_rules: rules } : {}) };
}

/** The `milestone` decisions whose document is the plan, its spec or one of its tasks (newest per class+document). */
export function selectPlanMilestoneDecisions(
  rows: readonly DecisionLogRow[],
  slugs: ReadonlySet<string>,
): MilestoneDecisionRef[] {
  const found = new Map<string, MilestoneDecisionRef>();
  for (const row of rows) {
    if (row.verdict !== "milestone") continue;
    let document = row.subject_id.split("#")[0] ?? row.subject_id;
    let summary = "";
    if (row.detail !== undefined && row.detail !== null) {
      try {
        const detail = decisionDetailSchema.parse(JSON.parse(row.detail));
        summary = detail.summary;
        const changed = detail.change["document"];
        if (typeof changed === "string") document = changed;
      } catch {
        // reason: a detail that does not parse falls back to the subject id's document and an empty summary — the
        // decision is still LISTED (visible), never dropped for want of a readable detail.
        summary = "";
      }
    }
    if (!slugs.has(document)) continue;
    found.set(`${row.class}|${document}|${summary}`, { class: row.class, document, summary });
  }
  return [...found.values()];
}

/** See the module header. */
export class MilestoneReviewService {
  constructor(private readonly deps: MilestoneReviewDeps) {}

  /**
   * Re-verifies stale cited evidence ONCE for a whole batch, before any plan is judged (Part D). Collects the citing
   * criteria of every stale cited rule across `planRefs`, deduplicated per (spec, criterion), and runs each through the
   * trusted runner port; the next `review` call recomputes rule state from the fresh attested evidence.
   *
   * @param planRefs - the batch's plans (unresolvable plans and plans without a spec are skipped; `review` reports them)
   * @param refresher - the trusted-runner port (the `lore verify` path in the batch's throwaway main worktree)
   * @returns `ok(report)`; a port failure is recorded in `report.failures` (its rules stay stale, hence n/a), never
   *   thrown; `err` only when a cited-rule read fails
   */
  async refreshStaleCitedRules(
    planRefs: readonly string[],
    refresher: StaleAcRefresherPort,
  ): Promise<Result<StaleRefreshReport, LoreError>> {
    const claimed = new Set<string>();
    const byPlan = new Map<string, string[]>();
    for (const planRef of planRefs) {
      const bundle = await this.deps.getPlanBundle(planRef);
      if (!bundle.ok || bundle.value.spec === undefined) continue;
      const cited = await this.deps.getCitedRuleStates(bundle.value.spec);
      if (!cited.ok) return cited;
      for (const acId of staleCitingAcIds(cited.value)) {
        const key = `${bundle.value.spec.slug}#${acId}`;
        if (claimed.has(key)) continue;
        claimed.add(key);
        byPlan.set(planRef, [...(byPlan.get(planRef) ?? []), acId]);
      }
    }
    const ran: { plan: string; acIds: readonly string[] }[] = [];
    const failures: { plan: string; acIds: readonly string[]; message: string }[] = [];
    for (const [plan, acIds] of byPlan) {
      const result = await refresher.runAcs(plan, acIds);
      if (result.ok) ran.push({ plan, acIds });
      else failures.push({ plan, acIds, message: "message" in result.error ? result.error.message : result.error.code });
    }
    return ok({ ran, failures });
  }

  /**
   * Records what one suite measurement says about main in the local ledger (BR-1412): a main-red record at detection
   * (commit range checked, failing checks and files, time), the green time on the open record when main is green again,
   * and the check itself. Never touches the issue tracker.
   *
   * @param suite - the batch's suite run; `undefined` or not measured records nothing
   * @returns `ok` once every row is written; `err` when the ledger cannot be read, holds a row that does not parse, or a write fails
   */
  async recordMainRed(suite: SuiteRun | undefined): Promise<Result<void, LoreError>> {
    const ledger = this.deps.mainRedLedger;
    if (ledger === undefined || suite === undefined) return ok(undefined);
    const measured = classifySuiteForMainRed(suite.status === "measured" ? suite : { status: suite.status });
    if (measured.state === "unmeasured") return ok(undefined);
    const rows = await ledger.listRows();
    if (!rows.ok) return rows;
    const folded = foldMainRedRecords(rows.value);
    if (!folded.ok) return folded;
    for (const row of planMainRedWrites(folded.value, measured, ledger.now())) {
      const appended = await ledger.appendRow(row);
      if (!appended.ok) return appended;
    }
    return ok(undefined);
  }

  /**
   * Reviews one plan and stores the review.
   *
   * @param planRef - plan id or slug
   * @param opts - the diff the adapter derived, its source account and the diff budget
   * @returns `ok({doc, review})`; `err` for an unresolvable plan, a plan with no tasks, a judge failure (AI_PROVIDER_ERROR,
   *   nothing stored), a store failure, or a half-failure (doc created, link failed)
   */
  async review(planRef: string, opts: MilestoneReviewOptions): Promise<Result<MilestoneReviewResult, LoreError>> {
    // reason: BR-1412 — detection is recorded first, whatever the judge or the issue tracker later does. One batch
    // measures once and calls this per plan; the open record makes every call after the first a no-op for main red.
    const recorded = await this.recordMainRed(opts.suite);
    if (!recorded.ok) return recorded;
    const bundleResult = await this.deps.getPlanBundle(planRef);
    if (!bundleResult.ok) return bundleResult;
    const bundle = bundleResult.value;
    if (bundle.tasks.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "tasks",
        message: `Plan '${bundle.plan.slug}' has zero child tasks — nothing to review.`,
        rule: "BR-1372",
      });
    }

    const slugs = new Set<string>([bundle.plan.slug, ...bundle.tasks.map((t) => t.slug)]);
    if (bundle.spec !== undefined) slugs.add(bundle.spec.slug);
    const logResult = await this.deps.listDecisionLog();
    if (!logResult.ok) return logResult;
    const decisions = selectPlanMilestoneDecisions(logResult.value, slugs);

    const citedRulesResult = bundle.spec !== undefined ? await this.deps.getCitedRuleStates(bundle.spec) : ok<CitedRuleStateRow[]>([]);
    if (!citedRulesResult.ok) return citedRulesResult;

    const tasks: MilestoneTaskInput[] = bundle.tasks.map((task) => ({
      slug: task.slug,
      title: task.title,
      status: task.status,
      content: task.content,
      evidence: extractEvidence(task).map((e) => ({
        oracle: e.oracle,
        command: e.command,
        result: e.result,
        attested: e.attestation !== undefined,
        ...(e.ac_ref !== undefined ? { ac_ref: e.ac_ref } : {}),
      })),
    }));
    const touched = opts.diffText !== undefined && opts.diffText.length > 0 ? touchedFilesOfDiff(opts.diffText) : undefined;
    const attribution =
      opts.suite !== undefined ? attributeSuiteFailures(opts.suite, touched) : { attributed: [], unattributed: [] };
    const judgedInputsResult = this.deps.judgedDecisionInputs !== undefined ? await this.deps.judgedDecisionInputs(bundle) : ok<JudgedDecisionInput[]>([]);
    if (!judgedInputsResult.ok) return judgedInputsResult;
    const judgedInputs = judgedInputsResult.value;
    const prompt = buildMilestoneReviewPrompt({
      suiteSection: renderSuiteSection(opts.suite, attribution, touched !== undefined),
      plan: { slug: bundle.plan.slug, title: bundle.plan.title, content: bundle.plan.content },
      ...(bundle.spec !== undefined ? { spec: { slug: bundle.spec.slug, title: bundle.spec.title, content: bundle.spec.content } } : {}),
      tasks,
      citedRules: citedRulesResult.value,
      decisions,
      recordedDecisions: judgedInputs,
      ...(opts.diffText !== undefined ? { diffText: opts.diffText } : {}),
      diffSource: opts.diffSource,
      maxDiffChars: opts.maxDiffChars,
    });

    const judged = await this.judgeWithRetry(prompt, bundle.plan.title, judgedInputs);
    if (!judged.ok) return judged;
    // reason: both measured inputs are applied AFTER the judge so it cannot waive them (Part D): an attributed
    // failing test file fails regression; snapshot_accuracy fails only on a contradicted cited rule.
    const decisionFindingsResult = this.deps.recheckDecisions !== undefined ? await this.deps.recheckDecisions(bundle) : ok<DecisionFinding[]>([]);
    if (!decisionFindingsResult.ok) return decisionFindingsResult;
    // reason: one list — the deterministic re-check, the judge's objections and the criterion re-runs all land in
    // `decision_findings`; only a wrong-when-written one changes a verdict (`applyDecisionFindings`).
    const rerun = opts.rerunCriterion !== undefined ? await rerunCitingCriteria(judgedInputs, opts.rerunCriterion) : [];
    const decisionFindings = [...decisionFindingsResult.value, ...judged.value.findings, ...rerun];
    // reason: a wrong-when-written decision premise fails snapshot_accuracy AFTER the cited-rule rule so neither the judge
    // nor that rule can turn it back into a pass or an n/a (spec D5).
    const dimensions = applyDecisionFindings(
      applySnapshotRule(
        applyRegressionFloor(
          applyDeterministicDimensionRules(judged.value.output.dimensions),
          attribution,
          opts.suite?.status === "measured" ? opts.suite.commit : undefined,
        ),
        citedRulesResult.value,
      ),
      decisionFindings,
    );
    // reason: optional port so hand-built services (unit tests, MCP stubs) stay valid; `app.ts` always wires it.
    const retiredResult = this.deps.listRetiredAcs !== undefined ? await this.deps.listRetiredAcs(bundle) : ok<RetiredAcRef[]>([]);
    if (!retiredResult.ok) return retiredResult;
    // reason: BR-1379 root-cause grouping needs the MEASURED causes of the failed findings (not the judge's prose), and
    // a later batch that only retries filing reads them from the stored review instead of re-judging.
    const causes = measuredCauses(
      dimensions,
      attribution.attributed,
      citedRulesResult.value,
      opts.suite?.status === "measured" ? opts.suite.failing_test_files.map((f) => f.file) : [],
    );
    const review: MilestoneReview = {
      plan_id: bundle.plan.id,
      ...(retiredResult.value.length > 0 ? { retired_acs: retiredResult.value } : {}),
      fingerprint: planStateFingerprint(bundle.plan, bundle.tasks, bundle.spec),
      ...(causes !== undefined ? { causes } : {}),
      overall: overallMilestoneVerdict(dimensions),
      dimensions,
      decisions,
      ...(decisionFindings.length > 0 ? { decision_findings: decisionFindings } : {}),
      prompt_version: MILESTONE_REVIEW_PROMPT_VERSION,
      diff_source: opts.diffSource,
    };

    const created = await this.deps.createReviewDoc({
      type: "knowledge",
      title: `Milestone review: ${bundle.plan.title}`,
      parent_id: bundle.plan.id,
      extra: { sub_type: MILESTONE_REVIEW_SUB_TYPE, milestone_review: review },
      content: renderMilestoneReviewContent(review),
    });
    if (!created.ok) return created;
    const doc = created.value;
    const linked = await this.deps.link(doc.id, bundle.plan.id, "informs");
    if (!linked.ok && linked.error.code !== "DUPLICATE_LINK") {
      return err({
        code: "VALIDATION_ERROR",
        field: "informs_link",
        message:
          `Milestone review created (${doc.slug}) but linking it to plan "${bundle.plan.slug}" failed: ` +
          `${linked.error.code}. Repair: \`lore link ${doc.slug} ${bundle.plan.slug} --type informs\``,
        rule: "BR-1372",
      });
    }
    return ok({ doc, review });
  }

  /** One judge call, parsed; on a parse failure one retry that shows the judge its own error. */
  private async judgeWithRetry(
    prompt: string,
    title: string,
    inputs: readonly JudgedDecisionInput[],
  ): Promise<Result<{ output: LlmMilestoneOutput; findings: DecisionFinding[] }, LoreError>> {
    let currentPrompt = prompt;
    let lastProblem = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = await this.deps.judge(currentPrompt, title);
      if (!raw.ok) return raw;
      const extracted = extractAssessmentJson(raw.value);
      if (extracted.ok) {
        const parsed = llmMilestoneOutputSchema.safeParse(extracted.value);
        if (parsed.success) {
          // reason: llmMilestoneOutputSchema strips unknown keys, so the decisions answer is read from the raw object.
          const answered = judgedFindingsOf(inputs, (extracted.value as { decisions?: unknown }).decisions);
          if (answered.ok) return ok({ output: parsed.data, findings: answered.value });
          lastProblem = answered.error;
        } else {
          lastProblem = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        }
      } else {
        lastProblem = "message" in extracted.error ? extracted.error.message : extracted.error.code;
      }
      currentPrompt =
        `${prompt}\n\nYour previous answer was rejected: ${lastProblem}\n` +
        "Answer again with ONE JSON object containing all seven dimensions, each with verdict, reason and reference, and a non-empty cites list on every failed finding" +
        (inputs.length > 0 ? `, and a \`decisions\` array with one answer for each of: ${inputs.map((i) => i.address).join(", ")}.` : ".");
    }
    return err(aiError(`the judge did not return a valid seven-dimension review after one retry: ${lastProblem}`));
  }
}
