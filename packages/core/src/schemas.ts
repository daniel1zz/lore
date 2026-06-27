/**
 * Zod validation schemas for the Lore corpus.
 * Runtime validation at service boundaries. Source: SPEC-002 §2, §3, §6.
 */

import { z } from "zod";
import type { DocStatus, DocType, Slug } from "./types.js";

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

export const taskExtraSchema = z
  .object({
    plan_id: docIdSchema,
    assignee: z.string().optional(),
    task_status: z.enum(["todo", "in-progress", "done", "blocked"]).optional(),
  })
  .passthrough();

export const planExtraSchema = z
  .object({
    phase: z.string().optional(),
  })
  .passthrough();

export const prdExtraSchema = z.record(z.unknown());
export const specExtraSchema = z.record(z.unknown());

// ─── CreateDocInput Schema ─────────────────────────────────────────────────

const baseCreateDocInputSchema = z.object({
  type: docTypeSchema,
  title: z.string(),
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
