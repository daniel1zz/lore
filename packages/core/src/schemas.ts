/**
 * Zod validation schemas for the Lore corpus.
 * Runtime validation at service boundaries. Source: SPEC-002 §2, §3, §6.
 */

import { z } from "zod";
import type { DocRecord, DocStatus, DocType, Slug } from "./types.js";
import { DECISION_STATUSES, KNOWLEDGE_SUB_TYPES } from "./types.js";
import { evidenceEntrySchema, taskClaimSchema } from "./task-workflow.js";
import { VALID_TRANSITIONS } from "./lifecycle.js";
// reason: the transition graph moved to the leaf `lifecycle.ts` so `task-workflow.ts` can ask "is this status
// terminal?" without an import cycle (schemas.ts imports task-workflow.ts values at load time). Re-exported here
// verbatim so every existing importer of these names is unchanged.
export { isValidTransition, getAllowedTransitions, isTerminalStatus } from "./lifecycle.js";
import { uatVerdictSchema } from "./uat.js";
import { milestoneReviewSchema } from "./milestone-review.js";
import { prdRequirementsSchema } from "./requirement.js";
import { SPEC_KINDS } from "./spec-kind.js";
import { specAcceptanceCriteriaSchema } from "./acceptance.js";
import { handoffExtraSchema } from "./session.js";
import { WEIGHT_TABLE_KINDS } from "./decision-record.js";
import { validitySchema } from "./validity.js";
import { acScopeArraySchema, phaseExtraSchema } from "./phase.js";
import { baselineExtraSchema } from "./baseline.js";
import { templateDocumentExtraSchema } from "./template-document.js";
import { fnv1a32Hex } from "./slug-hash.js";
import { isSelfDeclaredOrdinalTitle, SELF_DECLARED_ORDINAL_TITLE_REFUSAL } from "./ordinal.js";
import type { MirrorHumanId } from "./ordinal.js";

// ─── Primitive Schemas ─────────────────────────────────────────────────────

/**
 * Slug format: {type}-{kebab-case-name}
 * Regex: ^[a-z][a-z0-9-]{1,62}[a-z0-9]$
 * Requires: starts with lowercase letter, ends with alphanumeric, total 3–64 chars
 */
export const slugSchema = z.string().regex(
  /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/,
  "Slug must be lowercase alphanumeric with hyphens, 3–64 chars, no leading/trailing hyphens",
);

export const docIdSchema = z.string().min(1);

// ─── Enum Schemas ──────────────────────────────────────────────────────────

export const docTypeSchema = z.enum([
  "prd",
  "spec",
  "adr",
  "plan",
  "knowledge",
  "task",
  "phase",
  "baseline",
  "template",
]);

export const docRoleSchema = z.enum([
  "intent",
  "spec",
  "decision",
  "plan",
  "knowledge",
]);

export const docStatusSchema = z.enum([
  "draft",
  "in-review",
  "approved",
  "active",
  "archived",
  "deprecated",
]);

export const prioritySchema = z.enum(["critical", "high", "medium", "low"]);

export const linkTypeSchema = z.enum([
  "parent",
  "implements",
  "informs",
  "supersedes",
  "relates-to",
  "blocks",
  // "governs": from = skill, to = artifact — the skill governed/fed that
  // artifact's production (P4 provenance). Plain typed edge, no lifecycle
  // or validation coupling beyond the generic link rules above.
  "governs",
  // "resolves" is RETIRED (spec-github-owns-issue-report-state-no-mirror-task-work-carries D1):
  // the carrier is `extra.issues` on a task or plan. Stored legacy rows are read by
  // `lore issues migrate`; CorpusService.link refuses to create a new one.
  // "known-defect" is RETIRED (spec-a-plan-s-known-defects-are-its-own-record-of-github-issues D1): a plan records
  // its known defects itself in `extra.known_defects`; the schema migration converts every old link into entries.
]);

/**
 * One GitHub issue reference, the element of `extra.issues` on a task or plan (the "carrier").
 * `repo_id` is GitHub's numeric repository id; the repository name is never part of identity.
 * Source: spec-github-owns-issue-report-state-no-mirror-task-work-carries D1.
 */
export const issueRefSchema = z.object({
  repo_id: z.number().int().positive(),
  number: z.number().int().positive(),
});
export type IssueRef = z.infer<typeof issueRefSchema>;

/** Upper bound on `extra.issues` length (spec D1: 1..50 distinct refs). */
export const MAX_ISSUE_REFS_PER_CARRIER = 50;

export const versionActionSchema = z.enum([
  "create",
  "update",
  "approve",
  "reject",
  "restore",
  "delete",
  "undelete",
]);

// ─── Type-specific Extra Schemas ───────────────────────────────────────────

/**
 * Zod schema for an adr document's `extra.decision_status` — SSOT is
 * `DECISION_STATUSES` (types.ts), mirroring the `SPEC_KINDS`/`specExtraSchema` precedent.
 */
export const decisionStatusSchema = z.enum(DECISION_STATUSES);

export const adrExtraSchema = z
  .object({
    decision_status: decisionStatusSchema,
    superseded_by: docIdSchema.optional(),
    /** Bi-temporal validity metadata (SPEC-043 D1) — written exclusively via
     *  `ValidityService.invalidate` (`lore invalidate`), never `lore set` (D10). */
    validity: validitySchema.optional(),
  })
  .passthrough();

/**
 * Extra fields for knowledge documents.
 *
 * @invariant sub_type "assessment" is the RETIRED plan-outcome assessment (BR-1372). Existing docs are archived and
 *   read as plain documents: `extra.assessment` rides the passthrough raw and no schema parses it. Creating a new one
 *   is refused by `CorpusService` (the value stays in `KNOWLEDGE_SUB_TYPES` only so the archived docs still validate).
 * Source: SPEC-002 §2 (base sub_types); spec-lean-governance-batch-verbs-judgment-only-at-milestones Part D
 */
/**
 * Zod schema for a knowledge document's `extra.sub_type` — SSOT is
 * `KNOWLEDGE_SUB_TYPES` (types.ts), mirroring the `SPEC_KINDS`/`specExtraSchema` precedent.
 */
export const knowledgeSubTypeSchema = z.enum(KNOWLEDGE_SUB_TYPES);

/**
 * Extra fields for a `knowledge` doc with `sub_type: "prompt"` — a reusable prompt
 * artifact riding knowledge's existing review/version/calibration machinery (upstream
 * asset consolidation; no new top-level doc type). Both fields are OPTIONAL — a
 * `sub_type: "prompt"` doc with no nested `extra.prompt` at all is still valid (unlike
 * `sub_type: "handoff"`, which hard-requires `extra.handoff` — prompts have no
 * analogous cross-field requirement).
 */
export const promptExtraSchema = z.object({
  /** Named placeholders the prompt template expects at render time, e.g. `["topic"]`. */
  variables: z.array(z.string()).optional(),
  /** Free-text label for where this prompt is consumed, e.g. "claude-code-slash-command". */
  target_surface: z.string().optional(),
});

/** Derived TypeScript type for `extra.prompt` on a `sub_type: "prompt"` knowledge doc. */
export type PromptExtra = z.infer<typeof promptExtraSchema>;

/**
 * Extra fields for a `knowledge` doc with `sub_type: "skill"` — a reusable skill
 * artifact, same upstream-asset rationale as {@link promptExtraSchema}. Both fields
 * optional for the same reason.
 */
