#!/usr/bin/env bun
/**
 * Shipped-default drift oracle (`bun run check:shipped-defaults`) —
 * `spec-governance-defaults-must-ship-and-every-recorded-gap-must` D1/D2,
 * `task-raise-capture-timeout-ms-and-max-diff-chars-to-the-values` AC-GD-1.
 *
 * Purpose: a dogfood-validated override in THIS repo's `.lore/config.yaml`
 * (raised because the shipped default was measurably too small for real
 * work) never reaches any other consumer unless the SAME value also ships —
 * either as a code default (`packages/core/src/config.ts` / `ai.ts`) or as a
 * seed in `assets/project/lore-config-template.yaml`. This script compares
 * this repo's own config against "what a fresh install materialises" (code
 * defaults merged with the template) and fails loud on any divergence that
 * is not on the explicit {@link PROJECT_SPECIFIC_KEYS} allowlist.
 *
 * ## Predicate: ABSENCE only
 *
 * A repo override that merely DUPLICATES the shipped value is redundant but
 * harmless — flagging it would force pointless churn every time a shipped
 * default catches up to a repo override. Only a value the shipped surface
 * does NOT carry (whether because the path is entirely absent from the
 * shipped surface, or because it carries a DIFFERENT value there) is a
 * violation. See {@link findShippedDefaultDrift}.
 *
 * ## The allowlist cannot become a hiding place
 *
 * {@link PROJECT_SPECIFIC_KEYS} is the SOLE definition of "inherently
 * per-project" — never a discretionary judgement call layered on top. Every
 * entry carries a `rationale`; {@link meetsRationaleMinimalShape} pins that
 * rationale to a MINIMAL ACCEPTED SHAPE (non-empty, >= {@link
 * RATIONALE_MIN_LENGTH} chars after trimming, not a whole-value placeholder)
 * — a floor on EFFORT, never on MEANING, because no predicate can check
 * meaning. An allowlist entry failing that shape makes the WHOLE checker
 * exit 3, exactly like a drift violation.
 *
 * ## Why this checker does NOT call `loadConfig` for its OWN comparison basis
 *
 * `loadConfig` on a config.yaml that omits a whole top-level section (e.g. a
 * freshly-templated corpus's `ai:`/`workflow:` keys, which are absent) leaves
 * that section `undefined` — Zod's nested `.default(...)` values are only
 * applied when the PARENT key is present (even as `{}`); `LoreConfigSchema`
 * declares `ai`/`workflow`/etc. as `.optional()` with NO section-level
 * default. The REAL per-key resolution happens downstream, at each call
 * site's own seam (`resolveCaptureTimeoutMs`, `createApp`'s
 * `config?.ai ?? AiConfigSchema.parse({})`) — never inside `loadConfig`
 * itself. {@link computeCodeDefaults} reproduces that materialisation
 * generically (by seeding every Zod-defaultable section with `{}` before
 * parsing) so this checker's OWN "what does a fresh install carry" question
 * has an answer for an ARBITRARY key path, not just the two named ones. This
 * is a DIFFERENT question from AC-GD-1's fresh-install CLAUSE (paired
 * `.test.ts`), which asserts the real per-key resolvers directly — this
 * module has no opinion on which function server code actually calls for any
 * one key, only on what a fresh install's Zod-defaulted VALUE would be.
 *
 * ## Arming — wired via `bun run test`, deliberately NOT `hooks/pre-push`
 *
 * This checker's originating task named `hooks/pre-push` as the wiring
 * surface ("the same surface … already drives its sibling checks"). That
 * surface is WRONG for this checker and was not used: `hooks/pre-push` is
 * byte-identical-pinned with `assets/project/pre-push`
 * (`packages/lore/tests/unit/assets/pre-push-parity.test.ts`) because the
 * asset copy is VENDORED into third-party consumer repos by `lore setup
 * --project` — every step inside it is a call to the INSTALLED `lore`
 * binary's own generic subcommands (`lore status`, `lore audit`), which
 * behave identically in any corpus. This script is the opposite: a
 * repo-tree source script that reads `packages/core/src/config.ts` (by
 * proxy, via {@link computeCodeDefaults}) and
 * `assets/project/lore-config-template.yaml` — paths that exist ONLY in
 * lore's own checkout. Adding it to the shared hook pair would silently
 * break `git push` in every consumer repo that installs that hook (the
 * referenced files do not exist there). Instead this module is armed the
 * same way every sibling structural checker in `scripts/` already is
 * (`check-ordinal-write-sites.mjs`, `check-test-budgets.ts`,
 * `check-no-nul-bytes.ts`): the paired `.test.ts`'s REGRESSION suite calls
 * `main()` with no injected `repoRoot` and asserts exit 0 against the real
 * checkout, and that file is picked up automatically by `bun run test`'s
 * `test:vitest` step (the `scripts/tests` test-file include glob declared in
 * `vitest.config.ts`) — the full-suite run the orchestrator performs after
 * every merge to `main`.
 * `bun run check:shipped-defaults` (package.json) is the direct, ad-hoc
 * invocation for a developer or CI step that wants just this one check.
 *
 * Public surface:
 *   - `PROJECT_SPECIFIC_KEYS` — the allowlist (exported so the paired test
 *     can assert against real entries without duplicating them).
 *   - `computeCodeDefaults` / `deepMergeShippedSurface` / `flattenLeaves` /
 *     `getAtPath` / `deepEqualJsonValue` / `isAllowlistedKey` — pure.
 *   - `meetsRationaleMinimalShape` / `findAllowlistRationaleViolations` — pure.
 *   - `findShippedDefaultDrift` — pure.
 *   - `main(repoRoot?)` — IO shell: reads `.lore/config.yaml` (REQUIRED —
 *     its absence throws, #223) and the shipped template, prints a report, RETURNS the exit code
 *     (never calls `process.exit` itself — mirrors
 *     `scripts/check-ordinal-write-sites.mjs`'s armable shape so a test can
 *     import and call it directly).
 *
 * Side-effect class: every export except `main` is pure (no IO). `main`
 * reads two files from disk and writes to stdout/stderr.
 *
 * Exit codes:
 *   0 — no drift violation and every allowlist entry's rationale is valid.
 *   3 — >=1 drift violation and/or >=1 invalid allowlist rationale — each
 *       printed by name.
 *   4 — the scan itself could not run (missing or malformed `.lore/config.yaml`,
 *       missing/malformed template, unreadable file) — `main` THROWS
 *       {@link ShippedDefaultsCheckError} in this case; the `import.meta.main`
 *       block below is what maps it to 4. NEVER reported as a clean tree.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import { z } from "zod";
import { LoreConfigSchema, loadConfigFromString } from "@lore/core";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");

const CONFIG_RELATIVE_PATH = ".lore/config.yaml";
const TEMPLATE_RELATIVE_PATH = "assets/project/lore-config-template.yaml";

/** Thrown when this oracle cannot measure the tree at all — never reported as clean. */
export class ShippedDefaultsCheckError extends Error {
  readonly context: Record<string, unknown> | undefined;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = "ShippedDefaultsCheckError";
    this.context = context;
  }
}

