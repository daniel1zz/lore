/**
 * `LATEST_SCHEMA_VERSION` — a bare constant, deliberately isolated in its own
 * module with NO `bun:sqlite` import.
 *
 * Public surface: `LATEST_SCHEMA_VERSION` only.
 *
 * Invariants:
 *   - This module MUST NOT import `bun:sqlite` (directly or transitively) —
 *     its sole purpose is to let a `bun:sqlite`-free import site read the
 *     schema-version ceiling without dragging `bun:sqlite` into the vitest
 *     module graph (that import is externalized for vitest,
 *     `vitest.config.ts`, and any file that touches it must run under `bun
 *     test` instead).
 *   - The value MUST equal the highest migration number in
 *     `sqlite-store.ts::runMigrations`'s `if (currentVersion < N)` chain.
 *     Confirmed by reading that chain directly (as of migration-017): the
 *     chain runs `< 1` through `< 17`, so the ceiling is 17.
 *   - Bump this constant in the SAME commit that adds a new `migration-NNN`
 *     and its corresponding `if (currentVersion < NNN)` branch — the two are
 *     the same fact stated twice (migration chain ceiling vs. the value a
 *     readonly schema-version probe compares a corpus's own `PRAGMA
 *     user_version` against, e.g. `store/schema-probe.ts`'s
 *     `probeSchemaVersion` and its callers) and must never drift apart.
 *   - `sqlite-store.ts` re-exports this constant beside the migration chain
 *     it describes (`export { LATEST_SCHEMA_VERSION } from "./schema-version.js"`)
 *     so existing bun-only callers keep importing it from the same module
 *     they already import `SQLiteStore` from.
 *
 * Side-effect class: pure (a single literal).
 *
 * Source: SPEC-078 D2 (`mount/mount-registry.ts`'s schema-version probe,
 * `store/schema-probe.ts::probeSchemaVersion` — relocated in P4 of
 * spec-the-defect-channel-reaches-no-machine-but-its-own-github from the
 * now-deleted SPEC-072-specific `flows/` module this constant was
 * originally sited alongside).
 */

/** The SQLite corpus schema's current migration ceiling (highest applied `migration-NNN`; 049 = judge_verdicts (the judge's raw per-unit answer under the sha256 key of the unit's inputs, reused by a re-review); 048 = review_judgments.template_ref + missing_dimensions, review_judgment_dimensions and the template revision / proposal tables (judging per template dimension); 047 = every suite_file_runs row classified red/green/inconclusive (old failing rows inconclusive `unclassified`), single-file unique index over conclusive rows only; 046 =docs.type accepts 'template' (structured-document templates); 045 =single-file runs unique per (key, file) via a partial unique index on suite_file_runs; 044 = stored suite results whose command exited outside {0,1} (the tests never ran) marked unrunnable; 043 = suite_results + suite_file_runs (one full-suite result per commit, append-only, plus per-file re-runs attached to it); 042 = ac_exemptions.decision + ac_exemptions.harness_run (an exemption keeps its DecisionRecord and the writer's run, NULL when none); 041 = versions.decision (a decision-carrying write's DecisionRecord as JSON, NULL when none); 040 = released pre-#356 claims without a tip marked unrecoverable; 039 = landing kind and claim start_head back-filled, then required). */
export const LATEST_SCHEMA_VERSION = 49;
