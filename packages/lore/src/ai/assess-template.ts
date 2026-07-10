/**
 * Judge prompt builder for `lore assess` — LLM-as-judge plan-outcome assessment.
 * Owns the prompt text and ASSESS_PROMPT_VERSION (SPEC-026 §3 D8: prompt lives in
 * packages/lore/src/ai/, NOT core — core stays limited to schemas + pure data helpers).
 *
 * Public surface:
 *   - ASSESS_PROMPT_VERSION — the currently active key into ASSESS_TEMPLATES; bump whenever
 *     the prompt text or rubric changes materially
 *   - AssessTemplateFn — the shape every registry entry must satisfy (mirrors
 *     review-template.ts's ReviewTemplateFn)
 *   - ASSESS_TEMPLATES — version-keyed registry (SPEC-040 §T2 D6); `5` is the frozen v5
 *     entry (`buildAssessPrompt`, provenance only), `6` is the active entry (`buildAssessPromptV6`)
 *   - getAssessTemplate(version) — Result-returning registry lookup; an absent version is
 *     err(AI_PROVIDER_ERROR) naming it, never an uncaught throw
 *   - buildAssessPrompt(bundle, diffText, budgets) — the v5 prompt builder (registry entry `5`)
 *   - buildAssessPromptV6(bundle, diffText, budgets, facts?) — the v6 prompt builder (registry
 *     entry `6`, SPEC-040 §T2): adds a "# Deterministic Facts" section (from
 *     `computeAssessmentFacts`, @lore/core), a three-dimension rubric (outcome /
 *     evidence_integrity / scope_fidelity), and — when the plan declares `extra.ac_scope` —
 *     marks out-of-scope AC-table rows and restricts the output's allowed `ac_id` set (D5)
 *   - buildAssessDiffMeta(diffText) — derives the {@link DiffMeta} regression-signal shape
 *     from the SAME diff-header parse `truncateDiffByFile` uses (`listDiffFiles`,
 *     `diff-truncation.ts`) — single derivation site, consumed by both v6's own facts
 *     fallback and `AIProviderService.assessPlan`'s once-only facts computation
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
 *   - **Truncation manifest (bugfix F3, see file header Source)**: when `truncateDiffByFile` reports any
 *     `omittedFiles`, the prompt gains a "Truncation Manifest" section listing every one of
 *     them (grouped source/test/other via the SAME `classifyDiffFilePriority` used to build
 *     `truncated[]` — no second bookkeeping) plus a hard instruction not to treat an omitted
 *     file as absent or penalize it for having no visible content. Root cause this fixes: the
 *     judge could not distinguish "this file doesn't exist" from "this file was cut for
 *     budget," so it systematically under-scored test-coverage ACs whose test files happened
 *     to sort into the dropped set (observed on the SPEC-037 assessment — 4 false gaps, all
 *     four in `truncated[]`). The manifest is diff-omission-only; spec/plan/task truncation
 *     keeps its pre-existing bare `truncated[]`-only behaviour (those sections aren't split
 *     by file, so there's no per-file list to manifest).
 *   - Prompt section order matches SPEC-026 §5: role → materials → rubric → output instruction.
 *   - The Output Instruction explicitly states the per-AC `reasoning` 300-char cap AND that
 *     exceeding it gets clipped server-side (SPEC-029 AC-AR-1) — present in BOTH the base
 *     prompt (here) and the corrective-retry prompt (which embeds this prompt verbatim, see
 *     {@link buildAssessRetryPrompt}). ASSESS_PROMPT_VERSION bumped 1 → 2 for this change,
 *     and 2 → 3 for the truncation manifest (bugfix F3).
 *   - **v5 → v6 registry split (SPEC-040 §T2 D6)**: `buildAssessPrompt` (v5) is now frozen as
 *     `ASSESS_TEMPLATES[5]` — kept for provenance/regression, no byte-identical guarantee
 *     required going forward, but its EXISTING tests must stay green. `buildAssessPromptV6`
 *     extends v5's role→materials→rubric→output structure with a "# Deterministic Facts"
 *     section and a three-dimension rubric; see its own JSDoc for the full delta.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-026 §3 D2, D7, D8; §5; SPEC-028 AC-AE-2, AC-AE-3, AC-AE-4; SPEC-029 AC-AR-1;
 * bugfix F3 (`knowledge-assess-diff-truncation-systematically-hides-tests-from`);
 * SPEC-040 §T2 D1, D2, D3, D5, D6
 */

import { err, ok, truncateSection, type LoreError, type PlanBundle, type DocRecord, type Result } from "@lore/core";
import { evidenceEntrySchema } from "@lore/core";
import {
  computeAcCoverage,
  computeAssessmentFacts,
  specAcceptanceCriteriaSchema,
  type AcceptanceCriterion,
  type AcCoverageFact,
  type AssessmentFacts,
  type DiffMeta,
} from "@lore/core";
import { z } from "zod";
import {
  truncateDiffByFile,
  classifyDiffFilePriority,
  listDiffFiles,
  type DiffFilePriority,
} from "./diff-truncation.js";