/** One `PROJECT_SPECIFIC_KEYS` entry: a dotted config path plus why it can never ship. */
export interface ProjectSpecificKeyEntry {
  /** Dotted config path (e.g. `"project.name"`). Matches itself OR any deeper path under it. */
  readonly key: string;
  /** Why this key is inherently per-project — validated by {@link meetsRationaleMinimalShape}. */
  readonly rationale: string;
}

/** Minimal accepted rationale length AFTER trimming (spec D1: "a floor on EFFORT, not meaning"). */
export const RATIONALE_MIN_LENGTH = 20;

/** Whole-value placeholder tokens a rationale must not equal, case-insensitive (spec D1). */
export const RATIONALE_PLACEHOLDER_TOKENS: readonly string[] = ["TODO", "TBD", "FIXME", "N/A", "-", "?"];

/**
 * The SOLE definition of "inherently per-project" this checker's drift
 * predicate consults — never a discretionary test layered beside it. Every
 * entry's `rationale` is validated by {@link meetsRationaleMinimalShape}.
 *
 * Back-catalogue sweep (2026-08-11, same task/spec as the two code-default
 * raises in this file's module header) — each entry beyond the four named in
 * the governing spec was found by running this checker's own predicate
 * against this repo's real `.lore/config.yaml`:
 *   - `context.memory_files.root.*` — this repo deliberately tightens its
 *     own CLAUDE.md ceiling BELOW the shipped anti-explosion default; the
 *     shipped default is an adoption-safe ceiling for every OTHER consumer,
 *     not a size recommendation, so neither raising the code default nor
 *     shipping this tightened number to the template is correct — see that
 *     entry's own field-level JSDoc in `contextConfigSchema`.
 *   - `workflow.gates` — per-checkpoint gate arming (e.g. `plan-close`'s
 *     `prd_sync` sub-predicate, `resolvePrdSyncGateEnabled`) is a deliberate,
 *     default-OFF corpus-maturity decision (SPEC-080 Migration Plan Phase 0)
 *     — this repo armed it only after 5 observed clean plan-closes. Shipping
 *     any one project's arming choice to every fresh corpus would force
 *     unearned strictness on projects that have not reached that maturity.
 *   - `ai.assess.max_diff_chars` / `workflow.evidence.capture_timeout_ms` —
 *     the two NAMED cases; FIXED by raising the code default (this file /
 *     `ai.ts`), so they are duplicates now, not overrides — listed in the
 *     spec's own text, not repeated here as allowlist entries.
 *   - `verify.default_timeout_ms` — a THIRD, previously-unnamed instance of
 *     the same "shipped default too small" pattern (see this file's
 *     `VerifyConfigSchema.default_timeout_ms` JSDoc for the measurement);
 *     also FIXED by raising the code default, not allowlisted.
 *   - `ai.providers.claude-cli.*` — this repo's static invocation args
 *     (`args: ["-p"]`) drop a flag (`--setting-sources project`) that
 *     `buildHermeticSpawnSpec` (`packages/lore/src/ai/hermetic-spawn.ts`)
 *     unconditionally appends its OWN, always-superseding
 *     `--setting-sources ""` after — so the static flag was already
 *     functionally inert; SHIPPED TO THE TEMPLATE instead of allowlisted
 *     (`assets/project/lore-config-template.yaml`), so every fresh corpus
 *     gets the same simplified, equally-inert-downstream args.
 */
