/**
 * Generated documents' structured content: the `extra.fields` and `extra.dimensions` an internal creator writes.
 *
 * Purpose: every document a command generates (handoff, UAT verdict, milestone review, ad-hoc re-verification task,
 *   baseline fidelity record) is created structured through its shipped seed template (BR-1528), never as a free body.
 *   Each builder here maps the generator's own typed data onto the seed template's fields and answers the template's
 *   dimensions from facts the generator holds. The body is then rendered by the write path from these fields.
 * Public surface: {@link GeneratedFields}, {@link handoffFields}, {@link uatFields}, {@link milestoneReviewFields},
 *   {@link adhocVerifyTaskFields}, {@link fidelityResearchFields}, {@link withGeneratedFields}.
 * Invariants:
 *   - Pure: no IO, no clock. The result is validated by `CorpusService.create` against the corpus's approved template
 *     (never here), so a template the corpus revised past the seed refuses the create loudly; nothing is patched up.
 *   - Field and dimension ids are the v1 shipped seeds' (`assets/templates/*.json`); `generated-fields.test.ts` proves each
 *     builder's output validates against the seed it names, so a seed rename fails a test, not a user.
 *   - A fact the generator does not hold is written as an explicit statement that it is not recorded, never as an
 *     invented value (the dimension answers say what the payload carried).
 * Side-effect class: pure.
 */

import {
  MILESTONE_DIMENSIONS,
  type CreateDocInput,
  type DimensionAnswer,
  type HandoffExtra,
  type MilestoneReview,
  type UatVerdict,
} from "@lore/core";
import type { FidelityRecord } from "./fidelity-sample.js";

/** The structured content of one generated document. */
export interface GeneratedFields {
  readonly fields: Record<string, unknown>;
  readonly dimensions: DimensionAnswer[];
}

/**
 * Attach generated fields to a create input: `extra.fields` + `extra.dimensions`, no body (the body is rendered).
 *
 * @param input - the create input WITHOUT `content`
 * @param generated - the builder's output
 * @returns the input carrying the structured content in `extra`
 */
export function withGeneratedFields(input: Omit<CreateDocInput, "content">, generated: GeneratedFields): CreateDocInput {
  return { ...input, extra: { ...(input.extra ?? {}), fields: generated.fields, dimensions: generated.dimensions } };
}

function answer(id: string, status: "handled" | "na", text: string, refs: string[] = []): DimensionAnswer {
  return { id, status, answer: text, refs };
}

/** A handoff decision's confidence band (the payload's 0-100 integer, or absent) as the template's enum. */
function confidenceBand(confidence: number | undefined): "established" | "observed" | "unconfirmed" {
  if (confidence === undefined) return "unconfirmed";
  if (confidence >= 90) return "established";
  if (confidence >= 70) return "observed";
  return "unconfirmed";
}

/** One change source of a handoff's changed-file entry (derived: the core barrel does not export the session-trail type). */
type ChangeSource = NonNullable<HandoffExtra["changed_files"]>[number]["sources"][number];

