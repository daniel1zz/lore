/**
 * The worker count of the one test runner (TG-15, AC-TG-11): single source for vitest.shared.ts
 * (which applies it) and scripts/measure-test-wall.ts (which prints it).
 * Pure: no side effects at import, so a script can import it without arming a vitest run.
 */

export const DEFAULT_MAX_WORKERS = 4;

/** `VITEST_MAX_WORKERS` (a positive integer) overrides the default; anything else set there is an error, never ignored. */
export function resolveMaxWorkers(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env.VITEST_MAX_WORKERS;
  if (raw === undefined || raw === "") return DEFAULT_MAX_WORKERS;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`VITEST_MAX_WORKERS must be a positive integer, got ${JSON.stringify(raw)}`);
  return Number(raw);
}
