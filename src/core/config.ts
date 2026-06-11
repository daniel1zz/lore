/**
 * LoreConfig — Zod schema, types, pure parse helpers, and file I/O.
 * Source: SPEC-009 §6, D-004 (auth_token_env is env-var NAME only), D-007 (sync.enabled + remote_url → TursoStore).
 */

import { z } from "zod";
import yaml from "yaml";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { ok, err } from "./errors.js";
import type { Result, LoreError } from "./errors.js";

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
    return err({
      code: "STORE_ERROR",
      message,
      cause: e instanceof Error ? e : undefined,
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
    return err({
      code: "STORE_ERROR",
      message,
      cause: e instanceof Error ? e : undefined,
    } satisfies LoreError);
  }
}

/**
 * Resolve sync credentials from process.env using the env-var name in config.sync.
 * D-004: token is read from process.env at runtime, never stored on disk.
 * Missing/empty env var or absent sync section → {ok:false, VALIDATION_ERROR}. Never throws.
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

  return ok({ url: config.sync.remote_url ?? "", token });
}
