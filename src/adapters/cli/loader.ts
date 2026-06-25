/**
 * CLI App loader — telemetry-aware DB discovery and App construction.
 *
 * Public surface:
 *   - loadLoreApp() — single unified entry point for all CLI commands
 *
 * Invariants:
 *   - loadLoreApp() ALWAYS loads config.yaml so telemetry is wired when enabled
 *   - loadLoreApp() strips the sync section — always returns App (never Result<App>)
 *   - init command is exempt — it creates the DB before config exists (uses createApp directly)
 *   - sync command is exempt — manages TursoStore directly, not corpus operations
 *
 * Side-effect class: IO (file reads, process.exit(1) on missing DB)
 *
 * reason: Kept separate from utils.ts because utils.ts is imported by vitest tests
 * that cannot resolve bun:sqlite. This module imports app.ts (which imports bun:sqlite)
 * and is only loaded at runtime by the CLI binary, never by vitest.
 *
 * Source: SPEC-012 §5 (K3 — full-CLI telemetry coverage, AC-K3-1)
 */

import { dirname } from "path";
import { loadConfig } from "../../core/config.js";
import type { LoreConfig } from "../../core/config.js";
import { createApp, type App } from "../../app.js";
import { findLoreDbPath } from "./utils.js";

/**
 * Load a telemetry-aware App instance for use by CLI commands.
 *
 * Walks up from cwd to find .lore/lore.db, loads .lore/config.yaml (including
 * the telemetry section), then constructs App via createApp(dbPath, config).
 *
 * The sync section is stripped from config before passing to createApp so that
 * this helper always returns App (not Result<App>). Commands that manage sync
 * (lore sync setup/push/pull) handle TursoStore construction separately.
 *
 * reason: AC-K3-1 — every CLI command MUST go through a telemetry-aware loader
 * so JsonlTelemetry is wired when telemetry.enabled=true in config.yaml. Using
 * createApp(dbPath) without config silently produces NoOpTelemetry, bypassing
 * the user's telemetry preference. (SPEC-012 §5)
 *
 * @returns { app, dbPath } — App wired with telemetry; dbPath for commands that need it
 * @throws process.exit(1) if no .lore/lore.db found in directory tree
 * @example
 *   const { app } = loadLoreApp();
 *   try { ... } finally { app.close(); }
 */
export function loadLoreApp(): { app: App; dbPath: string } {
  const dbPath = findLoreDbPath();
  // The .lore dir is always one level up from lore.db
  const loreDir = dirname(dbPath);
  const projectDir = dirname(loreDir);
  // Config parse failures are silently ignored — fall back to NoOpTelemetry
  const configResult = loadConfig(projectDir);
  const rawConfig: LoreConfig | undefined = configResult.ok ? configResult.value : undefined;

  // Strip sync section — reason: prevents createApp returning Result<App>.
  // Corpus-level commands never need TursoStore; they use local SQLiteStore + telemetry only.
  let telemetryOnlyConfig: LoreConfig | undefined;
  if (rawConfig !== undefined) {
    const { sync: _sync, ...configWithoutSync } = rawConfig;
    telemetryOnlyConfig = configWithoutSync as LoreConfig;
  }

  // createApp(dbPath, config) with no sync section always returns App (not Result<App>)
  const app = createApp(dbPath, telemetryOnlyConfig) as App;
  return { app, dbPath };
}
