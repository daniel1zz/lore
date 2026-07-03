/**
 * LoreConfig — Zod schema, types, and pure parse helpers. Browser-safe.
 *
 * Public surface:
 *   - LoreConfigSchema / LoreConfig — project-level config (.lore/config.yaml)
 *   - GlobalLoreConfigSchema / GlobalLoreConfig — user-level global config (XDG path)
 *   - LoreDefaultsSchema / LoreDefaults — shared defaults section (editor, format, color)
 *   - parseConfig / loadConfigFromString — pure YAML/object → LoreConfig validation
 *   - isAiConfigValidationError — type guard distinguishing `ai`-block violations from
 *     other config-block violations (SPEC-030 AC-HJ-3 fail-loud path)
 *   - mergeDefaults — project defaults win over global defaults
 *   - resolveSyncCredentials — D-004 credential resolution (env-var NAME only; reads
 *     process.env, not the filesystem — safe to keep here)
 *
 * Invariants:
 *   - D-004: auth_token_env is ALWAYS an env-var NAME — never the plaintext token
 *   - D-007: sync.enabled=true + remote_url MUST be present (TursoStore selection)
 *   - SPEC-030 AC-HJ-3: an invalid `ai` block MUST be reported as a VALIDATION_ERROR whose
 *     `field` names the offending key path (e.g. "ai.cli") — callers (loadLoreApp) use
 *     isAiConfigValidationError() to decide fail-loud vs the (unchanged, non-goal) silent
 *     fallback that still applies to other config blocks. A config with no `ai` key at all
 *     remains valid (schema default applies) — this only fires when `ai:` IS present but
 *     malformed.
 *   - This file MUST NOT import Node builtins (fs/path/os/child_process/...), even
 *     transitively — it is re-exported from the browser-safe `@lore/core` barrel
 *     (`index.ts`) and consumed by `@lore/dashboard`. File-IO helpers (`loadConfig`,
 *     `saveConfig`, `resolveGlobalConfigPath`, `loadGlobalConfig`) live in the
 *     Node-only sibling `config-node.ts`, exported only via the `@lore/core/node`
 *     subpath. Regression oracle: `packages/dashboard/tests/e2e/write-flow.pw.ts`
 *     (SPEC-022) — a `fs` import reachable from this file crashes the dashboard SPA
 *     at load time.
 *
 * Side-effect class: pure (file IO lives in config-node.ts)
 *
 * Source: SPEC-009 §6, SPEC-003 §6.2
 */

import { z } from "zod";
import yaml from "yaml";
import { ok, err } from "./errors.js";
import type { Result, LoreError } from "./errors.js";
import { TelemetryConfigSchema } from "./telemetry.js";
import { AiConfigSchema } from "./ai.js";

// ─── Shared Defaults Schema ───────────────────────────────────────────────────

/**
 * CLI output defaults shared by both global and project config.
 * Controls editor, output format, and ANSI color.
 *
 * @invariant All keys are optional — absence means "use built-in default".
 */
export const LoreDefaultsSchema = z
  .object({
    /**
     * Preferred editor command. Overrides $EDITOR env var.
     * Fallback chain: defaults.editor → $EDITOR → vi (Unix) / notepad (Windows).
     */
    editor: z.string().optional(),
    /** Output format. Built-in default: "text". */
    format: z.enum(["text", "json"]).optional(),
    /** Enable ANSI colour output. Built-in default: true. */
    color: z.boolean().optional(),
  })
  .strict();

/** CLI output defaults (editor, format, color). All fields optional. */
export type LoreDefaults = z.infer<typeof LoreDefaultsSchema>;

// ─── Global Config Schema (XDG / $LORE_CONFIG_HOME) ──────────────────────────

/**
 * Global user-level Lore config (SPEC-003 §6.2).
 * Loaded from the first existing path in XDG resolution order:
 *   1. $LORE_CONFIG_HOME/config.yaml
 *   2. $XDG_CONFIG_HOME/lore/config.yaml
 *   3. ~/.config/lore/config.yaml
 *
 * @invariant MUST NOT contain project / sync / telemetry sections (strict schema).
 * @invariant Missing file is NOT an error — returns ok({}).
 */