/**
 * Judge prompt schema version. Bump whenever the prompt text, rubric anchors, or output
 * instruction changes in a way that could shift judge behaviour — persisted verbatim into
 * `judgment.prompt_version` on every assessment for audit (SPEC-026 §3 D6).
 *
 * **v3 → v4 (SPEC-038 §5 AC-ACODE-4)**: when the linked spec declares structured
 * `extra.acceptance_criteria`, the "Spec Acceptance Criteria (verbatim)" prose section is
 * replaced by a deterministic AC table (id | statement | verify | coverage, the coverage
 * column from `computeAcCoverage`) and the output instruction is tightened to `ac_id MUST
 * be one of: <declared id list>` plus a script-mode evidence-priority note. A spec with NO
 * declared criteria still renders byte-identical to v3 (verbatim fallback, D7 storage
 * compat) — the version bump exists purely because the *possible* judge-facing prompt text
 * changed, mirroring the v2→v3 bump for the diff-omission Truncation Manifest (bugfix F3,
 * see file header Source), which was likewise conditional on a materials shape (omitted
 * diff files) that isn't present in every run.
 *
 * **v4 → v5 (SPEC-039 §2 D8)**: the structured AC table's coverage column now annotates
 * runner-attested evidence counts alongside the existing pass/fail totals — e.g.
 * `2 pass (1 attested), 0 fail` — using `computeAcCoverage`'s `attested_pass`/
 * `attested_fail` fields (`@lore/core`), so the judge can see when a pass/fail came from
 * `lore verify`'s machine-executed command rather than a self-reported `lore evidence`
 * call. The attested/self-reported split is derived exactly once, in `computeAcCoverage`
 * (SPEC-039 §2 D8) — this module only formats it, never re-derives it (same discipline as
 * the pass/fail counts themselves, SPEC-038 §7 D6). A spec with no structured ACs still
 * falls through to the untouched verbatim prose section (D7 storage compat) — this bump,
 * like v2→v3 and v3→v4 before it, is conditional on a materials shape (declared structured
 * ACs with attested evidence) that isn't present in every run.
 *
 * **v5 → v6 (SPEC-040 §T2 D2, D3, D5)**: registered as `ASSESS_TEMPLATES[6]`
 * (`buildAssessPromptV6`) — adds a "# Deterministic Facts" section (from
 * `computeAssessmentFacts`, @lore/core: per-AC coverage, per-task evidence completeness,
 * AC-scope-vs-declared drift incl. `dangling[]`, knowledge-link counts, regression
 * signals), instructing the judge that facts are ground truth and it should judge ONLY
 * what facts cannot decide; a three-dimension rubric (`outcome` / `evidence_integrity` /
 * `scope_fidelity`, each `{score, confidence, based_on, reasoning}`); and, when the plan
 * declares `extra.ac_scope`, marks out-of-scope AC-table rows and restricts the output's
 * allowed `ac_id` set to the plan's scoped subset (D5). `ASSESS_PROMPT_VERSION` is now the
 * REGISTRY KEY — always look it up via {@link getAssessTemplate}, never call
 * `buildAssessPromptV6` (or `buildAssessPrompt`) directly from a version-agnostic caller.
 */
export const ASSESS_PROMPT_VERSION = 6;

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
  /**
   * The spec's declared `extra.acceptance_criteria` ids, in schema order — empty when the
   * spec has none declared (legacy verbatim path, SPEC-038 §7 D7). This is the SAME
   * extraction `AIProviderService.assessPlan` uses to build its containment check's
   * `declaredIds` set (SPEC-038 §5 D5) — computed once here, not re-derived at the call
   * site, so the prompt's AC table and the post-hoc containment check can never drift
   * apart on what "declared" means.
   */
  declaredAcIds: string[];
}

/**
 * Shape every entry in {@link ASSESS_TEMPLATES} must satisfy (SPEC-040 §T2 D6, mirrors
 * `review-template.ts`'s `ReviewTemplateFn`). `facts` is OPTIONAL and v5-incompatible on
 * purpose — a function accepting fewer parameters (like {@link buildAssessPrompt}, 3-ary)
 * is structurally assignable to this 4-ary type (TS/JS excess-argument tolerance), so v5
 * can sit in the same registry without ever seeing the facts argument. v6 uses it when
 * provided (the service's "compute once, pass down" path) and falls back to computing its
 * own via {@link computeAssessmentFacts} when called directly (tests, a future golden
 * harness) without a caller-supplied snapshot.
 */
