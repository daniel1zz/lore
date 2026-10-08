/**
 * Module: site-census-nonbusiness — the shared list of app-bootstrap symbols the census sets aside.
 *
 * Purpose: name the entry-point plumbing (app wiring, config loading) whose failure sites are NOT
 *   business behaviour, so the census reports them separately as `bootstrap` instead of as gaps
 *   a baseline leaf would have to explain (spec baseline-slice-2 C1/C2).
 * Public surface: {@link NON_BUSINESS_SYMBOLS}.
 * Invariants:
 *   - One list, read by the census walker only; coverage never needs to know the names.
 *   - An entry is either a bare enclosing-symbol name (`loadLoreApp`) or `<file>#<symbol>` with the
 *     file relative to the census rootDir, `/`-separated.
 *   - Adding a symbol here removes its sites from every leaf's obligations: only app wiring and
 *     config loading belong, never a function that decides a business outcome.
 * Side-effect class: pure (constant).
 */

/** Enclosing symbols whose own failure sites are reported as `bootstrap`, never as gaps; the census does not descend past them. */
export const NON_BUSINESS_SYMBOLS: readonly string[] = [
  // app wiring
  "packages/lore/src/adapters/cli/loader.ts#loadLoreApp",
  "packages/lore/src/app.ts#createApp",
  // config loading
  "packages/core/src/config-node.ts#loadConfig",
  "packages/core/src/config-node.ts#loadGlobalConfig",
  "packages/core/src/config.ts#loadConfigFromString",
  "packages/core/src/config.ts#parseConfig",
  "packages/core/src/config.ts#resolveSyncCredentials",
  // AI-provider registry assembly at app start
  "packages/lore/src/ai/registry.ts#buildProviderRegistry",
  "packages/lore/src/ai/env-resolve.ts#resolveEnvInHeaders",
];
