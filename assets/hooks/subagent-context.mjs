#!/usr/bin/env node
/**
 * subagent-context.mjs — SubagentStart hook (thin caller).
 *
 * Spec: spec-context-fragments-config-driven-layered-rule-injection
 * (D5 thin hook, D12 never block / never empty; AC-CF-7, AC-CF-10).
 *
 * All content now lives in context fragments, rendered by the `lore` binary:
 * One call: `lore fragments render --outlet hook:subagent-start --agent-type <type> --cwd <cwd> --with-pointers`
 *   -> hook JSON; its additionalContext is the fragment block (placed FIRST) followed by the
 *   project pointer lines. On any render failure the binary itself exits 0 with a short banner
 *   carrying the error code (D12), which passes through unchanged.
 * This hook only spawns one lore process and wraps. It holds NO per-type text.
 *
 * The `lore` binary is resolved from PATH, exactly like session-start-resume.mjs.
 *
 * Failure policy (D12): this hook never blocks and never emits an empty
 * additionalContext. If the render spawn itself fails (binary missing, timeout,
 * unparseable stdout) a banner naming the cause is emitted instead.
 *
 * stdin:  {"agent_type": string, "cwd": string, ...}
 * stdout: {"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":string}}
 */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { trackOutcome } from './lib/check-outcome.mjs';
trackOutcome('hook:subagent-context');

const SPAWN_TIMEOUT_MS = 8000;

// stdin parse: a bad payload degrades to defaults, never to a crash.
let payload = {};
try {
  const parsed = JSON.parse(readFileSync(0, 'utf8'));
  if (parsed !== null && typeof parsed === 'object') payload = parsed;
} catch {
  // proceed with empty payload; the envelope below is still emitted
}
const cwd = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : process.cwd();
const agentType = typeof payload.agent_type === 'string' ? payload.agent_type : '';

function spawnLore(args) {
  return spawnSync('lore', args, {
    cwd,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    env: { ...process.env, CLAUDECODE: '1' },
  });
}

function banner(reason) {
  return `[subagent-context] lore fragments render failed: ${reason}`;
}

function renderBlock() {
  const args = ['fragments', 'render', '--outlet', 'hook:subagent-start', '--cwd', cwd, '--with-pointers'];
  if (agentType !== '') args.push('--agent-type', agentType);
  const r = spawnLore(args);
  if (r.error) return banner(r.error.message);
  if (r.status !== 0) return banner(`exit ${r.status === null ? `signal ${r.signal}` : r.status}`);
  try {
    const text = JSON.parse(r.stdout)?.hookSpecificOutput?.additionalContext;
    if (typeof text === 'string' && text !== '') return text;
    return banner('render emitted no additionalContext');
  } catch {
    return banner('render stdout is not hook JSON');
  }
}

const context = renderBlock();

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SubagentStart',
    additionalContext: context,
  },
}));
process.exit(0);
