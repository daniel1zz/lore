/**
 * Context fragments — browser-safe types, schema, config resolution and cap constants.
 * Spec: spec-context-fragments-config-driven-layered-rule-injection (D3, D6, D11, D14).
 *
 * @invariant Pure module: NO Node builtin imports (default-barrel browser-safety rule,
 *   see packages/core/src/CLAUDE.md). Discovery / rendering live in packages/lore.
 * @invariant No silent defaults: frontmatter fields are required unless marked optional;
 *   an unset language resolves to `null`, never a made-up default.
 */
import { z } from "zod";

import { err, ok, type LoreError, type Result } from "./errors.js";

// ─── Cap constants (D6, GH #20: hook strings over 10_000 chars are silently truncated) ───

/** Claude Code truncates a hook-emitted string above this many characters. */
export const HOOK_STRING_CAP = 10_000;
/** Reserved for the subagent pointer line appended after fragments. */
export const POINTER_CEILING = 600;
/**
 * Ceiling of the failure banner a hook outlet emits in place of its block (D12). It is NOT reserved out of the
 * fragment cap: the banner REPLACES the block, so the cap is only ever reduced by the pointer line (BR-907).
 */
export const HOOK_BANNER_CAP = 400;
/** Max fragment chars at hook:subagent-start (HOOK_STRING_CAP - POINTER_CEILING). */
export const SUBAGENT_FRAGMENT_CAP = HOOK_STRING_CAP - POINTER_CEILING;
/**
 * Max chars of the hook:user-prompt block (blank separators counted). The block is re-sent on every user turn
 * and stays in the transcript, so it is far below the hook string cap (D5).
 */
export const USER_PROMPT_FRAGMENT_CAP = 1_000;

// ─── Language names (D3) ───

/** Language code → name written into Claude Code's `language` setting. */
export const LANGUAGE_NAMES = {
  zh: "Chinese",
  en: "English",
  ja: "Japanese",
} as const;

/**
 * Maps a language code to its name (the one lookup behind Claude Code's `language` projection, the drift check
 * and `{{lore:artifact_language}}`).
 * @param code language code read from config
 * @param field config key the code came from (e.g. `context.language`), named in the refusal
 * @param layer config layer the code came from, named in the refusal
 * @returns err(VALIDATION_ERROR) naming field, layer and the known codes when `code` is unknown
 */
export function languageName(code: string, field: string, layer: "global" | "project"): Result<string, LoreError> {
  // reason: Object.hasOwn — "constructor"/"toString" must not resolve through the prototype.
  if (!Object.hasOwn(LANGUAGE_NAMES, code)) {
    return err({
      code: "VALIDATION_ERROR",
      field,
      message: `${layer} ${field} "${code}" is not a known code (known: ${Object.keys(LANGUAGE_NAMES).join(", ")})`,
      value: code,
      rule: "BR-828",
    });
  }
  return ok((LANGUAGE_NAMES as Readonly<Record<string, string>>)[code] as string);
}

// ─── Fragment frontmatter ───

/**
 * When a fragment reaches the model (spec-fragment-injection-timing-one-inject-enum-a-per-turn, Injection timings).
 * `launch` -> lore rules file; `on-demand` -> lore skill; `user-prompt` -> every-turn UserPromptSubmit hook;
 * `subagent-start` -> helper-agent SubagentStart hook.
 */
export const INJECT_TIMINGS = ["launch", "on-demand", "user-prompt", "subagent-start"] as const;
export type InjectTiming = (typeof INJECT_TIMINGS)[number];

/** Timings that reach the main session; a fragment names at most one (D2, BR-1067). */
export const MAIN_SESSION_TIMINGS: ReadonlySet<InjectTiming> = new Set<InjectTiming>(["launch", "on-demand", "user-prompt"]);

/** Max chars of a skill `description` (BR-1061; Claude Code truncates skill listings beyond this). */
export const SKILL_DESCRIPTION_MAX = 1536;

/**
 * Retired frontmatter keys (D9): declared so `.strict()` does not pre-empt the message with a generic
 * "unrecognized key". Presence is refused with the migration command named. Property-level refine (not
 * superRefine) so the message survives other issues on the same file, e.g. the then-missing `inject`.
 */
function retiredKey(key: "audience" | "mode" | "delivery") {
  return z
    .unknown()
    .optional()
    .refine((v) => v === undefined, {
      message: `'${key}' is retired: replace audience/mode/delivery with 'inject' (run: lore migrate fragments --scope user|project --apply)`,
    });
}

