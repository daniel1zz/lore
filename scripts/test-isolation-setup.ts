/**
 * Test-run marker setup (task-skill-implement-tg-4, AC-TG-2).
 *
 * Purpose: arm `LORE_TEST_SANDBOX=1` for every test process (and, by env
 * inheritance, every child process it spawns) so corpus resolution refuses this
 * repository's own `.lore/lore.db` — the rule holds without author discipline.
 * Public surface: none (import side effect). Registered in `vitest.config.ts`
 * `setupFiles` and `packages/lore/bunfig.toml` `[test] preload`.
 * Invariants: LORE_TEST_SANDBOX_REPO is the absolute checkout root derived from THIS
 * file's location (no git probe, no fallback); both variables are overwritten
 * unconditionally so an inherited stale value cannot weaken the guard.
 * Side-effect class: stateful (mutates process.env).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env["LORE_TEST_SANDBOX"] = "1";
process.env["LORE_TEST_SANDBOX_REPO"] = resolve(dirname(fileURLToPath(import.meta.url)), "..");