export const GlobalLoreConfigSchema = z
  .object({
    defaults: LoreDefaultsSchema.optional(),
  })
  .strict();

/** Validated global Lore config. All fields optional. */
export type GlobalLoreConfig = z.infer<typeof GlobalLoreConfigSchema>;

// ─── Sync Section Schema ───────────────────────────────────────────────────

/**
 * Sync configuration section (optional).
 * D-007: when enabled=true, remote_url MUST be present (TursoStore selection).
 * D-004: auth_token_env is an env-var NAME — never the plaintext token.
 */
const SyncConfigSchema = z
  .object({
    enabled: z.boolean(),
    remote_url: z.string().startsWith("libsql://").optional(),
    auth_token_env: z.string().default("LORE_SYNC_TOKEN"),
    interval: z.number().int().positive().default(60),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.enabled && data.remote_url === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "remote_url is required when sync.enabled is true (D-007)",
        path: ["remote_url"],
      });
    }
  });

// ─── Workflow Section Schema ───────────────────────────────────────────────

/**
 * Task execution workflow configuration (SPEC-025).
 * Controls the advisory claim-lease TTL consumed by TaskWorkflowService.
 *
 * @invariant claim_ttl_minutes defaults to 120 — an order of magnitude above
 *   realistic clock skew between machines (SPEC-025 §5 risk table).
 */
const WorkflowConfigSchema = z
  .object({
    /** Minutes after which an unrefreshed claim becomes stale and reclaimable. */
    claim_ttl_minutes: z.number().int().positive().default(120),
  })
  .strict();

/** Task execution workflow config section. Source: SPEC-025 §3 D2. */
export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;

// ─── Root Config Schema ────────────────────────────────────────────────────

/**
 * Full LoreConfig schema.
 * strict() rejects unknown top-level keys.
 * sync section is optional — absence means local-only mode.
 */
export const LoreConfigSchema = z
  .object({
    project: z
      .object({
        name: z.string(),
        author: z.string(),
      })
      .strict(),
    sync: SyncConfigSchema.optional(),
    /**
     * Telemetry configuration (SPEC-012).
     * When absent, defaults to enabled=false (no file side effects).
     * Set enabled: true to start writing .lore/telemetry.jsonl.
     */
    telemetry: TelemetryConfigSchema.optional(),
    /**
     * Per-project CLI defaults (editor, format, color).
     * When set, overrides global defaults from ~/.config/lore/config.yaml.
     * Project defaults are CLI-scoped — NOT forwarded to createApp.
     */
    defaults: LoreDefaultsSchema.optional(),
    /**
     * AI provider configuration (SPEC-017).
     * When absent, createApp uses AiConfigSchema.parse({}) defaults (claude-cli provider).
     * NOT stripped by loadLoreApp — forwarded to createApp alongside telemetry config.
     * .strict() on AiConfigSchema rejects typos at load time (AC-AI-12).
     */
    ai: AiConfigSchema.optional(),
    /**
     * Task execution workflow configuration (SPEC-025).
     * When absent, createApp uses WorkflowConfigSchema.parse({}) defaults (120min TTL).
     */
    workflow: WorkflowConfigSchema.optional(),
  })
  .strict();

export type LoreConfig = z.infer<typeof LoreConfigSchema>;

/**
 * Resolve the effective claim TTL in minutes from an optional LoreConfig.
 * Mirrors the `aiConfig = config?.ai ?? AiConfigSchema.parse({})` pattern used
 * elsewhere in createApp — absence of the whole config or the workflow section
 * both fall back to the schema default (120).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns Effective claim_ttl_minutes value
 * @example
 *   resolveClaimTtlMinutes(undefined) // => 120
 *   resolveClaimTtlMinutes({ ..., workflow: { claim_ttl_minutes: 30 } }) // => 30
 */
export function resolveClaimTtlMinutes(config: LoreConfig | undefined): number {
  return (config?.workflow ?? WorkflowConfigSchema.parse({})).claim_ttl_minutes;
}

// ─── Pure Parse Helpers ────────────────────────────────────────────────────

