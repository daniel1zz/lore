#!/usr/bin/env node
/**
 * stop-handoff-coverage.mjs — Stop hook. A blind pipe: it relays, it never
 * decides.
 *
 * Purpose: hand the Stop payload's two authoritative read channels to
 * `lore handoff coverage-check` and report back exactly what that verb said —
 * its stdout, its stderr, and its exit status, all verbatim.
 *
 * Public surface: none. This file is an executable script with no exports.
 * Side-effect class: IO — reads stdin, spawns one child process, writes both
 * output channels, sets the process exit status.
 *
 * ## Flow
 *
 *   1. unreadable / empty / non-object stdin -> fail loud (see below)
 *   2. `stop_hook_active === true` -> exit 0 silent (loop prevention, exactly
 *      as `stop-doc-sync.mjs` does)
 *   3. forward `transcript_path` + `last_assistant_message` to the verb on its
 *      stdin, then relay its three results verbatim
 *
 * ## Invariant: this file holds no grammar
 *
 * spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D9. No item-id
 * format, no accounting tokens, no matching logic, no notion of what "covered"
 * means. All of that lives in the verb, which is its sole owner, and is
 * identity-assertable there in tests against the exported values in
 * `packages/core/src/session.ts`.
 *
 * reason: an installed copy of this file cannot be identity-asserted against
 * those exported values — it drifts from the binary independently, which is the
 * exact defect class SPEC-083 retired for governance prose. A re-implementation
 * of the matcher here would also be the second implementation that spec's D8
 * exists to prevent (the binary parses a format the binary emitted). The
 * governing acceptance criterion AC-RC-10 pins the property mechanically: a
 * zero-hit search over this source for every grammar value the barrel exports.
 * Do not "helpfully" pre-filter, short-circuit, or explain the verb's verdict
 * here — that would reintroduce the grammar this file is defined by not having.
 *
 * ## Invariant: a fault of this hook's own is never reported as exit 0
 *
 * Deliberate divergence from `stop-doc-sync.mjs`'s fail-silent posture. Spec D7
 * names the failure mode directly: a hook that exits 0 because it crashed early
 * is indistinguishable from one that exits 0 because the accounting was
 * complete. So every fault path here writes a diagnostic naming this file and
 * exits non-zero. The stdin payload is required and is never guessed at: there
 * is no `?? {}` degradation, because forwarding a fabricated empty payload
 * would make the verb answer a question about a session it was never shown.
 *
 * The two forwarded fields are each genuinely optional at this boundary and are
 * passed through by presence, never defaulted — the verb owns what an absent
 * channel means (spec D6: no ticket, no obligation). Their asymmetry is the
 * verb's business too: `last_assistant_message` is probe-verified and final,
 * while the newest entry of `transcript_path` may not be flushed yet.
 *
 * @spec_ref spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D6, D7,
 *   D8, D9; AC-RC-10
 */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/** Resolved from `PATH` rather than an absolute path: the hook runs in the user's environment, and `PATH` resolution is also what lets AC-RC-10's relay half substitute a scripted stub. */
const VERB_BINARY = 'lore';

/** The verb this hook is a pipe for. It reads its own payload from stdin, which is why nothing here goes through argv. */
const VERB_ARGV = ['handoff', 'coverage-check'];

/** The Stop payload keys forwarded to the verb, in this order. Everything else in the payload is deliberately dropped — the pipe carries two channels, not a whole payload. */
const FORWARDED_KEYS = ['transcript_path', 'last_assistant_message'];

/**
 * Exit status for a fault of this hook's own, as opposed to a status relayed
 * from the verb.
 *
 * reason: non-zero, so such a fault can never be read as "the accounting was
 * complete" (spec D7). Deliberately not 2 — under the Stop-hook contract 2 is
 * the blocking status, and only the verb's own verdict, relayed verbatim, may
 * carry that meaning. Faults are told apart from relayed statuses by
 * `FAULT_STDERR_PREFIX`, never by the number.
 */
const FAULT_EXIT_CODE = 1;

/** Fixed, greppable attribution on every line this hook itself writes. Nothing the verb wrote is ever prefixed. */
const FAULT_STDERR_PREFIX = 'stop-handoff-coverage: ';

/**
 * Captured child output is bounded (a short verdict, not a stream), but the
 * ceiling is set explicitly anyway: `spawnSync`'s silent 1 MiB default
 * truncation is a measured false-oracle vector in this repo, and an overrun
 * surfaces as `error` below, which fails loud.
 */
const CHILD_OUTPUT_BYTE_CEILING = 16 * 1024 * 1024;

/**
 * Writes an attributed diagnostic and terminates non-zero. Never returns —
 * every call site below relies on that to stop the pipe.
 *
 * @param {string} reason - What went wrong, in operator-readable terms.
 * @returns {never}
 */
function failLoud(reason) {
  // CLI surface: a hook's only report channel is the process's own stderr.
  process.stderr.write(`${FAULT_STDERR_PREFIX}${reason}\n`);
  process.exit(FAULT_EXIT_CODE);
}

let rawStdin;
try {
  rawStdin = readFileSync(0, 'utf8');
} catch (cause) {
  failLoud(`could not read the Stop payload from stdin: ${String(cause)}`);
}

if (rawStdin.trim().length === 0) {
  failLoud('stdin was empty, but the Stop payload is required — refusing to ask the verb about a session it was never shown');
}

let payload;
try {
  payload = JSON.parse(rawStdin);
} catch (cause) {
  failLoud(`stdin is not valid JSON: ${String(cause)}`);
}

if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
  const shape = Array.isArray(payload) ? 'an array' : `a ${typeof payload}`;
  failLoud(`stdin parsed to ${shape}, but the Stop payload must be a JSON object`);
}

// Loop prevention, keyed on the value `true` and not on field presence —
// mirrors `stop-doc-sync.mjs`. Nothing is spawned on this path.
if (payload.stop_hook_active === true) process.exit(0);

const forwarded = {};
for (const key of FORWARDED_KEYS) {
  // Presence, not truthiness: an absent channel stays absent so the verb sees
  // the session as it really is. `Object.hasOwn` also keeps an inherited
  // prototype property from being mistaken for a real channel.
  if (Object.hasOwn(payload, key)) forwarded[key] = payload[key];
}

const relayed = spawnSync(VERB_BINARY, VERB_ARGV, {
  input: JSON.stringify(forwarded),
  stdio: ['pipe', 'pipe', 'pipe'],
  maxBuffer: CHILD_OUTPUT_BYTE_CEILING,
});

if (relayed.error) {
  failLoud(`could not run \`${VERB_BINARY} ${VERB_ARGV.join(' ')}\`: ${String(relayed.error)}`);
}

// Relay both channels before inspecting how the child terminated, so whatever
// the verb managed to say survives even an abnormal end. Buffers are written
// through unchanged — no re-encoding, no added newline, nothing appended.
if (relayed.stdout && relayed.stdout.length > 0) process.stdout.write(relayed.stdout);
if (relayed.stderr && relayed.stderr.length > 0) process.stderr.write(relayed.stderr);

if (relayed.signal !== null && relayed.signal !== undefined) {
  failLoud(`\`${VERB_BINARY} ${VERB_ARGV.join(' ')}\` was killed by signal ${relayed.signal} — its verdict is unknown`);
}

if (typeof relayed.status !== 'number') {
  failLoud(`\`${VERB_BINARY} ${VERB_ARGV.join(' ')}\` yielded no exit status to relay`);
}

process.exit(relayed.status);
