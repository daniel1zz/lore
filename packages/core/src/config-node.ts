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
import { ok, err } from "./errors.js";
import type { Result, LoreError } from "./errors.js";
import {
  GlobalLoreConfigSchema,
  loadConfigFromString,
  renamePrdSyncConfigKey,
  removeRetiredAdoptionSetting,
  removeRetiredActorIdentityGate,
  RETIRED_ACTOR_IDENTITY_FIELD,
  type LoreConfig,
  type GlobalLoreConfig,
} from "./config.js";

/** The invocation environment the global-config path resolvers read (`Invocation.env`). */
export type ConfigEnv = Readonly<Record<string, string | undefined>>;

// ─── Project Config I/O ───────────────────────────────────────────────────────

const CONFIG_FILE = ".lore/config.yaml";

/**
 * Load LoreConfig from <dir>/.lore/config.yaml.
 * Missing file or invalid content → {ok:false, error}. Never throws.
 * `warn`, when given, receives one line per retired key the file still carries (see `retiredConfigKeyNotices`).
 *
 * NEVER WRITES. A file still carrying the retired `workflow.gates."plan-close".prd_sync` fails by name
 * (`loadConfigFromString`'s refusal, which names the fix `lore migrate config-keys --apply`); renaming it is
 * {@link migrateConfigKeys}'s job, run on purpose.
 */
