#!/usr/bin/env node
/**
 * post-ask-decide.mjs — PostToolUse hook on AskUserQuestion. A blind pipe to `lore decide --from-harness`: when the
 * human answers a question that `lore pending --ask` wrote (BR-1374), lore verifies the question against what it issued
 * and records the decision. The hook never reads, builds or judges an answer itself.
 *
 * Public surface: none. Executable script, no exports.
 * Side-effect class: IO — reads stdin, spawns at most one child process, prints one line per question on stdout.
 *
 * ## Flow
 *
 *   1. stdin payload (PostToolUse: session_id, cwd, tool_name, tool_input.questions[], tool_response.answers, tool_use_id)
 *   2. a payload that does not mention a lore decision question is none of lore's business: no child, no output
 *   3. otherwise spawn `lore decide --from-harness` in the payload's cwd with the payload verbatim on stdin
 *   4. lore's stdout (one line per question) is passed on; its stderr (a refusal names BR-1374) is passed on
 *
 * ## Invariant: never block the harness
 *
 * The tool has already run, so there is nothing to deny: every failure (malformed payload, lore absent, non-zero exit,
 * signal) is stderr text and exit 0. A refusal by lore is stderr text, never a thrown error here.
 */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { trackOutcome, noteHookCwd } from './lib/check-outcome.mjs';
trackOutcome('hook:post-ask-decide');

/** Resolved from `PATH`, same as run-end.mjs; lets tests substitute a shim. */
const VERB_BINARY = 'lore';

/** Text every lore-written question starts with (`service/harness-ask.ts::ASK_DECISION_MARKER`). */
const LORE_QUESTION_MARKER = 'Lore decision #';

/** Explicit ceiling so an overrun surfaces as an error, not silent truncation. */
const CHILD_OUTPUT_BYTE_CEILING = 16 * 1024 * 1024;

/**
 * Prints one stderr line and exits 0. Never returns.
 *
 * @param {string} reason - One-line description (newlines are flattened).
 * @returns {never}
 */
function failOpen(reason) {
  process.stderr.write(`post-ask-decide: ${reason}; no decision recorded by hook\n`.replace(/\s*[\r\n]+\s*(?=.)/g, ' '));
  process.exit(0);
}

let raw;
let payload;
try {
  raw = readFileSync(0, 'utf8');
  payload = noteHookCwd(JSON.parse(raw));
} catch (cause) {
  failOpen(`malformed hook payload on stdin (${String(cause)})`);
}
if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
  failOpen('malformed hook payload on stdin (expected a JSON object)');
}

if (!raw.includes(LORE_QUESTION_MARKER)) process.exit(0);

const child = spawnSync(VERB_BINARY, ['decide', '--from-harness'], {
  input: raw,
  stdio: ['pipe', 'pipe', 'pipe'],
  maxBuffer: CHILD_OUTPUT_BYTE_CEILING,
  encoding: 'utf8',
  ...(typeof payload.cwd === 'string' && payload.cwd !== '' ? { cwd: payload.cwd } : {}),
});

if (child.error) {
  const code = /** @type {NodeJS.ErrnoException} */ (child.error).code;
  failOpen(code === 'ENOENT' ? `\`${VERB_BINARY}\` not found on PATH` : `could not run \`${VERB_BINARY} decide --from-harness\` (${String(child.error)})`);
}
if (typeof child.status !== 'number') {
  failOpen(`\`${VERB_BINARY} decide --from-harness\` was killed by signal ${child.signal}`);
}
if (child.stdout) process.stdout.write(child.stdout);
if (child.stderr) process.stderr.write(child.stderr);
process.exit(0);
