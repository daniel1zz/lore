/**
 * Template rule slice: the rule text a gate denial and `lore feed spec-create` quote, taken from the approved corpus template.
 *
 * Purpose: ONE source for "what a candidate document of this type must satisfy" (spec-every-document-is-stored-as-structured-
 *   fields-validated-by, scope "One source"). It replaces the spec-create rules document, the compiled-in fallback rule text
 *   and the rule file shipped with the binary: gates, feeds, `lore template show` and the judge all read the approved template.
 * Public surface: {@link templateRuleSlice}, {@link resolveRuleSlice}, {@link RuleSlice}.
 * Invariants:
 *   - Pure rendering ({@link templateRuleSlice}); the only IO is the template read in {@link resolveRuleSlice}.
 *   - Compact by design: a feeding pack keeps ~800 characters of rule, so the slice names the required fields, the dimension
 *     ids and the promote checks, and points at `lore template show` for the full text; it never reproduces dimension questions.
 *   - A missing template is NAMED in the slice (source `template lookup`), never replaced by an invented rule.
 * Side-effect class: read-only (template reads through {@link TemplateService}).
 */

import type { JsonSchemaNode, Template } from "@lore/core";
import type { ResolvedTemplate, TemplateService } from "./template-service.js";

/** A rule slice with the label the feeding pack shows as its `[source: ...]`. */
export interface RuleSlice {
  readonly source: string;
  readonly markdown: string;
}

function requiredFieldNames(template: Template): string[] {
  const fields = template.fields as JsonSchemaNode;
  const required: unknown = fields["required"];
  return Array.isArray(required) ? (required as unknown[]).filter((name): name is string => typeof name === "string") : [];
}

/**
 * The compact rule text of one approved template.
 *
 * @param resolved - the approved template and its `slug@version` ref
 * @returns `{source: "template <ref>", markdown}`; the same template always yields the same text
 */
export function templateRuleSlice(resolved: ResolvedTemplate): RuleSlice {
  const { template } = resolved;
  const slot = template.kind === undefined ? template.doc_type : `${template.doc_type} ${template.kind}`;
  const required = requiredFieldNames(template);
  const lines = [
    `## What a ${slot} must satisfy (template ${resolved.ref})`,
    "",
    `Fields (required: ${required.length === 0 ? "none" : required.join(", ")}): write them with \`--fields-file\`; the text is rendered from them.`,
    `Dimensions (answer each, handled or na with a reason): ${template.dimensions.map((dimension) => dimension.id).join(", ")}.`,
    `Checks run at promote: ${template.checks.length === 0 ? "none" : template.checks.join(", ")}.`,
    `Full template: \`lore template show ${template.doc_type}${template.kind === undefined ? "" : ` --kind ${template.kind}`}\`.`,
  ];
  return { source: `template ${resolved.ref}`, markdown: lines.join("\n") };
}

/**
 * The rule slice of the latest approved template for a slot, or a named notice when there is none.
 *
 * @param templates - the template reader
 * @param docType - e.g. `spec`
 * @param kind - e.g. `feature`; omitted for a kind-less type
 * @returns the slice; on a lookup refusal `{source: "template lookup", markdown: <the refusal>}` so the pack states why it
 *   has no rule rather than quoting nothing
 */
export async function resolveRuleSlice(templates: TemplateService, docType: string, kind?: string): Promise<RuleSlice> {
  const resolved = await templates.resolveTemplate(docType, kind);
  if (resolved.ok) return templateRuleSlice(resolved.value);
  const reason = "message" in resolved.error ? String(resolved.error.message) : JSON.stringify(resolved.error);
  return { source: "template lookup", markdown: `(No rule could be read from an approved template: ${reason})` };
}
