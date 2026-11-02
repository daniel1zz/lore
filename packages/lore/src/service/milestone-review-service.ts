/**
 * MilestoneReviewService — the SOLE writer of a plan's milestone review (BR-1372), behind `lore assess`.
 *
 * Purpose: judge a plan on the seven dimensions from its landed diff, documents, attested task evidence, cited-rule
 *   state and the `milestone` decisions that belong to it; store the review with the plan-state fingerprint it judged.
 * Public surface: `MilestoneReviewService.review(planRef, opts)`, `factsFingerprint`, `hasStaleCitations`, `MilestoneReviewDeps`, `MilestoneReviewResult`.
 * Invariants:
 *   - The judge never writes the fingerprint, the overall verdict or the decision list; this service computes them.
 *   - The judge is asked only the four judged dimensions and the AI-mode criteria (`milestone-review-judgment.ts`); the
 *     facts dimensions are computed from measured facts and an AI verdict on one is ignored. A judge answer that does not
 *     parse is retried ONCE with the parse error; a second failure is an AI error and NOTHING is stored.
 *   - A diff over the per-call budget is judged in file chunks, never cut; unseen files make the gates not-measured (BR-1499).
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
  extractEvidence,
  ok,
  overallMilestoneVerdict,
  type CreateDocInput,
  type DecisionFinding,
  type DocRecord,
  type LinkType,
  type JudgedDimension,
  type LlmMilestoneOutput,
  type ReviewCauses,
  type LoreError,
  type MilestoneDecisionRef,
  type MilestoneFacts,
  type MilestoneReview,
  type PlanBundle,
  type Result,
  type RetiredAcRef,
} from "@lore/core";
import { factsDimensions, mergeDimensions, runJudgment, type JudgePort } from "./milestone-review-judgment.js";
import { randomUUID } from "node:crypto";
import { UnitLedger, type JudgeVerdictStorePort } from "./judge-unit-ledger.js";
import { sha256Hex, type JudgeIdentity } from "./judge-unit-keys.js";
import {
  MILESTONE_REVIEW_PROMPT_VERSION,
  UNIT_INSTRUCTION_TEMPLATE,
  unitTemplateSourceOf,
  type JudgedDecisionInput,
  type MilestoneTaskInput,
} from "../ai/milestone-review-template.js";
import { decisionDetailSchema, type DecisionLogRow } from "../store/decision-log.js";
import {
  MILESTONE_REVIEW_SUB_TYPE,
  milestoneFactsFingerprint,
  planStateFingerprint,
  type CitedRuleStateRow,
} from "./milestone-review.js";
import { withDecisionFindingCites } from "./decision-finding-cites.js";
import { applyDecisionFindings,rerunCitingCriteria, type CriterionRerunPort } from "./decision-recheck.js";
import {
  applySnapshotRule,
  renderSuiteSection,
  staleCitingAcIds,
  type StaleAcRefresherPort,
  type StaleRefreshReport,
  type SuiteRun,
} from "./milestone-review-inputs.js";
import { milestoneReviewFields, withGeneratedFields } from "./generated-fields.js";

/** The narrow ports this service needs; `app.ts` binds the real services into them. */
export interface MilestoneReviewDeps {
  readonly getPlanBundle: (planRef: string) => Promise<Result<PlanBundle, LoreError>>;
  readonly getCitedRuleStates: (spec: DocRecord) => Promise<Result<CitedRuleStateRow[], LoreError>>;
  /** Every decision-log row (`store.listDecisionLog()`); this service keeps the `milestone` ones. */
  readonly listDecisionLog: () => Promise<Result<DecisionLogRow[], LoreError>>;
  /** Sends `prompt` to the configured judge and returns its raw text. */
  readonly judge: (prompt: string, title: string) => Promise<Result<string, LoreError>>;
  /**
   * Like `judge` but returns the call's duration and token usage; `app.ts` wires it. Absent (hand-built services), the
   * service times `judge` itself and records no tokens (unknown, never 0).
   */
  readonly judgeMeasured?: JudgePort;
  /** The ACs retired during the plan (adr-an-acceptance-criterion-retires-with-the-feature-it), listed in the review. */
  readonly listRetiredAcs?: (bundle: PlanBundle) => Promise<Result<RetiredAcRef[], LoreError>>;
  readonly createReviewDoc: (input: CreateDocInput) => Promise<Result<DocRecord, LoreError>>;
  readonly link: (fromId: string, toId: string, type: LinkType) => Promise<Result<unknown, LoreError>>;
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
  /**
   * The verdict store the judge's per-unit answers are kept in and reused from (BR-1535). Absent (hand-built services) = reuse is
   * off and the review records why.
   */
  readonly judgeVerdicts?: JudgeVerdictStorePort;
  /** Which judge answers (provider, model, settings); its model must be known for reuse. Absent = reuse is off. */
  readonly judgeIdentity?: () => JudgeIdentity;
  /** The clock (verdict read stamps, the 30-day expiry and the review token); default the system clock. */
  readonly now?: () => Date;
  /** The unit-instruction template source; default the shipped text. Sent in every call and hashed into every unit key. */
  readonly unitInstructions?: string;
  /** The dimension guide; default the shipped one. Sent in every call and hashed (with the unit instructions) into every unit key. */
  readonly dimensionGuide?: Readonly<Record<JudgedDimension, string>>;
}