function changeSourceLabel(source: ChangeSource): string {
  switch (source.kind) {
    case "run":
      return `run ${source.run}`;
    case "vcs":
      return "vcs";
    case "unknown":
      return "source unknown";
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

/**
 * The handoff's changed-file view as `modified_files` lines, so the trail-derived facts the text always carried survive the
 * move to a rendered body: one line per path with its change sources, the overflow groups, and a "not measured" line when
 * there was no trail. A payload with no merged view lists the author's own `modified_files`.
 */
function changedFileLines(handoff: HandoffExtra): string[] {
  const files = handoff.changed_files;
  if (files === undefined && handoff.changed_files_measured === undefined) return [...handoff.modified_files];
  const lines: string[] = [];
  if (handoff.changed_files_measured === false) {
    const why = (handoff.trail_gaps ?? []).find((gap) => gap.kind === "unmeasured" && gap.subject === "trail");
    lines.push(`changed files: not measured${why !== undefined ? ` (${why.detail})` : ""}`);
  }
  for (const file of files ?? []) {
    const runs = file.run_count ?? file.sources.filter((source) => source.kind === "run").length;
    const labels: string[] = [];
    if (runs > 0) labels.push(`${String(runs)} ${runs === 1 ? "run" : "runs"}`);
    for (const source of file.sources) if (source.kind !== "run") labels.push(changeSourceLabel(source));
    if (file.named_by_author) labels.push("named by author");
    lines.push(`${file.path} (${labels.join("; ")})`);
  }
  for (const group of handoff.changed_files_overflow ?? []) lines.push(`${group.dir}/ (${String(group.files)} files, grouped by top-level directory)`);
  return lines;
}

/** Trail parts the handoff could not list (removed, unmeasured), as non-blocking open threads: never shown as "no change". */
function trailGapThreads(handoff: HandoffExtra): { thread: string; blocking: boolean }[] {
  return (handoff.trail_gaps ?? [])
    .filter((gap) => !(gap.kind === "unmeasured" && gap.subject === "trail"))
    .map((gap) => ({
      thread: `${gap.kind === "removed" ? "removed" : "not measured"}: ${gap.count !== undefined && gap.count > 1 ? `${String(gap.count)} x ` : ""}${gap.subject} — ${gap.detail}`,
      blocking: false,
    }));
}

/**
 * Template `knowledge/handoff` fields from a validated handoff payload.
 *
 * @param handoff - the handoff payload (`extra.handoff`)
 * @returns fields and dimension answers for `knowledge-handoff-template`
 */
export function handoffFields(handoff: HandoffExtra): GeneratedFields {
  const summary =
    `Handoff by ${handoff.by}` +
    `${handoff.plan_ref !== undefined ? ` on ${handoff.plan_ref}` : ""}: ${String(handoff.key_decisions.length)} decision(s), ` +
    `${String(handoff.modified_files.length)} modified file(s), ${String(handoff.next_steps.length)} next step(s)` +
    `${handoff.degraded === true ? " (degraded git-only capture)" : ""}.`;
  const fields: Record<string, unknown> = {
    summary,
    ...(handoff.plan_ref !== undefined ? { plan_ref: handoff.plan_ref } : {}),
    ...(handoff.task_refs.length > 0 ? { task_refs: handoff.task_refs } : {}),
    decisions: handoff.key_decisions.map((decision) => ({
      decision: decision.judgment,
      why: "not recorded (the handoff payload carries the judgment only)",
      confidence: confidenceBand(decision.confidence),
    })),
    ...(handoff.failing_oracle !== undefined
      ? { failing_oracle: { command: handoff.failing_oracle.command, summary: handoff.failing_oracle.output_tail === "" ? "no output recorded" : handoff.failing_oracle.output_tail } }
      : {}),
    ...(changedFileLines(handoff).length > 0 ? { modified_files: changedFileLines(handoff) } : {}),
    ...(trailGapThreads(handoff).length > 0 ? { open_threads: trailGapThreads(handoff) } : {}),
    next_steps: handoff.next_steps,
  };
  return {
    fields,
    dimensions: [
      answer("resume-point", "handled", `First action on resuming: ${handoff.next_steps[0] ?? ""}`),
      answer("unrecorded-state", "na", "The handoff payload is the whole record: the caller supplied no state outside it."),
    ],
  };
}

/**
 * Template `knowledge/uat` fields from a validated verdict.
 *
 * @param planSlug - the plan the verdict accepts or rejects (the subject)
 * @param verdict - the UAT verdict payload (`extra.uat`)
 * @returns fields and dimension answers for `knowledge-uat-template`
 */
export function uatFields(planSlug: string, verdict: UatVerdict): GeneratedFields {
  const unverified = verdict.tier_results.reduce((total, tier) => total + tier.unverified, 0);
  const coverage = verdict.requirement_coverage;
  return {
    fields: {
      subject_ref: planSlug,
      verdict: verdict.verdict,
      tier_results: verdict.tier_results,
      requirement_coverage: coverage,
      uiux: verdict.uiux,
    },
    dimensions: [
      answer(
        "p0-coverage",
        "handled",
        `${String(coverage.covered)} of ${String(coverage.total)} requirements covered; uncovered P0: ${coverage.uncovered_p0.length === 0 ? "none" : coverage.uncovered_p0.join(", ")}.`,
      ),
      unverified === 0
        ? answer("unverified", "na", "No journey was left unverified in any tier.")
        : answer("unverified", "handled", `${String(unverified)} journey(s) unverified across tiers: ${verdict.tier_results.map((tier) => `${tier.tier} ${String(tier.unverified)}`).join(", ")}.`),
    ],
  };
}

/** Template dimension ids of `knowledge/milestone-review`, keyed by the review's dimension names. */
const MILESTONE_DIMENSION_IDS: Record<(typeof MILESTONE_DIMENSIONS)[number], string> = {
  correctness_vs_acs: "correctness-vs-acs",
  spec_conformance: "spec-conformance",
  regression: "regression",
  design_necessity: "design-necessity",
  snapshot_accuracy: "snapshot-accuracy",
  concurrency_safety: "concurrency-safety",
  security: "security",
};

/**
 * Template `knowledge/milestone-review` fields from a stored review.
 *
 * @param planSlug - the reviewed plan
 * @param review - the review (`extra.milestone_review`)
 * @returns fields and one dimension answer per review dimension (its verdict and reason)
 */
export function milestoneReviewFields(planSlug: string, review: MilestoneReview): GeneratedFields {
  const findings = MILESTONE_DIMENSIONS.map((dimension) => {
    const judgment = review.dimensions[dimension];
    const measuredCites =
      dimension === "regression" ? review.causes?.regression_files : dimension === "snapshot_accuracy" ? review.causes?.contradicted_rules : undefined;
    const cites = judgment.cites !== undefined && judgment.cites.length > 0 ? judgment.cites : measuredCites;
    return {
      dimension,
      verdict: judgment.verdict,
      reason: judgment.reason,
      ...(judgment.reference !== "" ? { reference: judgment.reference } : {}),
      ...(judgment.verdict === "fail" && cites !== undefined && cites.length > 0
        ? { root_causes: [{ fingerprint: `${dimension}:${[...cites].sort().join("|")}`, cites: [...cites] }] }
        : {}),
    };
  });
  return {
    fields: {
      plan_ref: planSlug,
      // reason: the review carries the assessed commit only when the facts were measured; an unmeasured review says so.
      assessed_commit: review.assessed_commit ?? "not measured (the review recorded no assessed commit)",
      verdict: review.overall,
      findings,
      ...(review.causes?.regression_files !== undefined && review.causes.regression_files.length > 0 ? { regression_files: review.causes.regression_files } : {}),
    },
    dimensions: MILESTONE_DIMENSIONS.map((dimension) => {
      const judgment = review.dimensions[dimension];
      return answer(MILESTONE_DIMENSION_IDS[dimension], judgment.verdict === "na" ? "na" : "handled", `${judgment.verdict}: ${judgment.reason}`);
    }),
  };
}

/**
 * Template `task` fields for the ad-hoc task that re-verifies one criterion for a milestone review.
 *
 * @param input - the criterion and its spec
 * @returns fields and dimension answers for `task-template`
 */
export function adhocVerifyTaskFields(input: { readonly acId: string; readonly specSlug: string }): GeneratedFields {
  return {
    fields: {
      kind: "check",
      objective: `Re-verifies ${input.acId} of ${input.specSlug} for the milestone review.`,
      spec_ref: input.specSlug,
      ac_scope: [input.acId],
      anchors: [],
      done_condition: `The trusted runner records a result for ${input.acId} of ${input.specSlug}.`,
      red_waiver_reason: "A measurement of an existing criterion: it changes no product code, so no red run precedes it.",
    },
    dimensions: [
      answer("done-condition", "handled", `A runner-attested result row for ${input.acId} exists on this task.`),
      answer("red-first", "na", "A check task: it measures an existing criterion and changes no code."),
      answer("scope-boundary", "na", "The task declares no file anchors and writes no file."),
      answer("concurrency", "na", "The task holds no files, so no other claim overlaps it."),
      answer("rollback", "na", "Nothing is left behind except this task's evidence row."),
    ],
  };
}

/**
 * Template `knowledge/research` fields for a baseline fidelity sample record: every sampled item is one finding (tier A:
 * measured here), every catch-all rule one more.
 *
 * @param record - the sample's record
 * @returns fields and dimension answers for `knowledge-research-template`
 */
export function fidelityResearchFields(record: FidelityRecord): GeneratedFields {
  const share = `${(record.faithful_share * 100).toFixed(1)}% of ${String(record.size)} sampled citations judged faithful`;
  const source = `baseline fidelity sample, seed ${String(record.seed)}`;
  const findings = [
    ...record.verdicts.map((verdict) => ({
      claim: `${verdict.key}: ${verdict.verdict}${verdict.unseen_paths !== undefined ? ` (unread: ${verdict.unseen_paths.join(", ")})` : ""} - ${verdict.reason}`,
      source: `${source}, item ${String(verdict.n)}`,
      tier: "A",
    })),
    ...record.catch_all.map((rule) => ({
      claim: `rule ${rule.rule_id} is cited by ${String(rule.citing_criteria.length)} criteria (catch-all above ${String(record.threshold_share * 100)}%)`,
      source,
      tier: "A",
    })),
  ];
  return {
    fields: {
      question: "What share of the citations from acceptance criteria to baseline rules are faithful to the rule they cite?",
      method: `${record.mode} sample of ${String(record.size)} from a pool of ${String(record.pool)}, seed ${String(record.seed)}, ${String(record.judges)} judge(s); ` +
        "an item whose cited test file could not be read is not_seen and counts as neither faithful nor wrong",
      findings,
      ...(record.disagreements.length > 0 ? { counter_evidence: [`${String(record.disagreements.length)} item(s) where the two judges disagreed and were adjudicated`] } : {}),
      conclusion: `${share} (pool ${String(record.pool)}, ${String(record.judges)} judge(s), not_seen ${String(record.not_seen)})`,
      confidence: "observed",
      limits: "A sample, not a census; it is stale once any sampled criterion, rule or cited test changes.",
    },
    dimensions: [
      answer("evidence-tier", "handled", "Every finding is tier A: measured on this corpus by the sample run."),
      record.disagreements.length === 0
        ? answer("counter-evidence", "na", "Single judgment per item or both judges agreed on every item; no counter-evidence was produced.")
        : answer("counter-evidence", "handled", `${String(record.disagreements.length)} disagreement(s) between judges, each adjudicated.`),
      answer("freshness", "handled", "Measured now against the corpus's current citations; stale after any change to a sampled criterion, rule or cited test."),
    ],
  };
}
