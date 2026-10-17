/**
 * The worker count of the one test runner (TG-15, AC-TG-11): single source for vitest.shared.ts
 * (which applies it) and scripts/measure-test-wall.ts (which prints it).
 * Pure: no side effects at import, so a script can import it without arming a vitest run.
 *
 * Why one fork per CPU, capped at 8 (measured 2026-10-17, M1 Pro 8 CPUs, whole run under other agents'
 * load of 5-17): 4 workers = 732 s, 8 workers = 538 s. The old cap of 4 existed because every test spawned
 * `bun run` subprocesses and starved; TG-24/25/26 build dist/lore once and run command logic in-process,
 * so a worker is now mostly CPU-bound and one per core is the useful limit. The cap bounds memory
 * (each fork carries up to the 1.5 GB heap of vitest.shared.ts) on bigger machines.
 */
import { availableParallelism } from "node:os";

export const MAX_WORKERS_CAP = 8;

export const DEFAULT_MAX_WORKERS = Math.max(1, Math.min(availableParallelism(), MAX_WORKERS_CAP));

/** `VITEST_MAX_WORKERS` (a positive integer) overrides the default; anything else set there is an error, never ignored. */
export function resolveMaxWorkers(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env.VITEST_MAX_WORKERS;
  if (raw === undefined || raw === "") return DEFAULT_MAX_WORKERS;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`VITEST_MAX_WORKERS must be a positive integer, got ${JSON.stringify(raw)}`);
  return Number(raw);
}