export const skillExtraSchema = z.object({
  /** Free-text scope this skill applies to, e.g. "spec" or "task". */
  applies_to: z.string().optional(),
  /** Free-text description of when the skill should be invoked. */
  trigger: z.string().optional(),
});

/** Derived TypeScript type for `extra.skill` on a `sub_type: "skill"` knowledge doc. */
export type SkillExtra = z.infer<typeof skillExtraSchema>;

/**
 * `extra.weight_table` of a knowledge `reference` doc: the dimension weights a decision's scores are weighed with.
 * Every weight > 0 and the weights sum to 1 within 1e-9. Written only by `lore weights set`.
 */
export const weightTableSchema = z
  .object({
    kind: z.enum(WEIGHT_TABLE_KINDS),
    dimensions: z.record(z.string().min(1), z.number().positive()),
  })
  .superRefine((table, ctx) => {
    const weights = Object.values(table.dimensions);
    if (weights.length === 0) {
      ctx.addIssue({ code: "custom", path: ["dimensions"], message: "a weight table needs at least one dimension" });
      return;
    }
    const sum = weights.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 1e-9) ctx.addIssue({ code: "custom", path: ["dimensions"], message: `weights must sum to 1, got ${sum}` });
  });
export type WeightTable = z.infer<typeof weightTableSchema>;

export const knowledgeExtraSchema = z
  .object({
    sub_type: knowledgeSubTypeSchema,
    /** Present iff sub_type === "milestone-review" — the stored seven-dimension review (BR-1372). */
    milestone_review: milestoneReviewSchema.optional(),
    /** Present only on a `reference` doc used as a decision weight table (written only by `lore weights set`). */
    weight_table: weightTableSchema.optional(),
    /** Present only for sub_type === "prompt"; optional even then (see schema JSDoc). */
    prompt: promptExtraSchema.optional(),
    /** Present only for sub_type === "skill"; optional even then (see schema JSDoc). */
    skill: skillExtraSchema.optional(),
    /** Present iff sub_type === "handoff" — the Zod-typed SSOT lossless-handoff payload. */
    handoff: handoffExtraSchema.optional(),
    /** Present iff sub_type === "uat" — the Zod-typed SSOT UAT verdict (SPEC-054). */
    uat: uatVerdictSchema.optional(),
    /** Bi-temporal validity metadata (SPEC-043 D1) — written exclusively via
     *  `ValidityService.invalidate` (`lore invalidate`), never `lore set` (D10). */
    validity: validitySchema.optional(),
    /** Declared `path[#Symbol]` code anchors, scanned by `lore status --check-drift`
     *  (M2 of spec-a-write-side-fact-with-no-read-side-address-counts-with-no). A
     *  domain FACT filed as knowledge asserts things about code; without this field
     *  those assertions had no drift oracle at all. SHAPE-ONLY here, exactly like
     *  `specExtraSchema.code_anchors` — see that field's @invariant for why the
     *  per-entry grammar lives in `parseCodeAnchor` and never in this schema.
     *  Declared EXPLICITLY rather than left to `.passthrough()` so the shape is
     *  validated instead of merely tolerated. Written exclusively via `lore anchor
     *  add/rm` (`DriftCheckService`), never `lore set`. Eligible for ALL 9 sub_types:
     *  a retro's claim about code is exactly as falsifiable as a reference table's. */
    code_anchors: z.array(z.string()).optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    // reason: sub_type "assessment" is the retired plan-outcome assessment. Its docs are archived and read as plain
    // documents: the passthrough keeps `extra.assessment` raw and nothing parses it (BR-1372).
    if (data.sub_type === "milestone-review" && data.milestone_review === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "knowledge sub_type 'milestone-review' requires a Zod-valid extra.milestone_review",
        path: ["milestone_review"],
      });
    }
    // reason: same cross-field pattern as "assessment" above — sub_type "handoff"
    // requires a Zod-valid extra.handoff. This is a PRESENCE/SHAPE check only; WHO is
    // allowed to write sub_type "handoff" at all is a separate, forgeable-if-done-here
    // concern (extra.handoff is user-supplied data, unlike an LLM-generated assessment
    // blob) enforced by `CorpusService._createImpl`'s writer-identity guard, not Zod.
    // Source: SPEC-041 §3 D3, D4.
    if (data.sub_type === "handoff" && data.handoff === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "knowledge sub_type 'handoff' requires a Zod-valid extra.handoff",
        path: ["handoff"],
      });
    }
    // reason: same cross-field pattern — sub_type "uat" requires a Zod-valid extra.uat
    // (SPEC-054). Presence/shape check only; WHO may write sub_type "uat" is enforced by
    // `CorpusService._createImpl`'s writer-identity guard (mirrors "handoff"), since
    // extra.uat is user-supplied data that a bare presence check cannot make unforgeable.
    if (data.sub_type === "uat" && data.uat === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "knowledge sub_type 'uat' requires a Zod-valid extra.uat",
        path: ["uat"],
      });
    }
    // Note: sub_type "prompt" / "skill" deliberately have NO analogous presence check —
    // extra.prompt / extra.skill are optional even under their matching sub_type; the
    // `prompt`/`skill` schema keys above already validate shape when present, via the
    // base object's own field parsing (no dispatch needed here).
  });

/**
 * Extra fields for task documents.
 *
 * @invariant `task_status` (legacy `todo|in-progress|done|blocked` field) was removed
 *   from the explicit shape (SPEC-025 D6 — zero business-logic consumers, would have
 *   drifted from computed readiness as a second parallel state signal). `.passthrough()`
 *   means legacy docs that still carry `extra.task_status` continue to validate — the
 *   key is preserved, just no longer schema-checked or read by any service.
 *   Source: SPEC-025 §3 D6, §4 AC-WF-12
 * @invariant `verification_evidence` is append-only, capped at 50 entries — the 51st
 *   append fails loud with VALIDATION_ERROR before any write (SPEC-025 §4 AC-WF-2).
 * @invariant `claim` is an advisory execution lease; expiry is computed read-side via
 *   `isClaimStale`, never stored (SPEC-025 §3 D2).
 * @invariant `file_anchors` is DELIBERATELY UNBOUNDED here (a bare array of
 *   strings, no `.max()`/per-entry length caps) — every bound (≤50 entries,
 *   ≤512 chars each) and every normalization rule (no leading "/", no "..", no
 *   "\", trailing-slash directory-scope semantics, dedup) lives EXCLUSIVELY in
 *   the shared pure `normalizeFileAnchors` (`file-anchors.ts`), called at every
 *   write seam (create-time `--anchor`, `TaskWorkflowService.setAnchors`/
 *   `addAnchors`/`removeAnchors`) — never re-derived here (SPEC-042 §3 D3).
 *   DO NOT add a `.max()`/length cap to this field — not because a cap would
 *   misreport (see below), but because duplicating ONE of
 *   `normalizeFileAnchors`'s bounds here would fork the SSOT: the Zod copy and
 *   the pure-function copy would then both have to be kept in step. The single
 *   field-specific error comes from `CorpusService._createImpl`'s dedicated
 *   `normalizeFileAnchors` call, which runs AFTER the top-level parse.
 *   HISTORICAL NOTE (fixed): this invariant used to cite a second reason — that
 *   `createDocInputSchema`'s superRefine collapsed ANY `taskExtraSchema`
 *   failure into the misleading `"task requires extra.plan_id"` message. That
 *   branch now FORWARDS each real issue (matching the adr/knowledge branches),
 *   so a strict field here would report itself correctly; `ac_scope` below
 *   relies on exactly that. The SSOT reason above stands on its own.
 *   Written exclusively via the sanctioned seams; never through
 *   `CorpusService.set` (D3 — a wholesale-extra replace flag was deliberately
 *   not built for anchors).
 * @invariant `plan_id` is REQUIRED unless `adhoc === true` (SPEC-069 §Design
 *   Decisions D2, ad-hoc task channel). Zod's declarative `.optional()` alone
 *   cannot express "required unless flag X" — the superRefine below is the
 *   real enforcement point; `plan_id: docIdSchema.optional()` only widens the
 *   SHAPE so an ad-hoc task's absent `plan_id` doesn't fail before the
 *   superRefine gets a chance to look at `adhoc`.
 */
