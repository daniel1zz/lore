/**
 * Judge prompt builder for `lore assess` — LLM-as-judge plan-outcome assessment.
 * Owns the prompt text and ASSESS_PROMPT_VERSION (SPEC-026 §3 D8: prompt lives in
 * packages/lore/src/ai/, NOT core — core stays limited to schemas + pure data helpers).
 *
 * Public surface:
 *   - ASSESS_PROMPT_VERSION — the currently active key into ASSESS_TEMPLATES; bump whenever
 *     the prompt text or rubric changes materially
 *   - AssessTemplateFn — the shape every registry entry's builder function must satisfy
 *     (mirrors review-template.ts's ReviewTemplateFn)
 *   - AssessTemplateRegistryEntry — {fn, reproducible} pair (task-assess-templates-5-binds-
 *     the-projected-renderer-while-two): `reproducible` is a FIRST-CLASS field, not a
 *     comment, so every slot answers "is this version's rendering guaranteed byte-identical
 *     forever" explicitly and the answer is machine-readable, not prose the reader of a
 *     persisted assessment doc would have to go find in this file
 *   - ASSESS_TEMPLATE_REGISTRY — version-keyed `Record<number, AssessTemplateRegistryEntry>`,
 *     the SSOT both `ASSESS_TEMPLATES` (function-only view, back-compat with reference-
 *     identity-pinned tests) and `getAssessTemplateReproducibility` derive from
 *   - ASSESS_TEMPLATES — version-keyed registry of BUILDER FUNCTIONS ONLY (SPEC-040 §T2 D6,
 *     re-keyed T5, derived from ASSESS_TEMPLATE_REGISTRY): `5` is the SLOT-STABLE v5 entry
 *     (`buildAssessPrompt`, provenance only — key `5` never moves, but its OUTPUT is not
 *     guaranteed reproducible, `reproducible: false`), `6` is the OUTPUT-FROZEN pre-
 *     projection v6 entry (`buildAssessPromptV6OutputFrozen` — byte-identical to
 *     `buildAssessPromptV6`'s behaviour before T3/a639485, `reproducible: true`), `7` is the
 *     OUTPUT-FROZEN pre-D1 entry (`buildAssessPromptV7`, T3's projected evidence renderer,
 *     `reproducible: true`), `8` is the active entry (`buildAssessPromptV8`, D1's
 *     `typed_gaps[].paths` requirement, `reproducible: true`)
 *   - getAssessTemplate(version) — Result-returning registry lookup; an absent version is
 *     err(AI_PROVIDER_ERROR) naming it, never an uncaught throw
 *   - getAssessTemplateReproducibility(version) — Result-returning lookup for the OTHER half
 *     of a registry entry (its `reproducible` declaration), same failure shape as
 *     getAssessTemplate
 *   - buildAssessPrompt(bundle, diffText, budgets) — the v5 prompt builder (registry entry `5`)
 *   - buildAssessPromptV6(bundle, diffText, budgets, facts?) / buildAssessPromptV7(same
 *     signature) — two names for the SAME active builder (registry entry `7`, T5): adds a
 *     "# Deterministic Facts" section (from `computeAssessmentFacts`, @lore/core), a
 *     three-dimension rubric (outcome / evidence_integrity / scope_fidelity), and — when the
 *     plan declares `extra.ac_scope` — marks out-of-scope AC-table rows and restricts the
 *     output's allowed `ac_id` set (D5). `buildAssessPromptV6`'s name is kept because
 *     AC-AEP-4 pins a direct caller asserting it renders the SAME projected evidence shape
 *     as v5 — it could not be repurposed to mean "output-frozen" without breaking that
 *     spec-level AC, so the output-frozen entry got a new name
 *     (`buildAssessPromptV6OutputFrozen`) instead of this one. `buildAssessPromptV7` is the
 *     forward-looking alias for any new caller, now itself OUTPUT-FROZEN (registry slot `7`)
 *     since `buildAssessPromptV8` became the active `ASSESS_PROMPT_VERSION` (D1, below).
 *   - buildAssessPromptV8(bundle, diffText, budgets, facts?) — the ACTIVE builder (registry
 *     entry `8`, D1, spec-judgment-surfaces-must-verify-before-they-certify-machine): same
 *     shared core as v6/v7, with `assembleFactsBasedAssessPrompt`'s `requireFindingPaths`
 *     opt-in set — the typed_gaps[] output-instruction JSON shape gains a `"paths"` array and
 *     an instruction requiring every file path a finding names in `statement` to also appear
 *     there, verbatim.
 *   - buildAssessDiffMeta(diffText) — derives the {@link DiffMeta} regression-signal shape
 *     from the SAME diff-header parse `truncateDiffByFile` uses (`listDiffFiles`,
 *     `diff-truncation.ts`) — single derivation site, consumed by both v6/v7's own facts
 *     fallback and `AIProviderService.assessPlan`'s once-only facts computation
 *   - buildAssessRetryPrompt(originalPrompt, parseErrorMessage) — one corrective retry prompt
 *   - ASSESS_DIFF_MIRROR_PATH_PREFIX / excludeAssessMirrorFromDiff(diffText) — D4
 *     (spec-judgment-surfaces-must-verify-before-they-certify-machine): strips every
 *     `docs/requirements/**` file-diff hunk from a unified diff BEFORE any registry-versioned
 *     builder (and its internal `truncateDiffByFile`) ever sees it. Called ONCE by
 *     `AIProviderService.assessPlan` on `opts.diffText`, deliberately NOT wired into any
 *     builder's own body (see this pair's own JSDoc for why: it would retroactively break
 *     slots 6/7's `reproducible: true` byte-identical guarantee)
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
 *   - **v5 → v6 registry split (SPEC-040 §T2 D6)**: `buildAssessPrompt` (v5) is now
 *     SLOT-STABLE as `ASSESS_TEMPLATES[5]` — the registry KEY `5` is never renumbered or
 *     repurposed, kept for provenance/regression — but explicitly NOT output-frozen: no
 *     byte-identical guarantee is required going forward, only that its EXISTING tests stay
 *     green (`reproducible: false` on its {@link AssessTemplateRegistryEntry}, per
 *     task-assess-templates-5-binds-the-projected-renderer-while-two — this is the
 *     GENERALIZATION of that decision: a single `reproducible` field answers the question
 *     for every future slot at once, rather than freezing one slot and deferring the same
 *     ambiguity to the next one). `buildAssessPromptV6` extends v5's
 *     role→materials→rubric→output structure with a "# Deterministic Facts" section and a
 *     three-dimension rubric; see its own JSDoc for the full delta.
 *   - **Evidence row projection, not embedding (SPEC-lore-assess-project-evidence-rows-
 *     instead-of-embedding-the D1)**: `renderTaskEvidence` projects each evidence row as
 *     `(oracle, ac_ref, result, command, tail_bytes)` — `tail_bytes` ALWAYS rendered (0 for
 *     an absent/empty tail, never omitted) — and shows the full clipped `output_tail` text
 *     ONLY for a row whose `ac_ref` is among `computeAcIdsUnderJudgment`'s result (v5: the
 *     spec's full declared set; v6: the plan-scope-restricted subset, D5 — AC-AEP-4 pins
 *     both builders agreeing). This is the root fix for a heavily-evidenced task's RENDERED
 *     TEXT ballooning unboundedly (AC-AEP-2): the OLD rendering embedded every row's full
 *     500-char-clipped tail regardless of relevance; the NEW compact projection keeps the
 *     evidence block itself small. `truncateSection(task.content, budgets.max_task_chars)`
 *     is UNCHANGED — it measures `task.content` ALONE, never the rendered evidence text
 *     (AC-067-5 pins this in isolation: a tiny task budget with zero evidence must truncate
 *     purely on content length) — the `` `task:${task.slug}` `` truncated[] entry vocabulary
 *     is likewise UNCHANGED (fixed string format, unrelated to registry slot-stability or
 *     output-freeze — `computeTaskTruncationRatio`, `@lore/core/assessment.ts`,
 *     keys off the `task:` prefix; `findUngroundedAbsenceDimensions`,
 *     `../service/ai-provider-service.ts`, substring-matches it) — AC-AEP-3 regression-pins
 *     the exact string.
 *   - **Evidence renderer parameterized, not forked (SPEC-lore-assess-project-evidence-rows-
 *     instead-of-embedding-the T5, AC-AEP-9/10)**: the defect the bullet above's D1 change
 *     surfaced is that `renderTaskEvidence` is SHARED by `buildAssessPrompt` (v5) and the
 *     v6/v7 builder, so changing it changed BOTH at once — but `ASSESS_PROMPT_VERSION` was
 *     still `6`, meaning an assessment stamped `prompt_version: 6` rendered differently
 *     before and after that change landed. The fix is an injectable `EvidenceRenderer`
 *     parameter on the shared v6/v7 builder core (`assembleFactsBasedAssessPrompt`) — ONE
 *     builder body, not a forked twin. `ASSESS_TEMPLATES[6]` now binds
 *     `renderTaskEvidenceV6OutputFrozen` (byte-identical to `renderTaskEvidence`'s PRE-D1
 *     behaviour, captured from `a639485^`), and `ASSESS_TEMPLATES[7]` binds the current
 *     (projected) `renderTaskEvidence` and becomes `ASSESS_PROMPT_VERSION`. See the
 *     `buildAssessPromptV6` doc for why that exported NAME still means "projected" even
 *     though its registry slot moved to `7`.
 *   - **"Frozen" is disambiguated into two distinct adjectives, never used bare**
 *     (task-assess-templates-5-binds-the-projected-renderer-while-two): **slot-stable**
 *     means the registry KEY is permanent — `getAssessTemplate(N)` for a given `N` will
 *     always resolve to SOME entry, and that entry never gets repointed at a behaviourally
 *     different builder under the same key (true of every key: 5, 6, 7, and any future
 *     one). **output-frozen** means the entry's RENDERED TEXT is additionally guaranteed
 *     byte-identical for the same input, forever — strictly stronger than slot-stable, and
 *     NOT true of every key (slot 5 is slot-stable but not output-frozen; the
 *     `reproducible` field on {@link AssessTemplateRegistryEntry} is the machine-readable
 *     form of exactly this distinction). This disambiguation exists because the two prior
 *     JSDoc sites in this file used "frozen" for both senses within three lines of each
 *     other, which produced two incorrect conclusions before this comment was written
 *     (see the task's own corrections: no real AC-AEP-4/AC-AEP-9 conflict, and no explicit
 *     assess-side non-drift invariant was ever violated — do not conflate this module's
 *     concerns with `GENERATE_PROMPT_VERSION`'s unrelated SSOT comment at
 *     `../service/ai-provider-service.ts:515`).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-026 §3 D2, D7, D8; §5; SPEC-028 AC-AE-2, AC-AE-3, AC-AE-4; SPEC-029 AC-AR-1;
 * bugfix F3 (`knowledge-assess-diff-truncation-systematically-hides-tests-from`);
 * SPEC-040 §T2 D1, D2, D3, D5, D6;
 * SPEC-lore-assess-project-evidence-rows-instead-of-embedding-the D1, D2 (T3), T5 (freeze + registry re-key);
 * task-assess-templates-5-binds-the-projected-renderer-while-two (reproducible field, slot-stable/
 * output-frozen vocabulary); adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the (Q1-Q3)
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

// ─── Mirror Exclusion (D4, spec-judgment-surfaces-must-verify-before-they-certify-machine) ───

/**
 * Single-definition-site path prefix for the generated corpus→file mirror this repo exports
 * under `docs/requirements/**` (see root CLAUDE.md's "Finding Live Project State" section) —
 * a PROJECTION of the corpus the judge already reads via the plan/spec/task materials
 * sections, never a second source of truth. Never inline this prefix at a second call site.
 */