export function loadConfig(dir: string, warn?: (line: string) => void): Result<LoreConfig, LoreError> {
  try {
    const configPath = join(dir, CONFIG_FILE);
    const raw = readFileSync(configPath, "utf8");
    return loadConfigFromString(raw, warn);
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

/** What {@link migrateConfigKeys} found in (and, with `apply`, did to) one project config file. */
export interface ConfigKeysMigration {
  /** Absolute path of the config file examined. */
  readonly file: string;
  /** Whether the file carried a retired key (a dry run reports `true` without writing). */
  readonly renamed: boolean;
  /** Whether the file was written (`apply` and `renamed`). */
  readonly written: boolean;
  /** One line naming the file and the rename, or `undefined` when nothing needed renaming. */
  readonly notice: string | undefined;
}

/**
 * The explicit, one-time rename of retired config keys in `<dir>/.lore/config.yaml` (`lore migrate config-keys`):
 * `workflow.gates."plan-close".prd_sync` -> `cited_rule_check` (BL-D3), and the removal of the retired
 * `workflow.gates."task-claim".actor_identity` setting (claims compare runs only). Only those keys change; every
 * other byte of the file is identical. The write is atomic (temp file in the same directory, then rename). A second
 * run finds no old key and changes nothing.
 *
 * @param dir - project directory holding `.lore/config.yaml`
 * @param apply - `false` (dry run) reports without writing; `true` writes
 * @returns `ok(report)`; `err(VALIDATION_ERROR)` when the YAML is malformed or both names are present (nothing
 *   written); `err(STORE_ERROR)` when the file cannot be read or written. Never throws.
 * @example
 *   migrateConfigKeys("/repo", true); // => ok({ file: "/repo/.lore/config.yaml", renamed: true, written: true, notice: "..." })
 */
export function migrateConfigKeys(dir: string, apply: boolean): Result<ConfigKeysMigration, LoreError> {
  const file = join(dir, CONFIG_FILE);
  try {
    const raw = readFileSync(file, "utf8");
    const renamed = renamePrdSyncConfigKey(raw);
    if (!renamed.ok) return renamed;
    const afterRename = renamed.value?.text ?? raw;
    const removed = removeRetiredActorIdentityGate(afterRename);
    if (!removed.ok) return removed;
    if (renamed.value === undefined && removed.value === undefined) {
      return ok({ file, renamed: false, written: false, notice: undefined });
    }
    const notices: string[] = [];
    if (renamed.value !== undefined) {
      notices.push(
        `${file}: workflow.gates."plan-close".prd_sync renamed to workflow.gates."plan-close".cited_rule_check ` +
          `(enabled: ${String(renamed.value.enabled)} kept)`,
      );
    }
    if (removed.value !== undefined) {
      notices.push(`${file}: ${RETIRED_ACTOR_IDENTITY_FIELD} removed (claims compare runs only; the setting no longer exists)`);
    }
    const notice = notices.join("\n");
    if (!apply) return ok({ file, renamed: true, written: false, notice });
    const tempPath = `${file}.migrating-${process.pid}`;
    writeFileSync(tempPath, removed.value?.text ?? afterRename, "utf8");
    renameSync(tempPath, file);
    return ok({ file, renamed: true, written: true, notice });
  } catch (e) {
    return err({
      code: "STORE_ERROR",
      message: e instanceof Error ? e.message : "Failed to migrate config file",
      ...(e instanceof Error ? { cause: e } : {}),
    } satisfies LoreError);
  }
}

/** What {@link migrateMemoryLimits} found in (and, with `apply`, did to) one project config file. */
export interface MemoryLimitsConfigMigration {
  /** Absolute path of the config file examined. */
  readonly file: string;
  /** The retired setting's value, or `undefined` when the file did not carry it. */
  readonly value: unknown;
  /** Whether the file carried the retired setting (a dry run reports `true` without writing). */
  readonly found: boolean;
  /** Whether the file was written (`apply` and `found`). */
  readonly written: boolean;
  /** The config text as it reads once the setting is gone (the input text itself when none was found). */
  readonly text: string;
}

/**
 * The config half of `lore migrate memory-limits`: removes the retired `context.memory_files.adoption` setting from
 * `<dir>/.lore/config.yaml` (its line only; every other byte is identical). The write is atomic (temp file in the
 * same directory, then rename). A second run finds no setting and changes nothing. Never loads the config through the
 * app: the file it repairs is the one every other command now refuses.
 *
 * @param dir - project directory holding `.lore/config.yaml`
 * @param apply - `false` (dry run) reports without writing; `true` writes
 * @returns `ok(report)`; `err(VALIDATION_ERROR)` when the YAML is malformed or the setting cannot be cut out line-wise
 *   (nothing written); `err(STORE_ERROR)` when the file cannot be read or written. Never throws.
 * @example
 *   migrateMemoryLimits("/repo", true); // => ok({ file: "/repo/.lore/config.yaml", value: "warn", found: true, written: true, text: "..." })
 */
export function migrateMemoryLimits(dir: string, apply: boolean): Result<MemoryLimitsConfigMigration, LoreError> {
  const file = join(dir, CONFIG_FILE);
  try {
    const raw = readFileSync(file, "utf8");
    const removed = removeRetiredAdoptionSetting(raw);
    if (!removed.ok) return removed;
    if (removed.value === undefined) return ok({ file, value: undefined, found: false, written: false, text: raw });
    const { text, value } = removed.value;
    if (!apply) return ok({ file, value, found: true, written: false, text });
    const tempPath = `${file}.migrating-${process.pid}`;
    writeFileSync(tempPath, text, "utf8");
    renameSync(tempPath, file);
    return ok({ file, value, found: true, written: true, text });
  } catch (e) {
    return err({
      code: "STORE_ERROR",
      message: e instanceof Error ? e.message : "Failed to migrate config file",
      ...(e instanceof Error ? { cause: e } : {}),
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
 * Pure side-effect: existsSync only. Never writes; reads no ambient state —
 * `env` and `home` are the invocation's resolved values (AS-26).
 *
 * @param env - the invocation environment (`Invocation.env`)
 * @param home - the user's home directory (`Invocation.paths.home`)
 * @example
 *   const path = resolveGlobalConfigPath(inv.env, inv.paths.home);
 *   // "/home/alice/.config/lore/config.yaml" | undefined
 */
export function resolveGlobalConfigPath(env: ConfigEnv, home: string): string | undefined {
  // 1. $LORE_CONFIG_HOME/config.yaml — app-specific escape hatch (highest precedence)
  const loreConfigHome = env["LORE_CONFIG_HOME"];
  if (loreConfigHome) {
    const candidate = join(loreConfigHome, "config.yaml");
    if (existsSync(candidate)) return candidate;
  }

  // 2. $XDG_CONFIG_HOME/lore/config.yaml — XDG explicit
  const xdgConfigHome = env["XDG_CONFIG_HOME"];
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
    const defaultCandidate = join(home, ".config", "lore", "config.yaml");
    if (existsSync(defaultCandidate)) return defaultCandidate;
  }

  return undefined;
}

/**
 * Load GlobalLoreConfig from the XDG-resolved path (or a provided path override).
 *
 * Behaviour:
 *   - No file exists at any XDG candidate (or it vanishes before the read) → ok({})  (missing is NOT an error)
 *   - File exists but cannot be read (EACCES, EISDIR, ...) → err(VALIDATION_ERROR, field "file")
 *   - Empty or null YAML file → ok({})
 *   - Malformed YAML → err(VALIDATION_ERROR)
 *   - Unknown top-level keys (incl. project/sync/telemetry) → err(VALIDATION_ERROR)
 *   - Valid schema → ok(parsed)
 *
 * @param configPath The path to read — normally the result of
 *   `resolveGlobalConfigPath(env, home)`; `undefined` (no file resolved) → ok({}). This function
 *   resolves nothing itself: it reads no ambient state (AS-26).
 * @returns Result<GlobalLoreConfig, LoreError> — never throws.
 * @example
 *   const path = resolveGlobalConfigPath(inv.env, inv.paths.home);
 *   if (path) {
 *     const result = loadGlobalConfig(path);
 *     if (!result.ok) console.error(`Warning: global config at ${path} ignored`);
 *   }
 */
export function loadGlobalConfig(
  configPath: string | undefined,
): Result<GlobalLoreConfig, LoreError> {
  const resolvedPath = configPath;

  // Missing file → ok({}) — global config is always optional
  if (resolvedPath === undefined) {
    return ok({});
  }

  let raw: string;
  try {
    raw = readFileSync(resolvedPath, "utf8");
  } catch (e) {
    // reason: file may disappear between resolveGlobalConfigPath and read (TOCTOU) — ONLY that
    // (ENOENT) is "missing", still not an error. Any other failure (EACCES from chmod 000, EISDIR, ...)
    // is an UNREADABLE config the caller must be able to report, never silently treated as absent
    // (spec-defect-clusters-round-2-part-d D29, BR-868).
    const errno = (e as NodeJS.ErrnoException).code;
    if (errno === "ENOENT") return ok({});
    return err({
      code: "VALIDATION_ERROR",
      field: "file",
      message: `Cannot read global config: ${e instanceof Error ? e.message : String(e)}`,
      value: resolvedPath,
    } satisfies LoreError);
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
 *   `resolveGlobalConfigPath(env, home) ?? resolveGlobalConfigWritePath(env, home)`.
 *
 * Pure: reads only its arguments. Never touches the filesystem.
 *
 * @param env - the invocation environment (`Invocation.env`)
 * @param home - the user's home directory (`Invocation.paths.home`)
 * @example
 *   const path = resolveGlobalConfigPath(inv.env, inv.paths.home) ?? resolveGlobalConfigWritePath(inv.env, inv.paths.home);
 *   saveGlobalConfig(newConfig, path);
 */
export function resolveGlobalConfigWritePath(env: ConfigEnv, home: string): string {
  const loreConfigHome = env["LORE_CONFIG_HOME"];
  if (loreConfigHome) return join(loreConfigHome, "config.yaml");

  const xdgConfigHome = env["XDG_CONFIG_HOME"];
  if (xdgConfigHome) return join(xdgConfigHome, "lore", "config.yaml");

  return join(home, ".config", "lore", "config.yaml");
}

/**
 * Validate-then-write the machine-scope global config (SPEC-064 D7).
 *
 * Order of operations:
 *   1. Validate `config` against {@link GlobalLoreConfigSchema} — a schema
 *      violation returns `err(VALIDATION_ERROR)` before any filesystem access
 *      (zero bytes written, any pre-existing file left byte-identical).
 *   2. `mkdirSync(..., {recursive: true})` the parent directory of `path` — creates every missing directory component.
 *   3. Write to a sibling temp file, then `renameSync` it onto the target path —
 *      atomic: a crash mid-write never leaves a partially-written config.yaml, and
 *      a concurrent reader either sees the old file in full or the new file in
 *      full, never a torn write.
 *
 * @param config - Candidate GlobalLoreConfig, validated BEFORE any IO
 * @param path - Target path: `resolveGlobalConfigWritePath(env, home)` in production, a throwaway
 *   `mkdtemp` file in tests (never the real XDG path). Required — this function reads no ambient state.
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
  path: string,
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

  const targetPath = path;

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