export const taskExtraSchema = z
  .object({
    plan_id: docIdSchema.optional(),
    assignee: z.string().optional(),
    /**
     * Optional phase grouping name. When present, validated against the parent
     * plan's extra.phases[].name in CorpusService.create / set (AC-PHASE-3).
     * Source: SPEC-023 §4 AC-PHASE-2
     */
    phase: z.string().optional(),
    /**
     * Append-only oracle verification log. Max 50 entries (SPEC-025 §4 AC-WF-2).
     * Written exclusively via TaskWorkflowService.addEvidence — never patched in place.
     */
    verification_evidence: z.array(evidenceEntrySchema).max(50).optional(),
    /**
     * Advisory execution lease. Written exclusively via TaskWorkflowService.claim/release.
     * Source: SPEC-025 §3 D2
     */
    claim: taskClaimSchema.optional(),
    /**
     * Declared file/directory scopes this task touches — the worktree-mutex
     * safety net's SSOT (SPEC-042 §3 D3). See this schema's own @invariant above.
     */
    file_anchors: z.array(z.string()).optional(),
    /**
     * Marks this task as planless (SPEC-069 §Design Decisions D2, ad-hoc task
     * channel). Set only via `lore create task --adhoc`; relaxes `plan_id`
     * (this schema's superRefine below) AND `parent_id`
     * (`createDocInputSchema`'s superRefine) — `CorpusService._createImpl`
     * parents the doc to the corpus root PRD instead of a plan. Mutually
     * exclusive with `plan_id`/`phase` at the CLI validation layer
     * (`create-task-validation.ts`), never re-checked here — this schema
     * stays a pure shape+plan_id-presence gate.
     */
    adhoc: z.boolean().optional(),
    /**
     * Free-text justification for WHY this task is attached to `plan_id`
     * despite looking unrelated to the plan's declared scope (SPEC-069
     * §Design Decisions D3). Verbatim input, no shape constraint beyond
     * "a string" — surfaced in `computeAssessmentFacts`'s scope-fidelity
     * facts (`assessment.ts`) so an explained attachment reads differently
     * from silent drift. Mutually exclusive with `adhoc` at the CLI
     * validation layer, same reason as above.
     */
    linkage: z.string().optional(),
    /**
     * Declared contract projection — the subset of the governing spec's AC ids
     * THIS task claims (spec-declared-scope-attestation-contract-task-owned-
     * ac-scope §Contract Details). See {@link acScopeArraySchema} (shared with
     * `phaseExtraSchema`) for the shape and the empty-vs-absent contract.
     *
     * Written exclusively via `lore scope add|rm` (→ `computeAcScopeEdit`, the
     * single edit site for both tiers) and `lore create task --ac-scope`. There
     * is deliberately NO `lore set --ac-scope`: `set` replaces `extra`
     * wholesale, the same reason `file_anchors`/`claim`/`verification_evidence`
     * each have a dedicated writer.
     */
    ac_scope: acScopeArraySchema.optional(),
    /**
     * Declares that this task's tests were written RED FIRST — the test file
     * was executed and OBSERVED FAILING before its implementation landed
     * (task-red-first-discipline-is-asked-for-in-prose-but-never). A task
     * carrying `red_first: true` is held to an ADDITIONAL floor at
     * `TaskWorkflowService.done` time, alongside the pre-existing
     * `result: "pass"` floor: at least one `"expected-fail"`/`"fail"`
     * evidence entry must be present, proving the claimed RED run was
     * actually RECORDED — not merely performed and then forgotten (the exact
     * gap this field closes; see the origin task's "Why this is a mechanism
     * gap" section). A task that never sets this flag is completely
     * unaffected — `done()`'s additional floor only evaluates when
     * `red_first === true`; anything else (absent, `false`, or a malformed
     * non-boolean value from a legacy/corrupted row) reads as "not declared"
     * (mirrors `readClaim`/`readEvidence`'s "malformed → safe default"
     * contract, never a crash).
     *
     * Written exclusively via `TaskWorkflowService.declareRedFirst`
     * (`lore red-first <task>`) — deliberately NO create-time
     * `lore create task --red-first` flag (this claim is commonly made
     * AFTER a task already exists, once its tests are written) and
     * deliberately NO `lore set --red-first` (wholesale `extra` replace,
     * same reason `file_anchors`/`claim`/`verification_evidence`/`ac_scope`
     * each have a dedicated writer instead).
     *
     * Source: task-red-first-discipline-is-asked-for-in-prose-but-never
     */
    red_first: z.boolean().optional(),
    /**
     * Bi-temporal validity metadata (SPEC-043 D1) — a task is a SECOND
     * eligible type alongside knowledge/adr as of
     * task-a-task-cannot-be-retracted-supersedes-emits-a-repair (Defect 2):
     * `draft`/`in-review` tasks had no retraction path visible to
     * `list`/`ready`/`search` at all (`VALID_TRANSITIONS` only reaches
     * `deprecated` from `approved`/`active`, and a task caught wrong while
     * still `draft` — the normal case, since that is when it gets reviewed —
     * could never be deprecated). Written exclusively via
     * `ValidityService.invalidate` (`lore invalidate`), never `lore set`
     * (D10 applies here too). ORTHOGONAL to `status` (D5) — a task's
     * workflow lifecycle is untouched by retraction; a `draft` task can be
     * bi-temporally invalid while its `status` stays `draft`.
     *
     * Deliberately NOT reachable via `lore create task --supersedes` (the
     * create-time compose flag stays scoped to knowledge/adr, SPEC-043 D11's
     * original intent — see `SUPERSEDE_CREATE_ELIGIBLE_TYPES`,
     * `packages/lore/src/flows/supersede-flow.ts`) — a task is retracted via the
     * two-step `lore create task` + `lore invalidate <old> --superseded-by
     * <new>` flow instead, matching how this task's own real-world fixture
     * was actually retracted (the replacement task was created FIRST, as an
     * independent command).
     */
    validity: validitySchema.optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    if (data.adhoc !== true && data.plan_id === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "plan_id is required unless extra.adhoc is true",
        path: ["plan_id"],
      });
    }
    // reason: BR-1468 — work on declared files needs a branch; the one-time back-fill released every such no-branch claim.
    if (data.claim !== undefined && data.claim.branch === undefined && (data.file_anchors?.length ?? 0) > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a claim that names no branch cannot be held on a task with file anchors (work-needs-branch)",
        path: ["claim"],
      });
    }
  });