export const ASSESS_DIFF_MIRROR_PATH_PREFIX = "docs/requirements/";

/** Same `diff --git a/... b/...` header shape `diff-truncation.ts`'s own (private,
 * unexported) `parseDiffIntoChunks` uses — necessarily duplicated here rather than shared:
 * this exclusion pass runs on the CALLER side (`AIProviderService.assessPlan`), strictly
 * BEFORE any of `truncateDiffByFile`/`buildAssessDiffMeta`/`parseDiffFilePaths` ever see the
 * diff text at all (D4) — splitting into per-file chunks is the only way to drop a whole
 * mirror hunk without slicing a kept hunk's body in half. */
const ASSESS_DIFF_FILE_HEADER_PATTERN = /^diff --git a\/(.*) b\/(.*)$/;

/**
 * Strips every `docs/requirements/**` file-diff hunk from a unified diff, UNCONDITIONALLY —
 * regardless of whether the diff would even need truncation. The generated mirror is a
 * projection of the corpus the judge is already shown via the plan/spec/task sections above
 * it in the prompt; showing it a SECOND time, as a diff hunk, only spends the
 * `ai.assess.max_diff_chars` budget that could have gone to real source hunks (one measured
 * run truncated 5.3M chars, most of it the mirror — see this mechanism's governing spec's
 * Problem section). This is the mirror-exclusion half of D4; `excludeAssessMirrorFromDiff`
 * is called ONCE, by `AIProviderService.assessPlan`, on `opts.diffText` BEFORE it reaches
 * `buildAssessDiffMeta`, `parseDiffFilePaths`, OR any registry-versioned prompt builder here
 * — never inside a builder itself, because `ASSESS_TEMPLATE_REGISTRY[6]`/`[7]` are both
 * declared `reproducible: true` (byte-identical output forever; see this file's own
 * "landed version is FROZEN" invariant) and a builder-internal change would retroactively
 * break that guarantee for every historical assessment stamped with either prompt_version.
 *
 * @invariant Pure, no IO.
 * @invariant A diff with no `diff --git a/... b/...` headers at all (the SAME documented
 *   passthrough `truncateDiffByFile` uses for an unparseable diff — see diff-truncation.ts's
 *   module header) is returned UNCHANGED: there is no per-file identity to test the prefix
 *   against.
 * @invariant Returns `diffText` BYTE-IDENTICAL when it contains zero mirror hunks — the
 *   overwhelmingly common case (most assess diffs never touch the mirror at all), so this
 *   is a safe no-op default for every pre-existing caller/test that never exercised it.
 * @param diffText - Raw unified diff text (already acquired by the caller)
 * @returns `diffText` with every `docs/requirements/**` file hunk removed
 *
 * @example
 * excludeAssessMirrorFromDiff(
 *   "diff --git a/docs/requirements/spec/SPEC-1.md b/docs/requirements/spec/SPEC-1.md\n@@ -1 +1 @@\n-old\n+new\n" +
 *   "diff --git a/packages/core/src/foo.ts b/packages/core/src/foo.ts\n@@ -1 +1 @@\n-old\n+new\n",
 * );
 * // → "diff --git a/packages/core/src/foo.ts b/packages/core/src/foo.ts\n@@ -1 +1 @@\n-old\n+new\n"
 *
 * @example
 * excludeAssessMirrorFromDiff("not a diff at all"); // → "not a diff at all" (unchanged)
 */
