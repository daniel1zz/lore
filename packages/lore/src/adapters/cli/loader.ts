/**
 * CLI App loader — telemetry-aware DB discovery and App construction.
 *
 * Public surface:
 *   - loadLoreApp() — single unified entry point for all CLI commands
 *
 * Invariants:
 *   - loadLoreApp() ALWAYS loads config.yaml so telemetry is wired when enabled
 *   - loadLoreApp() strips the sync section — always returns App (never Result<App>)
 *     unless ai.provider is set to an unknown name, in which case returns exit 1.
 *   - Global config missing/malformed → warning to stderr; defaults fall back to {}
 *   - init command is exempt — it creates the DB before config exists (uses createApp directly)
 *   - sync command is exempt — manages TursoStore directly, not corpus operations
 *   - setup command is exempt — the global install path (SetupService) targets ~/.claude,
 *     unrelated to any .lore/ corpus; the --project path bootstraps ITS OWN .lore/ via an
 *     injected initCorpus thunk (flows/init-corpus.ts), never via loadLoreApp() (which
 *     requires a .lore/lore.db to already exist — the opposite of what --project scaffolds)
 *   - SPEC-030 AC-HJ-3: a project config whose `ai` block fails schema validation is a
 *     LOUD failure (exit code from `exitCode()`, formatted error to stderr) — it must NOT
 *     silently fall back to `AiConfigSchema.parse({})` defaults. Every OTHER config parse
 *     failure (malformed YAML, bad `sync`/`telemetry`/`workflow` section, unknown top-level
 *     key, etc.) keeps the pre-existing silent fallback-to-undefined behaviour — this is a
 *     documented non-goal of SPEC-030, not an oversight.
 *
 * Side-effect class: IO (file reads, process.exit(1) on missing DB or unknown ai.provider,
 *   process.exit on invalid `ai` config block (AC-HJ-3), console.error for warnings)
 *
 * reason: Kept separate from utils.ts because utils.ts is imported by vitest tests
 * that cannot resolve bun:sqlite. This module imports app.ts (which imports bun:sqlite)
 * and is only loaded at runtime by the CLI binary, never by vitest.
 *
 * Source: SPEC-012 §5 (K3 — full-CLI telemetry coverage, AC-K3-1), SPEC-003 §6.2 (global config)
 *         SPEC-017 §3.12 (AC-AI-11 — unknown ai.provider → exit 1 with STORE_ERROR message)
 *         SPEC-030 §2 (AC-HJ-3 — fail-loud `ai` block config errors)
 */

import { dirname } from "path";
import { mergeDefaults, isAiConfigValidationError } from "@lore/core";
import type { LoreConfig, LoreDefaults, CallerSurface } from "@lore/core";
// reason: loadConfig/loadGlobalConfig/resolveGlobalConfigPath read the filesystem
// via Node fs/path/os — only reachable via the @lore/core/node subpath
// (browser-safety split, packages/core/src/CLAUDE.md).
import {
  loadConfig,
  loadGlobalConfig,
  resolveGlobalConfigPath,
} from "@lore/core/node";
import { createApp, type App } from "../../app.js";
import { findLoreDbPath, formatError, exitCode } from "./utils.js";

/**
 * Detect whether the current CLI invocation is by an AI agent or a human.
 *
 * Classification rules (SPEC-024 §8 Q1):
 *   - LORE_AI_DEFAULT=off → "agent" (explicit, highest trust)
 *   - CLAUDECODE=1        → "agent" (Claude Code main loop / subagent)
 *   - CI=true             → "agent" (any CI runner)
 *   - none of the above   → "cli" (human terminal, SPEC-017 default)
 *
 * reason: env vars read at process startup (before any command dispatch) ensure surface
 * is stable for the entire request. MCP/HTTP use in-process flags instead — see SPEC-024 §9.2.
 *
 * @returns CallerSurface — "cli" or "agent"
 */
function detectCliSurface(): CallerSurface {
  if (
    process.env["LORE_AI_DEFAULT"] === "off" ||
    process.env["CLAUDECODE"] === "1" ||
    process.env["CI"] === "true"
  ) {
    return "agent";
  }
  return "cli";
}

/**
 * Load a telemetry-aware App instance for use by CLI commands.
 *
 * Walks up from cwd to find .lore/lore.db, loads .lore/config.yaml (including
 * the telemetry section), then constructs App via createApp(dbPath, config).
 *
 * Also loads the XDG global config (~/.config/lore/config.yaml or $LORE_CONFIG_HOME)
 * and merges its defaults section with the project-level defaults (project wins).
 * Malformed global config → warning printed to stderr; loader continues with empty defaults.
 *
 * The sync section is stripped from config before passing to createApp. With sync
 * absent, createApp returns App directly — unless ai.provider references an unknown
 * name, in which case buildProviderRegistry inside createApp returns err(STORE_ERROR)
 * and createApp propagates it as Result. We detect this via duck-type check ("ok" in result)
 * and surface it as exit 1 with formatError output (AC-AI-11, SPEC-017 §3.12).
 *
 * reason: always returns App when sync is disabled AND ai.provider is a known name;
 * otherwise (unknown ai.provider) exits 1 instead of crashing with TypeError when
 * downstream code accesses app.corpusService on the unwrapped Result object.
 *
 * Commands that manage sync (lore sync setup/push/pull) handle TursoStore construction
 * separately.
 *
 * reason: AC-K3-1 — every CLI command MUST go through a telemetry-aware loader
 * so JsonlTelemetry is wired when telemetry.enabled=true in config.yaml. Using
 * createApp(dbPath) without config silently produces NoOpTelemetry, bypassing
 * the user's telemetry preference. (SPEC-012 §5)
 *
 * reason: Adding defaults to the return type (not to App) keeps App composition-root
 * pure — defaults are CLI display preferences, not domain state. (SPEC-003 §6.2)
 *
 * @returns { app, dbPath, defaults, config } — App wired with telemetry; dbPath for
 *   commands that need it; defaults (editor/format/color) merged from global + project
 *   config; config is the parsed project `.lore/config.yaml` (sync section stripped,
 *   same value passed to `createApp`), or `undefined` when no config file was found or
 *   it failed to parse (matching the historical silent-fallback for non-`ai` sections —
 *   see this function's header). Callers that need e.g. `workflow.gates` read `config`
 *   directly; it is intentionally the raw parsed shape, not yet another resolved helper.
 * @throws process.exit if no .lore/lore.db found in directory tree (code 1), if
 *   ai.provider references an unknown provider name (AC-AI-11, code 1), or if the `ai`
 *   config block itself fails schema validation (SPEC-030 AC-HJ-3, code from exitCode())
 * @example
 *   const { app, defaults, config } = loadLoreApp();
 *   try { ... } finally { app.close(); }
 */