export const PROJECT_SPECIFIC_KEYS: readonly ProjectSpecificKeyEntry[] = [
  {
    key: "project.name",
    rationale:
      "Identifies THIS project by name; a shipped default would be meaningless (or actively wrong) for every other corpus.",
  },
  {
    key: "project.author",
    rationale: "Identifies the default author identity for THIS project; inherently per-installation, never shared.",
  },
  {
    key: "context.memory_files.adoption",
    rationale: "Judged per project by lore setup from that project's own CLAUDE.md (enforce iff it already passes); an absent key is the designed warn default, never a shipped value.",
  },
  {
    key: "audit.verify_since",
    rationale:
      "Names the audit hash-chain watermark for THIS corpus's own history; a shared default would misdate every other corpus's chain.",
  },
  {
    key: "feedback.upstream",
    rationale:
      "Carries CONSENT to send this corpus's own defect reports (title, description, repro command, actor) to a third-party GitHub intake — inherently per-project, and no default can honestly stand in for an agreement nobody made. ADDRESSING is no longer part of this key's job: the vendor intake's address ships inside the binary as @lore/core's VENDOR_INTAKE_REPO, spent by feedback.upstream.vendor: true, so the half that WAS a constant left config entirely (2026-08-25) and only the half that genuinely needs a per-project decision remains.",
  },
  {
    key: "context.memory_files.root.max_lines",
    rationale:
      "Deliberately tightened below the shipped anti-explosion ceiling for this repo's own memory-file discipline; the shipped ceiling is adoption-safe, not a size recommendation, for every other consumer's unrelated files.",
  },
  {
    key: "context.memory_files.root.max_bytes",
    rationale:
      "Same tightened-below-shipped-ceiling reasoning as max_lines above; the two travel together as one role's ceiling pair (spec-project-claude-md-content-contract D2) and must not be split across dispositions.",
  },
  {
    key: "workflow.turn_end.main_session_source_edits",
    rationale:
      "Designed per-project opt-in (spec-interception-moves-off-every-tool-call-one-turn-end-review): shipped default is off; a project whose discipline has the main agent dispatch all code sets block, as this repo does. Shipping block would break every consumer whose main agent edits source directly.",
  },
  {
    key: "workflow.gates",
    rationale:
      "Per-checkpoint gate arming is a deliberate, corpus-maturity opt-in (e.g. plan-close's prd_sync sub-predicate is default-OFF); shipping one project's arming choice would force unearned strictness on every fresh corpus.",
  },
];

