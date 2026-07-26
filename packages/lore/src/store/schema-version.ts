/**
 * `LATEST_SCHEMA_VERSION` — a bare constant, deliberately isolated in its own
 * module with NO `bun:sqlite` import.
 *
 * Public surface: `LATEST_SCHEMA_VERSION` only.
 *
 * Invariants:
 *   - This module MUST NOT import `bun:sqlite` (directly or transitively) —
 *     its sole purpose is to let vitest-reachable code (SPEC-072
 *     `probeUpstreamDb` and its pure callers, e.g. `matchRootPrd`'s upstream
 *     caller) read the schema-version ceiling without dragging `bun:sqlite`
 *     into the vitest module graph (that import is externalized for vitest,
 *     `vitest.config.ts`, and any file that touches it must run under `bun
 *     test` instead).
 *   - The value MUST equal the highest migration number in
 *     `sqlite-store.ts::runMigrations`'s `if (currentVersion < N)` chain.
 *     Confirmed by reading that chain directly (as of migration-009): the
 *     chain runs `< 1` through `< 9`, so the ceiling is 9.
 *   - Bump this constant in the SAME commit that adds a new `migration-NNN`
 *     and its corresponding `if (currentVersion < NNN)` branch — the two are
 *     the same fact stated twice (migration chain ceiling vs. the value
 *     SPEC-072's version-skew check compares an upstream corpus's
 *     `PRAGMA user_version` against) and must never drift apart.
 *   - `sqlite-store.ts` re-exports this constant beside the migration chain
 *     it describes (`export { LATEST_SCHEMA_VERSION } from "./schema-version.js"`)
 *     so existing bun-only callers keep importing it from the same module
 *     they already import `SQLiteStore` from.
 *
 * Side-effect class: pure (a single literal).
 *
 * Source: SPEC-072 §3 Structure, §Public Interface (flows/upstream-probe.ts
 * JSDoc: "expectedSchemaVersion").
 */

/** The SQLite corpus schema's current migration ceiling (highest applied `migration-NNN`). */
export const LATEST_SCHEMA_VERSION = 9;