/**
 * One declared phase on a plan document.
 * name is case-sensitive, trimmed at write time (Q-extra, SPEC-023 §8).
 * Source: SPEC-023 §4 AC-PHASE-1
 */
export const planPhaseSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

/** Derived TypeScript type for a declared plan phase. */
export type PlanPhase = z.infer<typeof planPhaseSchema>;

/**
 * Extracts and validates a plan's declared `extra.phases[]` array. Returns `[]`
 * when absent, malformed, or not an array — mirrors the "extract, tolerate
 * malformed" shape `task-workflow.ts::extractEvidence`/`readClaimRecord` and
 * `phase-workflow-service.ts`'s own `readAcScope`/`readChecklist` already use
 * (`z.array(schema).safeParse`, never a hand-rolled type guard).
 *
 * Exported from `@lore/core` (rather than living as a service-local private
 * helper, `phase-service.ts`'s pre-existing `extractPhases`) so a SECOND
 * service — `PhaseWorkflowService.planPhaseStatus` (adr-planphasestatus-
 * projects-declared-extra-phases-alongside) — can read the SAME declared-phase
 * list without a forbidden cross-service import (services never import each
 * other; `@lore/core` is the shared leaf dependency both may reach).
 * `phase-service.ts`'s own `extractPhases` is untouched (out of scope; a
 * behaviorally-narrower manual type guard, not re-derived here to avoid an
 * unrelated behavior change to that file).
 *
 * @param plan - A `plan`-typed DocRecord (caller's responsibility to check
 *   `type === "plan"` first — this function does not validate doc type).
 * @returns Every entry in `extra.phases` that parses as a valid {@link PlanPhase}
 *   (non-empty `name`, optional `description`); `[]` on absence/malformed shape.
 * @example
 *   extractDeclaredPhases(planDoc); // => [{name: "Phase 1"}, {name: "Phase 2"}]
 */
export function extractDeclaredPhases(plan: DocRecord): PlanPhase[] {
  const raw = plan.extra["phases"];
  if (!Array.isArray(raw)) return [];
  const parsed = z.array(planPhaseSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/**
 * `plan.extra.ac_scope` — the subset of the parent spec's declared `AC-*` ids this plan
 * claims to address. Non-empty array of non-empty strings; `.min(1)` on BOTH the array
 * and each element catches the "empty array" and "empty-string id" shapes at the Zod
 * layer. Cross-entity membership (every id must actually be declared on the parent spec,
 * and the plan must actually HAVE a spec parent) cannot be expressed in Zod — that check
 * lives in `CorpusService._createImpl`/`set` (SPEC-040 D5), mirroring the
 * `phases[].name`-vs-task-`extra.phase` cross-entity pattern already established for
 * plan phases in this same file.
 *
 * Source: SPEC-040 §T2 D5
 */
export const planAcScopeSchema = z.array(z.string().min(1)).min(1);

/**
 * Extra fields for plan documents.
 *
 * @invariant phases[].name is unique within the array (enforced via superRefine).
 * @invariant phases is capped at 30 entries (soft-limit: SPEC-023 §6 risk table).
 * @invariant legacy_phase holds the original extra.phase string after `lore migrate phases` runs.
 * @invariant ac_scope, when present, is a non-empty array of non-empty AC-id strings
 *   (shape only — see {@link planAcScopeSchema} — cross-entity membership validation is
 *   CorpusService's job, SPEC-040 D5).
 *
 * Source: SPEC-023 §4 AC-PHASE-1, §8 Q2; SPEC-040 §T2 D5
 */
export const planExtraSchema = z
  .object({
    /**
     * Legacy singular phase string — present only on docs authored before `lore migrate phases`
     * was run. After migration this field is removed and extra.legacy_phase holds the old value.
     * Source: SPEC-023 §8 Q2
     */
    phase: z.string().optional(),
    /**
     * Declared phases for this plan. Tasks may reference these by name via extra.phase.
     * Uniqueness of name is enforced by Zod superRefine at write time.
     */
    phases: z.array(planPhaseSchema).max(30).optional(),
    /** Populated by `lore migrate phases` from the former singular extra.phase. */
    legacy_phase: z.string().optional(),
    /** SPEC-040 D5 — see {@link planAcScopeSchema}. */
    ac_scope: planAcScopeSchema.optional(),
    /**
     * SPEC-054 — opt-in to the `plan-close` UAT gate. When `true`, this plan may only be
     * archived (closed) after a linked UAT verdict shows P0 acceptance
     * (`CorpusService.getLatestUatVerdict` + the `plan-close` checkpoint). Absent/false →
     * the plan archives unchanged (opt-out, non-breaking).
     */
    requires_uat: z.boolean().optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    // reason: z.array() has no built-in uniqueness validator — must use superRefine.
    // Colliding index is flagged individually so callers can pinpoint the duplicate.
    // Source: SPEC-023 §4 AC-PHASE-1
    if (!data.phases) return;
    const seen = new Set<string>();
    for (let i = 0; i < data.phases.length; i++) {
      const entry = data.phases[i];
      if (!entry) continue;
      const name = entry.name;
      if (seen.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "phases[].name must be unique",
          path: ["phases", i, "name"],
        });
      }
      seen.add(name);
    }
  });

/**
 * Zod schema for a plan's `extra.attestation_exempt_kind`
 * (spec-verify-reachability-plan-promote-early-warning §Scope M3) — REQUIRED
 * whenever `extra.attestation_exempt === true` (enforced by
 * `gate-predicates.ts::attestationExemptKindValid`, consumed by
 * `checkpoint-registry.ts::checkPlanClose`). Distinguishes WHY a closing plan
 * cannot/does not carry runner-attested evidence, so audit readers can tell
 * "unverified" apart from "verified but unattestable":
 *   - `"red-tdd"`: canonical case — a red/TDD task's Expected state is a
 *     currently-failing, time-bound test; attesting it would misrepresent an
 *     intentionally-red state as verified.
 *   - `"no-oracle"`: no oracle exists at all for the exempted work (nothing
 *     to run, so nothing attestable in principle).
 *   - `"pipeline-unreachable"`: oracles exist and ran, but `lore verify` is
 *     structurally unreachable for this plan (no ancestor spec, or the
 *     ancestor spec declares zero script-mode acceptance criteria) — see
 *     `gate-predicates.ts::verifyReachability`.
 *   - `"other"`: any other plan-level rationale, still requiring a non-empty
 *     free-text `extra.attestation_exempt_reason` alongside it.
 *
 * Deliberately no `.optional()` default / legacy fallback at this schema
 * level — `attestationExemptKindValid` is the fail-loud enforcement point;
 * this schema only defines what a VALID value looks like once one is given.
 */
export const attestationExemptKindSchema = z.enum([
  "red-tdd",
  "no-oracle",
  "pipeline-unreachable",
  "other",
]);

/**
 * The four permitted `extra.attestation_exempt_kind` values as a TypeScript
 * union, derived from {@link attestationExemptKindSchema} rather than restated
 * — the authoring surface (`lore plan exempt-attestation --kind`) types its
 * accepted value against this, so the schema stays the ONE definition site for
 * both the runtime check and the compile-time shape.
 */
