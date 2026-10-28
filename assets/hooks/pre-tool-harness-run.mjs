#!/usr/bin/env node
/**
 * pre-tool-harness-run.mjs — PreToolUse hook. A blind pipe: it decides only
 * whether a call is worth asking about, then relays the verb's answer verbatim.
 *
 * Purpose: let `lore run attest-input` vouch for the run behind every lore call
 * (every Bash call).
 *
 * Public surface: none. Executable script, no exports.
 * Side-effect class: IO — reads stdin, spawns at most one child process, writes
 * the child's stdout, always exits 0.
 *
 * ## Flow
 *
 *   1. unparseable stdin -> exit 0 silently, nothing spawned
 *   2. trigger test on the payload alone: tool `Bash` whose `tool_input.command`
 *      is a string; otherwise exit 0 silently, nothing spawned
 *   3. spawn `lore run attest-input` with the raw stdin bytes piped in; on exit
 *      0 write its stdout byte-for-byte; on any failure write nothing
 *
 * ## Invariant: this file holds no grammar (spec D10)
 *
 * The per-call `LORE_HARNESS_RUN` export, the run id, and the shape of the updated input all belong
 * to the verb. This hook neither builds nor inspects its output, and it never
 * adds a permission decision of its own (spec D12): a relayed answer is exactly
 * what the verb printed.
 *
 * ## Invariant: fail-open (spec D7)
 *
 * Every fault — bad stdin, lore absent, non-zero child — exits 0 with nothing
 * on stdout, so the tool call proceeds without the run export; a lore write in it carries no
 * run and is then refused (no known party).
 * A failed child's stdout is never relayed, since it may be partial.
 *
 * @spec_ref spec-run-identity-slice-1-harness-attested-runs-attested D7, D10,
 *   D12; AC-RID-3
 */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { trackOutcome, noteHookCwd } from './lib/check-outcome.mjs';
trackOutcome('hook:pre-tool-harness-run');

/** Resolved from `PATH`, as for the other blind-pipe hooks. */
const VERB_BINARY = 'lore';

/** The verb this hook pipes to; it reads the payload from stdin. */
const VERB_ARGV = ['run', 'attest-input'];

/** Tool whose every call carries the per-call run export (spec D14): no command text is inspected. */
const SHELL_TOOL_NAME = 'Bash';


/** Explicit ceiling so an overrun surfaces as `error` (fail-open) rather than silent truncation. */
const CHILD_OUTPUT_BYTE_CEILING = 16 * 1024 * 1024;

let rawStdin;
try {
  rawStdin = readFileSync(0);
} catch {
  process.exit(0);
}

let payload;
try {
  payload = noteHookCwd(JSON.parse(rawStdin.toString('utf8')));
} catch {
  process.exit(0);
}

if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) process.exit(0);

const toolName = payload.tool_name;
const command = payload.tool_input?.command;
const triggered =
  toolName === SHELL_TOOL_NAME && typeof command === 'string';

if (!triggered) process.exit(0);

const child = spawnSync(VERB_BINARY, VERB_ARGV, {
  input: rawStdin,
  stdio: ['pipe', 'pipe', 'ignore'],
  maxBuffer: CHILD_OUTPUT_BYTE_CEILING,
});

if (child.error || child.status !== 0) process.exit(0);

if (child.stdout && child.stdout.length > 0) process.stdout.write(child.stdout);
process.exit(0);
