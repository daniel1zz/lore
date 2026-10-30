/**
 * Milestone review prompt: the judgment-layer prompt `lore assess` sends the judge for a plan (BR-1372, BR-1499).
 *
 * Purpose: render the plan's documents, facts table and landed diff (or a chunk of it) into a request that asks ONLY
 *   what no tool measures: spec_conformance, design_necessity, concurrency_safety, security, and one verdict per
 *   AI-mode criterion. The facts dimensions (correctness_vs_acs, regression, snapshot_accuracy) are never asked.
 * Public surface: MILESTONE_REVIEW_PROMPT_VERSION, MilestoneReviewPromptInput, MilestonePromptMode,
 *   buildMilestoneReviewPrompt, askedDimensionsOf, JudgedDecisionInput, judgedDecisionsAnswerSchema,
 *   MilestoneEvidenceLine, MilestoneTaskInput, DiffChunkSummary.
 * Invariants:
 *   - The asked dimensions come from `JUDGED_DIMENSIONS` (the single list) filtered by the call's mode; the prompt
 *     never names a facts dimension as something to judge, and says the facts table may be cited, never overruled.
 *   - This builder NEVER cuts the diff: the service chunks by file within the budget (BR-1499), so a diff given here is
 *     shown whole. A file that no call shows is named in the prompt as not seen.
 *   - A diff that is absent is said to be absent, with the reason.
 *   - The recorded decisions are a section of their own; the judge answers them in a top-level `decisions` array, and
 *     only in a mode that asks them (full, summary) and only when the section lists some.
 * Side-effect class: pure.
 *
 * Reference: Kayenta automated canary analysis (several metrics judged separately; promotion needs all to pass) and
 * Google's engineering code review guide (the dimensions of a review). Source: spec-the-milestone-review-measures-its-
 * facts-per-landing-and (Judgment layer, D6); adr-ai-decision-standard-four-checks-references-from-excellent.
 */

import { z } from "zod";
import { JUDGED_DIMENSIONS, type JudgedDimension, type MilestoneDecisionRef, type MilestoneFacts } from "@lore/core";
import type { CitedRuleStateRow } from "../service/milestone-review.js";

/** Stamped on every stored review (`prompt_version`). milestone-6: judgment layer only, facts table, file chunks. */
export const MILESTONE_REVIEW_PROMPT_VERSION = "milestone-6";

/**
 * Which call this prompt is. `full`: every judged dimension on the whole diff (one call). `chunk`: security and
 * concurrency_safety on one file chunk. `summary`: spec_conformance, design_necessity and the AI-mode criteria on the
 * full file list plus chunk summaries (the diff itself did not fit one call).
 */
export type MilestonePromptMode = "full" | "chunk" | "summary";

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

/** One decision the judge re-reads: what its write said it rested on, what it passed over, and a rule rewording's two statements. */
export interface JudgedDecisionInput {
  /** `<slug>@<version>` of the version row that recorded it. */
  readonly address: string;
  readonly reason: string;
  /** One entry per premise, in recorded order; `evidence` is the stored quote (file) or the source as recorded. */
  readonly premises: readonly { readonly claim: string; readonly tier: string; readonly evidence: string }[];
  readonly alternatives: readonly { readonly option: string; readonly why_rejected: string }[];
  /** A `rule set` statement change: the rule, the statement replaced and the statement now. */
  readonly rule?: { readonly id: string; readonly before: string; readonly after: string };
  /** `before` was recorded but no rule of the document carries that statement as its prior one. */
  readonly unlocatedBefore?: string;
  /** Live criteria that cite `rule` (empty without a rule); re-run by the milestone after a statement change. */
  readonly citing: readonly { readonly spec: string; readonly ac: string }[];
}

/** One decision's answer: `premises_supported` has one entry per premise; `meaning_unchanged` is required for a rule rewording. */
export const judgedDecisionAnswerSchema = z.object({
  decision: z.string().min(1),
  premises_supported: z.array(z.boolean()),
  meaning_unchanged: z.boolean().nullish(),
  better_option: z.string().nullish(),
  reason: z.string().nullish(),
});
export const judgedDecisionsAnswerSchema = z.array(judgedDecisionAnswerSchema);