export type AttestationExemptKind = z.infer<typeof attestationExemptKindSchema>;

export const prdExtraSchema = z
  .object({
    /**
     * SPEC-055 — the structured requirement inventory. Typed array of numbered `R-##`
     * requirements, written exclusively via `lore requirement add/rm` (`RequirementService`);
     * consumed by the `lore status --check-requirements` completeness oracle. Optional +
     * `.passthrough()` → every pre-SPEC-055 PRD (no requirements) stays valid.
     */
    requirements: prdRequirementsSchema.optional(),
  })
  .passthrough();

/**
 * Extra fields for spec documents.
 *
 * @invariant `spec_kind` classifies what a spec primarily describes (SPEC-032 §3.1
 *   taxonomy). The field is OPTIONAL here — Zod's `superRefine` cannot inject a
 *   default (only `addIssue`), so this schema layer validates ONLY: an absent
 *   field stays valid (100+ pre-SPEC-032 specs are unaffected), while an explicit
 *   unknown value fails loud. The default-on-create ("feature" when absent) is
 *   materialized by `CorpusService._createImpl` (packages/lore/src/service),
 *   never here.
 * @invariant `acceptance_criteria` is OPTIONAL and, when present, delegates fully
 *   to `specAcceptanceCriteriaSchema` (acceptance.ts) — max 50 entries, unique
 *   `id`. Written exclusively via `lore ac add/rm` (`AcService`, SPEC-038 §6),
 *   never here directly; this schema only gates the shape at create/set time.
 * @invariant `code_anchors` is SHAPE-ONLY here (a bare array of strings, no
 *   `.max()`/per-entry grammar) — the per-entry `path[#Symbol]` grammar
 *   (SPEC-045 §Design Decisions D1) lives EXCLUSIVELY in the shared pure
 *   `parseCodeAnchor` (`@lore/core`, code-anchors.ts), run at every write seam
 *   (`CorpusService._createImpl`/`set`, `DriftCheckService.addCodeAnchors/
 *   removeCodeAnchors/setCodeAnchors`) — never re-derived here. Same
 *   permissive-shape rationale as `taskExtraSchema.file_anchors` above: keeping
 *   this field unbounded at the Zod layer means a grammar-invalid entry is
 *   reported by the dedicated per-entry check (which names the offending
 *   anchor), not collapsed into a generic top-level parse failure.
 * Source: SPEC-032 §3.1; SPEC-038 §3, §7 D1; SPEC-045 §Design Decisions D1, D6a
 */
export const specExtraSchema = z
  .object({
    spec_kind: z.enum(SPEC_KINDS).optional(),
    acceptance_criteria: specAcceptanceCriteriaSchema.optional(),
    code_anchors: z.array(z.string()).optional(),
  })
  .passthrough();

// ─── CreateDocInput Schema ─────────────────────────────────────────────────

/**
 * A title with at least one non-whitespace character — the ONE title schema for create and patch.
 * `.min(1)` alone let `"   "` through (DC2-8): the stored title renders as nothing and slugifies
 * to a bare type word. The value is NOT trimmed — only blank is refused — so stored bytes stay.
 */
export const nonBlankTitleSchema = z
  .string()
  .min(1, "Title must not be empty")
  .refine((value) => value.trim().length > 0, "Title must not be blank (whitespace only)");

const baseCreateDocInputSchema = z.object({
  type: docTypeSchema,
  // reason: .min(1) enforces the AC-DASH-WRITE-10 requirement that client-side Zod
  // validation rejects empty title before making an HTTP call (SPEC-022 §9).
  title: nonBlankTitleSchema,
  content: z.string().optional(),
  parent_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  extra: z.record(z.unknown()).optional(),
  priority: prioritySchema.optional(),
  // D2 (spec-a-github-filed-defect-must-be-claimable-one-ingest-seam): an
  // OPTIONAL verbatim slug. When present, `CorpusService.create` uses it
  // AS-IS — no `slugifyWithCollision` suffixing — and the store's UNIQUE
  // index on `docs.slug` becomes the sole arbiter of identity, surfacing a
  // collision as a typed `DUPLICATE_SLUG` error (never a silently aliased
  // "-2" suffix). Mirrors `docPatchSchema.slug` (below, the *update* path's
  // equivalent field). Absent (every pre-existing caller) preserves today's
  // generated-slug behavior exactly.
  slug: slugSchema.optional(),
});

/**
 * Validates document creation input with type-specific rules:
 * - spec: requires parent_id
 * - task: requires parent_id AND extra.plan_id
 * - adr: requires extra.decision_status
 * - knowledge: requires extra.sub_type
 */
