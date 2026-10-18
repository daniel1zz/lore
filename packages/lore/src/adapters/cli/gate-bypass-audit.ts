/**
 * `LORE_GATE_BYPASS=1` escape-hatch observability (SPEC-080 G4) — the decision
 * logic behind `commands/gate.ts`'s env-bypass audit trace, split into this
 * sibling module for the SAME reason `assess-render.ts`/`review-render.ts` are
 * split out (`../../CLAUDE.md`'s testability-split pattern): `commands/gate.ts`
 * transitively imports `loader.ts` (`bun:sqlite` via `app.ts`), which vitest
 * cannot resolve, but this file imports only `@lore/core`/`@lore/core/node` +
 * `corpus-resolution.js` (also vitest-safe, no `bun:sqlite`), so
 * `tests/integration/cli/gate-bypass-audit.test.ts` can exercise the decision
 * logic directly.
 *
 * Public surface:
 *   - GateBypassAuditDeps — injected port shape (`openRecordGateSkip`)
 *   - runGateEnvBypassAudit(checkpoint, deps) — attempt-write-or-degrade logic
 *   - findLoreDbPathQuiet() — RE-EXPORTED from `./corpus-resolution.js`
 *     (spec-corpus-resolution-carries-provenance-and-a-foreign-write §D3/§D6
 *     genuinely relocated it there — this module no longer declares it
 *     itself, only re-exports, so `commands/gate.ts`'s existing import site
 *     stays untouched). Same terminal contract as before: `undefined` on a
 *     miss, never `process.exit` — the bypass path's exit-0 guarantee
 *     (SPEC-080 D3) must survive an absent corpus.
 *
 * @invariant D1/D3 (SPEC-080 §Design Decisions) — this module NEVER changes the
 *   bypass's outcome. `runGateEnvBypassAudit` never throws and never rejects:
 *   every failure mode (the injected port itself throwing/rejecting, resolving
 *   `null` for "corpus unreachable", or the write settling with `Result.err`)
 *   degrades to exactly one `gate bypass NOT audited: <reason>` stderr line.
 *   `commands/gate.ts`'s caller unconditionally sets `process.exitCode = 0`
 *   immediately after awaiting this function, regardless of what happened here.
 *
 * Side-effect class: IO (`findLoreDbPathQuiet`'s own IO via `corpus-
 *   resolution.js`, the injected port's own IO, one `process.stderr.write` on
 *   failure) — never `process.exit`, never a thrown/rejected promise escaping
 *   this module.
 *
 * Source: SPEC-080 §Scope, §Design Decisions D1/D3; AC-080-2.
 */

import type { Invocation } from "@lore/core";
import {
  buildGateSkipAuditEntry,
  describeLoreError,
  describeThrown,
  type RecordGateSkip,
} from "../../service/gate-enforcer.js";
import type { GateCheckpoint } from "../../service/checkpoint-registry.js";

export { findLoreDbPathQuiet } from "./corpus-resolution.js";

/**
 * Injected port for the ONE piece of this module's decision logic that needs
 * real corpus IO — resolving a `RecordGateSkip` function bound to the live
 * store, or `null` when the corpus can't be reached (no `.lore/lore.db`
 * discoverable, or the store failed to open — e.g. a corrupted file). A THROWN
 * error from this port is ALSO treated as "unreachable" by
 * `runGateEnvBypassAudit` (see its own doc comment) — the port is free to
 * either throw or resolve `null`, both degrade identically.
 */
export interface GateBypassAuditDeps {
  openRecordGateSkip: () => Promise<RecordGateSkip | null>;
}

/**
 * Attempts to write ONE `gate_skipped` audit entry (mechanism `"env_bypass"`)
 * for `checkpoint` via `deps.openRecordGateSkip()`'s resolved port. Every
 * failure mode — the port throwing/rejecting, resolving `null`, or the write
 * itself settling with `Result.err` — degrades to a single
 * `gate bypass NOT audited: <reason>` stderr line; this function itself never
 * throws or rejects, so its caller can safely `await` it immediately before
 * setting `process.exitCode = 0` unconditionally (D3).
 *
 * @param checkpoint - Which checkpoint's `LORE_GATE_BYPASS=1` short-circuit
 *   this call is auditing.
 * @param inv - the running command's Invocation: its claimed name (resolved once at the entry) is the actor the
 *   audit row is attributed to — never an independent resolution (AS-26)
 * @param deps - Injected port (real wiring: `commands/gate.ts` opens a
 *   `SQLiteStore` over the discovered `.lore/lore.db`; tests inject a fake
 *   resolving/rejecting/throwing stand-in).
 * @example
 * await runGateEnvBypassAudit("task-claim", inv, {
 *   openRecordGateSkip: async () => store.appendAuditEntry.bind(store),
 * });
 * // => writes one gate_skipped/env_bypass entry, or prints the NOT-audited
 * //    stderr line on any failure — never throws either way.
 */
export async function runGateEnvBypassAudit(
  checkpoint: GateCheckpoint,
  inv: Invocation,
  deps: GateBypassAuditDeps,
): Promise<void> {
  let recordGateSkip: RecordGateSkip | null;
  try {
    recordGateSkip = await deps.openRecordGateSkip();
  } catch (error) {
    warnBypassNotAudited(describeThrown(error));
    return;
  }

  if (recordGateSkip === null) {
    warnBypassNotAudited("corpus unreachable");
    return;
  }

  const nowIso = new Date().toISOString();
  // reason: the invocation's claimed name (resolved once at the entry) — never an independent resolution.
  const actor = inv.identity.claimed;
  const entry = buildGateSkipAuditEntry(checkpoint, "env_bypass", nowIso, actor);

  try {
    const result = await recordGateSkip(entry);
    if (!result.ok) {
      warnBypassNotAudited(describeLoreError(result.error));
    }
  } catch (error) {
    warnBypassNotAudited(describeThrown(error));
  }
}

/** Single stderr-line formatter shared by every failure branch above (SPEC-080 D1). */
function warnBypassNotAudited(reason: string): void {
  process.stderr.write(`gate bypass NOT audited: ${reason}\n`); // CLI surface
}
