/**
 * Module: baseline — the `baseline` DocType's extra schema, node/parent check,
 * rule lifecycle helper and the BL-11 rule-statement lint.
 *
 * Purpose: SSOT for the product-baseline tree's typed `extra` (spec
 *   `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` §C1, §C3).
 * Public surface: `baselineExtraSchema`, `baselineRuleSchema`, `glossaryEntrySchema`,
 *   `BASELINE_RULE_ID_PATTERN`, `validateBaselineParent`, `isLawfulRuleLifecycleTransition`,
 *   `lintRuleStatement`, and their derived types.
 * Invariants: rules only on `node=leaf`; glossary only on root|branch; rule lifecycle only
 *   moves forward (live -> deprecated -> retired, or live -> retired); a retired rule
 *   carries a `retired_note`.
 * Side effects: none (pure). ⛔ Browser-safe barrel member — no Node import. The lint's
 *   repo-path check therefore takes an INJECTED `pathExists` predicate; the caller
 *   (service layer) owns the filesystem probe.
 */
import { z } from "zod";

/** Permanent rule id grammar: `BR-` + positive integer without leading zero. */
export const BASELINE_RULE_ID_PATTERN = /^BR-[1-9][0-9]*$/;

export const BASELINE_NODE_KINDS = ["root", "branch", "leaf"] as const;
export const baselineNodeSchema = z.enum(BASELINE_NODE_KINDS);
export type BaselineNode = z.infer<typeof baselineNodeSchema>;

export const RULE_CONFIDENCES = ["established", "undecided", "unconfirmed", "observed"] as const;
export const RULE_ENFORCEMENTS = ["guaranteed", "both", "prompt-only"] as const;
export const RULE_LIFECYCLES = ["live", "deprecated", "retired"] as const;
export type RuleLifecycle = (typeof RULE_LIFECYCLES)[number];

/** One behavioural rule of a baseline leaf. `observed` = what the system does today, intent unconfirmed (BL-12). */
export const baselineRuleSchema = z
  .object({
    id: z.string().regex(BASELINE_RULE_ID_PATTERN, "rule id must match BR-<n> (n >= 1, no leading zero)"),
    statement: z.string().min(1).max(500),
    confidence: z.enum(RULE_CONFIDENCES),
    enforced_by: z.enum(RULE_ENFORCEMENTS),
    examples: z.array(z.string().max(300)).min(1).max(3),
    lifecycle: z.enum(RULE_LIFECYCLES),
    retired_note: z.string().min(1).optional(),
  })
  .superRefine((rule, ctx) => {
    if (rule.lifecycle === "retired" && rule.retired_note === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a retired rule requires retired_note",
        path: ["retired_note"],
      });
    }
  });
export type BaselineRule = z.infer<typeof baselineRuleSchema>;

export const glossaryEntrySchema = z.object({
  term: z.string().min(1),
  meaning: z.string().min(1),
  note: z.string().optional(),
});
export type GlossaryEntry = z.infer<typeof glossaryEntrySchema>;

/**
 * `extra` of a `baseline` doc.
 * @invariant `rules`, `site_map`, `commands` present only when `node === "leaf"`; `glossary` only on root|branch;
 *   rule ids unique within the leaf.
 */
export const baselineExtraSchema = z
  .object({
    node: baselineNodeSchema,
    label: z.string().min(1).optional(),
    rules: z.array(baselineRuleSchema).optional(),
    depends_on: z.array(z.string().min(1)).optional(),
    glossary: z.array(glossaryEntrySchema).optional(),
    /** Leaf only: census site key -> rule ids (`BR-n`) and/or `non-business:<reason>`. Written only by `lore baseline map`. */
    site_map: z.record(z.string().min(1), z.array(z.string().min(1)).min(1)).optional(),
    /** Leaf only: CLI command names (e.g. `ac add`) whose census this leaf answers for. Written only by `lore baseline map --command`. */
    commands: z.array(z.string().min(1)).optional(),
  })
  .superRefine((extra, ctx) => {
    for (const key of ["site_map", "commands"] as const) {
      if (extra[key] !== undefined && extra.node !== "leaf") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} is allowed only on node=leaf (got node=${extra.node})`,
          path: [key],
        });
      }
    }
    if (extra.rules !== undefined && extra.node !== "leaf") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `rules are allowed only on node=leaf (got node=${extra.node})`,
        path: ["rules"],
      });
    }
    if (extra.glossary !== undefined && extra.node === "leaf") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "glossary is allowed only on node=root|branch",
        path: ["glossary"],
      });
    }
    const seen = new Set<string>();
    (extra.rules ?? []).forEach((rule, index) => {
      if (seen.has(rule.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate rule id ${rule.id}`,
          path: ["rules", index, "id"],
        });
      }
      seen.add(rule.id);
    });
  });