/**
 * Top-level `LoreConfigSchema` sections that materialise safely from an
 * empty `{}` — i.e. `<Section>Schema.parse({})` never throws. Deliberately
 * EXCLUDES two top-level keys:
 *   - `sync` — `SyncConfigSchema` requires `enabled` with NO default, so
 *     `{}` throws a ZodError; sync is opt-in per-installation by
 *     construction, so it never has a meaningful "shipped default" anyway.
 *   - `project` — REQUIRED (`name`/`author`, no defaults) and every one of
 *     its own leaves is already covered by a `project.*` entry in {@link
 *     PROJECT_SPECIFIC_KEYS}, so it never needs a shipped-surface value.
 *
 * Measured empirically 2026-08-11 (see this task's closing report) against
 * every OTHER top-level optional section in `LoreConfigSchema` — each parses
 * `{}` cleanly via its own nested `.default(...)` chain.
 */
export const ZOD_DEFAULTABLE_SECTIONS: readonly string[] = [
  "telemetry",
  "defaults",
  "ai",
  "workflow",
  "audit",
  "feedback",
  "verify",
  "setup",
  "context",
  "trace",
];

/** A plain (non-array, non-null) object — the only container type {@link flattenLeaves} recurses into. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Materialises the fully Zod-defaulted config a bare `LoreConfigSchema.parse`
 * would produce if EVERY optional section were present (even empty) —
 * i.e. what a fresh install's code defaults carry when nothing overrides
 * them. This is a COMPARISON BASIS for {@link findShippedDefaultDrift}'s own
 * predicate; it is NOT the fresh-install resolution path server code
 * actually calls (see this module's header "why not `loadConfig`" note) —
 * that separate assertion lives in the paired `.test.ts` and calls the real
 * per-key resolvers directly.
 *
 * Pure — no IO. Throws only if `LoreConfigSchema` itself changes shape in a
 * way that makes an empty-object section throw (see {@link
 * ZOD_DEFAULTABLE_SECTIONS}'s own JSDoc) — a structural break this function
 * is deliberately NOT defensive against, so it fails loud immediately
 * rather than silently omitting a section from the comparison basis.
 *
 * @returns a plain object shaped like `LoreConfig`, every Zod-defaultable
 *   section fully populated with its own schema defaults
 * @example
 *   computeCodeDefaults().workflow.evidence.capture_timeout_ms // => 1200000 (post-D2)
 */
export function computeCodeDefaults(): Record<string, unknown> {
  const seedInput: Record<string, unknown> = {
    project: { name: "shipped-default-probe", author: "shipped-default-probe" },
  };
  for (const section of ZOD_DEFAULTABLE_SECTIONS) {
    seedInput[section] = {};
  }
  // reason: LoreConfigSchema.parse's inferred return type is the precise `LoreConfig`
  // shape; this module's generic tree-walkers (flattenLeaves/getAtPath/deepMergeShippedSurface)
  // deliberately operate on `Record<string, unknown>` so ONE set of pure functions
  // handles both a real LoreConfig and a raw, un-typed template fragment. The cast is
  // a widening (LoreConfig IS structurally a plain object), never a type-safety escape.
  return LoreConfigSchema.parse(seedInput) as unknown as Record<string, unknown>;
}

/**
 * Deep-merges `override` onto `base`: a plain-object value present in BOTH
 * merges recursively; any other value in `override` (primitive, array, or a
 * plain object whose `base` counterpart is NOT a plain object) REPLACES
 * `base`'s value wholesale — an array is never element-wise merged. `base`
 * keys absent from `override` are kept as-is. Neither input is mutated.
 *
 * Pure.
 *
 * @example
 *   deepMergeShippedSurface({ ai: { providers: {} } }, { ai: { providers: { "claude-cli": { args: ["-p"] } } } })
 *   // => { ai: { providers: { "claude-cli": { args: ["-p"] } } } }
 */
export function deepMergeShippedSurface(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = result[key];
    result[key] =
      isPlainObject(baseValue) && isPlainObject(overrideValue)
        ? deepMergeShippedSurface(baseValue, overrideValue)
        : overrideValue;
  }
  return result;
}

