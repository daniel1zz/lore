/**
 * Module: site-declarations — what the tree declares at each census site, judged against the corpus's rule liveness.
 *
 * Purpose: the pure verdict half of "a refusal site names the rule it enforces in code" (spec
 *   spec-refusal-sites-declare-their-rule-in-code-baseline-leaf, BR-1344). A site's rules come from the syntax at the site
 *   (`Site.rules`, read by site-census); the corpus contributes only which rule ids are live, retired or unknown.
 * Public surface: {@link classifySiteDeclaration}, {@link ruleStatusIndexOf}, {@link DeclarationState}, {@link RuleStatus},
 *   {@link RuleStatusOf}.
 * Invariants:
 *   - A site carries at most one rule: two or more distinct ids are a `conflict` naming all of them, never a pick. A site that
 *     declares nothing itself takes the rule of the predicate above it (`Site.predicates`); a shared site reached through
 *     predicates of different rules is `generic`, listing them, never attributed to one.
 *   - A declared id that is not a live rule is reported by its status (`retired`, `deprecated`, `unknown`), never read as mapped.
 *   - No liveness index (no corpus reachable) means every single declaration reads as `declared` and the caller says liveness was unchecked.
 * Side-effect class: pure.
 */

import type { PredicateRule } from "./site-census.js";

/** Lifecycle of a rule id as the corpus records it; `unknown` = no baseline node holds that id. */
export type RuleStatus = "live" | "deprecated" | "retired" | "unknown";

/** Looks a rule id up in the corpus. */
export type RuleStatusOf = (id: string) => RuleStatus;

/** What one site declares. */
export type DeclarationState =
  | { readonly state: "declared"; readonly rule: string; readonly via?: PredicateRule }
  | { readonly state: "unmapped" }
  | { readonly state: "conflict"; readonly rules: readonly string[] }
  | { readonly state: "generic"; readonly rules: readonly string[]; readonly predicates: readonly PredicateRule[] }
  | { readonly state: "retired" | "deprecated" | "unknown"; readonly rule: string; readonly via?: PredicateRule };

/**
 * Classify what a site declares: its own rules first (one = declared, two or more = a conflict on the site itself); with none,
 * the rules of the predicates above it (one = declared through that predicate, two or more = `generic`: a shared site the census
 * cannot attribute to one rule, so it lists them and picks none); nothing anywhere = unmapped.
 *
 * @param rules - `Site.rules` (sorted, unique).
 * @param statusOf - corpus liveness of an id; omit when no corpus is reachable.
 * @param predicates - `Site.predicates` (consulted only when `rules` is empty).
 * @example
 * classifySiteDeclaration(["BR-1"], () => "live"); // { state: "declared", rule: "BR-1" }
 */
export function classifySiteDeclaration(rules: readonly string[], statusOf?: RuleStatusOf, predicates: readonly PredicateRule[] = []): DeclarationState {
  const [own, ...rest] = rules;
  if (own !== undefined) {
    if (rest.length > 0) return { state: "conflict", rules };
    const status = statusOf === undefined ? "live" : statusOf(own);
    return status === "live" ? { state: "declared", rule: own } : { state: status, rule: own };
  }
  const distinct = [...new Set(predicates.map((p) => p.rule))].sort();
  const [only, ...others] = distinct;
  if (only === undefined) return { state: "unmapped" };
  if (others.length > 0) return { state: "generic", rules: distinct, predicates };
  const via = predicates.find((p) => p.rule === only) as PredicateRule;
  const status = statusOf === undefined ? "live" : statusOf(only);
  return status === "live" ? { state: "declared", rule: only, via } : { state: status, rule: only, via };
}

/**
 * Build a {@link RuleStatusOf} from baseline nodes' stored rules (`extra.rules[].id` / `.lifecycle`).
 *
 * @param nodes - every baseline doc of the corpus (business leaves and architecture standards alike).
 */
export function ruleStatusIndexOf(nodes: readonly { extra: Record<string, unknown> }[]): RuleStatusOf {
  const lifecycleOf = new Map<string, RuleStatus>();
  for (const node of nodes) {
    const rules = node.extra["rules"];
    if (!Array.isArray(rules)) continue;
    for (const rule of rules as { id?: unknown; lifecycle?: unknown }[]) {
      if (typeof rule.id !== "string") continue;
      const lifecycle = rule.lifecycle;
      lifecycleOf.set(rule.id, lifecycle === "live" || lifecycle === "deprecated" || lifecycle === "retired" ? lifecycle : "unknown");
    }
  }
  return (id) => lifecycleOf.get(id) ?? "unknown";
}