export type BaselineExtra = z.infer<typeof baselineExtraSchema>;

/** Minimal parent description the node/parent check needs (`node` only for baseline parents). */
export interface BaselineParentRef {
  type: string;
  node?: string;
}

export type BaselineParentVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Check that a baseline doc's `node` kind is consistent with its parent.
 * node=root => parent is a prd; node=branch|leaf => parent is a baseline whose node is root|branch.
 * Cross-entity, so it lives outside the Zod schema (the caller supplies the parent).
 */
export function validateBaselineParent(
  extra: { node: string },
  parent: BaselineParentRef,
): BaselineParentVerdict {
  if (extra.node === "root") {
    return parent.type === "prd"
      ? { ok: true }
      : { ok: false, reason: `node=root requires a prd parent (got ${parent.type})` };
  }
  if (extra.node === "branch" || extra.node === "leaf") {
    if (parent.type !== "baseline") {
      return { ok: false, reason: `node=${extra.node} requires a baseline parent (got ${parent.type})` };
    }
    if (parent.node !== "root" && parent.node !== "branch") {
      return {
        ok: false,
        reason: `node=${extra.node} requires a parent baseline with node root|branch (got ${parent.node ?? "none"})`,
      };
    }
    return { ok: true };
  }
  return { ok: false, reason: `unknown baseline node '${extra.node}'` };
}

/** Allowed forward moves of a rule's lifecycle. Nothing returns to `live`. */
const LAWFUL_RULE_TRANSITIONS: Readonly<Record<RuleLifecycle, readonly RuleLifecycle[]>> = {
  live: ["deprecated", "retired"],
  deprecated: ["retired"],
  retired: [],
};

/** True only for live->deprecated, live->retired, deprecated->retired. */
export function isLawfulRuleLifecycleTransition(from: string, to: string): boolean {
  const allowed = (LAWFUL_RULE_TRANSITIONS as Record<string, readonly string[] | undefined>)[from];
  return allowed !== undefined && allowed.includes(to);
}

export type RuleLintKind = "repo-path" | "symbol" | "call" | "flag" | "env-assignment" | "config-key";
export interface RuleLintFlag {
  token: string;
  kind: RuleLintKind;
}
export interface RuleLintOptions {
  /** Injected existence probe for repo-relative paths (core stays free of Node imports). */
  pathExists: (path: string) => boolean;
}

// reason: each pattern is one BL-11 token class; order here is the report order.
const PATH_PATTERN = /[\w.-]+(?:\/[\w.-]+)+/g;
const SYMBOL_PATTERN = /(?<![\w&])#[A-Za-z_]\w*/g;
const CALL_PATTERN = /\b[A-Za-z_]\w*\((?!s\))/g;
const FLAG_PATTERN = /(?<![\w-])--[a-z][\w-]*/g;
const ENV_PATTERN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+=[^\s,;]*/g;
const CONFIG_KEY_PATTERN = /\b[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2,}\b/g;

/**
 * BL-11 lint: flag implementation detail inside a rule statement. Warn-only — never refuses.
 * Pure: the only environment access is the injected `pathExists`.
 * @returns one flag per distinct (token, kind), in pattern order then text order.
 */
export function lintRuleStatement(statement: string, options: RuleLintOptions): RuleLintFlag[] {
  const flags: RuleLintFlag[] = [];
  const seen = new Set<string>();
  const collect = (pattern: RegExp, kind: RuleLintKind, accept: (token: string) => boolean): void => {
    for (const match of statement.matchAll(pattern)) {
      const token = match[0];
      const key = `${kind}\u0000${token}`;
      if (seen.has(key) || !accept(token)) continue;
      seen.add(key);
      flags.push({ token, kind });
    }
  };
  collect(PATH_PATTERN, "repo-path", (token) => options.pathExists(token));
  collect(SYMBOL_PATTERN, "symbol", () => true);
  collect(CALL_PATTERN, "call", () => true);
  collect(FLAG_PATTERN, "flag", () => true);
  collect(ENV_PATTERN, "env-assignment", () => true);
  collect(CONFIG_KEY_PATTERN, "config-key", () => true);
  return flags;
}
