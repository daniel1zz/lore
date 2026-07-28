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
 *   - SPEC-073: `createApp()` is called inside a `try/catch` — a corrupted/non-SQLite
 *     `.lore/lore.db` makes `bun:sqlite`'s `Database` constructor throw SYNCHRONOUSLY
 *     (never a `Result`), which pre-SPEC-073 propagated uncaught all the way to citty's
 *     own `runMain` catch-all (a bare stack-trace dump, no report-issue hint reachable
 *     there — see `safeInternalErrorHint`'s call site for the full rationale). Both this
 *     catch AND the pre-existing "`ai.provider` unknown" `STORE_ERROR` branch append a
 *     best-effort SPEC-073 report-issue hint via `safeInternalErrorHint` when the
 *     consumer has `feedback.upstream` configured.
 *
 * Side-effect class: IO (file reads, process.exit(1) on missing DB, unknown ai.provider,
 *   or an unexpected App-construction throw (SPEC-073); process.exit on invalid `ai`
 *   config block (AC-HJ-3), console.error for warnings)
 *
 * reason: Kept separate from utils.ts because utils.ts is imported by vitest tests
 * that cannot resolve bun:sqlite. This module imports app.ts (which imports bun:sqlite)
 * and is only loaded at runtime by the CLI binary, never by vitest.
 *
 * Source: SPEC-012 §5 (K3 — full-CLI telemetry coverage, AC-K3-1), SPEC-003 §6.2 (global config)
 *         SPEC-017 §3.12 (AC-AI-11 — unknown ai.provider → exit 1 with STORE_ERROR message)
 *         SPEC-030 §2 (AC-HJ-3 — fail-loud `ai` block config errors)
 *         SPEC-073 §Design (error-path report-issue hint, "internal" errClass)
 */

import { dirname } from "path";
import { mergeDefaults, isAiConfigValidationError } from "@lore/core";
import type { LoreConfig, LoreDefaults, CallerSurface, LoreError, Result } from "@lore/core";
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
// reason: buildReportIssueHint is pure/import-light (SPEC-073) — safe here regardless
// of this module's own bun-only status. resolveFeedbackUpstreamCfg's OWNING module
// (report-issue-wiring.ts) DOES value-import bun:sqlite transitively (probeUpstreamDb/
// ReceiptLog/LATEST_SCHEMA_VERSION) — but this file already imports "../../app.js"
// (bun:sqlite via createApp), so it is bun-only already and never vitest-reachable;
// no lazy-import indirection is needed here (contrast the MCP tools.ts precedent,
// which DOES need one because that file is NOT already bun-only).
import { buildReportIssueHint } from "./report-issue-hint.js";
import { resolveFeedbackUpstreamCfg } from "./report-issue-wiring.js";

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
 * Resolves the project directory one level up from a discovered `.lore/lore.db`
 * path and loads `.lore/config.yaml` via `@lore/core/node`'s `loadConfig` — the
 * ONE parse both {@link loadLoreApp} (one-time CLI startup) and
 * {@link loadProjectConfig} (per-call MCP re-read, SPEC-070 F6) build on, so a
 * long-lived MCP server observing config edits without restart never grows a
 * second, independently-drifting YAML-parsing implementation.
 *
 * @param dbPath - An already-discovered `.lore/lore.db` path (`findLoreDbPath()`).
 * @returns The raw `loadConfig` result — `sync` NOT yet stripped (each caller
 *   strips it on its own success path, matching their pre-existing behaviour).
 */
function resolveProjectConfigResult(dbPath: string): Result<LoreConfig, LoreError> {
  // The .lore dir is always one level up from lore.db
  const loreDir = dirname(dbPath);
  const projectDir = dirname(loreDir);
  return loadConfig(projectDir);
}

/**
 * Best-effort SPEC-073 report-issue hint for an `"internal"`-classified
 * `loadLoreApp()` failure (STORE_ERROR result, OR an unexpected throw during App
 * construction — e.g. a corrupted `.lore/lore.db` file, which `bun:sqlite`'s
 * `Database` constructor throws synchronously rather than returning a `Result` for).
 * Wrapped in a `try/catch` so a hint-resolution failure (malformed config shape)
 * can NEVER turn this already-fatal error path into a second, worse crash — every
 * failure mode here degrades to `null` (print nothing), never a throw.
 *
 * @param rawConfig - the ALREADY-parsed project config from this same
 *   `loadLoreApp()` call (sync section not yet stripped — irrelevant here, only
 *   `feedback.upstream` is read) — no second `.lore/config.yaml` parse.
 * @returns the hint line (no trailing newline), or `null` when unconfigured /
 *   resolution failed.
 */
function safeInternalErrorHint(rawConfig: LoreConfig | undefined): string | null {
  try {
    return buildReportIssueHint("internal", resolveFeedbackUpstreamCfg(rawConfig) !== undefined);
  } catch {
    return null;
  }
}

/**
 * Re-resolves `.lore/lore.db` (`findLoreDbPath`) and re-loads `.lore/config.yaml`
 * (`resolveProjectConfigResult`) fresh on every call, sync section stripped — the
 * SAME canonical parse {@link loadLoreApp} performs at CLI startup, reused here so
 * a long-lived caller (the MCP server's per-call `getConfig` getter, SPEC-070 F6)
 * observes `.lore/config.yaml` edits without a restart, exactly as a CLI
 * invocation naturally would (a fresh process per call).
 *
 * Deliberately narrower than `loadLoreApp`: no App construction, no global-config
 * merge, and no `process.exit` on an invalid `ai` block (AC-HJ-3's loud-exit is a
 * ONE-TIME CLI-startup concern — a live MCP server's per-call config re-read must
 * never abort the process mid-request). Every parse failure, `ai`-block-invalid
 * included, degrades to `undefined` here — the caller's pre-existing "no config"
 * fallback path (e.g. `resolveTaskStartBudgets(undefined)` returning `{}`).
 *
 * @returns The parsed project config with `sync` stripped, or `undefined` when no
 *   `.lore/lore.db` is discoverable from `cwd`, or the config file is
 *   missing/malformed.
 */
export function loadProjectConfig(): LoreConfig | undefined {
  const dbPath = findLoreDbPath();
  const configResult = resolveProjectConfigResult(dbPath);
  if (!configResult.ok) return undefined;
  const { sync: _sync, ...configWithoutSync } = configResult.value;
  return configWithoutSync as LoreConfig;
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
 *   ai.provider references an unknown provider name (AC-AI-11, code 1), if the `ai`
 *   config block itself fails schema validation (SPEC-030 AC-HJ-3, code from exitCode()),
 *   or if App construction throws unexpectedly — e.g. a corrupted/non-SQLite
 *   `.lore/lore.db` (SPEC-073, code 1)
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
  const configResult = resolveProjectConfigResult(dbPath);
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
  //
  // SPEC-073: createApp can ALSO throw SYNCHRONOUSLY (not return a Result) — the
  // bun:sqlite Database constructor throws on a corrupted/non-sqlite lore.db file,
  // before any Result-based error path is ever reached. Pre-SPEC-073 this propagated
  // uncaught all the way to citty's OWN `runMain` catch-all (a bare consola
  // stack-trace dump) — citty's internal error rendering has no override hook this
  // codebase can use (unlike `showUsage`, see `usage-render.ts`), so a report-issue
  // hint could never reach that output. Catching it HERE, at the one choke point
  // every corpus command's App construction passes through, is what makes the
  // "internal unexpected throw" errClass (SPEC-073 §Design) actually reachable.
  let appOrResult: App | Result<App, LoreError>;
  try {
    appOrResult = createApp(dbPath, telemetryOnlyConfig);
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    console.error(`Error: Storage failure: ${message}`); // CLI surface
    const hint = safeInternalErrorHint(rawConfig);
    if (hint !== null) console.error(hint); // CLI surface
    process.exit(1);
  }
  let app: App;
  if ("ok" in appOrResult) {
    // createApp returned a Result — only happens when ai.provider is unknown
    if (!appOrResult.ok) {
      console.error(formatError(appOrResult.error)); // CLI surface
      const hint = safeInternalErrorHint(rawConfig);
      if (hint !== null) console.error(hint); // CLI surface
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

  // SPEC-102 §Migration Strategy — opportunistic bounded-batch trace
  // retention prune, fired ONCE per CLI invocation (not MCP/HTTP — those are
  // long-lived processes, not a per-invocation "startup"). Absent when
  // trace.enabled resolves false (createApp never wires this port then).
  // Fire-and-forget: never awaited, so it adds ZERO latency to command
  // dispatch — the CLI process's own event loop keeps it running until it
  // settles or the process exits, whichever comes first.
  app.pruneTraceEventsOpportunistically?.();

  return { app, dbPath, defaults, config: telemetryOnlyConfig };
}