export const createDocInputSchema = baseCreateDocInputSchema.superRefine(
  (data, ctx) => {
    const { type, title, parent_id, extra } = data;

    // title purity (SPEC-084 D6) — spec/adr titles are pure prose; a title
    // self-declaring a display id (e.g. "SPEC-99 — …") races with the
    // store-atomic allocator (the SPEC-084 incident's exact root cause).
    // Applies regardless of exempt kind — see isSelfDeclaredOrdinalTitle's
    // own doc comment ("exemptKinds semantics" clarification).
    if (isSelfDeclaredOrdinalTitle(type, title)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `${SELF_DECLARED_ORDINAL_TITLE_REFUSAL} — the ordinal is allocated at create; write the bare title`,
        path: ["title"],
      });
    }

    // task and phase require parent_id (spec takes none — BR-1; phase: SPEC-056 D1 — always a plan).
    // reason: an ad-hoc task (SPEC-069 §Design Decisions D2, extra.adhoc === true)
    // is the ONE exception — it deliberately supplies no --parent/--plan-id;
    // CorpusService._createImpl resolves parent_id to the corpus root PRD instead.
    // Zod cannot see that resolution (it happens after this parse succeeds), so
    // this check must not fire for that one shape.
    if ((type === "task" || type === "phase") && !parent_id) {
      const isAdhocTask =
        type === "task" && (extra as { adhoc?: unknown } | undefined)?.adhoc === true;
      if (!isAdhocTask) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `parent_id is required for type '${type}'`,
          path: ["parent_id"],
        });
      }
    }

    // adr requires extra.decision_status (and, when extra.validity is present, a
    // schema-valid one — SPEC-043 D10/S1). reason: forward adrExtraSchema's own issues
    // (mirroring the knowledge branch below) instead of collapsing every failure into
    // the single decision_status message — a valid decision_status with a malformed
    // extra.validity must report the REAL validity issue, not a misleading
    // "requires extra.decision_status" message (SPEC-042 T1 bug class, twice-paid).
    if (type === "adr") {
      const adrResult = adrExtraSchema.safeParse(extra ?? {});
      if (!adrResult.success) {
        for (const issue of adrResult.error.issues) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              issue.path[0] === "decision_status"
                ? "adr requires extra.decision_status (proposed|accepted|deprecated|superseded)"
                : issue.message,
            path: ["extra", ...issue.path],
          });
        }
      }
    }

    // knowledge requires extra.sub_type (and the payload its sub_type needs, e.g. milestone-review's).
    // reason: forward knowledgeExtraSchema's own issues (the specific "requires extra.<payload>"
    // superRefine message) instead of a single generic string, so a valid sub_type with a
    // missing/invalid payload reports the real cause.
    if (type === "knowledge") {
      const knowledgeResult = knowledgeExtraSchema.safeParse(extra ?? {});
      if (!knowledgeResult.success) {
        for (const issue of knowledgeResult.error.issues) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              issue.path[0] === "sub_type"
                ? "knowledge requires extra.sub_type (ideation|retro|research|reference|assessment|milestone-review|prompt|skill|handoff)"
                : issue.message,
            path: ["extra", ...issue.path],
          });
        }
      }
    }

    // baseline requires a schema-valid extra (node, rules, ...). Node/parent consistency is
    // cross-entity and checked by the caller via validateBaselineParent (baseline.ts).
    if (type === "baseline") {
      const baselineResult = baselineExtraSchema.safeParse(extra ?? {});
      if (!baselineResult.success) {
        for (const issue of baselineResult.error.issues) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            // reason: a wrong-tree kind is a custom issue that already names the tree; only a missing /
            // unknown node gets the generic "requires extra.node" line.
            message:
              issue.path[0] === "node" && issue.code !== z.ZodIssueCode.custom
                ? "baseline requires extra.node (business: root|branch|leaf; tree=architecture: root|section|module-card|standard|debt-registry)"
                : issue.message,
            path: ["extra", ...issue.path],
          });
        }
      }
    }

    // template: extra.template must satisfy the core meta-schema; ALL issues in one message.
    if (type === "template") {
      const templateResult = templateDocumentExtraSchema.safeParse(extra ?? {});
      if (!templateResult.success) {
        for (const issue of templateResult.error.issues) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue.message, path: ["extra", ...issue.path] });
        }
      }
    }

    // task requires extra.plan_id.
    // reason: forward taskExtraSchema's own issues (mirroring the adr/knowledge
    // branches above) instead of collapsing EVERY failure into the plan_id
    // message — the SPEC-042 T1 bug class, twice-paid there. Before this, any
    // other malformed task-extra field (e.g. a blank `ac_scope` id) reported
    // "task requires extra.plan_id" even with plan_id present, which is how
    // `file_anchors` ended up documented as "must stay permissive at the Zod
    // layer" (see taskExtraSchema's own @invariant). The plan_id override keeps
    // the well-known message for the field it actually names.
    if (type === "task") {
      const taskResult = taskExtraSchema.safeParse(extra ?? {});
      if (!taskResult.success) {
        for (const issue of taskResult.error.issues) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: issue.path[0] === "plan_id" ? "task requires extra.plan_id" : issue.message,
            path: ["extra", ...issue.path],
          });
        }
      }
    }

    // phase requires extra.plan_id (SPEC-056 D1 — mirrors the task branch above;
    // phase generalizes/supersedes task at the plan-execution tier, including
    // that branch's issue-forwarding rationale)
    if (type === "phase") {
      const phaseResult = phaseExtraSchema.safeParse(extra ?? {});
      if (!phaseResult.success) {
        for (const issue of phaseResult.error.issues) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: issue.path[0] === "plan_id" ? "phase requires extra.plan_id" : issue.message,
            path: ["extra", ...issue.path],
          });
        }
      }
    }

    // plan: validate extra.phases uniqueness via planExtraSchema if present
    // reason: cross-field uniqueness cannot be expressed in the base schema shape;
    // we delegate to planExtraSchema.safeParse to invoke its superRefine check.
    // Source: SPEC-023 §4 AC-PHASE-1
    if (type === "plan" && extra !== undefined) {
      const planResult = planExtraSchema.safeParse(extra);
      if (!planResult.success) {
        for (const issue of planResult.error.issues) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: issue.message,
            path: ["extra", ...issue.path],
          });
        }
      }
    }

    // spec: validate extra.spec_kind against the taxonomy, if present.
    // reason: spec_kind is OPTIONAL (the service layer defaults it to "feature" on
    // create when absent — CorpusService._createImpl) — only an EXPLICIT invalid
    // value must fail loud. Same delegate-to-schema pattern as the plan branch above.
    // Source: SPEC-032 §3.1
    if (type === "spec" && extra !== undefined) {
      const specResult = specExtraSchema.safeParse(extra);
      if (!specResult.success) {
        for (const issue of specResult.error.issues) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: issue.message,
            path: ["extra", ...issue.path],
          });
        }
      }
    }
  },
);

export type CreateDocInput = z.infer<typeof createDocInputSchema>;

// ─── DocPatch Schema ───────────────────────────────────────────────────────

/** Partial update schema — all fields optional */
export const docPatchSchema = z.object({
  title: nonBlankTitleSchema.optional(),
  content: z.string().optional(),
  status: docStatusSchema.optional(),
  priority: prioritySchema.optional(),
  tags: z.array(z.string()).optional(),
  extra: z.record(z.unknown()).optional(),
  slug: slugSchema.optional(),
});

export type DocPatch = z.infer<typeof docPatchSchema>;

// ─── Lifecycle Transition Graph ────────────────────────────────────────────

/**
 * Doc types that may take the reopen-only `approved → draft` edge (spec D5, BR-1050).
 * Deliberately NOT part of {@link VALID_TRANSITIONS}: `lore set --status draft` on an
 * approved doc stays refused; only `ReviewService.reopen` consults this.
 */
export const REOPEN_ALLOWED_TYPES = ["spec"] as const;

/**
 * True only for the reopen edge: a spec going `approved → draft`.
 * Never widens {@link isValidTransition} / {@link getAllowedTransitions}.
 */
export function isReopenTransition(type: DocType, from: DocStatus, to: DocStatus): boolean {
  return (
    (REOPEN_ALLOWED_TYPES as readonly DocType[]).includes(type) &&
    from === "approved" &&
    to === "draft"
  );
}

