/**
 * LoreConfig file I/O — Node-only (fs/path/os).
 *
 * Public surface:
 *   - loadConfig / saveConfig — project config I/O (<dir>/.lore/config.yaml)
 *   - resolveGlobalConfigPath / loadGlobalConfig — global config (XDG) resolution + loading
 *   - resolveGlobalConfigWritePath / saveGlobalConfig — global config (XDG) write
 *     target resolution + validate-then-write (SPEC-064 D7)
 *
 * Invariants:
 *   - D-004: saveConfig writes only the env-var NAME (auth_token_env) — never a
 *     resolved token value
 *   - Global config missing/empty → ok({}) (NOT an error — user-optional)
 *   - Global config malformed → err(VALIDATION_ERROR) (caller decides whether to warn)
 *   - XDG resolution is EITHER/OR at each precedence tier — a set (non-empty)
 *     $XDG_CONFIG_HOME REPLACES the ~/.config default, it never stacks under
 *     it (XDG Base Directory spec; matches pnpm/helm/gh). Both
 *     resolveGlobalConfigPath and resolveGlobalConfigWritePath honor this;
 *     see each function's own docstring for the precise gating.
 *   - SPEC-064 D7: `saveGlobalConfig` is validate-THEN-write — `GlobalLoreConfigSchema`
 *     is checked BEFORE any filesystem access, so a schema-invalid candidate writes
 *     ZERO bytes and leaves any pre-existing file byte-identical. The write itself is
 *     atomic (temp file in the same directory, then `renameSync` — POSIX rename is
 *     atomic within one filesystem) and creates every missing parent directory, so a
 *     first write to a not-yet-existing XDG path succeeds without a separate mkdir step.
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
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "fs";
import { join, dirname } from "path";
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
 * Resolution order (first existing path wins), where step 3 is EITHER/OR
 * with step 2, never a stack:
 *   1. $LORE_CONFIG_HOME/config.yaml
 *   2. $XDG_CONFIG_HOME/lore/config.yaml — only when $XDG_CONFIG_HOME is set
 *      (non-empty)
 *   3. ~/.config/lore/config.yaml — the XDG default, used ONLY when
 *      $XDG_CONFIG_HOME is unset or empty
 *
 * Per the XDG Base Directory spec, an explicit $XDG_CONFIG_HOME REPLACES the
 * ~/.config default; it does not stack under it (pnpm/helm/gh all implement
 * this as either-or). A set-but-empty $XDG_CONFIG_HOME is treated the same
 * as unset. Falling through to step 3 whenever step 2 finds nothing — even
 * with $XDG_CONFIG_HOME explicitly set — silently leaks whatever lives at
 * the real ~/.config/lore/config.yaml into a caller that asked for an
 * isolated XDG root (2026-07-25 incident: leaked into test isolation).
 *
 * Returns undefined when no file exists at any applicable candidate path.
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

  // 3. ~/.config/lore/config.yaml — XDG default (macOS/Linux/Windows all use
  //    ~/.config per pnpm/helm/gh). GATED on $XDG_CONFIG_HOME being unset/empty:
  //    a set $XDG_CONFIG_HOME replaces this default, it never stacks under it —
  //    reaching this branch with $XDG_CONFIG_HOME set would silently leak the
  //    real machine-wide config into a caller that asked for an isolated XDG root.
  if (!xdgConfigHome) {
    const defaultCandidate = join(homedir(), ".config", "lore", "config.yaml");
    if (existsSync(defaultCandidate)) return defaultCandidate;
  }

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
 * Resolves the XDG target path for a NEW global config write — the same
 * EITHER/OR precedence as {@link resolveGlobalConfigPath} (never gated on
 * `existsSync`: this answers "where would a freshly-created config.yaml go",
 * not "where does one already live", SPEC-064 D7 — a missing global config
 * is not an error, and the first write must create the file at a
 * deterministic path):
 *   1. $LORE_CONFIG_HOME/config.yaml
 *   2. $XDG_CONFIG_HOME/lore/config.yaml — only when $XDG_CONFIG_HOME is set
 *      (non-empty); a set-but-empty value is treated the same as unset
 *   3. ~/.config/lore/config.yaml — the XDG default, returned ONLY when
 *      neither env var above is set/non-empty (an explicit $XDG_CONFIG_HOME
 *      REPLACES this default, it never stacks under it)
 *
 * Each branch RETURNS immediately (mutually exclusive if/else-if/else), so
 * this function has never exhibited the step-3-unconditional-fallthrough bug
 * {@link resolveGlobalConfigPath} had (fixed 2026-07-25) — documented here so
 * the two functions' precedence stays provably in sync on future edits.
 *
 * Callers that want read-or-create semantics compose:
 *   `resolveGlobalConfigPath() ?? resolveGlobalConfigWritePath()`.
 *
 * Pure side-effect: reads env vars + `homedir()` only. Never touches the filesystem.
 *
 * @example
 *   const path = resolveGlobalConfigPath() ?? resolveGlobalConfigWritePath();
 *   saveGlobalConfig(newConfig, path);
 */
