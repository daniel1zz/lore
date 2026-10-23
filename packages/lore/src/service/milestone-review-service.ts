/**
 * MilestoneReviewService — the SOLE writer of a plan's milestone review (BR-1372), behind `lore assess`.
 *
 * Purpose: judge a plan on the seven dimensions from its landed diff, documents, attested task evidence, cited-rule
 *   state and the `milestone` decisions that belong to it; store the review with the plan-state fingerprint it judged.
 * Public surface: `MilestoneReviewService.review(planRef, opts)`, `MilestoneReviewDeps`, `MilestoneReviewResult`.
 * Invariants:
 *   - The judge never writes the fingerprint, the overall verdict or the decision list; this service computes them.
 *   - A judge answer that does not parse as all seven dimensions is retried ONCE with the parse error; a second
 *     failure is an AI error and NOTHING is stored (a half-formed review is never a review).
 *   - `design_necessity` without a reference is a fail whatever the judge said (`applyDeterministicDimensionRules`).
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
  type DocRecord,
  type LinkType,
  type LoreError,
  type MilestoneDecisionRef,
  type MilestoneReview,
  type PlanBundle,
  type Result,
} from "@lore/core";
import {
  buildMilestoneReviewPrompt,
  MILESTONE_REVIEW_PROMPT_VERSION,
  type MilestoneTaskInput,
} from "../ai/milestone-review-template.js";
import { decisionDetailSchema, type DecisionLogRow } from "../store/decision-log.js";
import { MILESTONE_REVIEW_SUB_TYPE, planStateFingerprint, type CitedRuleStateRow } from "./milestone-review.js";

/** The narrow ports this service needs; `app.ts` binds the real services into them. */
export interface MilestoneReviewDeps {
  readonly getPlanBundle: (planRef: string) => Promise<Result<PlanBundle, LoreError>>;
  readonly getCitedRuleStates: (spec: DocRecord) => Promise<Result<CitedRuleStateRow[], LoreError>>;
  /** Every decision-log row (`store.listDecisionLog()`); this service keeps the `milestone` ones. */
  readonly listDecisionLog: () => Promise<Result<DecisionLogRow[], LoreError>>;
  /** Sends `prompt` to the configured judge and returns its raw text. */
  readonly judge: (prompt: string, title: string) => Promise<Result<string, LoreError>>;
  readonly createReviewDoc: (input: CreateDocInput) => Promise<Result<DocRecord, LoreError>>;
  readonly link: (fromId: string, toId: string, type: LinkType) => Promise<Result<unknown, LoreError>>;
}

/** Per-run inputs the adapter measured. */
export interface MilestoneReviewOptions {
  /** The plan's landed diff; `undefined` when none could be derived. */
  readonly diffText?: string;
  /** How the diff was obtained, or why it is absent (stored on the review). */
  readonly diffSource: string;
  readonly maxDiffChars: number;
}

/** A stored review and its document. */
export interface MilestoneReviewResult {
  readonly doc: DocRecord;
  readonly review: MilestoneReview;
}

function aiError(message: string): LoreError {
  return { code: "AI_PROVIDER_ERROR", message, provider: "milestone-review" };
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
        ...(e.ac_ref !== undefined ? { ac_ref: e.ac_ref } : {}),
      })),
    }));
    const prompt = buildMilestoneReviewPrompt({
      plan: { slug: bundle.plan.slug, title: bundle.plan.title, content: bundle.plan.content },
      ...(bundle.spec !== undefined ? { spec: { slug: bundle.spec.slug, title: bundle.spec.title, content: bundle.spec.content } } : {}),
      tasks,
      citedRules: citedRulesResult.value,
      decisions,
      ...(opts.diffText !== undefined ? { diffText: opts.diffText } : {}),
      diffSource: opts.diffSource,
      maxDiffChars: opts.maxDiffChars,
    });

    const judged = await this.judgeWithRetry(prompt, bundle.plan.title);
    if (!judged.ok) return judged;
    const dimensions = applyDeterministicDimensionRules(judged.value.dimensions);
    const review: MilestoneReview = {
      plan_id: bundle.plan.id,
      fingerprint: planStateFingerprint(bundle.plan, bundle.tasks),
      overall: overallMilestoneVerdict(dimensions),
      dimensions,
      decisions,
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
  ): Promise<Result<ReturnType<typeof llmMilestoneOutputSchema.parse>, LoreError>> {
    let currentPrompt = prompt;
    let lastProblem = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = await this.deps.judge(currentPrompt, title);
      if (!raw.ok) return raw;
      const extracted = extractAssessmentJson(raw.value);
      if (extracted.ok) {
        const parsed = llmMilestoneOutputSchema.safeParse(extracted.value);
        if (parsed.success) return ok(parsed.data);
        lastProblem = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      } else {
        lastProblem = "message" in extracted.error ? extracted.error.message : extracted.error.code;
      }
      currentPrompt =
        `${prompt}\n\nYour previous answer was rejected: ${lastProblem}\n` +
        "Answer again with ONE JSON object containing all seven dimensions, each with verdict, reason and reference.";
    }
    return err(aiError(`the judge did not return a valid seven-dimension review after one retry: ${lastProblem}`));
  }
}
