/**
 * Module: baseline — the `baseline` DocType's extra schema, node/parent check,
 * rule lifecycle helper and the BL-11 rule-statement lint.
 *
 * Purpose: SSOT for the product-baseline tree's typed `extra` (spec
 *   `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` §C1, §C3).
 * Public surface: `baselineExtraSchema`, `baselineRuleSchema`, `glossaryEntrySchema`,
 *   `BASELINE_RULE_ID_PATTERN` (BR), `STANDARD_RULE_ID_PATTERN` (AS), `DEBT_RULE_ID_PATTERN` (AD),
 *   `ANY_RULE_ID_PATTERN`, `ruleIdPrefix`, `ruleIdPrefixOfNode`, `isBusinessBaseline`, `isNodeOfTree`,
 *   `validateBaselineParent`, `isLawfulRuleLifecycleTransition`, `lintRuleStatement`, and their
 *   derived types.
 * Invariants: two trees share the `baseline` type (`extra.tree`, absent = business). Business nodes
 *   are root|branch|leaf, architecture nodes root|section|module-card|standard|debt-registry. Rules
 *   live on a business `leaf` (ids `BR-n`), an architecture `standard` (`AS-n`) and an architecture
 *   `debt-registry` (`AD-n`) only; the id family must match the node. Glossary only on a business
 *   root|branch; rule lifecycle only moves forward and nothing new enters `deprecated` (live ->
 *   retired; a rule already deprecated may still go -> retired); a retired rule carries a `retired_note`. The four-part standard fields
 *   (current_reality / target_rule / current_exceptions / migration) exist only on `AS-n` rules and
 *   are all-or-nothing.
 * Side effects: none (pure). ⛔ Browser-safe barrel member — no Node import. The lint's
 *   repo-path check therefore takes an INJECTED `pathExists` predicate; the caller
 *   (service layer) owns the filesystem probe.
 */
import { z } from "zod";

/** Permanent business rule id grammar: `BR-` + positive integer without leading zero. */
export const BASELINE_RULE_ID_PATTERN = /^BR-[1-9][0-9]*$/;
/** Architecture standard rule id grammar (`AS-n`). */
export const STANDARD_RULE_ID_PATTERN = /^AS-[1-9][0-9]*$/;
/** Architecture debt entry id grammar (`AD-n`). Never citable by a criterion; named only in a standard's current exceptions. */
export const DEBT_RULE_ID_PATTERN = /^AD-[1-9][0-9]*$/;
/** Any of the three permanent id families. */
export const ANY_RULE_ID_PATTERN = /^(BR|AS|AD)-[1-9][0-9]*$/;

/** The three id families: business rule, architecture standard rule, architecture debt entry. */
export const RULE_ID_PREFIXES = ["BR", "AS", "AD"] as const;
export type RuleIdPrefix = (typeof RULE_ID_PREFIXES)[number];

/** The family of a well-formed rule id, or `undefined` when `id` is none of BR-n / AS-n / AD-n. */
export function ruleIdPrefix(id: string): RuleIdPrefix | undefined {
  if (BASELINE_RULE_ID_PATTERN.test(id)) return "BR";
  if (STANDARD_RULE_ID_PATTERN.test(id)) return "AS";
  if (DEBT_RULE_ID_PATTERN.test(id)) return "AD";
  return undefined;
}

export const BASELINE_TREES = ["business", "architecture"] as const;
export const baselineTreeSchema = z.enum(BASELINE_TREES);
export type BaselineTree = z.infer<typeof baselineTreeSchema>;

export const BUSINESS_NODE_KINDS = ["root", "branch", "leaf"] as const;
export const ARCHITECTURE_NODE_KINDS = ["root", "section", "module-card", "standard", "debt-registry"] as const;
/** Every node kind of either tree (`root` is shared). Whether a kind belongs to a tree is {@link isNodeOfTree}. */
export const BASELINE_NODE_KINDS = [
  "root",
  "branch",
  "leaf",
  "section",
  "module-card",
  "standard",
  "debt-registry",
] as const;
export const baselineNodeSchema = z.enum(BASELINE_NODE_KINDS);
export type BaselineNode = z.infer<typeof baselineNodeSchema>;