/** What one file chunk contains, for the summary call (deterministic counts, no AI). */
export interface DiffChunkSummary {
  readonly index: number;
  readonly files: readonly { readonly path: string; readonly added: number; readonly removed: number }[];
}

/** Everything the prompt renders. */
export interface MilestoneReviewPromptInput {
  readonly mode: MilestonePromptMode;
  readonly plan: { readonly slug: string; readonly title: string; readonly content: string };
  readonly spec?: { readonly slug: string; readonly title: string; readonly content: string };
  readonly tasks: readonly MilestoneTaskInput[];
  readonly citedRules: readonly CitedRuleStateRow[];
  readonly decisions: readonly MilestoneDecisionRef[];
  /** The measured facts table; absent parts render as "not measured". */
  readonly facts?: MilestoneFacts;
  /** The plan's recorded decisions to judge (spec D6); absent or empty = none to judge. */
  readonly recordedDecisions?: readonly JudgedDecisionInput[];
  /** The diff this call shows (whole diff in `full`, one chunk in `chunk`); `undefined` in `summary` or when none could be derived. */
  readonly diffText?: string;
  /** Human-readable account of how the diff was obtained (or why it is absent). */
  readonly diffSource: string;
  /** Every file of the plan's diff (summary mode lists them all). */
  readonly allFiles?: readonly string[];
  /** Chunk summaries (summary mode). */
  readonly chunkSummaries?: readonly DiffChunkSummary[];
  /** Files no call shows the judge (listed in every mode that names the diff). */
  readonly unseenFiles?: readonly string[];
  /** The batch's full-suite run as it concerns this plan (`renderSuiteSection`); absent = a bare prompt build. */
  readonly suiteSection?: string;
}

const DIMENSION_GUIDE: Readonly<Record<JudgedDimension, string>> = {
  spec_conformance:
    "Does the landed work do what the spec and plan say, no less and no more? The facts table lists files landings " +
    "touched outside their task's anchors: a helper may legitimately sit outside, but a file that adds behaviour the " +
    "spec does not ask for is a fail.",
  design_necessity:
    "Is each technical choice needed? For EVERY technical choice name the external product or practice it follows in " +
    "`reference` (for example: Kayenta canary analysis, Postgres MVCC, the Google code review guide). A choice with no " +
    "external reference you can name is a fail.",
  concurrency_safety: "Can two sessions, writers or processes doing this at once corrupt state or lose a write?",
  security: "Does the change open a path for untrusted input, leaked credentials or an unchecked privilege?",
};

/**
 * The judged dimensions a call of `mode` asks.
 *
 * @param mode - the call's mode
 * @returns `full`: all four; `chunk`: concurrency_safety and security; `summary`: spec_conformance and design_necessity
 */
export function askedDimensionsOf(mode: MilestonePromptMode): readonly JudgedDimension[] {
  const chunkOnly: readonly JudgedDimension[] = ["concurrency_safety", "security"];
  if (mode === "full") return JUDGED_DIMENSIONS;
  if (mode === "chunk") return JUDGED_DIMENSIONS.filter((d) => chunkOnly.includes(d));
  return JUDGED_DIMENSIONS.filter((d) => !chunkOnly.includes(d));
}

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

function renderRecordedDecision(d: JudgedDecisionInput): string {
  const premises = d.premises.map((p, i) => `  premise ${String(i + 1)} [tier ${p.tier}]: ${p.claim}\n    source: ${p.evidence}`).join("\n");
  const alternatives = d.alternatives.map((a) => `  - ${a.option} (rejected: ${a.why_rejected})`).join("\n");
  const rule =
    d.rule === undefined
      ? ""
      : `\n  rule ${d.rule.id} reworded.\n    old statement: ${d.rule.before}\n    new statement: ${d.rule.after}`;
  return `## ${d.address}\n  reason: ${d.reason}\n${premises.length > 0 ? premises : "  (no premises)"}\n  alternatives passed over:\n${alternatives.length > 0 ? alternatives : "  (none)"}${rule}`;
}