/**
 * The ONE implementation of the contract-edit demotion rule: an `approved` doc
 * whose governing contract content changes returns to `draft`, because a changed
 * contract has not been reviewed.
 *
 * Lives here, beside {@link VALID_TRANSITIONS}, because it is the same KIND of
 * rule — a lifecycle authority over `DocStatus` — and because its two consumers
 * live in DIFFERENT services that are forbidden to import each other
 * (`packages/lore/src/service/CLAUDE.md`: *"service per concern, no cross-service
 * imports — composition lives in app.ts"*):
 *
 *   - `CorpusService.set` — a `content`/`title` edit; passes its own measured
 *     change flag, since a `priority`/`tags`/`slug`-only patch is not a contract
 *     change (slug is an address, not content).
 *   - `AcService.setCriterion` — an in-place acceptance-criterion edit; passes a
 *     literal `true`, because such an edit is ALWAYS a contract change by
 *     construction (an empty patch is rejected before the write is reached).
 *
 * Neither service may own the rule without creating that forbidden edge, so
 * `@lore/core` is the only home. `contentChanged` is therefore kept as an
 * EXPLICIT parameter rather than split into a second `AcService`-shaped overload:
 * the reasoning "an AC edit is always a contract change" then stays visible at the
 * call site that makes the claim, instead of being buried in a second function
 * that would immediately be a second copy of half the rule.
 *
 * reason: the demotion is not a convenience — it is what discharges I12
 * (`no self-weakening`) for an acceptance-criterion edit. Until 2026-08-01 the
 * rule was MIRRORED (an inline check in `CorpusService.set`, a `computeSetStatus`
 * twin in `AcService`), cross-referenced only by comments. Two copies of a
 * governance rule drift, the copy that drifts is the one nobody is looking at, and
 * the failure is SILENT: an edit that should have demoted simply does not, and the
 * criterion is re-reviewed by nobody. A cross-referencing comment is a prose
 * mitigation for a mechanism problem.
 *
 * ⛔ Do NOT re-inline this rule at a call site, and do NOT add a wrapper that
 * re-states either half of it (the `approved` trigger or the `draft` target) — the
 * whole rule, both halves, is this function.
 * `packages/lore/tests/unit/service/demotion-rule-ssot.test.ts` stubs THIS function
 * and asserts both call sites move together, so a re-inlined copy fails that test
 * instead of drifting quietly.
 *
 * `approved → draft` is deliberately ABSENT from {@link VALID_TRANSITIONS}: it is
 * an internal lifecycle side effect, never a user-requestable transition. A caller
 * that also runs {@link isValidTransition} MUST exempt the status this function
 * returns from that check (`CorpusService.set` does exactly that), or a legitimate
 * demotion is rejected as an illegal jump.
 *
 * Side-effect class: pure — no IO, no store access, no wall-clock read.
 * Referentially transparent: equal inputs always yield an equal result.
 *
 * @param currentStatus - The doc's status BEFORE the edit.
 * @param contentChanged - Whether this edit changes governing contract content.
 * @returns `"draft"` when an `approved` doc's contract content changed; otherwise
 *   `currentStatus`, returned unchanged.
 * @throws {Error} When `currentStatus` is not a known {@link DocStatus}. A value
 *   outside the closed union can only arrive via an unchecked cast, and returning
 *   it unchanged would silently skip a demotion that was owed — the exact silent
 *   failure this SSOT exists to prevent. `VALID_TRANSITIONS`' own key set is the
 *   status domain, so no second list of statuses is introduced here. A bare `Error`
 *   matches this module's other fail-loud programmer-error guards
 *   (`slugifyWithCollision`); Zod's `docStatusSchema` owns boundary validation.
 * @example
 * resolveStatusAfterContractEdit("approved", true);  // "draft"    — demoted
 * resolveStatusAfterContractEdit("approved", false); // "approved" — metadata-only patch
 * resolveStatusAfterContractEdit("active", true);    // "active"   — only `approved` demotes
 *
 * Source: SPEC-002 §3; spec-lore-ac-set-in-place-edit-of-a-declared-acceptance D2;
 *   task-the-approved-to-draft-demotion-rule-is-mirrored-in-ac.
 */
export function resolveStatusAfterContractEdit(currentStatus: DocStatus, contentChanged: boolean): DocStatus {
  if (!Object.prototype.hasOwnProperty.call(VALID_TRANSITIONS, currentStatus)) {
    throw new Error(
      `resolveStatusAfterContractEdit: unknown doc status "${String(currentStatus)}" — ` +
        `expected one of ${Object.keys(VALID_TRANSITIONS).join(", ")}`,
    );
  }
  return currentStatus === "approved" && contentChanged ? "draft" : currentStatus;
}

// ─── Slug Generation ───────────────────────────────────────────────────────

/**
 * Options for `slugify` (SPEC-068 D1).
 */
export interface SlugifyOptions {
  /**
   * Applied to the raw title BEFORE the kebab step. Used to transliterate a
   * non-ASCII script (e.g. Chinese → pinyin) into ASCII so the kebab regex
   * doesn't strip it entirely. The real implementation (`transliterateCjk`,
   * pinyin-pro-powered) lives OUTSIDE this browser-safe barrel — see
   * `packages/core/src/slugify-node.ts`'s module header and this package's
   * CLAUDE.md "Browser safety" invariant. Absent → pure pre-SPEC-068 behavior
   * (the kebab step strips every non-ASCII-alphanumeric character as before).
   */
  transliterate?: (raw: string) => string;
}

/**
 * Generate a valid slug from a doc type and title.
 *
 * Format: `{type}-{kebab-case-name}`, lowercase, non-alphanumeric collapsed to
 * single hyphens, max 64 chars (SPEC-002 §6.1). Collision handling (-2, -3, ...)
 * is delegated to `slugifyWithCollision`/`CorpusService`.
 *
 * SPEC-068 additions on top of the SPEC-002 base rule:
 *   - D1: `opts.transliterate`, applied to the raw title before the kebab step
 *     (e.g. CJK → pinyin) — see `SlugifyOptions`.
 *   - D2: a non-empty title that transliterates+kebabs to an EMPTY name part
 *     (no transliterator injected + non-ASCII title, or a script the injected
 *     transliterator doesn't cover — Korean/kana/emoji, ...) never falls back
 *     to the bare type name; it gets a deterministic `{type}-{fnv8hex}` instead,
 *     hashed over the RAW title (stable regardless of whether/which
 *     transliterator ran). An empty/whitespace-only title is the one case that
 *     KEEPS the bare-type-name result — there's nothing meaningful to hash.
 *   - D3: a kebab result equal to the type, or starting with `{type}-`, has
 *     that leading segment stripped BEFORE the type prefix is (re-)applied —
 *     prevents `adr-adr-...` when a title already opens with the type word.
 *   - D4: truncation cuts back to the last COMPLETE hyphen-separated token
 *     within the 64-char limit (no mid-word cut), unless the name part's first
 *     token alone already overflows the limit — then the hard character cut is
 *     kept (a full single token beats an empty name part).
 *
 * @param type - Document type; becomes the slug's mandatory prefix.
 * @param title - Raw document title (any script, any length).
 * @param opts - Optional D1 transliteration hook.
 * @returns A slug matching `slugSchema` (3–64 chars, `^[a-z][a-z0-9-]*[a-z0-9]$`).
 * @example
 *   slugify("adr", "ADR: internal-circle positioning")
 *   // => "adr-internal-circle-positioning" (D3: no adr-adr- duplication)
 * @example
 *   slugify("adr", "产品定位", { transliterate: transliterateCjk })
 *   // => "adr-chan-pin-ding-wei" (D1)
 * @example
 *   slugify("adr", "한국어 제목") // no transliterator covers Korean
 *   // => "adr-{8-char fnv1a32 hex}" (D2 — never the bare "adr")
 */
export function slugify(type: DocType, title: string, opts?: SlugifyOptions): Slug {
  const MAX_SLUG_LENGTH = 64;

  // Empty/whitespace-only title: nothing meaningful to transliterate or hash —
  // keep the pre-SPEC-068 bare-prefix behavior (D2's one exemption).
  if (title.trim() === "") {
    return type as Slug;
  }

  const transliterated = opts?.transliterate ? opts.transliterate(title) : title;

  let kebab = transliterated
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");

  // D3 — type-prefix dedup: a title beginning with the type word must not
  // duplicate the prefix ("ADR: x" -> "adr-x", never "adr-adr-x").
  if (kebab === type) {
    kebab = "";
  } else if (kebab.startsWith(`${type}-`)) {
    kebab = kebab.slice(type.length + 1);
  }

  // D2 — never emit a bare type name for a non-empty title: if transliteration
  // + kebab (+ D3 stripping) leaves nothing, fall back to a deterministic hash
  // of the RAW title — stable regardless of whether a transliterator ran.
  if (kebab === "") {
    kebab = fnv1a32Hex(title);
  }

  const combined = `${type}-${kebab}`;
  if (combined.length <= MAX_SLUG_LENGTH) {
    return combined as Slug;
  }

  // D4 — token-boundary truncation: cut back to the last complete
  // hyphen-separated token inside the 64-char hard cut, UNLESS the first name
  // token alone already overflows the limit (then keep the hard character cut).
  const hardCut = combined.slice(0, MAX_SLUG_LENGTH);
  const firstToken = kebab.split("-", 1)[0] ?? "";
  const firstTokenEndIdx = type.length + 1 + firstToken.length; // end of "{type}-{firstToken}"
  const lastHyphenIdx = hardCut.lastIndexOf("-");
  const boundaryCut = lastHyphenIdx >= firstTokenEndIdx ? hardCut.slice(0, lastHyphenIdx) : hardCut;
  return boundaryCut.replace(/-+$/, "") as Slug;
}

