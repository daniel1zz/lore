/**
 * Built-in per-doc-type prompt templates for the AI generation path.
 * Pure module — no IO, no Bun.*, no external dependencies.
 *
 * Public surface:
 *   - BUILT_IN_TEMPLATES — Record<DocType, string> with one template per doc type
 *   - renderTemplate(tpl, vars) — minimal mustache-subset rendering
 *
 * Invariants:
 *   - BUILT_IN_TEMPLATES contains exactly one entry for every DocType value
 *   - renderTemplate processes conditional blocks BEFORE simple substitutions
 *     (reason: prevents {{var}} inside {{#block}}…{{/block}} from being partially expanded)
 *   - renderTemplate returns empty string for missing vars rather than throwing
 *   - Both regexes are linear/non-backtracking on the accepted input shapes (no ReDoS risk)
 *
 * Side-effect class: pure (no IO)
 *
 * Source: SPEC-017 §3.9
 */

import type { DocType } from "@lore/core";

// ─── Built-in Templates ───────────────────────────────────────────────────────

/**
 * One prompt template per DocType.
 * Consumed by AIProviderService; overridable via .lore/config.yaml → ai.templates.<type>.
 *
 * Template syntax (minimal mustache subset):
 *   - {{#key}}…{{/key}} — conditional block; rendered iff vars[key] is truthy
 *   - {{key}} — simple substitution; replaced with vars[key] or "" if missing
 *
 * @example
 * BUILT_IN_TEMPLATES["prd"]
 * // → "Generate a Product Requirements Document titled \"My Product\". Sections: ..."
 */
export const BUILT_IN_TEMPLATES: Record<DocType, string> = {
  prd:
    'Generate a Product Requirements Document titled "{{title}}". Sections: Problem, Users, Goals, Scope, Success Metrics. Output GitHub-flavoured Markdown.',
  spec:
    'Generate a Specification titled "{{title}}"{{#parent_title}} under parent "{{parent_title}}"{{/parent_title}}. Sections: Purpose, Goals & Non-Goals, Architecture, Acceptance Criteria. Output GitHub-flavoured Markdown.',
  adr:
    'Generate an Architecture Decision Record titled "{{title}}". Sections: Context, Decision, Consequences, Status. Output GitHub-flavoured Markdown.',
  plan:
    'Generate an implementation Plan titled "{{title}}". Sections: Goal, Phases (numbered), Risks, Definition of Done. Output GitHub-flavoured Markdown.',
  knowledge:
    'Write a knowledge note titled "{{title}}". Concise, no preamble. Output GitHub-flavoured Markdown.',
  task:
    'Write a task description titled "{{title}}"{{#parent_title}} for plan "{{parent_title}}"{{/parent_title}}. Sections: Acceptance Criteria, File Anchors, Test Plan. Output GitHub-flavoured Markdown.',
};

// ─── Template Renderer ────────────────────────────────────────────────────────

/**
 * Render a template string with mustache-subset interpolation.
 *
 * Processing order (MUST be this order — conditionals before substitutions):
 *   1. Conditional blocks: {{#key}}…{{/key}} → body if vars[key] truthy; "" if falsy
 *   2. Simple substitutions: {{key}} → String(vars[key]) or "" when undefined/null
 *
 * @param tpl - Template string (from BUILT_IN_TEMPLATES or user override)
 * @param vars - Substitution values: title (required), parent_title (optional)
 * @returns Rendered string with all template markers replaced
 *
 * @example
 * renderTemplate("Spec for {{title}}{{#parent_title}} under {{parent_title}}{{/parent_title}}", {
 *   title: "Auth",
 *   parent_title: "SPEC-001",
 * });
 * // → "Spec for Auth under SPEC-001"
 *
 * @example
 * renderTemplate("Spec for {{title}}{{#parent_title}} under {{parent_title}}{{/parent_title}}", {
 *   title: "Auth",
 * });
 * // → "Spec for Auth"
 */
export function renderTemplate(
  tpl: string,
  vars: { title: string; parent_title?: string },
): string {
  // Step 1: conditional blocks {{#key}}...{{/key}} — keep body iff vars[key] is truthy
  // reason: must run before step 2 to avoid {{var}} inside a block being partially expanded
  // before the block itself is resolved.
  let out = tpl.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_match: string, key: string, body: string): string =>
      (vars as Record<string, unknown>)[key] ? body : "",
  );

  // Step 2: simple variable substitution {{key}} → value or ""
  out = out.replace(
    /\{\{(\w+)\}\}/g,
    (_match: string, key: string): string => {
      const value = (vars as Record<string, unknown>)[key];
      return value === undefined || value === null ? "" : String(value);
    },
  );

  return out;
}