function renderRecordedDecisions(input: MilestoneReviewPromptInput): string {
  const listed = input.recordedDecisions ?? [];
  if (listed.length === 0) return "None.";
  return [
    "Judge each decision below. For each: is every premise supported by the source quoted for it (not merely related to it)?",
    "For a rule rewording: is the meaning unchanged? Is there an alternative, or an option not listed, that was clearly better?",
    "",
    listed.map(renderRecordedDecision).join("\n\n"),
  ].join("\n");
}

function renderFactRows(title: string, rows: readonly { subject: string; verdict: string; detail: string }[] | undefined): string[] {
  if (rows === undefined) return [`${title}: not measured (no result was supplied).`];
  if (rows.length === 0) return [`${title}: none.`];
  return [`${title}:`, "| Subject | Verdict | Detail |", "|---|---|---|", ...rows.map((r) => `| ${r.subject} | ${r.verdict} | ${r.detail.replace(/\|/g, "/")} |`)];
}

/** The facts table: criteria attestation, regression per landing, outside-anchor files with their landings, cited-rule state. */
function renderFacts(input: MilestoneReviewPromptInput): string {
  const facts = input.facts;
  const outside =
    facts?.outside_anchors === undefined
      ? ["Files outside their task's anchors: not measured (no per-landing diff was supplied)."]
      : facts.outside_anchors.every((o) => o.files.length === 0)
        ? ["Files outside their task's anchors: none."]
        : [
            "Files outside their task's anchors (landing -> files):",
            ...facts.outside_anchors.filter((o) => o.files.length > 0).map((o) => `- ${o.landing}: ${o.files.join(", ")}`),
          ];
  const rules =
    input.citedRules.length === 0
      ? ["Cited rule state: no rule is cited by the plan's spec."]
      : [
          "Cited rule state:",
          ...input.citedRules.map((r) => `- ${r.rule_id}: ${r.state}${r.unknown_reason !== undefined ? ` (${r.unknown_reason})` : ""}`),
        ];
  const unlanded = facts?.unlanded_tasks !== undefined && facts.unlanded_tasks.length > 0 ? [`Tasks with no landing yet: ${facts.unlanded_tasks.join(", ")}.`] : [];
  return [
    "These facts were measured by tools. You may cite them; you may never overrule them, and you give no verdict on them.",
    "",
    ...renderFactRows("Criteria attestation", facts?.attestation),
    "",
    ...renderFactRows("Regression per landing", facts?.regression),
    "",
    ...outside,
    "",
    ...rules,
    ...unlanded,
    "",
    input.suiteSection ?? "No full-suite run was supplied for this review.",
  ].join("\n");
}

function renderUnseen(unseen: readonly string[] | undefined): string {
  if (unseen === undefined || unseen.length === 0) return "";
  return `\nFiles NOT shown to any call (too large for one call, or their landing could not be mapped to main; they are not reviewed): ${unseen.join(", ")}.`;
}

function renderDiffSection(input: MilestoneReviewPromptInput): string {
  if (input.mode === "summary") {
    const files = input.allFiles ?? [];
    const summaries = (input.chunkSummaries ?? [])
      .map((c) => `- chunk ${String(c.index + 1)}: ${c.files.map((f) => `${f.path} (+${String(f.added)} -${String(f.removed)})`).join(", ")}`)
      .join("\n");
    return (
      `Source: ${input.diffSource}\nThe diff is too large for one call, so its text is not shown here: security and concurrency_safety were ` +
      `judged per file chunk. Judge from the full file list and the chunk summaries.\n\nAll files (${String(files.length)}): ${files.join(", ")}\n\n` +
      `Chunk summaries:\n${summaries.length > 0 ? summaries : "(none)"}${renderUnseen(input.unseenFiles)}`
    );
  }
  if (input.diffText === undefined || input.diffText.length === 0) {
    return `No diff is available (${input.diffSource}). Judge from the documents and evidence, and say so in the reasons that depend on code.`;
  }
  const label = input.mode === "chunk" ? "This is ONE file chunk of a larger diff; judge only what it shows." : "";
  return `Source: ${input.diffSource}\n${label}${renderUnseen(input.unseenFiles)}\n\n${input.diffText}`;
}

function renderCriteria(input: MilestoneReviewPromptInput): string {
  const criteria = input.facts?.ai_criteria ?? [];
  if (criteria.length === 0) return "None.";
  return [
    "Give ONE verdict (pass or fail) and a reason for each criterion below, judged against its rubric, in `criteria`.",
    "",
    criteria.map((c) => `## ${c.spec}:${c.ac}\n  rubric: ${c.rubric}`).join("\n\n"),
  ].join("\n");
}

