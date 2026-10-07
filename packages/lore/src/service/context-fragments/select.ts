/**
 * Context-fragment selection: decides WHICH fragments reach one outlet.
 * Spec: spec-context-fragments-config-driven-layered-rule-injection (routing table, D2, D11, D14).
 *
 * Public surface: `selectFragments`, `checkOverrides`, `SelectOptions`, `OverrideConfigs`.
 * Invariants:
 *   - Pure (no IO, no clock); never mutates inputs; output is id-ascending (deterministic).
 *   - Pipeline order: outlet layer routing -> id override (project > user > shipped)
 *     -> disable -> audience/mode routing -> `when` matchers.
 *   - claude-md:project sees ONLY shipped+project layers; claude-md:user sees ONLY the user
 *     layer. This is what keeps each CLAUDE.md render independent of the other scope.
 *   - A `when` key missing from WHEN_MATCHERS fails loud (throws) - never silently matches.
 * Side-effect class: pure.
 */
import {
  WHEN_MATCHERS,
  err,
  ok,
  type Fragment,
  type OutletId,
  type ContextConfigLayer,
  type ResolvedContextConfig,
  type Result,
  type LoreError,
} from "@lore/core";

type FragmentLayer = Fragment["layer"];

/** Higher rank wins an id collision: project > user > shipped. */
const LAYER_RANK: Readonly<Record<FragmentLayer, number>> = { shipped: 0, user: 1, project: 2 };

/** Layers each outlet may draw from (keeps CLAUDE.md renders scope-independent). */
const OUTLET_LAYERS: Readonly<Record<OutletId, ReadonlySet<FragmentLayer>>> = {
  "claude-md:project": new Set<FragmentLayer>(["shipped", "project"]),
  "claude-md:user": new Set<FragmentLayer>(["user"]),
  "hook:session-start": new Set<FragmentLayer>(["shipped", "user", "project"]),
  "hook:subagent-start": new Set<FragmentLayer>(["shipped", "user", "project"]),
};

/** Options for {@link selectFragments}. `config` = `resolveContextConfig(global, project, outlet)`. */
export interface SelectOptions {
  readonly outlet: OutletId;
  /** Subagent type at hook:subagent-start; absent means only `subagent:*` audiences match. */
  readonly agentType?: string;
  readonly config: ResolvedContextConfig;
}

/** Raw (un-merged) config layers: disable lists are file-scoped, so checkOverrides needs them apart. */
export interface OverrideConfigs {
  readonly global: ContextConfigLayer;
  readonly project: ContextConfigLayer;
}

/** The only error {@link checkOverrides} returns; narrowed so callers can read `message`. */
export type OverrideViolationError = Extract<LoreError, { code: "VALIDATION_ERROR" }>;