export const FragmentFrontmatterSchema = z
  .object({
    // reason: `lore context refresh` prefixes `lore-` onto every rules file name (.claude/rules/lore-<id>.md)
    // and skill directory (skills/lore-<id>/), so an id already starting `lore-` yields `lore-lore-…`.
    id: z
      .string()
      .min(1)
      .refine((id) => !id.startsWith("lore-"), {
        message:
          "fragment id must not start with 'lore-': refresh prefixes 'lore-' onto rules files and skill dirs, so it would render as 'lore-lore-…'",
      }),
    title: z.string().min(1),
    inject: z.array(z.enum(INJECT_TIMINGS)).min(1),
    agents: z.array(z.string().min(1)).min(1).optional(),
    when: z.object({ language: z.array(z.string().min(1)).min(1).optional() }).strict().optional(),
    description: z.string().min(1).max(SKILL_DESCRIPTION_MAX).optional(),
    audience: retiredKey("audience"),
    mode: retiredKey("mode"),
    delivery: retiredKey("delivery"),
  })
  .strict()
  .superRefine((fm, ctx) => {
    const issue = (field: string, message: string) => ctx.addIssue({ code: "custom", path: [field], message });
    if (new Set(fm.inject).size !== fm.inject.length) issue("inject", "inject must not repeat a value");
    const mainTimings = fm.inject.filter((t) => MAIN_SESSION_TIMINGS.has(t));
    if (mainTimings.length > 1) {
      issue("inject", `inject names more than one main-session timing (${mainTimings.join(", ")}); a fragment names at most one`);
    }
    const onDemand = fm.inject.includes("on-demand");
    if (onDemand && fm.inject.length > 1) issue("inject", "inject: on-demand must be the only value");
    if (fm.agents !== undefined && !fm.inject.includes("subagent-start")) {
      issue("agents", "agents is only allowed together with inject: subagent-start");
    }
    if (onDemand && fm.description === undefined) issue("description", "inject: on-demand requires a description");
    if (!onDemand && fm.description !== undefined) issue("description", "description is only allowed with inject: on-demand");
  });

export type FragmentFrontmatter = z.infer<typeof FragmentFrontmatterSchema>;

/** True when the fragment reaches the main session at some timing (launch, on-demand or user-prompt). */
export function hasMainSessionTiming(fragment: Pick<FragmentFrontmatter, "inject">): boolean {
  return fragment.inject.some((t) => MAIN_SESSION_TIMINGS.has(t));
}

/** A discovered fragment: validated frontmatter + body + where it came from. */
export interface Fragment {
  readonly frontmatter: FragmentFrontmatter;
  readonly body: string;
  readonly layer: "shipped" | "user" | "project";
  readonly path: string;
  /** 0-based line index in the FILE where the body starts (frontmatter lines incl. both `---` fences); stamped by discoverFragments, never estimated. */
  readonly bodyLineOffset: number;
}

// ─── Outlets & config resolution (D11, D14) ───

// reason: `hook:session-start` is retired (spec-one-upgrade-reminder-at-session-start-covers-the-global, BR-912).
// `hook:user-prompt` is its per-turn replacement (spec-fragment-injection-timing-one-inject-enum-a-per-turn).
export const OUTLET_IDS = [
  "rules:project",
  "rules:user",
  "skills:project",
  "skills:user",
  "hook:subagent-start",
  "hook:user-prompt",
] as const;
export type OutletId = (typeof OUTLET_IDS)[number];

/** Structural subset of project / global config this module reads (avoids a config.ts import cycle). */
export interface ContextConfigLayer {
  readonly context?: {
    readonly language?: string;
    /** `context.artifact_language`: language code of the documents lore writes. */
    readonly artifact_language?: string;
    readonly fragments?: { readonly disable?: readonly string[] };
  };
  /** `workflow.integrate.floor_command`: the only workflow key fragment text may name (`{{lore:integrate_floor}}`). */
  readonly workflow?: { readonly integrate?: { readonly floor_command?: string } };
}

export type LanguageSource = "global" | "project" | "none";

export interface ResolvedContextConfig {
  readonly language: string | null;
  readonly languageSource: LanguageSource;
  readonly disabled: ReadonlySet<string>;
  /**
   * The two disable lists apart. `disabled` is their union at hook outlets, but at hook:user-prompt each list
   * may only disable what it owns (BR-905, D8), so selection needs them separate.
   */
  readonly disabledByGlobal: ReadonlySet<string>;
  readonly disabledByProject: ReadonlySet<string>;
}

