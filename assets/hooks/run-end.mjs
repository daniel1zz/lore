#!/usr/bin/env node
/**
 * run-end.mjs — SessionEnd / SubagentStop hook. A blind pipe to
 * `lore run end <run-id> --reason <r>`: it ends the run this session (or
 * helper agent) is, so the run's claims are released (BR-1059).
 *
 * Public surface: none. Executable script, no exports.
 * Side-effect class: IO — reads stdin, spawns one child process, writes at
 * most one stderr line, ALWAYS exits 0.
 *
 * ## Flow
 *
 *   1. stdin JSON object -> run id via `lib/run-id.mjs` (SessionEnd: `cc:S`;
 *      SubagentStop: `cc:S:A`, the id `run-register.mjs` registered)
 *   2. reason = SessionEnd `reason`, or `subagent-stop` for SubagentStop
 *   3. spawn `lore run end <id> --reason <r>`; `lore run end` on an unknown id
 *      exits 0 and writes nothing, so internal agents pass through safely
 *
 * ## Invariant: never block the harness
 *
 * Every failure (malformed payload, lore absent, non-zero exit, signal) is
 * one stderr line and exit 0. SessionEnd has no decision control, so there is
 * nothing to return; the registered `timeout` bounds the child.
 */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { deriveClaudeCodeRunId } from './lib/run-id.mjs';

/** Resolved from `PATH`, same as run-register.mjs; lets tests substitute a stub. */
const VERB_BINARY = 'lore';

/** Reason recorded when the payload carries none (SubagentStop has no `reason` field). */
const SUBAGENT_REASON = 'subagent-stop';

/** Explicit ceiling so an overrun surfaces as `error`, not silent truncation. */
const CHILD_OUTPUT_BYTE_CEILING = 16 * 1024 * 1024;

/**
 * Prints one stderr line and exits 0. Never returns.
 *
 * @param {string} reason - One-line description (newlines are flattened).
 * @returns {never}
 */
function failOpen(reason) {
  process.stderr.write(`run-end: ${reason}; run not ended by hook\n`.replace(/\s*[\r\n]+\s*(?=.)/g, ' '));
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(readFileSync(0, 'utf8'));
} catch (cause) {
  failOpen(`malformed hook payload on stdin (${String(cause)})`);
}
if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
  failOpen('malformed hook payload on stdin (expected a JSON object)');
}

let runId;
try {
  runId = deriveClaudeCodeRunId(payload);
} catch (cause) {
  failOpen(`malformed hook payload on stdin (${cause instanceof Error ? cause.message : String(cause)})`);
}

const isSubagent = typeof payload.agent_id === 'string';
const reason = isSubagent
  ? SUBAGENT_REASON
  : typeof payload.reason === 'string' && payload.reason !== ''
    ? payload.reason
    : 'other';

const child = spawnSync(VERB_BINARY, ['run', 'end', runId, '--reason', reason], {
  stdio: ['ignore', 'pipe', 'pipe'],
  maxBuffer: CHILD_OUTPUT_BYTE_CEILING,
  encoding: 'utf8',
});

if (child.error) {
  const code = /** @type {NodeJS.ErrnoException} */ (child.error).code;
  failOpen(code === 'ENOENT' ? `\`${VERB_BINARY}\` not found on PATH` : `could not run \`${VERB_BINARY} run end\` (${String(child.error)})`);
}
if (typeof child.status !== 'number') {
  failOpen(`\`${VERB_BINARY} run end\` was killed by signal ${child.signal}`);
}
if (child.status !== 0) {
  const detail = (child.stderr ?? '').trim().split(/\r?\n/)[0] ?? '';
  failOpen(`\`${VERB_BINARY} run end\` failed with exit ${child.status}${detail === '' ? '' : `: ${detail}`}`);
}

process.exit(0);
