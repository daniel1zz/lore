/**
 * Built-in prompt templates for the AI generation path.
 * Pure module — no IO, no Bun.*, no external dependencies.
 *
 * Public surface:
 *   - BUILT_IN_TEMPLATES — Record<DocType, string> with one template per doc type
 *   - REFINE_TEMPLATE — default prompt template for `lore set --refine` (SPEC-019 §9.2)
 *   - LINK_INFERENCE_TEMPLATE — default prompt template for `lore link --infer` (SPEC-019 §9.3)
 *   - renderTemplate(tpl, vars) — minimal mustache-subset rendering (generic vars map)
 *
 * Invariants:
 *   - BUILT_IN_TEMPLATES contains exactly one entry for every DocType value
 *   - renderTemplate processes conditional blocks BEFORE simple substitutions
 *     (reason: prevents {{var}} inside {{#block}}…{{/block}} from being partially expanded)
 *   - renderTemplate returns empty string for missing vars rather than throwing
 *   - Both regexes are linear/non-backtracking on the accepted input shapes (no ReDoS risk)
 *   - renderTemplate accepts any string → string|undefined map as vars (not only title/parent_title)
 *
 * Side-effect class: pure (no IO)
 *
 * Source: SPEC-017 §3.9, SPEC-019 §9.2–§9.3
 */

import type { DocType } from "@lore/core";

// ─── Built-in Templates ───────────────────────────────────────────────────────
// Doc-type templates live below; refine/link-inference templates follow after.

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

// ─── Refine Template (SPEC-019 §9.2) ─────────────────────────────────────────

/**
 * Default prompt template for `lore set --refine` / `--refine-stdin`.
 * Variables: {{title}}, {{current_content}} (may be truncated), {{user_prompt}}.
 * Overridable via ai.templates.refine in .lore/config.yaml.
 *
 * @invariant Must not include {{#conditional}} blocks — only simple {{key}} substitutions.
 * Source: SPEC-019 §9.2
 */
export const REFINE_TEMPLATE =
  `Below is the current content of a document titled "{{title}}":\n\n` +
  `<content>\n{{current_content}}\n</content>\n\n` +
  `The user requests the following refinement:\n{{user_prompt}}\n\n` +
  `Please output the revised full document content (markdown). ` +
  `Do NOT explain your changes; just emit the revised markdown.`;

// ─── Link Inference Template (SPEC-019 §9.3) ─────────────────────────────────

/**
 * Default prompt template for `lore link --infer`.
 * Variables: {{from_title}}, {{from_body_head}}, {{to_title}}, {{to_body_head}}.
 * Body heads are truncated to 500 chars by AIProviderService before rendering.
 * Overridable via ai.templates.link_inference in .lore/config.yaml.
 *
 * @invariant Must not include {{#conditional}} blocks — only simple {{key}} substitutions.
 * Source: SPEC-019 §9.3
 */
export const LINK_INFERENCE_TEMPLATE =
  `Two documents in a knowledge corpus need a relationship classified.\n\n` +
  `DOC A: "{{from_title}}"\n<body_head>\n{{from_body_head}}\n</body_head>\n\n` +
  `DOC B: "{{to_title}}"\n<body_head>\n{{to_body_head}}\n</body_head>\n\n` +
  `Choose EXACTLY ONE relationship type from this list:\n` +
  `- parent\n- implements\n- informs\n- supersedes\n- relates-to\n- blocks\n\n` +
  `Respond with only the single word — no explanation.`;

// ─── Template Renderer ────────────────────────────────────────────────────────

/**
 * Render a template string with mustache-subset interpolation.
 *
 * Processing order (MUST be this order — conditionals before substitutions):
 *   1. Conditional blocks: {{#key}}…{{/key}} → body if vars[key] truthy; "" if falsy
 *   2. Simple substitutions: {{key}} → String(vars[key]) or "" when undefined/null
 *
 * Accepts any string→string|undefined map as vars (not only the doc-type title/parent_title
 * pair). This allows REFINE_TEMPLATE and LINK_INFERENCE_TEMPLATE to reuse the same renderer.
 * Callers that previously passed `{ title, parent_title? }` continue to work unchanged.
 *
 * @param tpl - Template string (from BUILT_IN_TEMPLATES, REFINE_TEMPLATE, LINK_INFERENCE_TEMPLATE,
 *   or a user override from ai.templates.<key>)
 * @param vars - Substitution values map; missing keys render as ""
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
 *
 * @example
 * renderTemplate(REFINE_TEMPLATE, {
 *   title: "My PRD",
 *   current_content: "## Overview\n...",
 *   user_prompt: "Tighten section 1",
 * });
 */
export function renderTemplate(
  tpl: string,
  vars: Record<string, string | undefined>,
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
