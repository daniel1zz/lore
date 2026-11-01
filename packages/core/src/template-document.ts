/**
 * The `template` document type's extra contract and the `<slug>@<version>` pin grammar.
 *
 * Purpose: a template is stored as a document whose `extra.template` is validated by the core
 *   meta-schema ({@link parseTemplate}) on every write; documents pin one revision as `slug@version`.
 * Public surface: {@link templateDocumentExtraSchema}, {@link formatTemplateIssues},
 *   {@link formatTemplateRef}, {@link parseTemplateRef}, {@link TemplateRef}.
 * Invariants:
 *   - Validation lists EVERY {@link TemplateIssue} in ONE refusal message (create reports only the
 *     first zod issue, so all problems ride in a single issue).
 *   - A template is never validated by another template (the first template needs no other template).
 *   - `version` in a ref is the template's own `version` number (`extra.template.version`), not the
 *     document-history version counter.
 * Side-effect class: pure.
 */

import { z } from "zod";
import { parseTemplate, type TemplateIssue } from "./template.js";

/** A parsed `slug@version` pin. */
export interface TemplateRef {
  readonly slug: string;
  readonly version: number;
}

const TEMPLATE_REF_PATTERN = /^([a-z][a-z0-9-]{1,62}[a-z0-9])@([1-9][0-9]*)$/;

/** Render a pin as `slug@version` (the value of `extra.template_ref`). */
export function formatTemplateRef(ref: TemplateRef): string {
  return `${ref.slug}@${String(ref.version)}`;
}

/**
 * Parse a `slug@version` pin.
 *
 * @param raw - e.g. `template-spec-tech@2`
 * @returns the pin, or undefined when `raw` is not `slug@positive-integer`
 */
export function parseTemplateRef(raw: string): TemplateRef | undefined {
  const match = TEMPLATE_REF_PATTERN.exec(raw);
  if (match === null) return undefined;
  return { slug: match[1] as string, version: Number(match[2]) };
}

/** One line per issue, `template.<path>: <problem>`, joined by `; ` — the single refusal message. */
export function formatTemplateIssues(issues: readonly TemplateIssue[]): string {
  return issues
    .map((issue) => `${issue.path === "" ? "template" : `template.${issue.path}`}: ${issue.problem}`)
    .join("; ");
}

function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    typeof inner === "object" && inner !== null && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );
}

/**
 * True when two `extra.template` values are the same template (object key order is ignored; array order is not).
 * A template edit is a contract edit: it demotes an approved template to draft, a re-save of the same one does not.
 */
export function templatesEqual(a: unknown, b: unknown): boolean {
  return sortedJson(a) === sortedJson(b);
}

/**
 * `extra` of a `template` document: `template` is required and must satisfy the meta-schema.
 * All meta-schema issues are folded into one zod issue at `template`.
 */
export const templateDocumentExtraSchema = z
  .object({ template: z.unknown() })
  .passthrough()
  .superRefine((extra, ctx) => {
    if (extra.template === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "template requires extra.template (doc_type, version, fields, dimensions, checks, render)",
        path: ["template"],
      });
      return;
    }
    const parsed = parseTemplate(extra.template);
    if (parsed.ok) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `extra.template is not a valid template: ${formatTemplateIssues(parsed.error)}`,
      path: ["template"],
    });
  });