/**
 * Format a single Zod issue found while parsing LoreConfigSchema into a
 * human-readable `{field, message}` pair.
 *
 * Special-cases `unrecognized_keys` issues raised by a `.strict()` object: Zod
 * reports these with `path` pointing at the *container* object (e.g. `["ai"]`)
 * and the offending key names in `issue.keys`, not in `path` — so the raw path
 * alone would read as the unhelpfully generic "ai" rather than naming the typo
 * (e.g. "ai.cli"). This reconstructs the full dotted key path per offending key.
 *
 * When the container is exactly the top-level `ai` block, appends a targeted
 * hint pointing at `ai.providers.<name>` (SPEC-030 AC-HJ-3) — the most common
 * real-world typo is misplacing a provider override directly under `ai` instead
 * of nesting it under `ai.providers.<name>`.
 *
 * @param issue - a single Zod issue from `ZodError.issues`
 * @returns `{field, message}` — field is a dotted path (e.g. "ai.cli" or "root")
 * @example
 *   // issue: {code: "unrecognized_keys", path: ["ai"], keys: ["cli"]}
 *   describeConfigIssue(issue)
 *   // → {field: "ai.cli", message: "ai.cli: unrecognized key — did you mean ai.providers.<name>?"}
 */
function describeConfigIssue(issue: z.ZodIssue): { field: string; message: string } {
  const containerField = issue.path.join(".") || "root";
  if (issue.code === z.ZodIssueCode.unrecognized_keys) {
    const offendingPaths = issue.keys.map((key) => `${containerField}.${key}`);
    const plural = issue.keys.length > 1 ? "s" : "";
    const hint = containerField === "ai" ? " — did you mean ai.providers.<name>?" : "";
    return {
      field: offendingPaths[0] ?? containerField,
      message: `${offendingPaths.join(", ")}: unrecognized key${plural}${hint}`,
    };
  }
  return { field: containerField, message: `${containerField}: ${issue.message}` };
}

/**
 * Type guard: does this LoreError originate from a schema violation inside the
 * `ai` config block (as opposed to `project`/`sync`/`telemetry`/`workflow`/etc.)?
 *
 * Used by CLI/adapter callers (e.g. `loadLoreApp`) to decide whether a config
 * parse failure must fail loud (SPEC-030 AC-HJ-3) or may keep the historical
 * silent fallback-to-defaults behaviour that still applies to non-`ai` blocks
 * (SPEC-030 non-goals — a broader fail-loud sweep across all config blocks is
 * explicitly out of scope for this change).
 *
 * @param error - a LoreError, typically from `parseConfig`/`loadConfigFromString`/`loadConfig`
 * @returns true iff `error.code === "VALIDATION_ERROR"` and `error.field` is `"ai"`
 *   or starts with `"ai."`
 * @example
 *   isAiConfigValidationError({code: "VALIDATION_ERROR", field: "ai.cli", message: "..."}) // true
 *   isAiConfigValidationError({code: "VALIDATION_ERROR", field: "sync.enabled", message: "..."}) // false
 *   isAiConfigValidationError({code: "STORE_ERROR", message: "..."}) // false
 */
export function isAiConfigValidationError(
  error: LoreError,
): error is Extract<LoreError, { code: "VALIDATION_ERROR" }> {
  return (
    error.code === "VALIDATION_ERROR" &&
    (error.field === "ai" || error.field.startsWith("ai."))
  );
}

/**
 * Parse a raw (unknown) value through LoreConfigSchema.
 * Returns Result<LoreConfig, LoreError>; never throws.
 *
 * @invariant When multiple issues are present, an issue whose path is rooted at
 *   `ai` is always chosen over issues in other sections — a lone typo in the
 *   `ai` block must never be masked by ordering (SPEC-030 AC-HJ-3). This does NOT
 *   change behaviour for configs with only one violation (the common case).
 */
export function parseConfig(raw: unknown): Result<LoreConfig, LoreError> {
  const result = LoreConfigSchema.safeParse(raw);
  if (result.success) {
    return ok(result.data);
  }
  const aiIssue = result.error.issues.find((issue) => issue.path[0] === "ai");
  const chosenIssue = aiIssue ?? result.error.issues[0];
  const { field, message } =
    chosenIssue !== undefined
      ? describeConfigIssue(chosenIssue)
      : { field: "root", message: result.error.message };
  return err({
    code: "VALIDATION_ERROR",
    field,
    message,
    value: raw,
  } satisfies LoreError);
}

