/**
 * Bun preload that freezes the wall clock for a spawned `lore` process (test-only fixture).
 *
 * Why: `lore status` has no clock-injection flag or env var today (it reads `Date.now()`), yet
 * AC-RID-11 needs a window edge that is hit to the millisecond. Preloading this file
 * (`bun --preload <this> run <entry> ...`) pins `Date.now()` and `new Date()` to the instant in
 * `LORE_TEST_FROZEN_NOW` (ISO-8601), independent of how the implementation obtains "now"
 * (injected Clock backed by Date.now, or `new Date()`). Explicit-argument `new Date(x)` is untouched.
 */
const frozen = process.env.LORE_TEST_FROZEN_NOW;
if (frozen) {
  const frozenMs = new Date(frozen).getTime();
  if (Number.isNaN(frozenMs)) throw new Error(`LORE_TEST_FROZEN_NOW is not a date: ${frozen}`);
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(frozenMs);
      else super(...(args as [number]));
    }
    static override now(): number {
      return frozenMs;
    }
  }
  globalThis.Date = FrozenDate as unknown as DateConstructor;
}
