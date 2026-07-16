#!/usr/bin/env node
/**
 * pre-no-general-agent-gate.mjs — PreToolUse hook on Agent|Task.
 *
 * HARD gate: blocks subagent dispatch to general-purpose (explicit or default).
 * Forces use of specialized subagents. No bypass.
 */

import { readFileSync } from 'node:fs';

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

if (!['Agent', 'Task'].includes(payload.tool_name)) process.exit(0);

const subagent = payload?.tool_input?.subagent_type || '';
// Block when explicit "general-purpose" OR missing (implicit default)
if (subagent !== 'general-purpose' && subagent !== '') process.exit(0);

const reason = subagent === ''
  ? '<missing subagent_type> (defaults to general-purpose)'
  : 'general-purpose';

process.stderr.write(`[NO_GENERAL_AGENT_GATE] Blocked: ${payload.tool_name} with ${reason}.

general-purpose is a catch-all without task-specific prompt, tool restriction,
or quality gate. Use a specialized subagent instead:

  Custom:
    - lore-explorer    : read-only codebase + lore corpus exploration
    - lore-implementer : implement lore tasks (code + tests + oracle evidence)
    - lore-planner     : decompose goals into lore plan phases + tasks
    - lore-reviewer    : read-only code review against lore spec ACs
    - researcher       : SDK / pattern / benchmark evaluation (ADR output)

  Built-in:
    - Explore            : fast codebase exploration
    - Plan               : implementation planning

How to fix:
  Set subagent_type explicitly to one of the specialized types above.

No bypass available.
`);
process.exit(2);
