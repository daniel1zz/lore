/**
 * LoreConfig — Zod schema, types, pure parse helpers, and file I/O.
 *
 * Public surface:
 *   - LoreConfigSchema / LoreConfig — project-level config (.lore/config.yaml)
 *   - GlobalLoreConfigSchema / GlobalLoreConfig — user-level global config (XDG path)
 *   - LoreDefaultsSchema / LoreDefaults — shared defaults section (editor, format, color)
 *   - parseConfig / loadConfigFromString / loadConfig / saveConfig — project config I/O
 *   - resolveGlobalConfigPath / loadGlobalConfig — global config resolution + loading
 *   - mergeDefaults — project defaults win over global defaults
 *   - resolveSyncCredentials — D-004 credential resolution (env-var NAME only)
 *
 * Invariants:
 *   - D-004: auth_token_env is ALWAYS an env-var NAME — never the plaintext token
 *   - D-007: sync.enabled=true + remote_url MUST be present (TursoStore selection)
 *   - Global config missing/empty → ok({}) (NOT an error — user-optional)
 *   - Global config malformed → err(VALIDATION_ERROR) (caller decides whether to warn)
 *
 * Side-effect class: IO (loadConfig, saveConfig, loadGlobalConfig read/write disk)
 *
 * Source: SPEC-009 §6, SPEC-003 §6.2
 */

import { z } from "zod";
import yaml from "yaml";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { ok, err } from "./errors.js";
import type { Result, LoreError } from "./errors.js";
import { TelemetryConfigSchema } from "./telemetry.js";

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
  })
  .strict();

export type LoreConfig = z.infer<typeof LoreConfigSchema>;

// ─── Pure Parse Helpers ────────────────────────────────────────────────────

/**
 * Parse a raw (unknown) value through LoreConfigSchema.
 * Returns Result<LoreConfig, LoreError>; never throws.
 */