export type AssessTemplateFn = (
  bundle: PlanBundle,
  diffText: string | undefined,
  budgets: AssessBudgets,
  facts?: AssessmentFacts,
) => BuildAssessPromptResult;

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
 * Render a "Truncation Manifest" prompt section for diff files dropped entirely by
 * `truncateDiffByFile` (bugfix F3). Grouped by the same priority classification
 * (`classifyDiffFilePriority`) `truncateDiffByFile` already used to decide what to keep —
 * this is a presentation-only pass over `omittedFiles`, not a second source of truth.
 *
 * @param omittedFiles - File paths dropped from the diff section (from `TruncateDiffResult`)
 * @returns The manifest section text, or `""` if `omittedFiles` is empty (no section emitted)
 *
 * @example
 * buildTruncationManifest(["packages/lore/src/foo.test.ts"]);
 * // => "# Truncation Manifest\n...\nTest files omitted (1):\n  - packages/lore/src/foo.test.ts\n\n"
 */
function buildTruncationManifest(omittedFiles: string[]): string {
  if (omittedFiles.length === 0) return "";

  const groups: Record<DiffFilePriority, string[]> = { source: [], test: [], other: [] };
  for (const filePath of omittedFiles) {
    groups[classifyDiffFilePriority(filePath)].push(filePath);
  }

  const lines: string[] = [
    `# Truncation Manifest`,
    `The following changed files exist in the diff but are omitted from the "Diff" section ` +
      `above for budget reasons. Do NOT report them as missing, and do NOT lower coverage ` +
      `scores solely because their contents are not shown. Treat them as present but unseen, ` +
      `not absent.\n`,
  ];
  if (groups.source.length > 0) {
    lines.push(`Production files omitted (${groups.source.length}):`);
    for (const f of groups.source) lines.push(`  - ${f}`);
  }
  if (groups.test.length > 0) {
    lines.push(`Test files omitted (${groups.test.length}):`);
    for (const f of groups.test) lines.push(`  - ${f}`);
  }
  if (groups.other.length > 0) {
    lines.push(`Other files omitted (${groups.other.length}):`);
    for (const f of groups.other) lines.push(`  - ${f}`);
  }

  return `${lines.join("\n")}\n\n`;
}

// ─── Structured Acceptance Criteria (SPEC-038 §5) ──────────────────────────

/**
 * Extract a spec's declared structured acceptance criteria (SPEC-038 §3), if any.
 * A spec created before SPEC-038, or one that never ran `lore ac add`, has no
 * `extra.acceptance_criteria` at all — that is the normal, expected case, not an error.
 * A malformed/hand-edited `extra.acceptance_criteria` (fails `specAcceptanceCriteriaSchema`)
 * degrades the same way: treated as absent, never thrown. Either case falls through to the
 * pre-existing verbatim-prose prompt section (D7 storage compat).
 *
 * @param spec - The plan's linked spec, or undefined when the plan hangs off a PRD directly
 * @returns Declared criteria in schema order, or `[]` when none are declared/valid
 *
 * @example
 * extractDeclaredAcceptanceCriteria(specWithAcs); // → [{ id: "AC-X-1", ... }, ...]
 * extractDeclaredAcceptanceCriteria(undefined); // → []
 */
export function extractDeclaredAcceptanceCriteria(spec: DocRecord | undefined): AcceptanceCriterion[] {
  if (spec === undefined) return [];
  const extra: unknown = spec.extra;
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) return [];

  const raw = (extra as Record<string, unknown>)["acceptance_criteria"];
  if (raw === undefined) return [];

  const parsed = specAcceptanceCriteriaSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** Render one criterion's `verify` union member as a single prompt-table cell. */
function renderVerifyCell(criterion: AcceptanceCriterion): string {
  switch (criterion.verify.mode) {
    case "script":
      return `script: ${criterion.verify.oracle} — \`${criterion.verify.command}\``;
    case "ai":
      return `ai rubric: ${criterion.verify.rubric}`;
    case "human":
      return criterion.verify.note ? `human: ${criterion.verify.note}` : "human";
  }
}

/**
 * Render one {@link AcCoverageFact}'s pass/fail counts as a coverage table cell,
 * annotating the runner-attested subset when present (SPEC-039 §2 D8). Rendering ONLY —
 * the attested/self-reported split is `computeAcCoverage`'s single derivation point
 * (`@lore/core`); this function never recomputes or re-derives it.
 *
 * @param fact - The criterion's coverage fact, or `undefined` when `computeAcCoverage`
 *   produced no matching row (never happens in practice — it returns one fact per input
 *   criterion — but kept defensive to match the pre-existing lookup-by-id pattern)
 * @returns A deterministic string like `"0 pass, 0 fail"` (no evidence yet),
 *   `"2 pass, 1 fail"` (self-reported only), or `"2 pass (1 attested), 0 fail"` /
 *   `"0 pass, 1 fail (1 attested)"` (attested evidence present on that side)
 *
 * @example
 * renderCoverageCell({ ac_id: "AC-1", mode: "script", pass: 2, fail: 0,
 *   refs: [], attested_pass: 1, attested_fail: 0 });
 * // => "2 pass (1 attested), 0 fail"
 */