/** True when `node` is a kind of `tree` (absent tree = business). */
export function isNodeOfTree(tree: BaselineTree | undefined, node: string): boolean {
  const kinds: readonly string[] = tree === "architecture" ? ARCHITECTURE_NODE_KINDS : BUSINESS_NODE_KINDS;
  return kinds.includes(node);
}

/** True for a business-tree baseline `extra` (absent `tree` means business). */
export function isBusinessBaseline(extra: { tree?: string | undefined } | undefined): boolean {
  return extra?.tree === undefined || extra.tree === "business";
}

/**
 * The id family a node holds rules in: business leaf -> BR, architecture standard -> AS,
 * architecture debt-registry -> AD; `undefined` for every node that holds no rules.
 */
export function ruleIdPrefixOfNode(extra: { tree?: string | undefined; node?: string | undefined }): RuleIdPrefix | undefined {
  if (isBusinessBaseline(extra)) return extra.node === "leaf" ? "BR" : undefined;
  if (extra.node === "standard") return "AS";
  if (extra.node === "debt-registry") return "AD";
  return undefined;
}

export const RULE_CONFIDENCES = ["established", "undecided", "unconfirmed", "observed"] as const;
export const RULE_ENFORCEMENTS = ["guaranteed", "both", "prompt-only"] as const;
export const RULE_LIFECYCLES = ["live", "deprecated", "retired"] as const;
export type RuleLifecycle = (typeof RULE_LIFECYCLES)[number];

/**
 * The states of a permanent rule id in the registry: the three leaf lifecycles plus `proposed` — an id a
 * spec's change set has reserved that is NOT in the tree yet (spec-a-spec-carries-its-rule-changes-the-
 * baseline-takes-them, Model). A leaf's `extra.rules[].lifecycle` stays {@link RULE_LIFECYCLES}: a
 * `proposed` rule is never listed by a leaf.
 */
export const RULE_REGISTRY_STATES = [...RULE_LIFECYCLES, "proposed"] as const;
export type RuleRegistryState = (typeof RULE_REGISTRY_STATES)[number];

