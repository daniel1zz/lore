#!/usr/bin/env node
/**
 * run-register.mjs — SessionStart / SubagentStart hook. A blind pipe: it hands
 * the payload's identifiers to `lore run register` and never decides anything.
 *
 * Purpose: register the run this session (or helper agent) is, so later writes
 * can be attributed to it (BR-1027, BR-1029).
 *
 * Public surface: none. Executable script, no exports.
 * Side-effect class: IO — reads stdin, spawns one child process, writes at most
 * one stdout line, always exits 0.
 *
 * ## Flow
 *
 *   1. stdin must be a JSON object with a string `session_id`, else report
 *      "malformed" (lore is not spawned: there is no session to register)
 *   2. spawn `lore run register --harness claude-code --session S --harness-pid <ppid>`
 *      (the harness process that spawned this hook; AC-AU-5), plus
 *      `--agent-id A --agent-type T` when the payload carries a string
 *      `agent_id` (SubagentStart); on SessionStart only, `--messaging-socket <raw path>` when the environment
 *      variable CLAUDE_CODE_MESSAGING_SOCKET is non-empty (BR-1360)
 *   3. success -> print nothing; failure -> print ONE hook-JSON line whose
 *      additionalContext names the failure
 *
 * ## Invariant: fail-open and loud (spec D7, BR-1030)
 *
 * Exit status is 0 on every path, so a registration fault can never block a
 * session or a helper. The fault is not swallowed: the single additionalContext
 * line tells the session why its writes will be refused (a write naming an
 * unregistered run is refused, never recorded unattested).
 *
 * ## Invariant: this file holds no grammar (spec D10)
 *
 * Run-id derivation, parent linkage, fragment composition and the messaging-address grammar (`uds:<path>`)
 * belong to the `lore run register` verb. This file only forwards the identifiers it was given, the socket path
 * included, raw.
 *
 * @spec_ref spec-run-identity-slice-1-harness-attested-runs-attested D7, D10;
 *   AC-RID-3
 */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { trackOutcome, noteHookCwd } from './lib/check-outcome.mjs';
trackOutcome('hook:run-register');

/** Resolved from `PATH`: the hook runs in the user's environment, and this is what lets tests substitute a stub. */
const VERB_BINARY = 'lore';

/** The harness name the verb records; fixed by the claude-code integration this hook belongs to. */
const HARNESS = 'claude-code';

/** Event name used in the output envelope when the payload does not name one. */
const DEFAULT_EVENT_NAME = 'SessionStart';

/** Captured child output is only inspected for its status; the ceiling is explicit so an overrun surfaces as `error`, not silent truncation. */
const CHILD_OUTPUT_BYTE_CEILING = 16 * 1024 * 1024;

/**
 * Prints the single fail-open line and exits 0. Never returns.
 *
 * @param {string} eventName - Hook event name for the envelope.
 * @param {string} reason - One-line failure description (newlines are flattened).
 * @returns {never}
 */
function reportAndExit(eventName, reason) {
  const text = `run-register: ${reason}; this run's writes will be refused until it is registered (see \`lore setup\`)`.replace(/\s*[\r\n]+\s*/g, ' ');
  process.stdout.write(
    `${JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } })}\n`,
  );
  process.exit(0);
}

let payload;
try {
  payload = noteHookCwd(JSON.parse(readFileSync(0, 'utf8')));
} catch (cause) {
  reportAndExit(DEFAULT_EVENT_NAME, `malformed hook payload on stdin (${String(cause)})`);
}

if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
  reportAndExit(DEFAULT_EVENT_NAME, 'malformed hook payload on stdin (expected a JSON object)');
}

const eventName = typeof payload.hook_event_name === 'string' ? payload.hook_event_name : DEFAULT_EVENT_NAME;

if (typeof payload.session_id !== 'string' || payload.session_id === '') {
  reportAndExit(eventName, 'malformed hook payload on stdin (no string session_id)');
}

// reason: process.ppid is the process that spawned this hook — the harness (AC-AU-5). It is forwarded as a bare
// number: `lore run register` resolves it past a shell wrapper, probes its start time and records both, so that
// `lore run reap` can prove the run dead. No decision is made here (D10).
const argv = ['run', 'register', '--harness', HARNESS, '--session', payload.session_id, '--harness-pid', String(process.ppid)];
if (typeof payload.agent_id === 'string') {
  argv.push('--agent-id', payload.agent_id);
  if (typeof payload.agent_type === 'string') argv.push('--agent-type', payload.agent_type);
}

// reason: BR-1360 — only the main run (SessionStart) carries an address; a subagent shares its session's socket and
// registers none. The path is forwarded raw: the `uds:` grammar is the verb's (D10 above). Unset or empty -> no flag,
// which makes the register clear any previously stored address.
const messagingSocket = process.env.CLAUDE_CODE_MESSAGING_SOCKET;
if (typeof payload.agent_id !== 'string' && typeof messagingSocket === 'string' && messagingSocket !== '') {
  argv.push('--messaging-socket', messagingSocket);
}

const child = spawnSync(VERB_BINARY, argv, {
  stdio: ['ignore', 'pipe', 'pipe'],
  maxBuffer: CHILD_OUTPUT_BYTE_CEILING,
  encoding: 'utf8',
});

if (child.error) {
  const code = /** @type {NodeJS.ErrnoException} */ (child.error).code;
  reportAndExit(
    eventName,
    code === 'ENOENT'
      ? `\`${VERB_BINARY}\` not found on PATH`
      : `could not run \`${VERB_BINARY} run register\` (${String(child.error)})`,
  );
}

if (typeof child.status !== 'number') {
  reportAndExit(eventName, `\`${VERB_BINARY} run register\` was killed by signal ${child.signal}`);
}

if (child.status !== 0) {
  const detail = (child.stderr ?? '').trim().split(/\r?\n/)[0] ?? '';
  reportAndExit(
    eventName,
    `\`${VERB_BINARY} run register\` failed with exit ${child.status}${detail === '' ? '' : `: ${detail}`}`,
  );
}

process.exit(0);
