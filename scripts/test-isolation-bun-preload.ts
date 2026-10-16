/**
 * Bun half of the test-run marker (task-skill-implement-tg-4, AC-TG-2).
 *
 * Purpose: verify, then arm, the LORE_TEST_SANDBOX guard for `bun test` from packages/lore.
 * Why a verify step: under bun, children spawned WITHOUT an explicit `env` (node:child_process
 * spawnSync/execFileSync AND Bun.spawnSync) inherit the STARTUP environment, not later
 * `process.env` mutations — so a preload that only sets variables leaves most spawned
 * `dist/lore` children unguarded (measured on bun 1.3.10). `packages/lore/.env.test`
 * (auto-loaded by `bun test` into the startup environment) carries the real marker; this
 * preload FAILS LOUD when the startup env lacks it or names a different repo root than the
 * one derived from this file's location, then delegates to `test-isolation-setup.ts`
 * (which normalises LORE_TEST_SANDBOX_REPO for in-process readers).
 *
 * Invariants: throws (aborts the bun run) on a missing/disagreeing startup marker.
 * Side-effect class: stateful (mutates process.env via the delegated setup).
 */
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const derivedRepoRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const startupMarker = process.env["LORE_TEST_SANDBOX"];
const startupRepo = process.env["LORE_TEST_SANDBOX_REPO"];

if (startupMarker !== "1") {
  throw new Error(
    `test-isolation-bun-preload: LORE_TEST_SANDBOX is ${JSON.stringify(startupMarker ?? null)} in the bun startup ` +
      `environment, expected "1". packages/lore/.env.test must be loaded (run \`bun test\` with cwd packages/lore) — ` +
      `without it spawned children would run unguarded against this repository's corpus.`,
  );
}
if (startupRepo === undefined || startupRepo === "" || realpathSync(startupRepo) !== derivedRepoRoot) {
  throw new Error(
    `test-isolation-bun-preload: LORE_TEST_SANDBOX_REPO is ${JSON.stringify(startupRepo ?? null)} in the bun startup ` +
      `environment but this checkout's root is ${JSON.stringify(derivedRepoRoot)}. packages/lore/.env.test derives it ` +
      `from \${PWD}; run \`bun test\` from a shell whose PWD is packages/lore.`,
  );
}

await import("./test-isolation-setup.js");