/** One behavioural rule of a baseline leaf. `observed` = what the system does today, intent unconfirmed (BL-12). */
export const baselineRuleSchema = z
  .object({
    id: z.string().regex(ANY_RULE_ID_PATTERN, "rule id must match BR-<n>, AS-<n> or AD-<n> (n >= 1, no leading zero)"),
    statement: z.string().min(1).max(500),
    confidence: z.enum(RULE_CONFIDENCES),
    enforced_by: z.enum(RULE_ENFORCEMENTS),
    examples: z.array(z.string().max(300)).min(1).max(3),
    lifecycle: z.enum(RULE_LIFECYCLES),
    retired_note: z.string().min(1).optional(),
    /** Four-part standard (AS-n only; all four or none): what the code does today. */
    current_reality: z.string().min(1).max(1000).optional(),
    /** Four-part standard: the rule the code is migrating toward. */
    target_rule: z.string().min(1).max(1000).optional(),
    /** Four-part standard: the debt entries (`AD-n`) that still violate it; may be empty. */
    current_exceptions: z
      .array(z.string().regex(DEBT_RULE_ID_PATTERN, "current_exceptions[] must match AD-<n>"))
      .optional(),
    /** Four-part standard: how the exceptions get closed. */
    migration: z.string().min(1).max(1000).optional(),
  })
  .superRefine((rule, ctx) => {
    const fourPart = {
      current_reality: rule.current_reality,
      target_rule: rule.target_rule,
      current_exceptions: rule.current_exceptions,
      migration: rule.migration,
    };
    const present = Object.entries(fourPart).filter(([, value]) => value !== undefined);
    const missing = Object.entries(fourPart).filter(([, value]) => value === undefined);
    if (present.length > 0 && !STANDARD_RULE_ID_PATTERN.test(rule.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${present.map(([key]) => key).join(", ")} exist only on an AS-<n> standard rule (got ${rule.id})`,
        path: [present[0]?.[0] ?? "id"],
      });
    } else if (present.length > 0 && missing.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a four-part standard needs all of current_reality, target_rule, current_exceptions, migration (missing ${missing.map(([key]) => key).join(", ")})`,
        path: [missing[0]?.[0] ?? "current_reality"],
      });
    }
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

/** A node label: non-empty after trimming (BR-613) — the one definition both write paths use. */
export const baselineLabelSchema = z.string().refine((label) => label.trim() !== "", { message: "label must not be empty" });

/**
 * `extra` of a `baseline` doc.
 * @invariant `rules`, `site_map`, `commands` present only when `node === "leaf"`; `glossary` only on root|branch;
 *   rule ids unique within the leaf.
 */
export const baselineExtraSchema = z
  .object({
    /** Which tree this node belongs to; ABSENT means business (every pre-existing doc stays valid). */
    tree: baselineTreeSchema.optional(),
    node: baselineNodeSchema,
    label: baselineLabelSchema.optional(),
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
    if (!isNodeOfTree(extra.tree, extra.node)) {
      const kinds = extra.tree === "architecture" ? ARCHITECTURE_NODE_KINDS : BUSINESS_NODE_KINDS;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `node=${extra.node} does not belong to tree=${extra.tree ?? "business"} (allowed: ${kinds.join("|")})`,
        path: ["node"],
      });
    }
    const family = ruleIdPrefixOfNode(extra);
    if (extra.rules !== undefined && family === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `rules are allowed only on a business leaf, an architecture standard or debt-registry (got tree=${extra.tree ?? "business"} node=${extra.node})`,
        path: ["rules"],
      });
    }
    if (extra.glossary !== undefined && !(isBusinessBaseline(extra) && extra.node !== "leaf")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "glossary is allowed only on a business node=root|branch",
        path: ["glossary"],
      });
    }
    const seen = new Set<string>();
    (extra.rules ?? []).forEach((rule, index) => {
      if (family !== undefined && ruleIdPrefix(rule.id) !== family) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `rule ${rule.id} does not belong on this node (a ${extra.tree ?? "business"} ${extra.node} holds ${family}-<n> ids)`,
          path: ["rules", index, "id"],
        });
      }
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

/** Minimal parent description the node/parent check needs (`node`/`tree` only for baseline parents). */
export interface BaselineParentRef {
  type: string;
  node?: string;
  /** The parent's `extra.tree`; absent means business. */
  tree?: string;
}

export type BaselineParentVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Check that a baseline doc's `node` kind is consistent with its parent, per tree.
 * Business: root => prd parent; branch|leaf => business baseline root|branch.
 * Architecture: root => prd parent; section => architecture root; module-card|standard|debt-registry
 * => architecture section. A node never hangs under a parent of the other tree.
 * Cross-entity, so it lives outside the Zod schema (the caller supplies the parent).
 */