export function parseConfig(raw: unknown): Result<LoreConfig, LoreError> {
  const result = LoreConfigSchema.safeParse(raw);
  if (result.success) {
    return ok(result.data);
  }
  const firstIssue = result.error.issues[0];
  const field = firstIssue !== undefined ? firstIssue.path.join(".") || "root" : "root";
  const message =
    firstIssue !== undefined ? firstIssue.message : result.error.message;
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

// ─── File I/O ─────────────────────────────────────────────────────────────────

const CONFIG_FILE = ".lore/config.yaml";

/**
 * Load LoreConfig from <dir>/.lore/config.yaml.
 * Missing file or invalid content → {ok:false, error}. Never throws.
 */
export function loadConfig(dir: string): Result<LoreConfig, LoreError> {
  try {
    const configPath = join(dir, CONFIG_FILE);
    const raw = readFileSync(configPath, "utf8");
    return loadConfigFromString(raw);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to read config file";
    const cause = e instanceof Error ? e : undefined;
    return err({
      code: "STORE_ERROR",
      message,
      ...(cause !== undefined ? { cause } : {}),
    } satisfies LoreError);
  }
}

/**
 * Write LoreConfig to <dir>/.lore/config.yaml.
 * D-004: only the env-var NAME (auth_token_env) is written — never a resolved token value.
 * Creates <dir>/.lore/ if it does not exist. Never throws.
 */
export function saveConfig(
  dir: string,
  config: LoreConfig,
): Result<void, LoreError> {
  try {
    const loreDir = join(dir, ".lore");
    mkdirSync(loreDir, { recursive: true });
    const yamlText = yaml.stringify(config);
    writeFileSync(join(loreDir, "config.yaml"), yamlText, "utf8");
    return ok(undefined);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to write config file";
    const cause = e instanceof Error ? e : undefined;
    return err({
      code: "STORE_ERROR",
      message,
      ...(cause !== undefined ? { cause } : {}),
    } satisfies LoreError);
  }
}

// ─── Global Config I/O ────────────────────────────────────────────────────────

/**
 * Resolve the global Lore config file path using the XDG Base Directory spec
 * and the $LORE_CONFIG_HOME app-specific escape hatch (SPEC-003 §6.2).
 *
 * Resolution order (first existing path wins):
 *   1. $LORE_CONFIG_HOME/config.yaml
 *   2. $XDG_CONFIG_HOME/lore/config.yaml
 *   3. ~/.config/lore/config.yaml
 *
 * Returns undefined when no file exists at any candidate path.
 * Pure side-effect: reads env vars + existsSync only. Never writes.
 *
 * @example
 *   const path = resolveGlobalConfigPath();
 *   // "/home/alice/.config/lore/config.yaml" | undefined
 */
export function resolveGlobalConfigPath(): string | undefined {
  // 1. $LORE_CONFIG_HOME/config.yaml — app-specific escape hatch (highest precedence)
  const loreConfigHome = process.env["LORE_CONFIG_HOME"];
  if (loreConfigHome) {
    const candidate = join(loreConfigHome, "config.yaml");
    if (existsSync(candidate)) return candidate;
  }

  // 2. $XDG_CONFIG_HOME/lore/config.yaml — XDG explicit
  const xdgConfigHome = process.env["XDG_CONFIG_HOME"];
  if (xdgConfigHome) {
    const candidate = join(xdgConfigHome, "lore", "config.yaml");
    if (existsSync(candidate)) return candidate;
  }

  // 3. ~/.config/lore/config.yaml — XDG default (macOS/Linux/Windows all use ~/.config per pnpm/helm/gh)
  const defaultCandidate = join(homedir(), ".config", "lore", "config.yaml");
  if (existsSync(defaultCandidate)) return defaultCandidate;

  return undefined;
}

/**
 * Load GlobalLoreConfig from the XDG-resolved path (or a provided path override).
 *
 * Behaviour:
 *   - No file exists at any XDG candidate → ok({})  (missing is NOT an error)
 *   - Empty or null YAML file → ok({})
 *   - Malformed YAML → err(VALIDATION_ERROR)
 *   - Unknown top-level keys (incl. project/sync/telemetry) → err(VALIDATION_ERROR)
 *   - Valid schema → ok(parsed)
 *
 * @param configPath Optional explicit path; when omitted, resolveGlobalConfigPath() is called.
 *   Pass the result of resolveGlobalConfigPath() when you already have it (avoids a double stat).
 * @returns Result<GlobalLoreConfig, LoreError> — never throws.
 * @example
 *   const path = resolveGlobalConfigPath();
 *   if (path) {
 *     const result = loadGlobalConfig(path);
 *     if (!result.ok) console.error(`Warning: global config at ${path} ignored`);
 *   }
 */
export function loadGlobalConfig(
  configPath?: string,
): Result<GlobalLoreConfig, LoreError> {
  const resolvedPath = configPath ?? resolveGlobalConfigPath();

  // Missing file → ok({}) — global config is always optional
  if (resolvedPath === undefined) {
    return ok({});
  }

  let raw: string;
  try {
    raw = readFileSync(resolvedPath, "utf8");
  } catch (_e) {
    // reason: file may disappear between resolveGlobalConfigPath and read (TOCTOU).
    // Treat as missing — still not an error.
    return ok({});
  }

  // Empty file → ok({}) — treat same as missing
  if (!raw.trim()) {
    return ok({});
  }

  let parsed: unknown;
  try {
    parsed = yaml.parse(raw);
  } catch (_e) {
    return err({
      code: "VALIDATION_ERROR",
      field: "yaml",
      message: "Failed to parse YAML: malformed input",
      value: raw,
    } satisfies LoreError);
  }

  // null/undefined (e.g. YAML comment-only file) → ok({})
  if (parsed === null || parsed === undefined) {
    return ok({});
  }

  const parseResult = GlobalLoreConfigSchema.safeParse(parsed);
  if (parseResult.success) {
    return ok(parseResult.data);
  }

  const firstIssue = parseResult.error.issues[0];
  const field =
    firstIssue !== undefined
      ? firstIssue.path.join(".") || "root"
      : "root";
  const message =
    firstIssue !== undefined ? firstIssue.message : parseResult.error.message;
  return err({
    code: "VALIDATION_ERROR",
    field,
    message,
    value: parsed,
  } satisfies LoreError);
}

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