/** One leaf of a flattened config tree: a dotted path plus its (non-plain-object) value. */
export interface ConfigLeaf {
  readonly path: string;
  readonly value: unknown;
}

/**
 * Recursively flattens a plain-object config tree into dotted-path leaves.
 * Arrays are treated as LEAF values (never recursed into) — an array is
 * compared as a whole value by {@link deepEqualJsonValue}, never
 * element-by-element. An empty plain object at any depth contributes ZERO
 * leaves (nothing to compare, nothing overridden).
 *
 * Pure.
 *
 * @example
 *   flattenLeaves({ ai: { assess: { max_diff_chars: 80000 } } })
 *   // => [{ path: "ai.assess.max_diff_chars", value: 80000 }]
 */
export function flattenLeaves(obj: Record<string, unknown>, prefix = ""): ConfigLeaf[] {
  const leaves: ConfigLeaf[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (isPlainObject(value)) {
      leaves.push(...flattenLeaves(value, path));
    } else {
      leaves.push({ path, value });
    }
  }
  return leaves;
}

/**
 * Walks `path` (dot-separated) through `obj`, returning `undefined` the
 * moment any segment is missing or the current value is not a plain object
 * to descend into — never throws on a missing path.
 *
 * Pure.
 *
 * @example
 *   getAtPath({ ai: { assess: { max_diff_chars: 80000 } } }, "ai.assess.max_diff_chars") // => 80000
 *   getAtPath({ ai: {} }, "ai.providers.claude-cli") // => undefined
 */