export function validateBaselineParent(
  extra: { node: string; tree?: string },
  parent: BaselineParentRef,
): BaselineParentVerdict {
  const tree = extra.tree === "architecture" ? "architecture" : "business";
  if (extra.node === "root") {
    return parent.type === "prd"
      ? { ok: true }
      : { ok: false, reason: `node=root requires a prd parent (got ${parent.type})` };
  }
  if (!isNodeOfTree(tree, extra.node)) {
    return { ok: false, reason: `node=${extra.node} does not belong to tree=${tree}` };
  }
  if (parent.type !== "baseline") {
    return { ok: false, reason: `node=${extra.node} requires a baseline parent (got ${parent.type})` };
  }
  const parentTree = parent.tree === "architecture" ? "architecture" : "business";
  if (parentTree !== tree) {
    return { ok: false, reason: `node=${extra.node} (tree=${tree}) cannot hang under a tree=${parentTree} parent` };
  }
  const allowedParents: readonly string[] =
    tree === "business" ? ["root", "branch"] : extra.node === "section" ? ["root"] : ["section"];
  if (parent.node === undefined || !allowedParents.includes(parent.node)) {
    return {
      ok: false,
      reason: `node=${extra.node} requires a parent baseline with node ${allowedParents.join("|")} (got ${parent.node ?? "none"})`,
    };
  }
  return { ok: true };
}

/**
 * Allowed forward moves of a rule's lifecycle. Nothing returns to `live`, and nothing NEW enters `deprecated`
 * (D4 of spec-a-spec-carries-its-rule-changes-the-baseline-takes-them: a snapshot rule is true or not; "still
 * true, going away" belongs to the change set that will retire it). `deprecated -> retired` stays lawful so the
 * rules that already sit in `deprecated` can leave it.
 */
const LAWFUL_RULE_TRANSITIONS: Readonly<Record<RuleLifecycle, readonly RuleLifecycle[]>> = {
  live: ["retired"],
  deprecated: ["retired"],
  retired: [],
};

/** True only for live->retired and deprecated->retired. */
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

// ─── Spec rule change set (`extra.rule_changes`) ─────────────────────────────

const ruleChangeText = z.string().min(1).max(500);
/** ISO 8601 time the entry landed in the tree (`lore rule apply`); absent = not landed yet. Written only by apply. */
const ruleChangeAppliedAt = z.string().min(1).optional();
const ruleChangeExamples = z.array(z.string().max(300)).min(1).max(3);

/**
 * One entry of a spec's change set. `add` reserves a new `BR-n` (registry state `proposed`) and names the
 * leaf slug it will land on; `modify` / `retire` name a LIVE id. Strict: an unknown key is a typo, not data.
 */
export const ruleChangeSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("add"),
      id: z.string().regex(BASELINE_RULE_ID_PATTERN, "a proposed rule id must match BR-<n>"),
      leaf: z.string().min(1),
      statement: ruleChangeText,
      examples: ruleChangeExamples,
      enforced_by: z.enum(RULE_ENFORCEMENTS),
      applied_at: ruleChangeAppliedAt,
    })
    .strict(),
  z
    .object({
      op: z.literal("modify"),
      id: z.string().regex(BASELINE_RULE_ID_PATTERN, "a modified rule id must match BR-<n>"),
      statement: ruleChangeText.optional(),
      examples: ruleChangeExamples.optional(),
      enforced_by: z.enum(RULE_ENFORCEMENTS).optional(),
      applied_at: ruleChangeAppliedAt,
    })
    .strict(),
  z
    .object({
      op: z.literal("retire"),
      id: z.string().regex(BASELINE_RULE_ID_PATTERN, "a retired rule id must match BR-<n>"),
      note: z.string().min(1),
      applied_at: ruleChangeAppliedAt,
    })
    .strict(),
]);
export type RuleChange = z.infer<typeof ruleChangeSchema>;

/** A spec's whole change set. Ids are unique within it: one entry per rule id; a modify changes something. */
export const specRuleChangesSchema = z.array(ruleChangeSchema).superRefine((changes, ctx) => {
  const seen = new Set<string>();
  changes.forEach((change, index) => {
    if (seen.has(change.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate rule id ${change.id} in the change set`, path: [index, "id"] });
    }
    seen.add(change.id);
    if (change.op === "modify" && change.statement === undefined && change.examples === undefined && change.enforced_by === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a modify must change at least one of statement, examples, enforced_by", path: [index] });
    }
  });
});