export function resolveGlobalConfigWritePath(): string {
  const loreConfigHome = process.env["LORE_CONFIG_HOME"];
  if (loreConfigHome) return join(loreConfigHome, "config.yaml");

  const xdgConfigHome = process.env["XDG_CONFIG_HOME"];
  if (xdgConfigHome) return join(xdgConfigHome, "lore", "config.yaml");

  return join(homedir(), ".config", "lore", "config.yaml");
}

/**
 * Validate-then-write the machine-scope global config (SPEC-064 D7).
 *
 * Order of operations:
 *   1. Validate `config` against {@link GlobalLoreConfigSchema} — a schema
 *      violation returns `err(VALIDATION_ERROR)` before any filesystem access
 *      (zero bytes written, any pre-existing file left byte-identical).
 *   2. Resolve the target path (`path` if given, else
 *      {@link resolveGlobalConfigWritePath}) and `mkdirSync(..., {recursive: true})`
 *      its parent directory — creates every missing directory component.
 *   3. Write to a sibling temp file, then `renameSync` it onto the target path —
 *      atomic: a crash mid-write never leaves a partially-written config.yaml, and
 *      a concurrent reader either sees the old file in full or the new file in
 *      full, never a torn write.
 *
 * @param config - Candidate GlobalLoreConfig, validated BEFORE any IO
 * @param path - Optional explicit target path (tests should always pass one,
 *   pointing at a throwaway `mkdtemp` directory — never the real XDG path).
 *   Omitted → {@link resolveGlobalConfigWritePath}.
 * @returns `Result<void, LoreError>` — never throws. Schema violation →
 *   `VALIDATION_ERROR`; any IO failure (permission denied, disk full, ...) →
 *   `STORE_ERROR`.
 * @example
 *   const result = saveGlobalConfig({ defaults: { format: "json" } }, "/tmp/x/config.yaml");
 *   // result.ok === true; /tmp/x was created; loadGlobalConfig("/tmp/x/config.yaml")
 *   // round-trips to { defaults: { format: "json" } }
 */
export function saveGlobalConfig(
  config: GlobalLoreConfig,
  path?: string,
): Result<void, LoreError> {
  const parsed = GlobalLoreConfigSchema.safeParse(config);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const field =
      firstIssue !== undefined ? firstIssue.path.join(".") || "root" : "root";
    const message =
      firstIssue !== undefined ? firstIssue.message : parsed.error.message;
    return err({
      code: "VALIDATION_ERROR",
      field,
      message,
      value: config,
    } satisfies LoreError);
  }

  const targetPath = path ?? resolveGlobalConfigWritePath();

  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    const yamlText = yaml.stringify(parsed.data);
    // reason: write-then-rename (not a direct writeFileSync onto targetPath) is
    // what makes this atomic — a process crash between these two calls leaves
    // only an orphan temp file, never a truncated/partial config.yaml.
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpPath, yamlText, "utf8");
    renameSync(tmpPath, targetPath);
    return ok(undefined);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to write global config file";
    const cause = e instanceof Error ? e : undefined;
    return err({
      code: "STORE_ERROR",
      message,
      ...(cause !== undefined ? { cause } : {}),
    } satisfies LoreError);
  }
}
