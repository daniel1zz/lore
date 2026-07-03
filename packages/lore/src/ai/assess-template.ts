/**
 * Judge prompt builder for `lore assess` — LLM-as-judge plan-outcome assessment.
 * Owns the prompt text and ASSESS_PROMPT_VERSION (SPEC-026 §3 D8: prompt lives in
 * packages/lore/src/ai/, NOT core — core stays limited to schemas + pure data helpers).
 *
 * Public surface:
 *   - ASSESS_PROMPT_VERSION — bump whenever the prompt text or rubric changes materially
 *   - buildAssessPrompt(bundle, diffText, budgets) — assembles the initial judge prompt
 *   - buildAssessRetryPrompt(originalPrompt, parseErrorMessage) — one corrective retry prompt
 *
 * Invariants:
 *   - No IO — pure string assembly over already-fetched PlanBundle data.
 *   - Truncation is applied per-section via @lore/core's truncateSection; every truncated
 *     section's name is collected into the returned `truncated[]` list (AC-ASSESS-7).
 *   - The diff section is the one exception: it uses `truncateDiffByFile` (SPEC-028), NOT
 *     `truncateSection` — a blind tail cut can slice a file's hunk in half and silently
 *     drop whichever files sort last. `truncateDiffByFile` keeps whole files in priority
 *     order (source > test > other) and reports exactly which files were dropped/head-cut,
 *     which are recorded as individual `"diff:<file-path>"` entries in `truncated[]`
 *     (AC-AE-3) instead of the old single opaque `"diff"` marker.
 *   - Prompt section order matches SPEC-026 §5: role → materials → rubric → output instruction.
 *   - The Output Instruction explicitly states the per-AC `reasoning` 300-char cap AND that
 *     exceeding it gets clipped server-side (SPEC-029 AC-AR-1) — present in BOTH the base
 *     prompt (here) and the corrective-retry prompt (which embeds this prompt verbatim, see
 *     {@link buildAssessRetryPrompt}). ASSESS_PROMPT_VERSION bumped 1 → 2 for this change.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-026 §3 D2, D7, D8; §5; SPEC-028 AC-AE-2, AC-AE-3, AC-AE-4; SPEC-029 AC-AR-1
 */

import { truncateSection, type PlanBundle } from "@lore/core";
import { evidenceEntrySchema } from "@lore/core";
import { z } from "zod";
import { truncateDiffByFile } from "./diff-truncation.js";

/**
 * Judge prompt schema version. Bump whenever the prompt text, rubric anchors, or output
 * instruction changes in a way that could shift judge behaviour — persisted verbatim into
 * `judgment.prompt_version` on every assessment for audit (SPEC-026 §3 D6).
 */
export const ASSESS_PROMPT_VERSION = 2;

/** Character budgets for each prompt section, sourced from `config.ai.assess.*`. */
export interface AssessBudgets {
  max_plan_chars: number;
  max_spec_chars: number;
  max_task_chars: number;
  max_diff_chars: number;
}

/** Result of {@link buildAssessPrompt} — the assembled prompt plus truncated section names. */
export interface BuildAssessPromptResult {
  prompt: string;
  truncated: string[];
}

const evidenceArraySchema = z.array(evidenceEntrySchema);

/**
 * Render a task's verification_evidence entries as a compact text block for the prompt.
 * Malformed/absent evidence renders as "(no evidence recorded)" rather than throwing —
 * `extra` is untyped storage, and a judge prompt should degrade gracefully, not crash.
 */
function renderTaskEvidence(task: PlanBundle["tasks"][number]): string {
  const raw = task.extra["verification_evidence"];
  if (!Array.isArray(raw) || raw.length === 0) return "(no evidence recorded)";

  const parsed = evidenceArraySchema.safeParse(raw);
  if (!parsed.success || parsed.data.length === 0) return "(no evidence recorded)";

  return parsed.data
    .map(
      (e, i) =>
        `  [${i + 1}] oracle=${e.oracle} command="${e.command}" result=${e.result} recorder=${e.recorded_by}` +
        (e.output_tail ? `\n      output_tail: ${e.output_tail.slice(0, 500)}` : ""),
    )
    .join("\n");
}

/**
 * Assemble the initial judge prompt for `lore assess`, per the SPEC-026 §5 contract:
 * role → materials (plan, spec ACs, per-task evidence, optional diff) → rubric anchors →
 * output instruction. Each material section is truncated to its configured budget; any
 * section that gets cut has its name appended to the returned `truncated[]` list.
 *
 * @param bundle - {plan, spec?, tasks[]} from CorpusService.getPlanBundle
 * @param diffText - Optional git diff / diff-file content (already read by the CLI layer)
 * @param budgets - Character budgets from config.ai.assess.*
 * @returns { prompt, truncated } — the prompt to send to the AI provider
 *
 * @example
 * const { prompt, truncated } = buildAssessPrompt(bundle, undefined, {
 *   max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000,
 * });
 */
