#!/usr/bin/env node
/**
 * subagent-trail.mjs — SubagentStop hook: measures an isolated helper's changes in its own
 * working copy and records them in helpers/<agent_id>.json (spec
 * spec-session-trail-a-session-local-record-of-what-each-run-4, Design > Helper measurement).
 *
 * Not registered in the shipped roster here (a later task owns distribution-hooks.ts); tests
 * call it with `node`. Fires more than once per helper when another SubagentStop hook blocks:
 * each firing overwrites the measurement and increments end_count.
 *
 * Contract (spec D13): exits 0 with empty stdout and stderr on every path. Measurement failures
 * become `changes:{measured:false, reason}` in the record; a payload with no usable session_id
 * or agent_id, malformed stdin or an unwritable state base end silently.
 */

import { readHookPayload, resolveSessionId, getStateBase } from './lib/turn-state.mjs';
import { recordHelperEnd } from './lib/session-trail.mjs';

try {
  const payload = readHookPayload();
  recordHelperEnd(getStateBase(), resolveSessionId(payload), payload.agent_id, payload.cwd);
} catch {
  // reason: spec D13 — a trail hook never speaks and never blocks the helper's stop.
}
process.exit(0);
