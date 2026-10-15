/**
 * Fragment-outlet expansion of `{{lore:<name>}}` placeholders (the ONE helper every fragment path uses).
 * Spec: spec-lore-owned-agent-context-is-generated-from-templates-and (D2-D5, D10).
 *
 * Public surface: `expandFragments`, `LocatedFragment`, `FragmentExpansionContext`.
 * Invariants:
 *   - Pure: no IO; inputs are never mutated; the registry is an injected parameter.
 *   - All-or-nothing: the first refused fragment returns its error and no expanded list.
 *   - A body without `{{lore:` is returned byte-identical (same fragment object, not even copied).
 *   - Error messages carry `<fragment.path>:<file line>` and the variable name (from `expandTemplate`).
 *   - Callers run this on SELECTED fragments of one outlet, BEFORE render / fingerprint / duplicate
 *     detection / byte caps, so refresh, check and render all measure the same expanded text.
 * Line numbers: `discoverFragments` stamps `bodyLineOffset` (frontmatter lines incl. both `---` fences)
 * on every fragment it loads. A fragment built without it (tests, synthetic) falls back to the line
 * count of its re-serialised frontmatter, which is exact for block-style YAML only.
 * Side-effect class: pure.
 */
import { stringify as stringifyYaml } from "yaml";
import {
  expandTemplate,
  ok,
  type ContextVariable,
  type Fragment,
  type LoreError,
  type OutletId,
  type Result,
} from "@lore/core";

/** A discovered fragment plus the number of file lines before its body (frontmatter block with fences). */
export type LocatedFragment = Fragment & { readonly bodyLineOffset?: number };

/** Caller-supplied values; fragment outlets never allow an invocation variable, so this is normally empty. */
export interface FragmentExpansionContext {
  readonly invocation: Readonly<Record<string, string>>;
}

/** Marker of a candidate placeholder; bodies without it skip the expander entirely. */
const PLACEHOLDER_MARKER = "{{lore:";

function bodyLineOffset(fragment: LocatedFragment): number {
  if (fragment.bodyLineOffset !== undefined) return fragment.bodyLineOffset;
  const yamlLines = stringifyYaml(fragment.frontmatter).split("\n").filter((line, i, all) => i < all.length - 1 || line !== "").length;
  return yamlLines + 2;
}

/**
 * Expand every `{{lore:<name>}}` in the bodies of `fragments` for one outlet.
 *
 * @param fragments - selected fragments of `outlet`
 * @param outlet - the fragment outlet being rendered
 * @param ctx - invocation values (never makes an outlet-disallowed variable allowed)
 * @param registry - injected variable registry (production: `LORE_CONTEXT_VARIABLES`)
 * @returns the same fragments with `body` expanded, or the first VALIDATION_ERROR (file:line + name)
 */
export function expandFragments(
  fragments: readonly Fragment[],
  outlet: OutletId,
  ctx: FragmentExpansionContext,
  registry: readonly ContextVariable[],
): Result<readonly Fragment[], LoreError> {
  const expanded: Fragment[] = [];
  for (const fragment of fragments) {
    if (!fragment.body.includes(PLACEHOLDER_MARKER)) {
      expanded.push(fragment);
      continue;
    }
    const result = expandTemplate(
      fragment.body,
      { outlet, path: fragment.path, lineOffset: bodyLineOffset(fragment), invocation: ctx.invocation },
      registry,
    );
    if (!result.ok) return result;
    expanded.push({ ...fragment, body: result.value });
  }
  return ok(expanded);
}
