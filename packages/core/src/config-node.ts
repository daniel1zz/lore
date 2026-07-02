/**
 * LoreConfig file I/O — Node-only (fs/path/os).
 *
 * Public surface:
 *   - loadConfig / saveConfig — project config I/O (<dir>/.lore/config.yaml)
 *   - resolveGlobalConfigPath / loadGlobalConfig — global config (XDG) resolution + loading
 *
 * Invariants:
 *   - D-004: saveConfig writes only the env-var NAME (auth_token_env) — never a
 *     resolved token value
 *   - Global config missing/empty → ok({}) (NOT an error — user-optional)
 *   - Global config malformed → err(VALIDATION_ERROR) (caller decides whether to warn)
 *   - This module imports `fs`/`path`/`os` — it MUST only be reached via the
 *     `@lore/core/node` subpath (`src/node.ts`), never via the default `@lore/core`
 *     barrel (`src/index.ts`). `@lore/dashboard` (browser) MUST NOT import this
 *     file, directly or transitively.
 *
 * Side-effect class: IO (reads/writes disk)
 *
 * Source: SPEC-009 §6, SPEC-003 §6.2
 */

import yaml from "yaml";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { ok, err } from "./errors.js";
import type { Result, LoreError } from "./errors.js";
import {
  GlobalLoreConfigSchema,
  loadConfigFromString,
  type LoreConfig,
  type GlobalLoreConfig,
} from "./config.js";

// ─── Project Config I/O ───────────────────────────────────────────────────────

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