export function loadLoreApp(): {
  app: App;
  dbPath: string;
  defaults: LoreDefaults;
  config: LoreConfig | undefined;
} {
  const dbPath = findLoreDbPath();
  // The .lore dir is always one level up from lore.db
  const loreDir = dirname(dbPath);
  const projectDir = dirname(loreDir);
  const configResult = loadConfig(projectDir);
  let rawConfig: LoreConfig | undefined;
  if (configResult.ok) {
    rawConfig = configResult.value;
  } else if (isAiConfigValidationError(configResult.error)) {
    // SPEC-030 AC-HJ-3: an invalid `ai` block MUST fail loud — silently falling back to
    // AiConfigSchema.parse({}) defaults here previously masked typos (e.g. an unrecognized
    // `ai.cli` key silently reverting BOTH `ai.assess.max_diff_chars` and every
    // `ai.providers.<name>.timeout_ms` override to built-in defaults with zero warning).
    console.error(formatError(configResult.error)); // CLI surface
    process.exit(exitCode(configResult.error));
  } else {
    // reason: all OTHER config parse failures (malformed YAML, invalid sync/telemetry/
    // workflow section, unknown top-level key) keep the historical silent fallback —
    // documented SPEC-030 non-goal, not touched by this change.
    rawConfig = undefined;
  }

  // Strip sync section — reason: prevents createApp returning Result<App>.
  // Corpus-level commands never need TursoStore; they use local SQLiteStore + telemetry only.
  let telemetryOnlyConfig: LoreConfig | undefined;
  if (rawConfig !== undefined) {
    const { sync: _sync, ...configWithoutSync } = rawConfig;
    telemetryOnlyConfig = configWithoutSync as LoreConfig;
  }

  // ─── Global config + defaults merge ─────────────────────────────────────────
  // reason: SPEC-003 §6.2 — resolve once here so we have the path for the warning message.
  const globalConfigPath = resolveGlobalConfigPath();
  let globalDefaults: LoreDefaults | undefined;
  if (globalConfigPath !== undefined) {
    const globalResult = loadGlobalConfig(globalConfigPath);
    if (globalResult.ok) {
      globalDefaults = globalResult.value.defaults;
    } else {
      // reason: malformed global config MUST NOT prevent lore from starting (SPEC-003 §6.2).
      // Warn and continue — project defaults and built-in defaults still apply.
      // reason: LoreError is a discriminated union — not all variants have .message.
      // Use 'message' in narrowing to safely extract a human-readable reason.
      const reason =
        "message" in globalResult.error
          ? globalResult.error.message
          : globalResult.error.code;
      console.error( // CLI surface
        `Warning: global config at ${globalConfigPath} ignored — ${reason}`,
      );
    }
  }

  // Project defaults win over global defaults (SPEC-003 §6.2 merge semantics)
  const projectDefaults = rawConfig?.defaults;
  const defaults = mergeDefaults(globalDefaults, projectDefaults);

  // createApp with sync stripped returns App when ai.provider is a known name.
  // If ai.provider is unknown, buildProviderRegistry inside createApp returns
  // err(STORE_ERROR) and createApp propagates it as Result<App, LoreError>.
  // reason: always returns App when sync is disabled AND ai.provider is a known name;
  // otherwise returns Result and we surface it as exit 1 (AC-AI-11, SPEC-017 §3.12).
  const appOrResult = createApp(dbPath, telemetryOnlyConfig);
  let app: App;
  if ("ok" in appOrResult) {
    // createApp returned a Result — only happens when ai.provider is unknown
    if (!appOrResult.ok) {
      console.error(formatError(appOrResult.error)); // CLI surface
      process.exit(1);
    }
    app = appOrResult.value;
  } else {
    app = appOrResult;
  }

  // SPEC-024 §9.1: set callerSurface from env vars before any command dispatch.
  // reason: must happen here (not inside each command) so the surface is stable
  // for the entire CLI invocation. MCP sets "mcp" in adapters/mcp/index.ts; HTTP
  // resolves per-request in ActorContext — see SPEC-024 §9.2.
  app.callerSurface = detectCliSurface();

  return { app, dbPath, defaults, config: telemetryOnlyConfig };
}
