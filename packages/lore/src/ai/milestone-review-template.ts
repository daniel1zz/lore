/**
 * Milestone review prompt: the one prompt `lore assess` sends the judge for a plan (BR-1372).
 *
 * Purpose: render the plan's landed diff, documents, attested task evidence, cited-rule state and the milestone
 *   decisions into a seven-dimension review request whose answer parses with `llmMilestoneOutputSchema`.
 * Public surface: MILESTONE_REVIEW_PROMPT_VERSION, MilestoneReviewPromptInput, buildMilestoneReviewPrompt.
 * Invariants:
 *   - The prompt names all seven dimensions from `MILESTONE_DIMENSIONS` (the single list), never a restated copy.
 *   - A diff over `maxDiffChars` is cut by file (`truncateDiffByFile`), and the prompt says so: a judge told nothing
 *     about a cut would read a partial diff as a complete one.
 *   - A diff that is absent is said to be absent, with the reason; the judge is told to judge from the documents.
 * Side-effect class: pure.
 *
 * Reference: Kayenta automated canary analysis (several metrics judged separately; promotion needs all to pass) and
 * Google's engineering code review guide (the dimensions of a review). Source: spec-lean-governance-batch-verbs-
 * judgment-only-at-milestones Part D; adr-ai-decision-standard-four-checks-references-from-excellent.
 */

import { MILESTONE_DIMENSIONS, type MilestoneDecisionRef } from "@lore/core";
import { truncateDiffByFile } from "./diff-truncation.js";
import type { CitedRuleStateRow } from "../service/milestone-review.js";

/** Stamped on every stored review (`prompt_version`). */
export const MILESTONE_REVIEW_PROMPT_VERSION = "milestone-4";

/** One task's evidence row as the judge sees it. */
export interface MilestoneEvidenceLine {
  readonly oracle: string;
  readonly command: string;
  readonly result: string;
  /** True when a trusted runner produced the row (`attestation` present). */
  readonly attested: boolean;
  readonly ac_ref?: string;
}

/** One task of the plan as the judge sees it. */
export interface MilestoneTaskInput {
  readonly slug: string;
  readonly title: string;
  readonly status: string;
  readonly content: string;
  readonly evidence: readonly MilestoneEvidenceLine[];
}

/** Everything the prompt renders. */
export interface MilestoneReviewPromptInput {
  readonly plan: { readonly slug: string; readonly title: string; readonly content: string };
  readonly spec?: { readonly slug: string; readonly title: string; readonly content: string };
  readonly tasks: readonly MilestoneTaskInput[];
  readonly citedRules: readonly CitedRuleStateRow[];
  readonly decisions: readonly MilestoneDecisionRef[];
  /** The plan's landed diff, or `undefined` when none could be derived. */
  readonly diffText?: string;
  /** Human-readable account of how the diff was obtained (or why it is absent). */
  readonly diffSource: string;
  readonly maxDiffChars: number;
  /** The batch's full-suite run as it concerns this plan (`renderSuiteSection`); absent = a bare prompt build. */
  readonly suiteSection?: string;
}

const DIMENSION_GUIDE: Readonly<Record<(typeof MILESTONE_DIMENSIONS)[number], string>> = {
  correctness_vs_acs:
    "Does the landed work satisfy every acceptance criterion the plan claims? Read the attested evidence below; a pass " +
    "that no trusted runner produced is a self-report. List any milestone decisions below here: each is an override " +
    "that was applied and is waiting for this review.",
  spec_conformance: "Does the landed work do what the spec and plan say, no less and no more?",
  regression: "Did the change break behaviour that existed before it? Name the behaviour at risk and what covers it. Read the " +
    "full-suite section below: it is one run on main for the whole batch; a failing file counts against this plan only " +
    "when the section attributes it to this plan.",
  design_necessity:
    "Is each technical choice needed? For EVERY technical choice name the external product or practice it follows in " +
    "`reference` (for example: Kayenta canary analysis, Postgres MVCC, the Google code review guide). A choice with no " +
    "external reference you can name is a fail.",
  snapshot_accuracy:
    "Do the documents describe what the code now does? Read the cited-rule state below: fail ONLY for a rule whose " +
    "state is contradicted (a failing run of its citing criterion, so the document and the code disagree). A stale " +
    "rule only means a code anchor changed since its last attested pass; stale evidence was re-verified before this " +
    "review, so a rule still shown stale, and an unknown (no code anchor, dirty tree, no recorded commit) or " +
    "unverified rule, is na, never a fail.",
  concurrency_safety: "Can two sessions, writers or processes doing this at once corrupt state or lose a write?",
  security: "Does the change open a path for untrusted input, leaked credentials or an unchecked privilege?",
};