export function buildAssessPrompt(
  bundle: PlanBundle,
  diffText: string | undefined,
  budgets: AssessBudgets,
): BuildAssessPromptResult {
  const truncated: string[] = [];

  const planSection = truncateSection(bundle.plan.content, budgets.max_plan_chars);
  if (planSection.truncated) truncated.push("plan");

  let specBlock = "(plan has no linked spec — it is parented directly under a PRD; there are no verbatim ACs to judge against beyond the plan's own goals)";
  if (bundle.spec) {
    const specSection = truncateSection(bundle.spec.content, budgets.max_spec_chars);
    if (specSection.truncated) truncated.push("spec");
    specBlock = specSection.text;
  }

  const taskBlocks = bundle.tasks.map((task) => {
    const taskSection = truncateSection(task.content, budgets.max_task_chars);
    if (taskSection.truncated) truncated.push(`task:${task.slug}`);
    return (
      `### Task: ${task.title} (${task.slug}, status=${task.status})\n` +
      `${taskSection.text}\n` +
      `Evidence:\n${renderTaskEvidence(task)}`
    );
  });

  let diffBlock = "(no diff provided)";
  if (diffText !== undefined) {
    // reason: file-boundary truncation (SPEC-028 AC-AE-2) replaces the old blind tail cut
    // for the diff section only — every other section still uses truncateSection above.
    const diffResult = truncateDiffByFile(diffText, budgets.max_diff_chars);
    if (diffResult.truncated) {
      for (const filePath of diffResult.omittedFiles) truncated.push(`diff:${filePath}`);
      if (diffResult.headTruncatedFile) truncated.push(`diff:${diffResult.headTruncatedFile.filePath}`);
    }
    diffBlock = diffResult.text;
  }

  const prompt =
    `# Role\n` +
    `You are an independent implementation auditor. Judge ONLY from the materials provided ` +
    `below — do not assume anything about the codebase you cannot see here. Score ` +
    `unverifiable claims conservatively (prefer a lower score over benefit-of-the-doubt).\n\n` +
    `# Materials\n\n` +
    `## Plan: ${bundle.plan.title} (${bundle.plan.slug})\n` +
    `${planSection.text}\n\n` +
    `## Spec Acceptance Criteria (verbatim)\n` +
    `${specBlock}\n\n` +
    `## Tasks and Evidence\n` +
    `${taskBlocks.join("\n\n")}\n\n` +
    `## Diff\n` +
    `${diffBlock}\n\n` +
    `# Rubric Anchors\n` +
    `Score each acceptance criterion 0-100:\n` +
    `- 90-100: AC fully evidenced\n` +
    `- 60-89: met with gaps noted\n` +
    `- 30-59: partially met / weakly evidenced\n` +
    `- 0-29: unmet or contradicted\n\n` +
    `Overall verdict:\n` +
    `- "met": all ACs scored >= 60 AND overall_score >= 80\n` +
    `- "not_met": overall_score < 40 OR any AC scored 0 with no mitigation noted\n` +
    `- "partially_met": everything else\n\n` +
    `# Output Instruction\n` +
    `Respond with a SINGLE JSON object and nothing else — no prose before or after it, no markdown ` +
    `fence required (but allowed). The object MUST match this shape exactly:\n` +
    `{\n` +
    `  "verdict": "met" | "partially_met" | "not_met",\n` +
    `  "overall_score": <integer 0-100>,\n` +
    `  "ac_scores": [\n` +
    `    { "ac_id": "<AC identifier from the spec, e.g. AC-ASSESS-1>", "score": <integer 0-100>,\n` +
    `      "reasoning": "<<=300 chars>", "evidence_refs": [{ "doc_id": "<task or doc id>", "note": "<optional>" }] }\n` +
    `  ],\n` +
    `  "gaps": ["<string>", ...],\n` +
    `  "recommendations": ["<string>", ...]\n` +
    `}\n` +
    `Use the exact AC identifiers found in the spec's Acceptance Criteria section above for ac_id.\n` +
    `IMPORTANT: each ac_scores[].reasoning MUST be 300 characters or fewer. If you exceed 300 ` +
    `characters, it will be silently clipped (with a trailing "…") before scoring is recorded — ` +
    `write terse, evidence-focused reasoning instead of relying on the clip.\n`;

  return { prompt, truncated };
}

/**
 * Build the single corrective-retry prompt (SPEC-026 §3 D2) — embeds the parse/validation
 * error from the first attempt plus a terse reminder, on top of the original prompt. Used
 * exactly once: if the model's first response fails JSON extraction or schema validation.
 *
 * @param originalPrompt - The prompt sent on the first attempt (from {@link buildAssessPrompt})
 * @param parseErrorMessage - Human-readable reason the first response failed to parse/validate
 * @returns The retry prompt to send as the second (and final) attempt
 *
 * @example
 * buildAssessRetryPrompt(originalPrompt, "Unexpected token 'T' at position 0");
 */
export function buildAssessRetryPrompt(originalPrompt: string, parseErrorMessage: string): string {
  return (
    `${originalPrompt}\n\n` +
    `# Correction Required\n` +
    `Your previous response could not be parsed as the required JSON object: ${parseErrorMessage}\n` +
    `Respond again with ONLY the single JSON object described above — no prose, no explanation, ` +
    `no markdown fence unless it wraps valid JSON.\n`
  );
}
