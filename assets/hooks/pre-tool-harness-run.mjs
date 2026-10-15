#!/usr/bin/env node
/**
 * pre-tool-harness-run.mjs — PreToolUse hook. A blind pipe: it decides only
 * whether a call is worth asking about, then relays the verb's answer verbatim.
 *
 * Purpose: let `lore run attest-input` vouch for the run behind every lore call
 * (Bash `lore ...` or an `mcp__<server>__lore_<verb>` tool).
 *
 * Public surface: none. Executable script, no exports.
 * Side-effect class: IO — reads stdin, spawns at most one child process, writes
 * the child's stdout, always exits 0.
 *
 * ## Flow
 *
 *   1. unparseable stdin -> exit 0 silently, nothing spawned
 *   2. trigger test on the payload alone: tool `Bash` whose `tool_input.command`
 *      contains the word lore, or a tool name shaped `mcp__<server>__lore_<verb>`;
 *      otherwise exit 0 silently, nothing spawned
 *   3. spawn `lore run attest-input` with the raw stdin bytes piped in; on exit
 *      0 write its stdout byte-for-byte; on any failure write nothing
 *
 * ## Invariant: this file holds no grammar (spec D10)
 *
 * The flag spelling, the run id, and the shape of the rewritten input all belong
 * to the verb. This hook neither builds nor inspects its output, and it never
 * adds a permission decision of its own (spec D12): a relayed answer is exactly
 * what the verb printed.
 *
 * ## Invariant: fail-open (spec D7)
 *
 * Every fault — bad stdin, lore absent, non-zero child — exits 0 with nothing
 * on stdout, so the tool call proceeds un-rewritten and is simply unattested.
 * A failed child's stdout is never relayed, since it may be partial.
 *
 * @spec_ref spec-run-identity-slice-1-harness-attested-runs-attested D7, D10,
 *   D12; AC-RID-3
 */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/** Resolved from `PATH`, as for the other blind-pipe hooks. */
const VERB_BINARY = 'lore';

/** The verb this hook pipes to; it reads the payload from stdin. */
const VERB_ARGV = ['run', 'attest-input'];

/** Tool whose `tool_input.command` is searched for the word lore. */
const SHELL_TOOL_NAME = 'Bash';

/**
 * A lore MCP tool under ANY registered server name: `mcp__<server>__lore_<verb>`.
 * reason: the server name is user-configurable (`mcp__lore-dev__...`), so a fixed
 * `mcp__lore__` prefix missed renamed servers (#146, BR-1093); requiring the `__lore_`
 * verb segment keeps `mcp__mylore__get_issue` and other servers' tools out. Twin of
 * `LORE_MCP_TOOL` in packages/lore/src/adapters/cli/commands/run.ts (this file is standalone,
 * so the shape cannot be imported) — change both together.
 */
const LORE_MCP_TOOL = /^mcp__.+__lore_\w+$/;

/** "The word lore": a word boundary on both sides, so `explore` and `folklore` do not match. */
const LORE_WORD = /\blore\b/;

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
  payload = JSON.parse(rawStdin.toString('utf8'));
} catch {
  process.exit(0);
}

if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) process.exit(0);

const toolName = payload.tool_name;
const command = payload.tool_input?.command;
const triggered =
  typeof toolName === 'string' &&
  ((toolName === SHELL_TOOL_NAME && typeof command === 'string' && LORE_WORD.test(command)) ||
    LORE_MCP_TOOL.test(toolName));

if (!triggered) process.exit(0);

const child = spawnSync(VERB_BINARY, VERB_ARGV, {
  input: rawStdin,
  stdio: ['pipe', 'pipe', 'ignore'],
  maxBuffer: CHILD_OUTPUT_BYTE_CEILING,
});

if (child.error || child.status !== 0) process.exit(0);

if (child.stdout && child.stdout.length > 0) process.stdout.write(child.stdout);
process.exit(0);