// ─── Anthropic Messages HTTP Response Schema (SPEC-020) ────────────────────

/**
 * Zod schema for a single Anthropic Messages API content block.
 * Only `type: "text"` blocks are expected for text-generation requests.
 * `.strict()` rejects unknown fields — prevents silent acceptance of tool_use or image blocks.
 *
 * Source: SPEC-020 §9.4
 */
export const aiHttpContentBlockSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .strict();

/**
 * Zod schema for the Anthropic Messages API response body.
 * Used by HttpAIProvider to validate the raw HTTP response before content extraction.
 * `.strict()` rejects any unknown top-level fields — schema mismatch → AI_PROVIDER_ERROR.
 *
 * @invariant content array must contain at least one element (enforced by .min(1))
 * @invariant content[0].type must be "text" for extraction to succeed
 * @invariant Token values MUST NOT appear in this schema — only usage metadata
 *
 * @example
 * const validated = aiHttpResponseSchema.parse(responseBody);
 * const text = validated.content[0].text; // safe after parse
 *
 * @example
 * // Schema mismatch (tool_use block, unknown field, etc.) → safeParse returns false
 * const result = aiHttpResponseSchema.safeParse({ ...body, extra_field: "x" });
 * // result.success === false
 *
 * Source: SPEC-020 §9.4 (AC-HTTP-CORE-1)
 */
export const aiHttpResponseSchema = z
  .object({
    id: z.string(),
    type: z.literal("message"),
    role: z.literal("assistant"),
    model: z.string(),
    /** At least one content block; HttpAIProvider extracts content[0].text */
    content: z.array(aiHttpContentBlockSchema).min(1),
    /** Anthropic stop reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" */
    stop_reason: z.string().optional(),
    /** Token usage from the API — optional for resilience against future Anthropic changes */
    usage: z
      .object({
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .strict();

/** Derived TypeScript type for the Anthropic Messages API response. Source: SPEC-020 §9.4 */
export type AiHttpResponse = z.infer<typeof aiHttpResponseSchema>;

// ─── Export Index Schema ────────────────────────────────────────────────────

/**
 * Schema for a single entry in the export index mapping table.
 * One entry per exported corpus doc.
 *
 * `human_id` carries the nominal {@link MirrorHumanId} brand (SPEC-mirror-identifier-ssot
 * D3/D4): a value can only reach this shape by being produced through
 * `formatMirrorHumanId`/`assertIsMirrorHumanId` (`packages/core/src/ordinal.ts`) OR by being
 * read through THIS schema's `.transform` below, which is the ONE sanctioned `as MirrorHumanId`
 * cast site in the whole tree — every other occurrence of that cast text is a violation
 * `scripts/check-ordinal-write-sites.mjs` flags.
 *
 * @example
 *   const m: ExportIndexMapping = exportIndexMappingSchema.parse({
 *     human_id: "SPEC-025",
 *     file_path: "docs/requirements/spec/SPEC-025-foo.md",
 *   });
 */
export const exportIndexMappingSchema = z.object({
  /**
   * Human-readable ID, e.g. "SPEC-025". Stable once assigned.
   *
   * The `.transform` below is the SOLE sanctioned `as MirrorHumanId` cast (D4): it admits a
   * value already read from `.lore/export-index.json` at this exact JSON-parse boundary,
   * branding it as {@link MirrorHumanId} without re-validating the shape (the file is
   * git-tracked and only ever written by the sanctioned producers on the write side).
   */
  human_id: z.string().min(1).transform((value) => value as MirrorHumanId), // sanctioned cast (D4) — the ONE site
  /** Forward-slash path relative to project root, e.g. "docs/requirements/spec/SPEC-025-foo.md". */
  file_path: z.string().min(1),
});

/**
 * Schema for .lore/export-index.json — git-tracked mapping of corpus ULIDs to
 * human-readable IDs and file paths. Enables stable ID assignment across runs.
 *
 * @invariant version is always 1 in v1.
 * @invariant mappings keys are corpus doc ULIDs (26-char ULID format).
 * @invariant Within a type, human_id sequential numbers are unique and monotonically increasing.
 * @invariant file_path uses forward slashes (cross-platform) relative to project root.
 *
 * Source: SPEC-021 §9.3
 */
export const exportIndexSchema = z.object({
  version: z.literal(1),
  mappings: z.record(z.string(), exportIndexMappingSchema),
});

/** Derived TypeScript type for the export index. Source: SPEC-021 §9.3 */
export type ExportIndex = z.infer<typeof exportIndexSchema>;
/** Derived TypeScript type for a single mapping entry. Source: SPEC-021 §9.3 */
export type ExportIndexMapping = z.infer<typeof exportIndexMappingSchema>;

/**
 * Generate a collision-free slug by appending -2, -3, etc.
 * `existsSlug` must return true if the candidate slug is already taken.
 * Accepts both sync and async `existsSlug` callbacks.
 * Returns a Promise when `existsSlug` is async, Slug when sync.
 * `opts` (SPEC-068 D1) forwards unchanged to the underlying `slugify(type, title, opts)`
 * call that produces the base candidate — see `SlugifyOptions`.
 */
export function slugifyWithCollision(
  type: DocType,
  title: string,
  existsSlug: (slug: string) => boolean,
  opts?: SlugifyOptions,
): Slug;
export function slugifyWithCollision(
  type: DocType,
  title: string,
  existsSlug: (slug: string) => Promise<boolean>,
  opts?: SlugifyOptions,
): Promise<Slug>;
export function slugifyWithCollision(
  type: DocType,
  title: string,
  existsSlug: (slug: string) => boolean | Promise<boolean>,
  opts?: SlugifyOptions,
): Slug | Promise<Slug> {
  const base = slugify(type, title, opts);
  const checkResult = existsSlug(base);

  if (checkResult instanceof Promise) {
    // Async path
    return (async () => {
      if (!(await checkResult)) return base;
      for (let i = 2; i <= 999; i++) {
        const suffix = `-${i}`;
        const candidate = base.slice(0, 64 - suffix.length) + suffix;
        if (!(await existsSlug(candidate))) return candidate as Slug;
      }
      throw new Error(`Could not generate unique slug for type=${type} title=${title}`);
    })();
  }

  // Sync path
  if (!checkResult) return base;
  for (let i = 2; i <= 999; i++) {
    const suffix = `-${i}`;
    const candidate = base.slice(0, 64 - suffix.length) + suffix;
    if (!(existsSlug(candidate) as boolean)) return candidate as Slug;
  }

  // Unreachable in practice
  throw new Error(`Could not generate unique slug for type=${type} title=${title}`);
}