function renderEvidence(lines: readonly MilestoneEvidenceLine[]): string {
  if (lines.length === 0) return "  (no evidence recorded)";
  return lines
    .map(
      (e) =>
        `  - [${e.attested ? "attested" : "self-reported"}] ${e.oracle} ${e.result}: ${e.command}` +
        (e.ac_ref !== undefined ? ` (ac ${e.ac_ref})` : ""),
    )
    .join("\n");
}

function renderDiff(input: MilestoneReviewPromptInput): string {
  if (input.diffText === undefined || input.diffText.length === 0) {
    return `No diff is available (${input.diffSource}). Judge from the documents and evidence, and say so in the reasons that depend on code.`;
  }
  if (input.diffText.length <= input.maxDiffChars) return `Source: ${input.diffSource}\n\n${input.diffText}`;
  const cut = truncateDiffByFile(input.diffText, input.maxDiffChars);
  return (
    `Source: ${input.diffSource}\nThe diff is ${input.diffText.length} characters and was cut by file to fit ` +
    `${input.maxDiffChars}; files not shown were not reviewed.\n\n${cut.text}`
  );
}

/**
 * Builds the milestone review prompt.
 *
 * @param input - the plan, spec, tasks with evidence, cited-rule state, milestone decisions and diff
 * @returns the prompt text; the judge answers with one JSON object `{"dimensions": {<dimension>: {verdict, reason, reference, cites}}}`
 * @example
 * buildMilestoneReviewPrompt({ plan, tasks: [], citedRules: [], decisions: [], diffSource: "none", maxDiffChars: 24000 });
 */
export function buildMilestoneReviewPrompt(input: MilestoneReviewPromptInput): string {
  const dims = MILESTONE_DIMENSIONS.map((d) => `- ${d}: ${DIMENSION_GUIDE[d]}`).join("\n");
  const tasks = input.tasks
    .map((t) => `## Task ${t.slug} (${t.status}): ${t.title}\n${t.content}\nEvidence:\n${renderEvidence(t.evidence)}`)
    .join("\n\n");
  const rules =
    input.citedRules.length === 0
      ? "No rule is cited by the plan's spec."
      : input.citedRules
          .map((r) => `- ${r.rule_id}: ${r.state}${r.unknown_reason !== undefined ? ` (${r.unknown_reason})` : ""}`)
          .join("\n");
  const decisions =
    input.decisions.length === 0
      ? "None."
      : input.decisions.map((d) => `- ${d.class} on ${d.document}: ${d.summary}`).join("\n");
  const spec = input.spec === undefined ? "The plan has no spec." : `# Spec ${input.spec.slug}: ${input.spec.title}\n${input.spec.content}`;
  return [
    "You are the milestone reviewer for a finished plan. Judge it on seven dimensions, each separately.",
    "For each dimension give a verdict (pass, fail or na), a reason that cites what you saw, and a reference.",
    "For every dimension you fail (except regression and snapshot_accuracy, which are measured) also give `cites`: a non-empty",
    "list of the stable things the finding is about: acceptance-criterion ids, rule ids, file paths or symbols. Use the same",
    "cite for the same defect on every review; cites identify the defect, so never put prose or wording in them.",
    "Overall the plan passes only if no dimension fails. Use na only when the dimension cannot apply.",
    "",
    "# Dimensions",
    dims,
    "",
    "# Output",
    'Reply with ONE JSON object and nothing else: {"dimensions": {' +
      MILESTONE_DIMENSIONS.map((d) => `"${d}": {"verdict": "pass|fail|na", "reason": "...", "reference": "...", "cites": ["..."]}`).join(", ") +
      "}}",
    "",
    `# Plan ${input.plan.slug}: ${input.plan.title}`,
    input.plan.content,
    "",
    spec,
    "",
    "# Tasks and attested evidence",
    tasks.length === 0 ? "(no tasks)" : tasks,
    "",
    "# Cited rule state",
    rules,
    "",
    "# Full-suite run on main (regression input)",
    input.suiteSection ?? "No full-suite run was supplied for this review.",
    "",
    "# Milestone decisions awaiting this review",
    decisions,
    "",
    "# Landed diff",
    renderDiff(input),
  ].join("\n");
}