/**
 * Parse a YAML string into LoreConfig.
 * Pure function — no filesystem access.
 * Malformed YAML or schema violations → {ok:false, error} with code VALIDATION_ERROR.
 * Never throws.
 */
export function loadConfigFromString(
  yamlText: string,
): Result<LoreConfig, LoreError> {
  let parsed: unknown;
  try {
    parsed = yaml.parse(yamlText);
  } catch (_e) {
    return err({
      code: "VALIDATION_ERROR",
      field: "yaml",
      message: "Failed to parse YAML: malformed input",
      value: yamlText,
    } satisfies LoreError);
  }

  if (parsed === null || parsed === undefined) {
    return err({
      code: "VALIDATION_ERROR",
      field: "root",
      message: "Config YAML parsed to empty value",
      value: yamlText,
    } satisfies LoreError);
  }

  return parseConfig(parsed);
}

// reason: File-IO helpers (loadConfig, saveConfig, resolveGlobalConfigPath,
// loadGlobalConfig) moved to config-node.ts — they import fs/path/os and must
// only be reachable via the `@lore/core/node` subpath. See that file's header
// for the full list and behaviour contracts (unchanged from before the split).

/**
 * Merge global defaults with project-level defaults.
 * Project defaults take precedence over global defaults on conflict (SPEC-003 §6.2).
 * Missing (undefined) on either side is treated as an empty object.
 *
 * @param globalDefaults — from the user's global config (~/.config/lore/config.yaml)
 * @param projectDefaults — from the project's .lore/config.yaml (wins on conflict)
 * @returns Merged LoreDefaults (shallow — all fields are scalars, no nesting needed)
 * @example
 *   mergeDefaults({ editor: "vim", color: true }, { editor: "nano" })
 *   // → { editor: "nano", color: true }
 */
export function mergeDefaults(
  globalDefaults: LoreDefaults | undefined,
  projectDefaults: LoreDefaults | undefined,
): LoreDefaults {
  // reason: shallow spread is safe here — LoreDefaultsSchema has no nested objects.
  // Project spread last so its keys always override global keys (SPEC-003 §6.2).
  return { ...globalDefaults, ...projectDefaults };
}

/**
 * Resolve sync credentials from process.env using the env-var name in config.sync.
 * D-004: token is read from process.env at runtime, never stored on disk.
 * Fails loud (VALIDATION_ERROR) when:
 *   - no sync section in config
 *   - sync.enabled !== true
 *   - remote_url is absent or empty
 *   - env var is absent or empty
 * Never returns ok with empty/missing credentials. Never throws.
 */
export function resolveSyncCredentials(
  config: LoreConfig,
): Result<{ url: string; token: string }, LoreError> {
  if (config.sync === undefined) {
    return err({
      code: "VALIDATION_ERROR",
      field: "sync",
      message: "No sync section in config — cannot resolve credentials",
      value: config,
    } satisfies LoreError);
  }

  if (config.sync.enabled !== true) {
    return err({
      code: "VALIDATION_ERROR",
      field: "sync.enabled",
      message: "Sync is not enabled (sync.enabled must be true to resolve credentials)",
      value: config.sync.enabled,
    } satisfies LoreError);
  }

  const remoteUrl = config.sync.remote_url;
  if (!remoteUrl) {
    return err({
      code: "VALIDATION_ERROR",
      field: "sync.remote_url",
      message: "sync.remote_url is missing or empty — cannot resolve credentials",
      value: remoteUrl,
    } satisfies LoreError);
  }

  const envVarName = config.sync.auth_token_env;
  const token = process.env[envVarName];

  if (!token) {
    return err({
      code: "VALIDATION_ERROR",
      field: "sync.auth_token_env",
      message: `Environment variable ${envVarName} is not set or is empty`,
      value: envVarName,
    } satisfies LoreError);
  }

  return ok({ url: remoteUrl, token });
}