/**
 * Resolve the effective language + disabled ids for one outlet.
 * - rules:user, skills:user       → GLOBAL layer only
 * - rules:project, skills:project → PROJECT layer only
 * - hook:subagent-start → project language over global; disable lists unioned
 * - hook:user-prompt → project language over global; disable lists unioned HERE, but `selectFragments` applies
 *   each list only to the fragments it may legally disable (D8, BR-905)
 * Pure: never mutates its inputs.
 */
export function resolveContextConfig(
  global: ContextConfigLayer,
  project: ContextConfigLayer,
  outlet: OutletId,
): ResolvedContextConfig {
  const g = global.context ?? {};
  const p = project.context ?? {};
  const gDisable = g.fragments?.disable ?? [];
  const pDisable = p.fragments?.disable ?? [];

  switch (outlet) {
    case "rules:user":
    case "skills:user":
      return {
        language: g.language ?? null,
        languageSource: g.language !== undefined ? "global" : "none",
        disabled: new Set(gDisable),
        disabledByGlobal: new Set(gDisable),
        disabledByProject: new Set(),
      };
    case "rules:project":
    case "skills:project":
      return {
        language: p.language ?? null,
        languageSource: p.language !== undefined ? "project" : "none",
        disabled: new Set(pDisable),
        disabledByGlobal: new Set(),
        disabledByProject: new Set(pDisable),
      };
    case "hook:subagent-start":
    case "hook:user-prompt": {
      const language = p.language ?? g.language ?? null;
      const languageSource: LanguageSource =
        p.language !== undefined ? "project" : g.language !== undefined ? "global" : "none";
      return {
        language,
        languageSource,
        disabled: new Set([...gDisable, ...pDisable]),
        disabledByGlobal: new Set(gDisable),
        disabledByProject: new Set(pDisable),
      };
    }
    default: {
      const unreachable: never = outlet;
      throw new Error(`resolveContextConfig: unknown outlet ${String(unreachable)}`);
    }
  }
}

/**
 * The `workflow.integrate.floor_command` a fragment rendered for `outlet` may name, or `null` when that
 * outlet's layer sets none. Same layer routing as {@link resolveContextConfig}: user outlets read the
 * GLOBAL layer, project outlets the PROJECT layer, the subagent hook the project layer over the global one.
 */
export function resolveIntegrateFloor(
  global: ContextConfigLayer,
  project: ContextConfigLayer,
  outlet: OutletId,
): string | null {
  const g = global.workflow?.integrate?.floor_command;
  const p = project.workflow?.integrate?.floor_command;
  switch (outlet) {
    case "rules:user":
    case "skills:user":
      return g ?? null;
    case "rules:project":
    case "skills:project":
      return p ?? null;
    case "hook:subagent-start":
    case "hook:user-prompt":
      return p ?? g ?? null;
    default: {
      const unreachable: never = outlet;
      throw new Error(`resolveIntegrateFloor: unknown outlet ${String(unreachable)}`);
    }
  }
}

/**
 * The `context.artifact_language` code a fragment rendered for `outlet` may name, with the layer it came from,
 * or `null` when that outlet's layer sets none. Same layer routing as {@link resolveIntegrateFloor}.
 */
export function resolveArtifactLanguage(
  global: ContextConfigLayer,
  project: ContextConfigLayer,
  outlet: OutletId,
): { readonly code: string; readonly layer: "global" | "project" } | null {
  const g = global.context?.artifact_language;
  const p = project.context?.artifact_language;
  const fromGlobal = g === undefined ? null : ({ code: g, layer: "global" } as const);
  const fromProject = p === undefined ? null : ({ code: p, layer: "project" } as const);
  switch (outlet) {
    case "rules:user":
    case "skills:user":
      return fromGlobal;
    case "rules:project":
    case "skills:project":
      return fromProject;
    case "hook:subagent-start":
    case "hook:user-prompt":
      return fromProject ?? fromGlobal;
    default: {
      const unreachable: never = outlet;
      throw new Error(`resolveArtifactLanguage: unknown outlet ${String(unreachable)}`);
    }
  }
}

// ─── `when` matchers (D3) ───

/** Selection context a `when` clause is evaluated against. */
export interface WhenContext {
  readonly language: string | null;
}

/**
 * Registry of `when` key → predicate. A fragment with a `when` key absent from this
 * registry must be refused by the caller (fail loud), never silently matched.
 */
export const WHEN_MATCHERS: Readonly<Record<string, (allowed: readonly string[], ctx: WhenContext) => boolean>> = {
  language: (allowed, ctx) => ctx.language !== null && allowed.includes(ctx.language),
};