export function getAtPath(obj: Record<string, unknown>, path: string): unknown {
  let current: unknown = obj;
  for (const segment of path.split(".")) {
    if (!isPlainObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * Structural equality over JSON-like values (objects/arrays/primitives) —
 * order-sensitive for arrays, order-INsensitive for object keys. Pure.
 *
 * @example
 *   deepEqualJsonValue(["-p"], ["-p"]) // => true
 *   deepEqualJsonValue(["-p"], ["-p", "--setting-sources", "project"]) // => false
 */
export function deepEqualJsonValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqualJsonValue(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => bKeys.includes(key) && deepEqualJsonValue(a[key], b[key]));
  }
  return false;
}

/**
 * True iff `path` equals an allowlist entry's `key`, or is nested under it
 * (`entry.key + "."` prefix) — a prefix match lets one entry (e.g.
 * `"workflow.gates"`) cover an entire per-checkpoint sub-tree without one
 * row per checkpoint. Pure.
 *
 * @example
 *   isAllowlistedKey("project.name", PROJECT_SPECIFIC_KEYS) // => true
 *   isAllowlistedKey("workflow.gates.\"plan-close\".prd_sync.enabled", PROJECT_SPECIFIC_KEYS) // => true
 *   isAllowlistedKey("workflow.evidence.capture_timeout_ms", PROJECT_SPECIFIC_KEYS) // => false
 */
export function isAllowlistedKey(path: string, allowlist: readonly ProjectSpecificKeyEntry[]): boolean {
  return allowlist.some((entry) => path === entry.key || path.startsWith(`${entry.key}.`));
}

/**
 * The MINIMAL ACCEPTED SHAPE for a `PROJECT_SPECIFIC_KEYS` rationale (spec
 * D1): non-empty after trimming, at least {@link RATIONALE_MIN_LENGTH}
 * characters, and NOT a whole-value match (case-insensitive) against {@link
 * RATIONALE_PLACEHOLDER_TOKENS}. A floor on EFFORT, never on MEANING — no
 * predicate can check whether a rationale is actually TRUE, only whether
 * someone spent >= a sentence fragment writing it.
 *
 * Pure.
 *
 * @example
 *   meetsRationaleMinimalShape("   ") // => false (whitespace-only)
 *   meetsRationaleMinimalShape("TODO") // => false (whole-value placeholder)
 *   meetsRationaleMinimalShape("short but under twenty") // => true (24 chars)
 *   meetsRationaleMinimalShape("18-char rationale.") // => false (18 chars, < 20)
 */
export function meetsRationaleMinimalShape(rationale: string): boolean {
  const trimmed = rationale.trim();
  if (trimmed.length < RATIONALE_MIN_LENGTH) return false;
  return !RATIONALE_PLACEHOLDER_TOKENS.some((token) => token.toLowerCase() === trimmed.toLowerCase());
}

/** One `PROJECT_SPECIFIC_KEYS` entry whose rationale fails {@link meetsRationaleMinimalShape}. */
export interface AllowlistRationaleViolation {
  readonly key: string;
  readonly rationale: string;
}

/**
 * Every allowlist entry whose rationale fails the minimal accepted shape —
 * evaluated unconditionally over the allowlist's OWN declared shape, never
 * gated on whether the repo's config currently exercises that key. This is
 * what stops the allowlist from becoming "the place overrides go to hide":
 * an entry with an empty/placeholder rationale fails the checker even if it
 * never matches a real override.
 *
 * Pure.
 */
export function findAllowlistRationaleViolations(
  allowlist: readonly ProjectSpecificKeyEntry[],
): AllowlistRationaleViolation[] {
  return allowlist.filter((entry) => !meetsRationaleMinimalShape(entry.rationale));
}

/** One config path this repo overrides to a value the shipped surface does not carry. */
export interface ShippedDefaultDriftViolation {
  readonly path: string;
  readonly repoValue: unknown;
  readonly shippedValue: unknown;
}

/**
 * Flattens `repoConfig` and, for every non-allowlisted leaf, compares its
 * value against the SAME dotted path in `shippedSurface`. A violation is
 * ABSENCE of that exact value from the shipped surface — whether because the
 * path does not exist there at all (`shippedValue === undefined`) or because
 * it carries a DIFFERENT value. A leaf whose value is byte-identical to the
 * shipped surface's is a harmless duplicate, never reported.
 *
 * Pure.
 */
export function findShippedDefaultDrift(
  repoConfig: Record<string, unknown>,
  shippedSurface: Record<string, unknown>,
  allowlist: readonly ProjectSpecificKeyEntry[],
): ShippedDefaultDriftViolation[] {
  const violations: ShippedDefaultDriftViolation[] = [];
  for (const leaf of flattenLeaves(repoConfig)) {
    if (isAllowlistedKey(leaf.path, allowlist)) continue;
    const shippedValue = getAtPath(shippedSurface, leaf.path);
    if (!deepEqualJsonValue(leaf.value, shippedValue)) {
      violations.push({ path: leaf.path, repoValue: leaf.value, shippedValue });
    }
  }
  return violations;
}

/** Loose plain-object shape a YAML template's top level MUST have — never a scalar/array/null document. */
const TemplateRawSchema = z.record(z.string(), z.unknown());

/**
 * CLI entrypoint — reads `<repoRoot>/.lore/config.yaml` (REQUIRED — its
 * absence IS a scan failure, since this repo tracks the dogfood config (#223)
 * and a missing file must never read as "zero overrides") and
 * `<repoRoot>/assets/project/lore-config-template.yaml` (REQUIRED — its
 * absence IS a scan failure, since the shipped surface is undefined without
 * it), computes the shipped surface, and reports how many configured
 * override leaves it scanned.
 *
 * Never calls `process.exit` — returns the exit code so a test can call this
 * directly (mirrors `scripts/check-ordinal-write-sites.mjs`'s armable
 * shape).
 *
 * @param repoRoot - defaults to this script's own repo root; overridable so
 *   tests can point it at a throwaway fixture tree
 * @param allowlist - defaults to the real {@link PROJECT_SPECIFIC_KEYS} —
 *   overridable ONLY so the paired `.test.ts` can prove the IO shell itself
 *   surfaces an invalid-rationale allowlist entry as exit 3 end-to-end
 *   (AC-GD-1c), without being able to corrupt the real, exported constant
 *   every other caller (including the direct-run CLI entry below) relies on
 * @returns 0 (clean) or 3 (drift and/or invalid-rationale violations found)
 * @throws ShippedDefaultsCheckError when the scan itself cannot run (missing
 *   config, missing template, malformed YAML, malformed config) — never reported as clean
 */
export function main(
  repoRoot: string = REPO_ROOT,
  allowlist: readonly ProjectSpecificKeyEntry[] = PROJECT_SPECIFIC_KEYS,
): number {
  const configPath = join(repoRoot, CONFIG_RELATIVE_PATH);
  const templatePath = join(repoRoot, TEMPLATE_RELATIVE_PATH);

  if (!existsSync(configPath)) {
    throw new ShippedDefaultsCheckError(
      `${CONFIG_RELATIVE_PATH} not found at ${configPath}: the dogfood config is tracked (#223); a missing file is not 'zero overrides'`,
    );
  }
  let repoConfig: Record<string, unknown>;
  let scannedOverrideCount: number;
  {
    let raw: string;
    try {
      raw = readFileSync(configPath, "utf8");
    } catch (error) {
      throw new ShippedDefaultsCheckError(
        `could not read ${CONFIG_RELATIVE_PATH}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const parsed = loadConfigFromString(raw);
    if (!parsed.ok) {
      throw new ShippedDefaultsCheckError(`${CONFIG_RELATIVE_PATH} failed to parse: ${JSON.stringify(parsed.error)}`, {
        error: parsed.error,
      });
    }
    // reason: same widening as computeCodeDefaults above — flattenLeaves needs a
    // generic Record, not the precise LoreConfig type.
    repoConfig = parsed.value as unknown as Record<string, unknown>;
    // reason: count the leaves the file ITSELF writes (raw YAML), not `parsed.value`,
    // which has Zod defaults filled in — otherwise an empty config would still report >0.
    scannedOverrideCount = flattenLeaves(yaml.parse(raw) as Record<string, unknown>).length;
  }

  let templateText: string;
  try {
    templateText = readFileSync(templatePath, "utf8");
  } catch (error) {
    throw new ShippedDefaultsCheckError(
      `could not read ${TEMPLATE_RELATIVE_PATH}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let templateParsed: unknown;
  try {
    templateParsed = yaml.parse(templateText);
  } catch (error) {
    throw new ShippedDefaultsCheckError(
      `${TEMPLATE_RELATIVE_PATH} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const templateRawResult = TemplateRawSchema.safeParse(templateParsed ?? {});
  if (!templateRawResult.success) {
    throw new ShippedDefaultsCheckError(
      `${TEMPLATE_RELATIVE_PATH} did not parse to a plain key/value map: ${templateRawResult.error.message}`,
    );
  }

  const codeDefaults = computeCodeDefaults();
  const shippedSurface = deepMergeShippedSurface(codeDefaults, templateRawResult.data);

  const rationaleViolations = findAllowlistRationaleViolations(allowlist);
  const driftViolations = findShippedDefaultDrift(repoConfig, shippedSurface, allowlist);

  if (rationaleViolations.length > 0 || driftViolations.length > 0) {
    console.error(
      `check-shipped-defaults: found ${driftViolations.length} shipped-default drift violation(s) and ` +
        `${rationaleViolations.length} invalid allowlist rationale(s):\n`,
    );
    for (const violation of driftViolations) {
      console.error(
        `  DRIFT ${violation.path}: this repo's ${CONFIG_RELATIVE_PATH} overrides it to ` +
          `${JSON.stringify(violation.repoValue)}, but the shipped surface (code defaults + template) carries ` +
          `${JSON.stringify(violation.shippedValue)}`,
      );
    }
    for (const violation of rationaleViolations) {
      console.error(
        `  ALLOWLIST ${violation.key}: rationale ${JSON.stringify(violation.rationale)} does not meet the ` +
          `minimal accepted shape (non-empty, >= ${RATIONALE_MIN_LENGTH} chars trimmed, not a whole-value ` +
          `placeholder) — this is a floor on EFFORT, not meaning; a passing entry is NOT a reviewed one.`,
      );
    }
    console.error(
      "\nFix: raise the CODE default (packages/core/src/config.ts or ai.ts), ship the value to " +
        "assets/project/lore-config-template.yaml, or add the key to PROJECT_SPECIFIC_KEYS in " +
        "scripts/check-shipped-defaults.ts with a valid rationale.",
    );
    return 3;
  }

  console.log(
    `check-shipped-defaults: OK — scanned ${scannedOverrideCount} configured override(s) in ${CONFIG_RELATIVE_PATH}: ` +
      `0 shipped-default drift violation(s), and all ${allowlist.length} PROJECT_SPECIFIC_KEYS entries carry a valid rationale.`,
  );
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(
      `check-shipped-defaults: scan failed — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(4);
  }
}