/** Per-run inputs the adapter measured. */
export interface MilestoneReviewOptions {
  /** The plan's landed diff; `undefined` when none could be derived. */
  readonly diffText?: string;
  /** How the diff was obtained, or why it is absent (stored on the review). */
  readonly diffSource: string;
  /** Per-call budget for diff text; a larger diff is judged in file chunks (BR-1499), never cut. */
  readonly maxDiffChars: number;
  /** Measured facts for the facts table and the facts dimensions (attestation, regression at head, scope, AI-mode criteria). */
  readonly facts?: MilestoneFacts;
  /** The batch's one full-suite run (`lore assess` measures it once); absent = none supplied for this review. */
  readonly suite?: SuiteRun;
  /** Runs one criterion in this run's execution context; absent = the re-run of criteria citing a reworded rule is not done. */
  readonly rerunCriterion?: CriterionRerunPort;
  /** `lore assess --rejudge`: ignore stored unit verdicts for this review; fresh answers are still stored, replacing nothing (BR-1535 S5). */
  readonly rejudge?: boolean;
}

/** A stored review and its document. */
export interface MilestoneReviewResult {
  readonly doc: DocRecord;
  readonly review: MilestoneReview;
}

/**
 * The measured root causes of a review's failed findings: the files red at the plan's last landing that the selection
 * charged to it (when `regression` failed) and the contradicted cited rule ids (when `snapshot_accuracy` failed);
 * `undefined` when neither.
 */