/**
 * Builds the milestone judgment prompt.
 *
 * @param input - the call's mode, the plan, spec, tasks with evidence, facts table, milestone decisions and diff (or chunk)
 * @returns the prompt text; the judge answers with one JSON object `{"dimensions": {<asked dimension>: {verdict, reason, reference, cites}}}`
 *   plus `criteria` and `decisions` where the mode asks them
 * @example
 * buildMilestoneReviewPrompt({ mode: "full", plan, tasks: [], citedRules: [], decisions: [], diffSource: "none" });
 */
export function buildMilestoneReviewPrompt(input: MilestoneReviewPromptInput): string {
  const asked = askedDimensionsOf(input.mode);
  const dims = asked.map((d) => `- ${d}: ${DIMENSION_GUIDE[d]}`).join("\n");
  const asksCriteria = input.mode !== "chunk" && (input.facts?.ai_criteria ?? []).length > 0;
  const asksDecisions = input.mode !== "chunk" && (input.recordedDecisions ?? []).length > 0;
  const tasks = input.tasks
    .map((t) => `## Task ${t.slug} (${t.status}): ${t.title}\n${t.content}\nEvidence:\n${renderEvidence(t.evidence)}`)
    .join("\n\n");
  const decisions =
    input.decisions.length === 0
      ? "None."
      : input.decisions.map((d) => `- ${d.class} on ${d.document}: ${d.summary}`).join("\n");
  const spec = input.spec === undefined ? "The plan has no spec." : `# Spec ${input.spec.slug}: ${input.spec.title}\n${input.spec.content}`;
  const shape =
    '{"dimensions": {' +
    asked.map((d) => `"${d}": {"verdict": "pass|fail|na", "reason": "...", "reference": "...", "cites": ["..."]}`).join(", ") +
    "}" +
    (asksCriteria ? ', "criteria": [{"spec": "<spec slug>", "ac": "<AC id>", "verdict": "pass|fail", "reason": "..."}]' : "") +
    (asksDecisions
      ? ', "decisions": [{"decision": "<slug@version>", "premises_supported": [true|false per premise, in order], ' +
        '"meaning_unchanged": true|false (rule rewordings only), "better_option": "<option>" (only when one was clearly better), "reason": "..."}]'
      : "") +
    "}";
  const head = [
    `You are the milestone reviewer for a finished plan. Judge ONLY the dimensions listed below, each separately: ${asked.join(", ")}.`,
    "Everything else (criteria attestation, regression, cited-rule state) was measured by tools and appears in the facts table; do not judge it.",
    "For each dimension give a verdict (pass, fail or na), a reason that cites what you saw, and a reference.",
    "For every dimension you fail also give `cites`: a non-empty list of the stable things the finding is about: acceptance-criterion",
    "ids, rule ids, file paths or symbols. Use the same cite for the same defect on every review; cites identify the defect, so never put prose in them.",
    "Use na only when the dimension cannot apply. Never answer for something you were not shown.",
    "",
    "# Dimensions",
    dims,
    "",
    "# Output",
    `Reply with ONE JSON object and nothing else: ${shape}`,
    "",
    `# Plan ${input.plan.slug}: ${input.plan.title}`,
    input.plan.content,
    "",
    spec,
    "",
  ];
  if (input.mode === "chunk") {
    return [...head, "# Facts table", renderFacts(input), "", "# Diff chunk", renderDiffSection(input)].join("\n");
  }
  return [
    ...head,
    "# Tasks and attested evidence",
    tasks.length === 0 ? "(no tasks)" : tasks,
    "",
    "# Facts table",
    renderFacts(input),
    "",
    "# AI-mode criteria (judge each against its rubric)",
    renderCriteria(input),
    "",
    "# Milestone decisions awaiting this review",
    decisions,
    "",
    "# Recorded decisions (judge each; answer in `decisions`)",
    renderRecordedDecisions(input),
    "",
    "# Final state of each changed file (net diff across the plan's landings)",
    renderDiffSection(input),
  ].join("\n");
}