function compareById(a: Fragment, b: Fragment): number {
  const x = a.frontmatter.id;
  const y = b.frontmatter.id;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Collapse repeated ids to the highest-layer fragment. */
function resolveOverrides(candidates: readonly Fragment[]): Fragment[] {
  const winners = new Map<string, Fragment>();
  for (const fragment of candidates) {
    const current = winners.get(fragment.frontmatter.id);
    if (current === undefined || LAYER_RANK[fragment.layer] > LAYER_RANK[current.layer]) {
      winners.set(fragment.frontmatter.id, fragment);
    }
  }
  return [...winners.values()];
}

function isStaticMain(fragment: Fragment): boolean {
  return fragment.frontmatter.mode === "static" && fragment.frontmatter.audience.includes("main");
}

function matchesOutletRouting(fragment: Fragment, outlet: OutletId, agentType: string | undefined): boolean {
  const { audience, mode } = fragment.frontmatter;
  switch (outlet) {
    case "claude-md:project":
    case "claude-md:user":
      return mode === "static" && audience.includes("main");
    case "hook:session-start":
      return mode === "dynamic" && audience.includes("main");
    case "hook:subagent-start":
      return audience.some((a) => a === "subagent:*" || (agentType !== undefined && a === `subagent:${agentType}`));
    default: {
      const unreachable: never = outlet;
      throw new Error(`selectFragments: unknown outlet ${String(unreachable)}`);
    }
  }
}

function matchesWhen(fragment: Fragment, language: string | null): boolean {
  const when = fragment.frontmatter.when;
  if (when === undefined) return true;
  for (const [key, allowed] of Object.entries(when)) {
    if (allowed === undefined) continue;
    const matcher = WHEN_MATCHERS[key];
    if (matcher === undefined) {
      throw new Error(`selectFragments: fragment '${fragment.frontmatter.id}' uses unknown when key '${key}'`);
    }
    if (!matcher(allowed as readonly string[], { language })) return false;
  }
  return true;
}

/**
 * Select the fragments one outlet renders.
 *
 * @param all Fragments of ALL layers, un-merged (an id may repeat across layers).
 * @param options Outlet, optional subagent type, and the outlet-resolved config.
 * @returns Selected fragments, id ascending. Input array is not mutated.
 * @throws Error when a fragment carries a `when` key with no registered matcher (fail loud).
 */
export function selectFragments(all: readonly Fragment[], options: SelectOptions): Fragment[] {
  const { outlet, agentType, config } = options;
  const allowedLayers = OUTLET_LAYERS[outlet];
  const eligible = all.filter((f) => allowedLayers.has(f.layer));
  return resolveOverrides(eligible)
    .filter((f) => !config.disabled.has(f.frontmatter.id))
    .filter((f) => matchesOutletRouting(f, outlet, agentType))
    .filter((f) => matchesWhen(f, config.language))
    .sort(compareById);
}

/**
 * Refuse cross-file targeting of a STATIC MAIN fragment that the targeting file does not own.
 * A static main fragment lands in a CLAUDE.md file, so only the scope that owns the next layer
 * up may override/disable it: shipped is overridable/disable-able by project only; user-layer
 * ones by nobody outside the user file. Dynamic and subagent-only fragments are unrestricted.
 *
 * @param all Fragments of ALL layers, un-merged.
 * @param configs Raw global + project config layers.
 * @returns ok(undefined), or a VALIDATION_ERROR whose message names every offending id.
 */
export function checkOverrides(all: readonly Fragment[], configs: OverrideConfigs): Result<void, OverrideViolationError> {
  const offending = new Set<string>();

  const byId = new Map<string, Fragment[]>();
  for (const fragment of all) {
    const list = byId.get(fragment.frontmatter.id) ?? [];
    list.push(fragment);
    byId.set(fragment.frontmatter.id, list);
  }

  for (const [id, versions] of byId) {
    for (const lower of versions) {
      if (!isStaticMain(lower)) continue;
      for (const higher of versions) {
        if (LAYER_RANK[higher.layer] <= LAYER_RANK[lower.layer]) continue;
        const legal = lower.layer === "shipped" && higher.layer === "project";
        if (!legal) offending.add(id);
      }
    }
  }

  const globalDisable = new Set(configs.global.context?.fragments?.disable ?? []);
  const projectDisable = new Set(configs.project.context?.fragments?.disable ?? []);
  for (const fragment of all) {
    if (!isStaticMain(fragment)) continue;
    const id = fragment.frontmatter.id;
    // Global config owns only the user layer; project config owns shipped (and its own) layer.
    if (fragment.layer === "shipped" && globalDisable.has(id)) offending.add(id);
    if (fragment.layer === "user" && projectDisable.has(id)) offending.add(id);
  }

  if (offending.size === 0) return ok(undefined);
  const list = [...offending].sort();
  return err({
    code: "VALIDATION_ERROR",
    field: "context.fragments",
    message: `cross-file override/disable of static main fragment refused: ${list.join(", ")}`,
    value: list,
  });
}