function renderCoverageCell(fact: AcCoverageFact | undefined): string {
  if (fact === undefined) return "0 pass, 0 fail";
  const passCell = fact.attested_pass > 0 ? `${fact.pass} pass (${fact.attested_pass} attested)` : `${fact.pass} pass`;
  const failCell = fact.attested_fail > 0 ? `${fact.fail} fail (${fact.attested_fail} attested)` : `${fact.fail} fail`;
  return `${passCell}, ${failCell}`;
}

/**
 * Render the deterministic structured AC table that replaces the "Spec Acceptance
 * Criteria (verbatim)" section when the spec declares `extra.acceptance_criteria`
 * (SPEC-038 §5 AC-ACODE-4). One row per declared criterion: id | statement | verify mode
 * | coverage (pass/fail(+attested) evidence count from `computeAcCoverage`, @lore/core —
 * this function does NOT recompute coverage itself, per D6 "facts in core, rendering per
 * consumer"; the attested annotation is {@link renderCoverageCell}, SPEC-039 §2 D8). No
 * wall-clock reads, no randomness — same input always renders identically.
 *
 * @param criteria - The spec's declared acceptance criteria (non-empty; callers only
 *   invoke this when {@link extractDeclaredAcceptanceCriteria} returned a non-empty array)
 * @param tasks - The plan's tasks, whose evidence entries' `ac_ref` feed coverage counts
 * @param scopedIds - SPEC-040 D5 (v6 ONLY — v5's call site never passes this, so its
 *   output is byte-identical to before). When provided, every criterion id NOT in this
 *   set gets an " (out of scope for this plan)" suffix on its statement cell — the row is
 *   still SHOWN (never filtered out), only annotated. `undefined` means "no plan-level
 *   scope restriction" — every declared criterion is treated as in-scope.
 * @returns Markdown table text (header + one row per criterion, in input order)
 */
