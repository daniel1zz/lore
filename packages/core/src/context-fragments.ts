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

// ─── Language names (D3) ───

/** Language code → name written into Claude Code's `language` setting. */
export const LANGUAGE_NAMES = {
  zh: "Chinese",
  en: "English",
  ja: "Japanese",
} as const;

// ─── Fragment frontmatter ───

/** `main` or `subagent:*` or `subagent:<agent_type>`. */
export const AUDIENCE_PATTERN = /^(main|subagent:(\*|[A-Za-z0-9_:-]+))$/;

export const FRAGMENT_MODES = ["static", "dynamic"] as const;

/** How a fragment reaches the model: always-loaded rules file, or an on-demand skill. */
export const FRAGMENT_DELIVERIES = ["rules", "skill"] as const;

/** Max chars of a skill `description` (BR-1061; Claude Code truncates skill listings beyond this). */
export const SKILL_DESCRIPTION_MAX = 1536;

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
    audience: z.array(z.string().regex(AUDIENCE_PATTERN, "audience must be 'main' or 'subagent:<*|agent_type>'")).min(1),
    mode: z.enum(FRAGMENT_MODES),
    when: z.object({ language: z.array(z.string().min(1)).min(1).optional() }).strict().optional(),
    delivery: z.enum(FRAGMENT_DELIVERIES).default("rules"),
    description: z.string().min(1).max(SKILL_DESCRIPTION_MAX).optional(),
  })
  .strict()
  .superRefine((fm, ctx) => {
    if (fm.delivery !== "skill") return;
    if (fm.description === undefined) {
      ctx.addIssue({ code: "custom", path: ["description"], message: "delivery: skill requires a description" });
    }
    if (fm.mode !== "static") {
      ctx.addIssue({ code: "custom", path: ["mode"], message: "delivery: skill requires mode: static" });
    }
    if (fm.audience.length !== 1 || fm.audience[0] !== "main") {
      ctx.addIssue({ code: "custom", path: ["audience"], message: "delivery: skill requires audience: [main]" });
    }
  });

export type FragmentFrontmatter = z.infer<typeof FragmentFrontmatterSchema>;
export type Audience = FragmentFrontmatter["audience"][number];
export type FragmentDelivery = (typeof FRAGMENT_DELIVERIES)[number];
export type FragmentMode = (typeof FRAGMENT_MODES)[number];

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

// reason: `hook:session-start` is retired (spec-one-upgrade-reminder-at-session-start-covers-the-global, BR-912):
// a dynamic main fragment reached the model only through that outlet, so it now reaches nowhere and
// `lore fragments check` refuses it (kind `dynamic_main`). Do not re-add the id without a replacement delivery path.
export const OUTLET_IDS = [
  "rules:project",
  "rules:user",
  "skills:project",
  "skills:user",
  "hook:subagent-start",
] as const;
export type OutletId = (typeof OUTLET_IDS)[number];

/** Structural subset of project / global config this module reads (avoids a config.ts import cycle). */
export interface ContextConfigLayer {
  readonly context?: {
    readonly language?: string;
    readonly fragments?: { readonly disable?: readonly string[] };
  };
}

export type LanguageSource = "global" | "project" | "none";

export interface ResolvedContextConfig {
  readonly language: string | null;
  readonly languageSource: LanguageSource;
  readonly disabled: ReadonlySet<string>;
}

/**
 * Resolve the effective language + disabled ids for one outlet.
 * - rules:user, skills:user       → GLOBAL layer only
 * - rules:project, skills:project → PROJECT layer only
 * - hook:subagent-start → project language over global; disable lists unioned
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
      };
    case "rules:project":
    case "skills:project":
      return {
        language: p.language ?? null,
        languageSource: p.language !== undefined ? "project" : "none",
        disabled: new Set(pDisable),
      };
    case "hook:subagent-start": {
      const language = p.language ?? g.language ?? null;
      const languageSource: LanguageSource =
        p.language !== undefined ? "project" : g.language !== undefined ? "global" : "none";
      return { language, languageSource, disabled: new Set([...gDisable, ...pDisable]) };
    }
    default: {
      const unreachable: never = outlet;
      throw new Error(`resolveContextConfig: unknown outlet ${String(unreachable)}`);
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
