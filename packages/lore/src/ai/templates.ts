/**
 * Built-in prompt templates for the AI generation path.
 * Pure module — no IO, no Bun.*, no external dependencies.
 *
 * Public surface:
 *   - BUILT_IN_TEMPLATES — Record<DocType, string> with one template per doc type (the "v1"
 *     entry of GENERATE_TEMPLATES below — kept as its own stable export so every pre-existing
 *     direct reference, e.g. AIProviderService.regenerateContent, stays byte-identical)
 *   - GENERATE_PROMPT_VERSION — the currently active key into GENERATE_TEMPLATES (task-t3-
 *     hardening-reachable-override-escape-real-ai-provenance — mirrors the ASSESS_PROMPT_VERSION
 *     / REVIEW_PROMPT_VERSION / STALENESS_PROMPT_VERSION precedent this module previously lacked)
 *   - GENERATE_TEMPLATES — version-keyed registry; v1 (== BUILT_IN_TEMPLATES) is the only entry
 *     today; a future prompt-shape change adds a new key rather than mutating v1 in place
 *   - getGenerateTemplateSet(version) — Result-returning registry lookup, mirrors getAssessTemplate
 *   - REFINE_TEMPLATE — default prompt template for `lore set --refine` (SPEC-019 §9.2)
 *   - LINK_INFERENCE_TEMPLATE — default prompt template for `lore link --infer` (SPEC-019 §9.3)
 *   - renderTemplate(tpl, vars) — minimal mustache-subset rendering (generic vars map)
 *
 * Invariants:
 *   - BUILT_IN_TEMPLATES contains exactly one entry for every DocType value
 *   - GENERATE_TEMPLATES["v1"] IS BUILT_IN_TEMPLATES (same object reference, never a copy) —
 *     the two can never structurally drift apart; GENERATE_PROMPT_VERSION is always a valid key
 *   - renderTemplate processes conditional blocks BEFORE simple substitutions
 *     (reason: prevents {{var}} inside {{#block}}…{{/block}} from being partially expanded)
 *   - renderTemplate returns empty string for missing vars rather than throwing
 *   - Both regexes are linear/non-backtracking on the accepted input shapes (no ReDoS risk)
 *   - renderTemplate accepts any string → string|undefined map as vars (not only title/parent_title)
 *
 * Side-effect class: pure (no IO)
 *
 * Source: SPEC-017 §3.9, SPEC-019 §9.2–§9.3, SPEC-103 §Mechanisms M2 (I1 provenance),
 * task-t3-hardening-reachable-override-escape-real-ai-provenance
 */

import type { DocType, LoreError, Result } from "@lore/core";
import { err, ok } from "@lore/core";

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
  // SPEC-056 T4 — "phase" registered as a real DocType; mirrors the task
  // template (phase generalizes/supersedes task at the plan-execution tier).
  phase:
    'Write a phase description titled "{{title}}"{{#parent_title}} for plan "{{parent_title}}"{{/parent_title}}. Sections: Checklist, Acceptance Criteria, File Anchors, Test Plan. Output GitHub-flavoured Markdown.',
};

// ─── Prompt-Version Registry (SPEC-103 I1, task-t3-hardening) ───────────────────

/**
 * Judge/generation-prompt schema version — the active key into {@link GENERATE_TEMPLATES}.
 * Persisted verbatim into `GenerateOutput.ai_provenance.prompt_version` (SPEC-017 create path)
 * so I1's self-review collision check (SPEC-103 §Mechanisms M2) compares a REAL, registry-backed
 * version rather than a floating literal — mirrors {@link ASSESS_PROMPT_VERSION}/
 * {@link REVIEW_PROMPT_VERSION}/{@link STALENESS_PROMPT_VERSION} (imported by name only in their
 * own JSDoc cross-references; see `../service/ai-provider-service.ts`). Bump by adding a NEW key
 * to `GENERATE_TEMPLATES` (never mutate `v1`/`BUILT_IN_TEMPLATES` in place) whenever the
 * create-path prompt shape changes materially.
 */
export const GENERATE_PROMPT_VERSION = "v1";

/**
 * Version-keyed registry of doc-type template SETS for the `lore create --ai` path.
 * `v1` is `BUILT_IN_TEMPLATES` itself (the SAME object reference, not a copy) — the two can
 * never drift apart structurally. Consumed via {@link getGenerateTemplateSet}, never indexed
 * directly, so a future `v2` entry is a pure addition.
 */
export const GENERATE_TEMPLATES: Record<string, Record<DocType, string>> = {
  v1: BUILT_IN_TEMPLATES,
};

/**
 * Result-returning lookup into {@link GENERATE_TEMPLATES} — mirrors `getAssessTemplate`'s shape
 * (`../assess-template.ts`) so `AIProviderService.generate()` resolves its template set through
 * the SAME accessor whose key it stamps into `ai_provenance.prompt_version` (SSOT: the stamped
 * version and the template actually used can never disagree).
 *
 * @param version - Registry key (typically {@link GENERATE_PROMPT_VERSION})
 * @returns ok(template set) when `version` is a known key; err(AI_PROVIDER_ERROR) naming the
 *   unknown version and the known set otherwise
 *
 * @example
 * getGenerateTemplateSet(GENERATE_PROMPT_VERSION); // → ok(BUILT_IN_TEMPLATES)
 * getGenerateTemplateSet("v999"); // → err({ code: "AI_PROVIDER_ERROR", message: "...v999..." })
 */
export function getGenerateTemplateSet(version: string): Result<Record<DocType, string>, LoreError> {
  const templateSet = GENERATE_TEMPLATES[version];
  if (templateSet === undefined) {
    return err({
      code: "AI_PROVIDER_ERROR",
      provider: "generate-template-registry",
      message:
        `generate template version "${version}" is not registered in GENERATE_TEMPLATES. ` +
        `Known versions: ${Object.keys(GENERATE_TEMPLATES).join(", ")}.`,
    });
  }
  return ok(templateSet);
}

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
  `- parent\n- implements\n- informs\n- supersedes\n- relates-to\n- blocks\n- governs\n\n` +
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