function renderStructuredAcTable(
  criteria: AcceptanceCriterion[],
  tasks: DocRecord[],
  scopedIds?: Set<string>,
): string {
  const coverage = computeAcCoverage(criteria, tasks);
  const coverageById = new Map(coverage.map((fact) => [fact.ac_id, fact]));

  const lines = ["| id | statement | verify | coverage |", "|---|---|---|---|"];
  for (const criterion of criteria) {
    const fact = coverageById.get(criterion.id);
    const coverageCell = renderCoverageCell(fact);
    const outOfScope = scopedIds !== undefined && !scopedIds.has(criterion.id);
    const statementCell =
      criterion.statement.replace(/\|/g, "\\|") + (outOfScope ? " (out of scope for this plan)" : "");
    lines.push(`| ${criterion.id} | ${statementCell} | ${renderVerifyCell(criterion)} | ${coverageCell} |`);
  }
  return lines.join("\n");
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
 * @returns { prompt, truncated, declaredAcIds } — the prompt to send to the AI provider;
 *   `declaredAcIds` is the spec's declared structured AC id list (SPEC-038 §5), empty for
 *   a spec with no structured ACs (or no linked spec at all) — the caller
 *   (`AIProviderService.assessPlan`) uses it to build the containment-check `Set` (D5)
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

  // reason: structured ACs (SPEC-038 §5 AC-ACODE-4) replace the verbatim prose section with
  // a deterministic table when the spec declares `extra.acceptance_criteria`; a spec with
  // none declared (or none linked at all) falls through unchanged to the pre-existing
  // verbatim path (D7 storage compat, REGRESSION-tested byte-for-byte).
  const declaredCriteria = extractDeclaredAcceptanceCriteria(bundle.spec);
  const hasStructuredAc = declaredCriteria.length > 0;

  let specHeading = "## Spec Acceptance Criteria (verbatim)";
  let specBlock = "(plan has no linked spec — it is parented directly under a PRD; there are no verbatim ACs to judge against beyond the plan's own goals)";
  if (hasStructuredAc) {
    specHeading = "## Spec Acceptance Criteria (structured)";
    const acTable = renderStructuredAcTable(declaredCriteria, bundle.tasks);
    const acTableSection = truncateSection(acTable, budgets.max_spec_chars);
    if (acTableSection.truncated) truncated.push("spec");
    specBlock = acTableSection.text;
  } else if (bundle.spec) {
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
  let truncationManifest = "";
  if (diffText !== undefined) {
    // reason: file-boundary truncation (SPEC-028 AC-AE-2) replaces the old blind tail cut
    // for the diff section only — every other section still uses truncateSection above.
    const diffResult = truncateDiffByFile(diffText, budgets.max_diff_chars);
    if (diffResult.truncated) {
      for (const filePath of diffResult.omittedFiles) truncated.push(`diff:${filePath}`);
      if (diffResult.headTruncatedFile) truncated.push(`diff:${diffResult.headTruncatedFile.filePath}`);
    }
    diffBlock = diffResult.text;
    // reason: bugfix F3 — built from `diffResult.omittedFiles`, the SAME array
    // that feeds `truncated[]` above, so the manifest can never drift from what's recorded.
    truncationManifest = buildTruncationManifest(diffResult.omittedFiles);
  }

  const prompt =
    `# Role\n` +
    `You are an independent implementation auditor. Judge ONLY from the materials provided ` +
    `below — do not assume anything about the codebase you cannot see here. Score ` +
    `unverifiable claims conservatively (prefer a lower score over benefit-of-the-doubt).\n\n` +
    `# Materials\n\n` +
    `## Plan: ${bundle.plan.title} (${bundle.plan.slug})\n` +
    `${planSection.text}\n\n` +
    `${specHeading}\n` +
    `${specBlock}\n\n` +
    `## Tasks and Evidence\n` +
    `${taskBlocks.join("\n\n")}\n\n` +
    `## Diff\n` +
    `${diffBlock}\n\n` +
    truncationManifest +
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
    // reason: SPEC-038 §5 AC-ACODE-4 — a spec with declared structured ACs gets a closed
    // instruction (ac_id MUST be one of the declared set) instead of the open-ended
    // "use the exact identifiers you find in the prose" instruction, which is exactly what
    // let the judge invent free-text ids (e.g. "D1", "D2-triage") that couldn't be aligned
    // across runs. The verbatim path's instruction text is untouched (REGRESSION).
    (hasStructuredAc
      ? `ac_id MUST be one of: ${declaredCriteria.map((c) => c.id).join(", ")}.\n` +
        `script-mode ACs: judge primarily from the evidence records, not the statement text alone.\n`
      : `Use the exact AC identifiers found in the spec's Acceptance Criteria section above for ac_id.\n`) +
    `IMPORTANT: each ac_scores[].reasoning MUST be 300 characters or fewer. If you exceed 300 ` +
    `characters, it will be silently clipped (with a trailing "…") before scoring is recorded — ` +
    `write terse, evidence-focused reasoning instead of relying on the clip.\n`;

  return { prompt, truncated, declaredAcIds: declaredCriteria.map((c) => c.id) };
}

// ─── v6: Deterministic Facts + Three-Dimension Rubric (SPEC-040 §T2) ───────

/**
 * Derive the {@link DiffMeta} regression-signal shape from a raw diff, via the SAME
 * `diff --git` header parse `truncateDiffByFile` uses internally (`listDiffFiles`,
 * `diff-truncation.ts`) — single derivation site, never re-implemented here.
 *
 * @param diffText - Raw diff text, or `undefined` when no diff was attached to this run
 * @returns `DiffMeta` classified by `classifyDiffFilePriority`, or `undefined` when no
 *   diff was provided at all (distinct from "diff provided but touched zero files",
 *   which cannot happen in practice but would still yield empty arrays, not `undefined`)
 *
 * @example
 * buildAssessDiffMeta("diff --git a/packages/core/src/foo.test.ts b/packages/core/src/foo.test.ts\n...");
 * // => { source_files: [], test_files: ["packages/core/src/foo.test.ts"], other_files: [] }
 */
export function buildAssessDiffMeta(diffText: string | undefined): DiffMeta | undefined {
  if (diffText === undefined) return undefined;
  const meta: DiffMeta = { source_files: [], test_files: [], other_files: [] };
  for (const filePath of listDiffFiles(diffText)) {
    const bucket = classifyDiffFilePriority(filePath);
    if (bucket === "source") meta.source_files.push(filePath);
    else if (bucket === "test") meta.test_files.push(filePath);
    else meta.other_files.push(filePath);
  }
  return meta;
}

/**
 * Render {@link AssessmentFacts} as a "# Deterministic Facts" prompt section (SPEC-040
 * §T2 D2) — instructs the judge to treat every line here as ground truth and to judge
 * ONLY what these facts cannot decide (e.g. whether the IMPLEMENTATION quality behind a
 * passing test is actually good, not whether the test ran). `dangling[]` — AC ids the
 * plan's `extra.ac_scope` still claims but the spec no longer declares — is annotated
 * with the literal phrase "(declared in plan scope but no longer on spec)" so a judge
 * reading only the rendered prompt (not the raw JSON) understands the drift without
 * re-deriving it.
 */
function renderFactsSection(facts: AssessmentFacts): string {
  const lines: string[] = [];

  lines.push("## AC Coverage");
  if (facts.ac_coverage.length > 0) {
    lines.push("| id | mode | pass | fail | attested_pass | attested_fail |");
    lines.push("|---|---|---|---|---|---|");
    for (const fact of facts.ac_coverage) {
      lines.push(
        `| ${fact.ac_id} | ${fact.mode} | ${fact.pass} | ${fact.fail} | ${fact.attested_pass} | ${fact.attested_fail} |`,
      );
    }
  } else {
    lines.push("(no declared acceptance criteria — nothing for this table to cover)");
  }
  lines.push("");

  lines.push("## Task Evidence Completeness");
  if (facts.task_evidence.length > 0) {
    lines.push("| task_id | has_evidence | oracle_kinds | attested_count | self_reported_count |");
    lines.push("|---|---|---|---|---|");
    for (const t of facts.task_evidence) {
      lines.push(
        `| ${t.task_id} | ${t.has_evidence} | ${t.oracle_kinds.join(", ") || "—"} | ${t.attested_count} | ${t.self_reported_count} |`,
      );
    }
  } else {
    lines.push("(no tasks in this plan)");
  }
  lines.push("");

  if (facts.scope) {
    lines.push("## AC Scope Facts");
    lines.push(`- Declared on spec: ${facts.scope.declared_ids.join(", ") || "(none)"}`);
    lines.push(
      `- Scoped by plan (extra.ac_scope): ${facts.scope.scoped_ids.join(", ") || "(none — plan declares no ac_scope; every declared AC is in scope)"}`,
    );
    if (facts.scope.dangling.length > 0) {
      lines.push(
        `- Dangling ids (declared in plan scope but no longer on spec): ${facts.scope.dangling.join(", ")}`,
      );
    }
    lines.push("");
  }

  lines.push("## Knowledge Capture");
  lines.push(
    `- ${facts.knowledge_capture.count} linked knowledge doc(s) (sub_types: ${facts.knowledge_capture.sub_types.join(", ") || "none"}), source=${facts.knowledge_capture.source}`,
  );
  lines.push("");

  lines.push("## Regression Signals");
  lines.push(`- diff_available: ${facts.regression.diff_available}`);
  lines.push(`- tests_touched: ${facts.regression.tests_touched}`);
  lines.push(`- attested_evidence_ratio: ${facts.regression.attested_evidence_ratio.toFixed(2)}`);

  return lines.join("\n");
}

/**
 * Assemble the v6 judge prompt for `lore assess` (SPEC-040 §T2 D2, D3, D5): role →
 * materials (same as v5: plan, spec ACs, per-task evidence, optional diff) → **# Deterministic
 * Facts** (new) → rubric (v5's per-AC anchors PLUS a new three-dimension rubric) → output
 * instruction (v5's `ac_scores` shape PLUS `dimension_scores`/`typed_gaps`/
 * `typed_recommendations`/`unverifiable`).
 *
 * D5 scope-fit: when `facts.scope.scoped_ids` is non-empty (the plan declares
 * `extra.ac_scope`), the structured AC table marks every OUT-of-scope declared criterion
 * and the output instruction restricts the allowed `ac_id` set to the plan's scoped
 * subset — `declaredAcIds` in the returned result reflects that SAME restricted subset,
 * so `AIProviderService`'s containment check (`validateAcIdContainment`) enforces the
 * plan's scope, not just the spec's full declared set.
 *
 * @param bundle - {plan, spec?, tasks[], knowledge_links?} from CorpusService.getPlanBundle
 * @param diffText - Optional git diff / diff-file content (already read by the CLI layer)
 * @param budgets - Character budgets from config.ai.assess.*
 * @param facts - Pre-computed {@link AssessmentFacts} (SPEC-040 D1) — the service computes
 *   this ONCE from the full untruncated bundle and passes it here so the SAME facts object
 *   is both shown to the judge and persisted (`extra.assessment.facts`). When omitted
 *   (e.g. a direct/standalone call), this function computes its own via
 *   {@link computeAssessmentFacts} and {@link buildAssessDiffMeta} — never re-derives
 *   `ac_coverage` itself (single derivation site, `@lore/core`).
 * @returns { prompt, truncated, declaredAcIds } — `declaredAcIds` is scope-restricted (D5)
 *
 * @example
 * const { prompt, truncated, declaredAcIds } = buildAssessPromptV6(bundle, undefined, {
 *   max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000,
 * });
 */
export function buildAssessPromptV6(
  bundle: PlanBundle,
  diffText: string | undefined,
  budgets: AssessBudgets,
  facts?: AssessmentFacts,
): BuildAssessPromptResult {
  const truncated: string[] = [];

  const planSection = truncateSection(bundle.plan.content, budgets.max_plan_chars);
  if (planSection.truncated) truncated.push("plan");

  const declaredCriteria = extractDeclaredAcceptanceCriteria(bundle.spec);
  const hasStructuredAc = declaredCriteria.length > 0;

  const resolvedFacts = facts ?? computeAssessmentFacts(bundle, declaredCriteria, buildAssessDiffMeta(diffText));

  // reason: SPEC-040 D5 — a non-empty `facts.scope.scoped_ids` IS the plan's declared
  // `extra.ac_scope`, already extracted once by `computeAssessmentFacts` (single
  // derivation site — this function never re-reads `plan.extra.ac_scope` itself).
  const scopedIds =
    resolvedFacts.scope && resolvedFacts.scope.scoped_ids.length > 0
      ? new Set(resolvedFacts.scope.scoped_ids)
      : undefined;

  let specHeading = "## Spec Acceptance Criteria (verbatim)";
  let specBlock = "(plan has no linked spec — it is parented directly under a PRD; there are no verbatim ACs to judge against beyond the plan's own goals)";
  if (hasStructuredAc) {
    specHeading = "## Spec Acceptance Criteria (structured)";
    const acTable = renderStructuredAcTable(declaredCriteria, bundle.tasks, scopedIds);
    const acTableSection = truncateSection(acTable, budgets.max_spec_chars);
    if (acTableSection.truncated) truncated.push("spec");
    specBlock = acTableSection.text;
  } else if (bundle.spec) {
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
  let truncationManifest = "";
  if (diffText !== undefined) {
    const diffResult = truncateDiffByFile(diffText, budgets.max_diff_chars);
    if (diffResult.truncated) {
      for (const filePath of diffResult.omittedFiles) truncated.push(`diff:${filePath}`);
      if (diffResult.headTruncatedFile) truncated.push(`diff:${diffResult.headTruncatedFile.filePath}`);
    }
    diffBlock = diffResult.text;
    truncationManifest = buildTruncationManifest(diffResult.omittedFiles);
  }

  // reason: the declared-id universe for the containment check narrows to the plan's
  // scoped subset when ac_scope is declared (D5) — this is what gets returned as
  // `declaredAcIds`, not the spec's full declared set.
  const scopedDeclaredCriteria = scopedIds
    ? declaredCriteria.filter((c) => scopedIds.has(c.id))
    : declaredCriteria;

  const prompt =
    `# Role\n` +
    `You are an independent implementation auditor. Judge ONLY from the materials provided ` +
    `below — do not assume anything about the codebase you cannot see here. Score ` +
    `unverifiable claims conservatively (prefer a lower score over benefit-of-the-doubt).\n\n` +
    `# Materials\n\n` +
    `## Plan: ${bundle.plan.title} (${bundle.plan.slug})\n` +
    `${planSection.text}\n\n` +
    `${specHeading}\n` +
    `${specBlock}\n\n` +
    `## Tasks and Evidence\n` +
    `${taskBlocks.join("\n\n")}\n\n` +
    `## Diff\n` +
    `${diffBlock}\n\n` +
    truncationManifest +
    `# Deterministic Facts\n` +
    `Everything in this section was computed mechanically from the SAME materials shown ` +
    `above — treat every line as GROUND TRUTH. Do not re-derive or contradict it. Spend your ` +
    `judgment ONLY on what these facts cannot decide (e.g. whether an evidenced pass reflects ` +
    `genuinely good implementation quality, not whether the evidence exists).\n\n` +
    `${renderFactsSection(resolvedFacts)}\n\n` +
    `# Rubric Anchors (per acceptance criterion)\n` +
    `Score each acceptance criterion 0-100:\n` +
    `- 90-100: AC fully evidenced\n` +
    `- 60-89: met with gaps noted\n` +
    `- 30-59: partially met / weakly evidenced\n` +
    `- 0-29: unmet or contradicted\n\n` +
    `Overall verdict:\n` +
    `- "met": all ACs scored >= 60 AND overall_score >= 80\n` +
    `- "not_met": overall_score < 40 OR any AC scored 0 with no mitigation noted\n` +
    `- "partially_met": everything else\n\n` +
    `# Dimension Rubric (SPEC-040 D2)\n` +
    `Score each of these THREE dimensions 0-100, with a self-reported confidence (0-1,\n` +
    `advisory only — never treat as a calibrated probability), a "based_on" tag\n` +
    `("evidence" | "absence"), and reasoning (<=200 chars — exceeding it is silently clipped\n` +
    `with a trailing "…"):\n` +
    `- outcome: did the plan's tasks deliver what the spec's acceptance criteria require?\n` +
    `- evidence_integrity: is the evidence trail (oracle runs, attestation) trustworthy and complete?\n` +
    `- scope_fidelity: does execution stay within the plan's declared scope (no unexplained drift)?\n\n` +
    `Use "based_on": "absence" ONLY when the score reflects the ABSENCE of evidence or\n` +
    `materials you could not verify (as opposed to positive evidence you actually reviewed).\n` +
    `When you use "absence" for a dimension, you MUST also name the missing material in the\n` +
    `"unverifiable" array below — an absence-based score with nothing named there is flagged\n` +
    `as an ungrounded warning.\n\n` +
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
    `  "recommendations": ["<string>", ...],\n` +
    `  "dimension_scores": {\n` +
    `    "outcome": { "score": <0-100>, "confidence": <0-1>, "based_on": "evidence"|"absence", "reasoning": "<<=200 chars>" },\n` +
    `    "evidence_integrity": { "score": <0-100>, "confidence": <0-1>, "based_on": "evidence"|"absence", "reasoning": "<<=200 chars>" },\n` +
    `    "scope_fidelity": { "score": <0-100>, "confidence": <0-1>, "based_on": "evidence"|"absence", "reasoning": "<<=200 chars>" }\n` +
    `  },\n` +
    `  "typed_gaps": [\n` +
    `    { "dimension": "outcome"|"evidence_integrity"|"scope_fidelity", "severity": "blocker"|"major"|"minor",\n` +
    `      "ac_ref": "<optional AC id>", "statement": "<<=500 chars>" }\n` +
    `  ],\n` +
    `  "typed_recommendations": [\n` +
    `    { "target": "spec"|"plan"|"prompt"|"skill"|"process", "action": "<<=500 chars>", "rationale": "<<=300 chars>" }\n` +
    `  ],\n` +
    `  "unverifiable": [\n` +
    `    { "material": "<string>", "reason": "<<=200 chars>" }\n` +
    `  ]\n` +
    `}\n` +
    (hasStructuredAc
      ? `ac_id MUST be one of: ${scopedDeclaredCriteria.map((c) => c.id).join(", ")}.\n` +
        // reason: only mention "(out of scope for this plan)" rows when at least one
        // declared criterion actually got that annotation — a plan whose extra.ac_scope
        // covers the FULL declared set has zero such rows, and referencing the marker
        // unconditionally there is a confusing, vestigial sentence pointing at nothing
        // (caught during SPEC-040 T2 test authoring, AC-ADF-11 boundary case).
        (scopedIds && declaredCriteria.length > scopedDeclaredCriteria.length
          ? `This list is RESTRICTED to the plan's declared extra.ac_scope — criteria marked ` +
            `"(out of scope for this plan)" above are informational only; do not score them.\n`
          : scopedIds
            ? `This list reflects the plan's declared extra.ac_scope (which covers every declared criterion here).\n`
            : "") +
        `script-mode ACs: judge primarily from the evidence records, not the statement text alone.\n`
      : `Use the exact AC identifiers found in the spec's Acceptance Criteria section above for ac_id.\n`) +
    `IMPORTANT: ac_scores[].reasoning caps at 300 chars, dimension_scores{}.reasoning caps at ` +
    `200 chars, typed_gaps[].statement and typed_recommendations[].action cap at 500 chars, ` +
    `typed_recommendations[].rationale and unverifiable[].reason cap at 200/300 chars ` +
    `respectively — every cap is silently clipped (trailing "…") before scoring is recorded; ` +
    `write terse, evidence-focused text instead of relying on the clip.\n`;

  return { prompt, truncated, declaredAcIds: scopedDeclaredCriteria.map((c) => c.id) };
}

/**
 * Version-keyed registry of assess judge prompt builders (SPEC-040 §T2 D6, mirrors
 * `review-template.ts`'s `REVIEW_TEMPLATES`). `5` is the frozen v5 entry
 * (`buildAssessPrompt`) kept for provenance; `6` is the active `ASSESS_PROMPT_VERSION`
 * entry. A future prompt revision adds a new key here rather than mutating an existing
 * one, so historical assessments' `judgment.prompt_version` stays meaningful.
 */
export const ASSESS_TEMPLATES: Record<number, AssessTemplateFn> = {
  5: buildAssessPrompt,
  6: buildAssessPromptV6,
};

/**
 * Result-returning lookup into {@link ASSESS_TEMPLATES} (SPEC-040 §T2 D6) — an absent
 * version is `err(AI_PROVIDER_ERROR)` naming the version, never an uncaught throw (e.g. a
 * bare `ASSESS_TEMPLATES[version]!` non-null assertion on a caller-supplied version).
 *
 * @param version - Registry key (typically {@link ASSESS_PROMPT_VERSION}, but callable
 *   with any version — e.g. a future golden-harness invoking a specific historical prompt)
 * @returns `ok(templateFn)` when registered; `err(AI_PROVIDER_ERROR)` naming the version
 *   and the known registered versions otherwise
 *
 * @example
 * const templateResult = getAssessTemplate(ASSESS_PROMPT_VERSION);
 * if (!templateResult.ok) { ... } // unreachable in practice — ASSESS_PROMPT_VERSION always has an entry
 *
 * @example
 * getAssessTemplate(999); // → err({ code: "AI_PROVIDER_ERROR", message: "...version 999..." })
 */
export function getAssessTemplate(version: number): Result<AssessTemplateFn, LoreError> {
  const template = ASSESS_TEMPLATES[version];
  if (template === undefined) {
    return err({
      code: "AI_PROVIDER_ERROR",
      provider: "assess-template-registry",
      message:
        `No assess judge prompt template registered for version ${version}. ` +
        `Known versions: ${Object.keys(ASSESS_TEMPLATES).join(", ")}.`,
    });
  }
  return ok(template);
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
