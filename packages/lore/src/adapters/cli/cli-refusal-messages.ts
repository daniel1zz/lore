/**
 * Runtime message clauses of CLI refusals and notices that tests (and callers) assert on.
 *
 * Why this module exists: a test that pins a whole product sentence breaks on every
 * rewording that changes no behaviour. Each clause below is the SINGLE definition the
 * command renders AND the test imports, so a reword moves both together while removing the
 * rule (the refusal itself) still turns the test red. Pure constants, no imports, so
 * vitest-safe (the command files themselves import `loader.ts`, which is bun-only).
 *
 * Clauses a user or script copies verbatim (remedy commands such as `lore anchor rm ...`)
 * are CONTRACTS and stay as literals in their tests; they are not defined here.
 */

/** `lore feed task-start` with no positional (exit 2). Rendered as "Error: `lore feed task-start <task>` <clause>." */
export const FEED_TASK_START_MISSING_TARGET = "requires a task document ID or slug";

/** `lore feed phase-start` with no positional (exit 2). */
export const FEED_PHASE_START_MISSING_TARGET = "requires a phase document ID or slug";

/** `lore list --governed-by` combined with another filter (exit 2). Followed by the conflicting flags. */
export const LIST_GOVERNED_BY_CONFLICT = "--governed-by cannot be combined with";

/** `lore verify` stdout when every in-scope AC is ai/human-mode, so nothing executes (exit 0). */
export const VERIFY_NO_SCRIPT_ACS = "No script-mode acceptance criteria to run";

/** `lore assess` stderr warning when commit derivation found no commits for the plan's tasks. */
export const ASSESS_NO_COMMITS_DERIVED = "could not derive any commits";

/** `lore assess` stderr warning clause naming why the stored assessment is stale. */
export const ASSESS_NEWER_TASK_ACTIVITY = "newer task activity was recorded at";