export function excludeAssessMirrorFromDiff(diffText: string): string {
  const lines = diffText.split("\n");
  const headerIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (ASSESS_DIFF_FILE_HEADER_PATTERN.test(lines[i] as string)) headerIndices.push(i);
  }
  if (headerIndices.length === 0) return diffText;

  const keptChunks: string[] = [];
  for (let i = 0; i < headerIndices.length; i++) {
    const start = headerIndices[i] as number;
    const end = i + 1 < headerIndices.length ? (headerIndices[i + 1] as number) : lines.length;
    const headerMatch = ASSESS_DIFF_FILE_HEADER_PATTERN.exec(lines[start] as string);
    // reason: post-change ("b/") path — same canonical-identity convention
    // diff-truncation.ts's own parser documents (rename source vs destination: the "b/"
    // side is stable across additions/modifications/deletions/renames alike).
    const filePath = (headerMatch?.[2] ?? "").trim();
    if (filePath.startsWith(ASSESS_DIFF_MIRROR_PATH_PREFIX)) continue;
    keptChunks.push(lines.slice(start, end).join("\n"));
  }
  return keptChunks.join("\n");
}

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
 *
 * **v6 → v7 (SPEC-lore-assess-project-evidence-rows-instead-of-embedding-the T5, AC-AEP-9/10)**:
 * T3 changed the evidence-row rendering SHARED by `buildAssessPrompt` (v5) and the v6/v7
 * builder, while `ASSESS_PROMPT_VERSION` stayed `6` — so an assessment stamped
 * `prompt_version: 6` rendered differently before and after that landed. (Correction,
 * task-assess-templates-5-binds-the-projected-renderer-while-two: an earlier version of
 * this comment claimed this broke a documented "prompt and stamped version can never drift
 * apart" invariant in `../service/ai-provider-service.ts` — that citation was misattributed.
 * The comment at that file's line ~515 is about `GENERATE_PROMPT_VERSION` and the GENERATE
 * templates, not assess; no explicit non-drift invariant was ever written for the assess
 * path. The problem was real regardless — output-freeze was silently lost for slot 6 — it
 * just was never a documented invariant being broken.) Fixed by PARAMETERIZING the shared
 * builder core (`assembleFactsBasedAssessPrompt`) over an injectable evidence renderer
 * instead of forking it: `ASSESS_TEMPLATES[6]` now binds `renderTaskEvidenceV6OutputFrozen`
 * (byte-identical to the PRE-T3 rendering, so `getAssessTemplate(6)` stays output-frozen
 * forever, `reproducible: true`), and `ASSESS_TEMPLATES[7]` binds T3's projected renderer
 * and becomes the active `ASSESS_PROMPT_VERSION` (also `reproducible: true` — any FUTURE
 * behavioural change moves to a new key rather than mutating `7` in place).
 * `buildAssessPromptV6` (the exported function) keeps its NAME and its (projected)
 * BEHAVIOUR unchanged — AC-AEP-4 pins a direct caller asserting it matches v5's projected
 * shape — it simply moved to registry slot `7`; `buildAssessPromptV7` is the same function
 * under the name that matches its new active slot.
 *
 * **v7 → v8 (D1, spec-judgment-surfaces-must-verify-before-they-certify-machine)**: adds a
 * `"paths"` array to the `typed_gaps[]` output-instruction JSON shape and a paragraph
 * requiring every file path a finding names in `statement`'s prose to also appear there,
 * verbatim — the machine-verifiable declaration D2/D3 checks against the assessed commit
 * (`AIProviderService`'s `verifyFindingPaths`). This is a NEW registry key (`8`), never a
 * mutation of slot `7` in place: `assembleFactsBasedAssessPrompt` gained an opt-in
 * `requireFindingPaths` PARAMETER (default `false`, so `buildAssessPromptV6OutputFrozen`'s
 * and `buildAssessPromptV7`'s own call sites are unchanged and their rendered output stays
 * byte-identical) — same "parameterize the shared core, never fork it" fix the v6→v7
 * transition above already established for the evidence renderer. `buildAssessPromptV8`
 * becomes the active `ASSESS_PROMPT_VERSION` (`reproducible: true` — a fresh registry key
 * with no prior renders to stay byte-identical to; any FUTURE change to slot `8` still moves
 * to a new key `9`, never mutates `8` in place).
 */
export const ASSESS_PROMPT_VERSION = 8;

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
  /**
   * Diff files WHOLLY omitted from the prompt (the exact `diffResult.omittedFiles` that feeds
   * the Truncation Manifest) — files the judge never saw. Excludes the head-truncated file,
   * which the judge saw in part. `AIProviderService._finalizeAssessment` withdraws findings
   * on these (F2, AC-CRIT-3). Empty when no diff was attached or nothing was dropped.
   */
  omittedDiffFiles: string[];
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
 * The set of acceptance-criterion ids currently "under judgment" for evidence full-tail
 * visibility (SPEC-lore-assess-project-evidence-rows-instead-of-embedding-the D1) — the
 * SAME set the prompt's "ac_id MUST be one of" output instruction restricts the judge to.
 * Single derivation site so v5 (the spec's full declared set) and v6 (its plan-scope-
 * restricted subset, D5) can never independently drift on what "under judgment" means —
 * AC-AEP-4 asserts both builders agree.
 *
 * @param criteria - Declared acceptance criteria already resolved for this prompt (v5:
 *   `declaredCriteria`; v6: `scopedDeclaredCriteria`)
 * @returns A `Set` of the criteria's ids, for O(1) membership tests in {@link renderTaskEvidence}
 *
 * @example
 * computeAcIdsUnderJudgment([{ id: "AC-X-1", ... }]); // → Set(["AC-X-1"])
 */
function computeAcIdsUnderJudgment(criteria: AcceptanceCriterion[]): Set<string> {
  return new Set(criteria.map((c) => c.id));
}

/**
 * Render a task's verification_evidence entries as a compact text block for the prompt
 * (SPEC-lore-assess-project-evidence-rows-instead-of-embedding-the D1). Per row this
 * projects ONLY `(oracle, ac_ref, result, command, tail_bytes)` — never the raw evidence
 * body — plus the clipped `output_tail` text itself, but ONLY when the row's `ac_ref` is
 * among `acIdsUnderJudgment`. `tail_bytes` is ALWAYS rendered, even when `output_tail` is
 * absent or empty (`tail_bytes=0`) — an omitted field would be indistinguishable from
 * "nobody looked," which is exactly the defect this fixes (measured: two red-first rows
 * with an empty tail went unnoticed inside a whole-body embedding — see
 * `knowledge-a-task-doc-that-accumulated-10-evidence-rows`). Byte count (not char count)
 * because `output_tail` can carry multi-byte UTF-8 content — matches this codebase's
 * existing `Buffer.byteLength(text, "utf8")` convention (`claude-md-budget.ts`).
 *
 * Malformed/absent evidence renders as "(no evidence recorded)" rather than throwing —
 * `extra` is untyped storage, and a judge prompt should degrade gracefully, not crash.
 *
 * @param task - The task doc whose `extra.verification_evidence` is rendered
 * @param acIdsUnderJudgment - AC ids currently being scored ({@link computeAcIdsUnderJudgment})
 * @returns The rendered evidence block, or `"(no evidence recorded)"` when absent/malformed
 *
 * @example
 * renderTaskEvidence(taskWithOneRow, new Set(["AC-X-1"]));
 * // => `  [1] oracle=test ac_ref=AC-X-1 result=pass command="bun test" tail_bytes=42\n      output_tail: ...`
 */
function renderTaskEvidence(task: PlanBundle["tasks"][number], acIdsUnderJudgment: ReadonlySet<string>): string {
  const raw = task.extra["verification_evidence"];
  if (!Array.isArray(raw) || raw.length === 0) return "(no evidence recorded)";

  const parsed = evidenceArraySchema.safeParse(raw);
  if (!parsed.success || parsed.data.length === 0) return "(no evidence recorded)";

  return parsed.data
    .map((e, i) => {
      const tailBytes = e.output_tail ? Buffer.byteLength(e.output_tail, "utf8") : 0;
      const acRef = e.ac_ref ?? "(none)";
      const line =
        `  [${i + 1}] oracle=${e.oracle} ac_ref=${acRef} result=${e.result} ` +
        `command="${e.command}" tail_bytes=${tailBytes}`;
      // reason: D1 — the full tail is shown ONLY for a row whose ac_ref names one of the
      // ids currently under judgment; every other row still gets its tail_bytes count above,
      // which is the load-bearing fact (an empty tail must be VISIBLE, not inferable).
      const showFullTail = e.ac_ref !== undefined && acIdsUnderJudgment.has(e.ac_ref) && e.output_tail;
      return line + (showFullTail ? `\n      output_tail: ${e.output_tail!.slice(0, 500)}` : "");
    })
    .join("\n");
}

/**
 * Evidence-row renderer signature injectable into the shared v6/v7 builder core
 * ({@link assembleFactsBasedAssessPrompt}) — SPEC-lore-assess-project-evidence-rows-
 * instead-of-embedding-the T5 ("parameterize, don't fork"). T3 changed `renderTaskEvidence`,
 * which is SHARED by `buildAssessPrompt` (v5) and the v6/v7 builder, while
 * `ASSESS_PROMPT_VERSION` stayed `6` — so a prompt stamped `prompt_version: 6` rendered
 * differently before and after that change. Both {@link renderTaskEvidenceV6OutputFrozen}
 * (`ASSESS_TEMPLATES[6]`) and {@link renderTaskEvidence} (`ASSESS_TEMPLATES[7]`) satisfy
 * this shape, so ONE builder body can bind either without a duplicated twin.
 */
type EvidenceRenderer = (
  task: PlanBundle["tasks"][number],
  acIdsUnderJudgment: ReadonlySet<string>,
) => string;

/**
 * OUTPUT-FROZEN pre-projection evidence renderer (SPEC-lore-assess-project-evidence-rows-
 * instead-of-embedding-the T5, AC-AEP-9) — byte-identical to `renderTaskEvidence`'s
 * behaviour BEFORE a639485 (T3) repurposed it into the `(oracle, ac_ref, result, command,
 * tail_bytes)` projection (captured verbatim from `git show a639485^:.../assess-template.ts`).
 * Registered as `ASSESS_TEMPLATES[6]` so `getAssessTemplate(6)` keeps rendering exactly
 * what it always has, independent of whatever `renderTaskEvidence` itself does for the
 * ACTIVE version — an assessment stamped `prompt_version: 6` must stay reproducible
 * (`reproducible: true` on this slot's {@link AssessTemplateRegistryEntry}). Ignores
 * `acIdsUnderJudgment` (this pre-projection shape has no "under judgment" concept —
 * every row's tail was shown unconditionally); the parameter exists only so this function
 * satisfies the shared {@link EvidenceRenderer} signature used by
 * {@link assembleFactsBasedAssessPrompt}.
 *
 * @param task - The task doc whose `extra.verification_evidence` is rendered
 * @param _acIdsUnderJudgment - Unused; present only for {@link EvidenceRenderer} conformance
 * @returns The rendered evidence block, or `"(no evidence recorded)"` when absent/malformed
 *
 * @example
 * renderTaskEvidenceV6OutputFrozen(taskWithOneRow, new Set());
 * // => `  [1] oracle=test command="bun test" result=pass recorder=alice\n      output_tail: ...`
 */
function renderTaskEvidenceV6OutputFrozen(
  task: PlanBundle["tasks"][number],
  _acIdsUnderJudgment: ReadonlySet<string>,
): string {
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

  // reason: SPEC-lore-assess-project-evidence-rows... D1 — the ids under judgment for v5
  // are the spec's full declared set (v5 has no plan-scope restriction, unlike v6's D5).
  const acIdsUnderJudgment = computeAcIdsUnderJudgment(declaredCriteria);
  const taskBlocks = bundle.tasks.map((task) => {
    // reason: task.content ALONE is what participates in max_task_chars (UNCHANGED from
    // pre-D1 behavior — AC-067-5 pins this in isolation via a tiny budget + zero evidence,
    // so evidence text must never enter this measurement). The compact per-row projection
    // (D1) is what keeps the RENDERED evidence text itself small regardless — AC-AEP-2
    // measures that compactness directly on the assembled block, not via this truncation flag.
    const taskSection = truncateSection(task.content, budgets.max_task_chars);
    if (taskSection.truncated) truncated.push(`task:${task.slug}`);
    return (
      `### Task: ${task.title} (${task.slug}, status=${task.status})\n` +
      `${taskSection.text}\n` +
      `Evidence:\n${renderTaskEvidence(task, acIdsUnderJudgment)}`
    );
  });

  let diffBlock = "(no diff provided)";
  let truncationManifest = "";
  let omittedDiffFiles: string[] = [];
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
    omittedDiffFiles = diffResult.omittedFiles;
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

  return { prompt, truncated, declaredAcIds: declaredCriteria.map((c) => c.id), omittedDiffFiles };
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
 * Shared v6/v7 builder core (SPEC-lore-assess-project-evidence-rows-instead-of-embedding-
 * the T5) — role → materials (same as v5: plan, spec ACs, per-task evidence, optional
 * diff) → **# Deterministic Facts** → rubric (v5's per-AC anchors PLUS a new
 * three-dimension rubric) → output instruction (v5's `ac_scores` shape PLUS
 * `dimension_scores`/`typed_gaps`/`typed_recommendations`/`unverifiable`), PARAMETERIZED
 * by which {@link EvidenceRenderer} projects each task's verification_evidence rows. Both
 * registered builders below — the OUTPUT-FROZEN `ASSESS_TEMPLATES[6]` and the active
 * `ASSESS_TEMPLATES[7]` — delegate here, binding {@link renderTaskEvidenceV6OutputFrozen} or
 * {@link renderTaskEvidence} respectively. ONE builder body, never a forked twin: forking
 * is exactly the defect T3 surfaced (`renderTaskEvidence` was shared, so changing it
 * changed BOTH v5's AND this builder's output even though `ASSESS_PROMPT_VERSION` didn't
 * move) — a duplicated twin would only reintroduce the same drift risk one level up, for
 * every non-evidence line in this prompt (facts section, rubric, output instruction).
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
 * @param evidenceRenderer - The {@link EvidenceRenderer} to project each task's evidence
 *   rows with — the ONLY behavioural difference between the output-frozen v6 entry and the
 *   active v7 entry.
 * @param requireFindingPaths - D1 (spec-judgment-surfaces-must-verify-before-they-certify-
 *   machine) — OPT-IN, defaults to `false`. `false` renders BYTE-IDENTICAL output to before
 *   this parameter existed (slots 6/7's `reproducible: true` guarantee depends on this
 *   default never changing) — `true` (registry slot 8 only, {@link buildAssessPromptV8})
 *   adds a `"paths"` array to the `typed_gaps[]` JSON shape and an instruction requiring
 *   every file path a finding names in `statement` to also appear there, verbatim.
 * @returns { prompt, truncated, declaredAcIds } — `declaredAcIds` is scope-restricted (D5)
 */
function assembleFactsBasedAssessPrompt(
  bundle: PlanBundle,
  diffText: string | undefined,
  budgets: AssessBudgets,
  facts: AssessmentFacts | undefined,
  evidenceRenderer: EvidenceRenderer,
  requireFindingPaths = false,
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

  // reason: the declared-id universe for the containment check narrows to the plan's
  // scoped subset when ac_scope is declared (D5) — hoisted above the task-block loop
  // (moved from its original post-loop position) so `computeAcIdsUnderJudgment` can use
  // the SAME scope-restricted set the "ac_id MUST be one of" output instruction uses below,
  // rather than a second, possibly-drifting derivation (AC-AEP-4).
  const scopedDeclaredCriteria = scopedIds
    ? declaredCriteria.filter((c) => scopedIds.has(c.id))
    : declaredCriteria;

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

  // reason: SPEC-lore-assess-project-evidence-rows... D1/D5 — v6's ids under judgment are
  // the plan-scope-restricted subset (the SAME set the "ac_id MUST be one of" instruction
  // below names), not the spec's full declared set.
  const acIdsUnderJudgment = computeAcIdsUnderJudgment(scopedDeclaredCriteria);
  const taskBlocks = bundle.tasks.map((task) => {
    // reason: task.content ALONE participates in max_task_chars (UNCHANGED — mirrors v5's
    // identical reasoning; AC-067-5 pins content-only measurement in isolation).
    const taskSection = truncateSection(task.content, budgets.max_task_chars);
    if (taskSection.truncated) truncated.push(`task:${task.slug}`);
    return (
      `### Task: ${task.title} (${task.slug}, status=${task.status})\n` +
      `${taskSection.text}\n` +
      // reason: SPEC-...T5 — the evidence rendering is the ONE thing that differs between
      // the output-frozen v6 entry and the active v7 entry; injected as a parameter rather
      // than forking this whole builder (AC-AEP-10).
      `Evidence:\n${evidenceRenderer(task, acIdsUnderJudgment)}`
    );
  });

  let diffBlock = "(no diff provided)";
  let truncationManifest = "";
  let omittedDiffFiles: string[] = [];
  if (diffText !== undefined) {
    const diffResult = truncateDiffByFile(diffText, budgets.max_diff_chars);
    if (diffResult.truncated) {
      for (const filePath of diffResult.omittedFiles) truncated.push(`diff:${filePath}`);
      if (diffResult.headTruncatedFile) truncated.push(`diff:${diffResult.headTruncatedFile.filePath}`);
    }
    diffBlock = diffResult.text;
    truncationManifest = buildTruncationManifest(diffResult.omittedFiles);
    omittedDiffFiles = diffResult.omittedFiles;
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
    `      "ac_ref": "<optional AC id>", "statement": "<<=500 chars>"` +
    (requireFindingPaths ? `,\n      "paths": ["<file path named in statement, verbatim>", ...]` : "") +
    ` }\n` +
    `  ],\n` +
    `  "typed_recommendations": [\n` +
    `    { "target": "spec"|"plan"|"prompt"|"skill"|"process", "action": "<<=500 chars>", "rationale": "<<=300 chars>" }\n` +
    `  ],\n` +
    `  "unverifiable": [\n` +
    `    { "material": "<string>", "reason": "<<=200 chars>" }\n` +
    `  ]\n` +
    `}\n` +
    (requireFindingPaths
      ? `Every file path you name in a typed_gaps[] finding's "statement" prose MUST also appear, ` +
        `verbatim, in that same finding's "paths" array — it is machine-verified against the ` +
        `exact commit this assessment covers, so do not paraphrase or normalize it. A finding ` +
        `naming no file path at all uses "paths": [].\n`
      : "") +
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

  return { prompt, truncated, declaredAcIds: scopedDeclaredCriteria.map((c) => c.id), omittedDiffFiles };
}

/**
 * The active assess judge prompt builder — binds {@link assembleFactsBasedAssessPrompt} to
 * the projected {@link renderTaskEvidence} (T3's `(oracle, ac_ref, result, command,
 * tail_bytes)` shape). Registered at `ASSESS_TEMPLATES[7]` via {@link buildAssessPromptV7}
 * below (the SAME function reference) — this export keeps the PRE-T5 name and behaviour
 * unchanged on purpose: AC-AEP-4 (SPEC-lore-assess-project-evidence-rows-instead-of-
 * embedding-the) pins a direct caller of `buildAssessPromptV6` asserting it renders the
 * identical projected evidence shape as `buildAssessPrompt` (v5), so this name could not be
 * repurposed to mean "output-frozen" without breaking that spec-level AC — the
 * output-frozen pre-projection entry is {@link buildAssessPromptV6OutputFrozen} instead, a
 * distinct function.
 *
 * @param bundle - {plan, spec?, tasks[], knowledge_links?} from CorpusService.getPlanBundle
 * @param diffText - Optional git diff / diff-file content (already read by the CLI layer)
 * @param budgets - Character budgets from config.ai.assess.*
 * @param facts - Pre-computed {@link AssessmentFacts}; see {@link assembleFactsBasedAssessPrompt}
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
  return assembleFactsBasedAssessPrompt(bundle, diffText, budgets, facts, renderTaskEvidence);
}

/**
 * Alias for {@link buildAssessPromptV6} under the name that matched ITS active registry
 * slot at the time (`ASSESS_TEMPLATES[7]`) — same shared core, same projected
 * {@link renderTaskEvidence}, byte-identical output for the same input. Now itself
 * OUTPUT-FROZEN (`reproducible: true`, slot `7`) since {@link buildAssessPromptV8} became
 * the active `ASSESS_PROMPT_VERSION` (D1). `buildAssessPromptV6` is kept only because
 * AC-AEP-4 pins a pre-existing direct caller of that historical name (see its own JSDoc for
 * why the name and the registry slot number diverge).
 */
export function buildAssessPromptV7(
  bundle: PlanBundle,
  diffText: string | undefined,
  budgets: AssessBudgets,
  facts?: AssessmentFacts,
): BuildAssessPromptResult {
  return assembleFactsBasedAssessPrompt(bundle, diffText, budgets, facts, renderTaskEvidence);
}

/**
 * The ACTIVE assess judge prompt builder (registry slot `8`, `ASSESS_PROMPT_VERSION`) — D1
 * (spec-judgment-surfaces-must-verify-before-they-certify-machine): same shared core and
 * projected {@link renderTaskEvidence} as {@link buildAssessPromptV7}, with
 * `assembleFactsBasedAssessPrompt`'s `requireFindingPaths` opt-in set to `true` — the ONLY
 * behavioural difference from v7. `buildAssessPromptV7` stays byte-identical (its own call
 * site never passes this new argument, so it keeps the parameter's `false` default) — this
 * is a NEW registry key, never a mutation of `7` in place, mirroring the v6→v7 transition's
 * own "parameterize the shared core" precedent.
 *
 * @param bundle - {plan, spec?, tasks[], knowledge_links?} from CorpusService.getPlanBundle
 * @param diffText - Optional git diff / diff-file content (already read by the CLI layer)
 * @param budgets - Character budgets from config.ai.assess.*
 * @param facts - Pre-computed {@link AssessmentFacts}; see {@link assembleFactsBasedAssessPrompt}
 * @returns { prompt, truncated, declaredAcIds } — `declaredAcIds` is scope-restricted (D5)
 */
export function buildAssessPromptV8(
  bundle: PlanBundle,
  diffText: string | undefined,
  budgets: AssessBudgets,
  facts?: AssessmentFacts,
): BuildAssessPromptResult {
  return assembleFactsBasedAssessPrompt(bundle, diffText, budgets, facts, renderTaskEvidence, true);
}

/**
 * OUTPUT-FROZEN registry entry for `ASSESS_TEMPLATES[6]` (SPEC-lore-assess-project-evidence-
 * rows-instead-of-embedding-the T5, AC-AEP-9) — the SAME shared
 * {@link assembleFactsBasedAssessPrompt} core as {@link buildAssessPromptV6}/
 * {@link buildAssessPromptV7}, bound to the pre-projection
 * {@link renderTaskEvidenceV6OutputFrozen} renderer instead of the active
 * {@link renderTaskEvidence}. This is what makes `getAssessTemplate(6)` stay
 * byte-identical to its behaviour before a639485 (T3), independent of whatever
 * `renderTaskEvidence` itself does for the active version — an assessment stamped
 * `prompt_version: 6` remains reproducible (`reproducible: true` on
 * {@link ASSESS_TEMPLATE_REGISTRY}[6]). Not exported: nothing outside this module's own
 * registry needs to call the output-frozen entry directly.
 */
function buildAssessPromptV6OutputFrozen(
  bundle: PlanBundle,
  diffText: string | undefined,
  budgets: AssessBudgets,
  facts?: AssessmentFacts,
): BuildAssessPromptResult {
  return assembleFactsBasedAssessPrompt(bundle, diffText, budgets, facts, renderTaskEvidenceV6OutputFrozen);
}

/**
 * One entry in {@link ASSESS_TEMPLATE_REGISTRY} — pairs a template BUILDER FUNCTION with its
 * REPRODUCIBILITY declaration (task-assess-templates-5-binds-the-projected-renderer-while-two,
 * per `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`'s Q2 generalization).
 *
 * `reproducible` answers, for THIS registry key specifically: is `getAssessTemplate(version)`'s
 * bound function guaranteed to render byte-identical output for the same input, FOREVER (no
 * future edit may change this key's behaviour in place — a behavioural change requires a NEW
 * key)? `true` on slots 6, 7, and 8 (all output-frozen, in the disambiguated sense above the
 * module's registry construction below); `false` on slot 5 — `buildAssessPrompt` is
 * slot-stable (key `5` never moves) but was EXPLICITLY exempted from the byte-identical
 * guarantee by SPEC-040 §T2 D6 ("no byte-identical guarantee required going forward"), and its
 * output genuinely changed at a639485 (T3) while the key stayed `5`. This field is the
 * GENERALIZATION the task's own three named options did not offer: freezing slot 5's output
 * (rejected option) would fix exactly one slot and defer the identical ambiguity to slots
 * 8, 9, … — a per-slot `reproducible` field answers the question for every CURRENT and
 * FUTURE slot at once, and makes the drift permission legible to a reader instead of merely
 * documented in prose three files away from where `prompt_version` is actually persisted
 * (`@lore/core`'s `assessment.ts`).
 */
export interface AssessTemplateRegistryEntry {
  fn: AssessTemplateFn;
  reproducible: boolean;
}

/**
 * Version-keyed registry of assess judge prompt builders (SPEC-040 §T2 D6, re-keyed by
 * SPEC-lore-assess-project-evidence-rows-instead-of-embedding-the T5, re-keyed again by D1
 * spec-judgment-surfaces-must-verify-before-they-certify-machine — mirrors
 * `review-template.ts`'s `REVIEW_TEMPLATES`) — the SSOT both {@link ASSESS_TEMPLATES}
 * (function-only view) and {@link getAssessTemplateReproducibility} derive from. `5` is the
 * SLOT-STABLE v5 entry (`buildAssessPrompt`) kept for provenance — key permanent,
 * `reproducible: false`; `6` is the OUTPUT-FROZEN pre-projection v6 entry
 * (`buildAssessPromptV6OutputFrozen` — byte-identical to `buildAssessPromptV6`'s behaviour
 * before T3/a639485, `reproducible: true`); `7` is the OUTPUT-FROZEN pre-D1 entry
 * (`buildAssessPromptV7`, T3's projected evidence renderer, `reproducible: true`); `8` is the
 * active `ASSESS_PROMPT_VERSION` entry (`buildAssessPromptV8`, D1's `typed_gaps[].paths`
 * requirement, `reproducible: true`). A future prompt revision adds a new key here rather
 * than mutating an existing one, so historical assessments' `judgment.prompt_version` stays
 * meaningful — and that new key MUST declare its own `reproducible` value rather than
 * inheriting one silently.
 */
const ASSESS_TEMPLATE_REGISTRY: Record<number, AssessTemplateRegistryEntry> = {
  5: { fn: buildAssessPrompt, reproducible: false },
  6: { fn: buildAssessPromptV6OutputFrozen, reproducible: true },
  7: { fn: buildAssessPromptV7, reproducible: true },
  8: { fn: buildAssessPromptV8, reproducible: true },
};

/**
 * Version-keyed registry of assess judge prompt BUILDER FUNCTIONS ONLY — derived from
 * {@link ASSESS_TEMPLATE_REGISTRY} (same function references, never cloned) so pre-existing
 * reference-identity-pinned tests (`ASSESS_TEMPLATES[5] === buildAssessPrompt`, etc. —
 * `assess-template-registry.test.ts`, `ai-provider-service-assess.test.ts`) continue to pass
 * unchanged. Prefer {@link ASSESS_TEMPLATE_REGISTRY} / {@link getAssessTemplateReproducibility}
 * for any NEW caller that also needs the reproducibility declaration.
 */
export const ASSESS_TEMPLATES: Record<number, AssessTemplateFn> = Object.fromEntries(
  Object.entries(ASSESS_TEMPLATE_REGISTRY).map(([version, entry]) => [version, entry.fn]),
);

/**
 * Result-returning lookup into {@link ASSESS_TEMPLATE_REGISTRY} (SPEC-040 §T2 D6) — an absent
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
/**
 * Shared "unregistered version" error builder for {@link getAssessTemplate} and
 * {@link getAssessTemplateReproducibility} — single message-construction site so the two
 * Result-returning lookups over {@link ASSESS_TEMPLATE_REGISTRY} can never drift on wording.
 */
function unregisteredAssessTemplateVersionError(version: number): LoreError {
  return {
    code: "AI_PROVIDER_ERROR",
    provider: "assess-template-registry",
    message:
      `No assess judge prompt template registered for version ${version}. ` +
      `Known versions: ${Object.keys(ASSESS_TEMPLATE_REGISTRY).join(", ")}.`,
  };
}

export function getAssessTemplate(version: number): Result<AssessTemplateFn, LoreError> {
  const entry = ASSESS_TEMPLATE_REGISTRY[version];
  if (entry === undefined) {
    return err(unregisteredAssessTemplateVersionError(version));
  }
  return ok(entry.fn);
}

/**
 * Result-returning lookup for the OTHER half of an {@link AssessTemplateRegistryEntry} — its
 * `reproducible` declaration — the counterpart {@link getAssessTemplate} does not expose
 * (that lookup returns only the callable function, preserving its pre-existing return type
 * for callers like `AIProviderService.assessPlan` that invoke the result directly). Added so
 * a version-agnostic caller can ask "is THIS prompt_version's rendering reproducible" without
 * duplicating {@link ASSESS_TEMPLATE_REGISTRY}'s per-slot answers anywhere else — e.g. the
 * judgment-stamping call site that persists `prompt_version` alongside a `reproducible` flag
 * (`packages/core/src/assessment.ts`'s `judgmentSchema`) should read this lookup rather than
 * re-deriving the answer.
 *
 * @param version - Registry key (typically {@link ASSESS_PROMPT_VERSION})
 * @returns `ok(reproducible)` when registered; `err(AI_PROVIDER_ERROR)` naming the version
 *   otherwise (same failure shape as {@link getAssessTemplate})
 *
 * @example
 * getAssessTemplateReproducibility(5); // → ok(false) — slot-stable, NOT output-frozen
 * getAssessTemplateReproducibility(7); // → ok(true)
 * getAssessTemplateReproducibility(999); // → err({ code: "AI_PROVIDER_ERROR", ... })
 */
export function getAssessTemplateReproducibility(version: number): Result<boolean, LoreError> {
  const entry = ASSESS_TEMPLATE_REGISTRY[version];
  if (entry === undefined) {
    return err(unregisteredAssessTemplateVersionError(version));
  }
  return ok(entry.reproducible);
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