export function measuredCauses(
  dimensions: LlmMilestoneOutput["dimensions"],
  attributedFailingFiles: readonly string[],
  cited: readonly CitedRuleStateRow[],
): ReviewCauses | undefined {
  const regression =
    dimensions.regression.verdict === "fail" && attributedFailingFiles.length > 0 ? [...new Set(attributedFailingFiles)].sort() : undefined;
  const contradicted = cited.filter((r) => r.state === "contradicted").map((r) => r.rule_id);
  const rules = dimensions.snapshot_accuracy.verdict === "fail" && contradicted.length > 0 ? [...new Set(contradicted)].sort() : undefined;
  if (regression === undefined && rules === undefined) return undefined;
  // reason: BR-1496 / #540 — no review measures a full suite, so the root causes are the files the selection found red at the
  // plan's last landing and charged to it. Each file is its own cause (BR-1513): the fingerprint reads one file at a time.
  return { ...(regression !== undefined ? { regression_files: regression } : {}), ...(rules !== undefined ? { contradicted_rules: rules } : {}) };
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

/** The facts fingerprint of one review: what its verdict read beyond the plan's own state (AC-AF-6). */
function factsFingerprintOf(facts: MilestoneFacts | undefined, cited: readonly CitedRuleStateRow[]): string {
  return milestoneFactsFingerprint({
    ...(facts?.head_suite_result_id !== undefined ? { headSuiteResultId: facts.head_suite_result_id } : {}),
    singleFileRunIds: facts?.single_file_run_ids ?? [],
    criteriaAttestationIds: facts?.criteria_attestation_ids ?? [],
    citedRules: cited.map((r) => ({ rule_id: r.rule_id, state: r.state })),
    promptVersion: MILESTONE_REVIEW_PROMPT_VERSION,
  });
}

/** See the module header. */
export class MilestoneReviewService {
  constructor(private readonly deps: MilestoneReviewDeps) {}

  /**
   * The facts fingerprint a review made NOW from `facts` would carry; the batch compares it with the stored review's
   * `facts_fingerprint` to decide whether a plan must be re-reviewed (AC-AF-6). Same function `review` stores with.
   *
   * @param planRef - plan id or slug
   * @param facts - the plan's measured facts
   * @returns the fingerprint; `err` when the plan or its cited rules cannot be read
   */
  async factsFingerprint(planRef: string, facts: MilestoneFacts | undefined): Promise<Result<string, LoreError>> {
    const bundle = await this.deps.getPlanBundle(planRef);
    if (!bundle.ok) return bundle;
    const cited = bundle.value.spec !== undefined ? await this.deps.getCitedRuleStates(bundle.value.spec) : ok<CitedRuleStateRow[]>([]);
    if (!cited.ok) return cited;
    return ok(factsFingerprintOf(facts, cited.value));
  }

  /**
   * Whether any of the plans cites a stale rule a refresh would re-verify (a pure read: nothing runs).
   *
   * @param planRefs - the batch's plans
   * @returns `ok(true)` when at least one citing criterion is stale
   */
  async hasStaleCitations(planRefs: readonly string[]): Promise<Result<boolean, LoreError>> {
    for (const planRef of planRefs) {
      const bundle = await this.deps.getPlanBundle(planRef);
      if (!bundle.ok || bundle.value.spec === undefined) continue;
      const cited = await this.deps.getCitedRuleStates(bundle.value.spec);
      if (!cited.ok) return cited;
      if (staleCitingAcIds(cited.value).length > 0) return ok(true);
    }
    return ok(false);
  }

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
   * Reviews one plan and stores the review.
   *
   * @param planRef - plan id or slug
   * @param opts - the diff the adapter derived, its source account and the diff budget
   * @returns `ok({doc, review})`; `err` for an unresolvable plan, a plan with no tasks, a judge failure (AI_PROVIDER_ERROR,
   *   nothing stored), a store failure, or a half-failure (doc created, link failed)
   */
  async review(planRef: string, opts: MilestoneReviewOptions): Promise<Result<MilestoneReviewResult, LoreError>> {
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
        output_tail_sha256: sha256Hex(e.output_tail ?? ""),
        ...(e.ac_ref !== undefined ? { ac_ref: e.ac_ref } : {}),
      })),
    }));
    const judgedInputsResult = this.deps.judgedDecisionInputs !== undefined ? await this.deps.judgedDecisionInputs(bundle) : ok<JudgedDecisionInput[]>([]);
    if (!judgedInputsResult.ok) return judgedInputsResult;
    const judgedInputs = judgedInputsResult.value;
    const clock = this.deps.now ?? (() => new Date());
    const identity = this.deps.judgeIdentity?.();
    const unitInstructions = this.deps.unitInstructions ?? UNIT_INSTRUCTION_TEMPLATE;
    // reason: BR-1535 — the review is named before it judges so the units it writes carry `first_review`; the review document does not exist yet.
    const reviewToken = `${bundle.plan.slug}@${clock().toISOString()}#${randomUUID().slice(0, 8)}`;
    const ledger = new UnitLedger(
      this.deps.judgeVerdicts,
      identity,
      reviewToken,
      clock,
      unitTemplateSourceOf(unitInstructions, this.deps.dimensionGuide),
      opts.rejudge === true,
    );
    const judged = await runJudgment({
      reuse: { ledger, identity, unitInstructions, ...(this.deps.dimensionGuide !== undefined ? { dimensionGuide: this.deps.dimensionGuide } : {}) },
      base: {
        suiteSection: renderSuiteSection(opts.suite),
        plan: { slug: bundle.plan.slug, title: bundle.plan.title, content: bundle.plan.content },
        ...(bundle.spec !== undefined ? { spec: { slug: bundle.spec.slug, title: bundle.spec.title, content: bundle.spec.content } } : {}),
        tasks,
        citedRules: citedRulesResult.value,
        decisions,
        ...(opts.facts !== undefined ? { facts: opts.facts } : {}),
        diffSource: opts.diffSource,
      },
      title: bundle.plan.title,
      ...(opts.diffText !== undefined ? { diffText: opts.diffText } : {}),
      maxDiffChars: opts.maxDiffChars,
      judge: this.judgePort(),
      recorded: judgedInputs,
    });
    if (!judged.ok) return judged;
    // reason: measured inputs are applied AFTER the judge so it cannot waive them (Part D): regression is the at-head
    // fact; snapshot_accuracy fails only on a contradicted cited rule.
    const decisionFindingsResult = this.deps.recheckDecisions !== undefined ? await this.deps.recheckDecisions(bundle) : ok<DecisionFinding[]>([]);
    if (!decisionFindingsResult.ok) return decisionFindingsResult;
    // reason: one list — the deterministic re-check, the judge's objections and the criterion re-runs all land in
    // `decision_findings`; only a wrong-when-written one changes a verdict (`applyDecisionFindings`).
    const rerun = opts.rerunCriterion !== undefined ? await rerunCitingCriteria(judgedInputs, opts.rerunCriterion) : [];
    const decisionFindings = [...decisionFindingsResult.value, ...judged.value.findings, ...rerun];
    const judgment = judged.value.record;
    // reason: a wrong-when-written decision premise fails snapshot_accuracy AFTER the cited-rule rule so neither the judge
    // nor that rule can turn it back into a pass or an n/a (spec D5).
    // reason: the facts dimensions come from measured facts alone (spec D6, judgment layer): the judge was never asked
    // for them and an answer on one is stripped. Regression comes from the at-head rows (BR-1496); with none supplied
    // it is not-measured, never a pass inferred from the HEAD suite (no second attribution path).
    const factDims = factsDimensions(opts.facts, judged.value.record.ai_criteria);
    // reason: the wrong-when-written finding is deterministic, so it carries its own cites (decision, part, premise
    // source) and --file-issues can fingerprint it (#500); a judge-text failure keeps none and stays refused.
    const dimensions = withDecisionFindingCites(
      applyDecisionFindings(
        applySnapshotRule(
          applyDeterministicDimensionRules(mergeDimensions(judged.value.dimensions, factDims)),
          citedRulesResult.value,
        ),
        decisionFindings,
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
      opts.facts?.regression_files ?? [],
      citedRulesResult.value,
    );
    const review: MilestoneReview = {
      plan_id: bundle.plan.id,
      ...(retiredResult.value.length > 0 ? { retired_acs: retiredResult.value } : {}),
      fingerprint: planStateFingerprint(bundle.plan, bundle.tasks, bundle.spec),
      ...(causes !== undefined ? { causes } : {}),
      ...(opts.facts?.assessed_commit !== undefined ? { assessed_commit: opts.facts.assessed_commit } : {}),
      ...(opts.facts?.criteria_run !== undefined ? { criteria_run: opts.facts.criteria_run } : {}),
      ...(opts.facts?.failing_fact_files !== undefined && opts.facts.failing_fact_files.length > 0 ? { failing_fact_files: [...new Set(opts.facts.failing_fact_files)].sort() } : {}),
      ...(opts.facts?.regression_causes !== undefined && opts.facts.regression_causes.length > 0 ? { regression_causes: [...new Set(opts.facts.regression_causes)].sort() } : {}),
      overall: overallMilestoneVerdict(dimensions),
      dimensions,
      decisions,
      ...(decisionFindings.length > 0 ? { decision_findings: decisionFindings } : {}),
      judgment,
      prompt_version: MILESTONE_REVIEW_PROMPT_VERSION,
      facts_fingerprint: factsFingerprintOf(opts.facts, citedRulesResult.value),
      diff_source: opts.diffSource,
    };

    // reason: BR-1528 — created structured through the `knowledge/milestone-review` template (body rendered from the
    // fields); `extra.milestone_review` stays the typed review plan close reads.
    const created = await this.deps.createReviewDoc(
      withGeneratedFields(
        {
          type: "knowledge",
          title: `Milestone review: ${bundle.plan.title}`,
          parent_id: bundle.plan.id,
          extra: { sub_type: MILESTONE_REVIEW_SUB_TYPE, milestone_review: review },
        },
        milestoneReviewFields(bundle.plan.slug, review),
      ),
    );
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

  /** The judge port with cost: the measured one when wired, else `judge` timed here (tokens unknown, never 0). */
  private judgePort(): JudgePort {
    const measured = this.deps.judgeMeasured;
    if (measured !== undefined) return measured;
    return async (prompt, title) => {
      const started = performance.now();
      const raw = await this.deps.judge(prompt, title);
      return raw.ok ? ok({ text: raw.value, duration_ms: Math.round(performance.now() - started) }) : raw;
    };
  }
}
