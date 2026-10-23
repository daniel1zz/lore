/**
 * check-outcome.mjs — every shipped hook records ONE outcome row per run (check id, pass|deny|error, time) so
 * `lore checks stats` can show whether a hook ever caught anything (spec-lean-governance-batch-verbs-judgment-only-
 * at-milestones Part D, AC-LG-13; BR-1373).
 *
 * Public surface: `trackOutcome(checkId)`, `markDeny()`, `outcomesFilePath(env, home)`.
 * Side-effect class: one synchronous append to a local JSONL file when the process exits.
 *
 * ## Invariants
 *   - No new process per hook run: the row is one `appendFileSync` from the exit handler. `lore checks stats`
 *     ingests the file (it renames it away first, so concurrent ingests never double count).
 *   - Outcome: exit code 2, or `markDeny()` called (a hook that blocks with JSON and exits 0) -> `deny`; exit 0 ->
 *     `pass`; any other exit code (a crash, an uncaught exception) -> `error`.
 *   - Recording NEVER changes a hook's verdict or exit code: a write failure is swallowed on purpose (a gate that
 *     fails open or closed because its own bookkeeping failed would be worse than one missing row).
 *   - The file is `<state base>/check-outcomes.jsonl`, the state base being `turn-state.mjs::getStateBase`'s
 *     directory; `packages/lore/src/service/check-stats-service.ts::hookOutcomesFilePath` is the reading side and a
 *     test pins both to the same path.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/**
 * @param {Record<string, string | undefined>} env - Process environment.
 * @param {string} home - Home directory.
 * @returns {string} Absolute path of the outcomes file.
 */
export function outcomesFilePath(env, home) {
  const override = env.CLAUDE_STATE_BASE_OVERRIDE;
  const base = override !== undefined && override !== '' ? override : join(home, '.claude', 'session-state');
  return join(base, 'check-outcomes.jsonl');
}

let denied = false;
let registered = false;

/** Marks this run as a deny for a hook that blocks through JSON output and still exits 0. */
export function markDeny() {
  denied = true;
}

/**
 * Registers the exit handler that appends this run's outcome row. Call once, at the top of the hook.
 *
 * @param {string} checkId - Stable id, `hook:<file name without .mjs>`.
 */
export function trackOutcome(checkId) {
  if (registered) return;
  registered = true;
  process.on('exit', (code) => {
    const outcome = denied || code === 2 ? 'deny' : code === 0 ? 'pass' : 'error';
    try {
      const path = outcomesFilePath(process.env, homedir());
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify({ check: checkId, outcome, ts: new Date().toISOString() })}\n`);
    } catch {
      // reason: bookkeeping must never change a hook's verdict (see the module invariants above).
    }
  });
}
