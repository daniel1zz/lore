/**
 * Zod validation schemas for the Lore corpus.
 * Runtime validation at service boundaries. Source: SPEC-002 §2, §3, §6.
 */

import { z } from "zod";
import type { DocStatus, DocType, Slug } from "./types.js";
import { evidenceEntrySchema, taskClaimSchema } from "./task-workflow.js";

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
]);

export const versionActionSchema = z.enum([
  "create",
  "update",
  "approve",
  "reject",
  "restore",
  "delete",
]);

// ─── Type-specific Extra Schemas ───────────────────────────────────────────

export const adrExtraSchema = z
  .object({
    decision_status: z.enum(["proposed", "accepted", "deprecated", "superseded"]),
    superseded_by: docIdSchema.optional(),
  })
  .passthrough();

export const knowledgeExtraSchema = z
  .object({
    sub_type: z.enum(["ideation", "retro", "research", "reference"]),
  })
  .passthrough();

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
 */
export const taskExtraSchema = z
  .object({
    plan_id: docIdSchema,
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
  })
  .passthrough();

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
 * Extra fields for plan documents.
 *
 * @invariant phases[].name is unique within the array (enforced via superRefine).
 * @invariant phases is capped at 30 entries (soft-limit: SPEC-023 §6 risk table).
 * @invariant legacy_phase holds the original extra.phase string after `lore migrate phases` runs.
 *
 * Source: SPEC-023 §4 AC-PHASE-1, §8 Q2
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

export const prdExtraSchema = z.record(z.unknown());
export const specExtraSchema = z.record(z.unknown());

// ─── CreateDocInput Schema ─────────────────────────────────────────────────

const baseCreateDocInputSchema = z.object({
  type: docTypeSchema,
  // reason: .min(1) enforces the AC-DASH-WRITE-10 requirement that client-side Zod
  // validation rejects empty title before making an HTTP call (SPEC-022 §9).
  title: z.string().min(1, "Title must not be empty"),
  content: z.string().optional(),
  parent_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  extra: z.record(z.unknown()).optional(),
  priority: prioritySchema.optional(),
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
    const { type, parent_id, extra } = data;

    // spec and task require parent_id
    if ((type === "spec" || type === "task") && !parent_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `parent_id is required for type '${type}'`,
        path: ["parent_id"],
      });
    }

    // adr requires extra.decision_status
    if (type === "adr") {
      const adrResult = adrExtraSchema.safeParse(extra ?? {});
      if (!adrResult.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "adr requires extra.decision_status (proposed|accepted|deprecated|superseded)",
          path: ["extra", "decision_status"],
        });
      }
    }

    // knowledge requires extra.sub_type
    if (type === "knowledge") {
      const knowledgeResult = knowledgeExtraSchema.safeParse(extra ?? {});
      if (!knowledgeResult.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "knowledge requires extra.sub_type (ideation|retro|research|reference)",
          path: ["extra", "sub_type"],
        });
      }
    }

    // task requires extra.plan_id
    if (type === "task") {
      const taskResult = taskExtraSchema.safeParse(extra ?? {});
      if (!taskResult.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "task requires extra.plan_id",
          path: ["extra", "plan_id"],
        });
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
  },
);

export type CreateDocInput = z.infer<typeof createDocInputSchema>;

// ─── DocPatch Schema ───────────────────────────────────────────────────────

/** Partial update schema — all fields optional */
export const docPatchSchema = z.object({
  title: z.string().optional(),
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
 * Valid status transitions per SPEC-002 §3 diagram.
 * Key: from-status, Value: set of allowed to-statuses.
 */
const VALID_TRANSITIONS: Readonly<Record<DocStatus, ReadonlySet<DocStatus>>> = {
  draft: new Set<DocStatus>(["in-review", "approved"]),
  "in-review": new Set<DocStatus>(["approved", "draft"]),
  approved: new Set<DocStatus>(["active", "archived", "deprecated"]),
  active: new Set<DocStatus>(["archived", "deprecated"]),
  archived: new Set<DocStatus>([]),
  deprecated: new Set<DocStatus>([]),
};

/**
 * Returns true if transitioning from -> to is a valid lifecycle step.
 * Source: SPEC-002 §3.
 */
export function isValidTransition(from: DocStatus, to: DocStatus): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed.has(to);
}

/**
 * Returns the set of statuses reachable from `from`.
 */
export function getAllowedTransitions(from: DocStatus): DocStatus[] {
  return [...VALID_TRANSITIONS[from]];
}

// ─── Slug Generation ───────────────────────────────────────────────────────

/**
 * Generate a valid slug from a doc type and title.
 * Rules per SPEC-002 §6.1:
 * - Format: {type}-{kebab-case-name}
 * - Lowercase, non-alphanumeric → hyphens, deduplicate hyphens
 * - Total max 64 chars
 * Collision handling (-2, -3, ...) is delegated to CorpusService.
 */
export function slugify(type: DocType, title: string): Slug {
  const MAX_SLUG_LENGTH = 64;

  const kebab = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");

  const prefix = type;
  const separator = kebab.length > 0 ? "-" : "";
  const combined = `${prefix}${separator}${kebab}`;

  // Truncate to max length, trimming trailing hyphens after truncation
  const truncated = combined.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "");

  // Ensure result is at least the type prefix (never empty)
  return (truncated.length >= 2 ? truncated : prefix) as Slug;
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
 * @example
 *   const m: ExportIndexMapping = { human_id: "SPEC-025", file_path: "docs/requirements/spec/SPEC-025-foo.md" };
 */
export const exportIndexMappingSchema = z.object({
  /** Human-readable ID, e.g. "SPEC-025". Stable once assigned. */
  human_id: z.string().min(1),
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
 */
export function slugifyWithCollision(
  type: DocType,
  title: string,
  existsSlug: (slug: string) => boolean,
): Slug;
export function slugifyWithCollision(
  type: DocType,
  title: string,
  existsSlug: (slug: string) => Promise<boolean>,
): Promise<Slug>;
export function slugifyWithCollision(
  type: DocType,
  title: string,
  existsSlug: (slug: string) => boolean | Promise<boolean>,
): Slug | Promise<Slug> {
  const base = slugify(type, title);
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
