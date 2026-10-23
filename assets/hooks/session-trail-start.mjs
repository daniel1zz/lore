#!/usr/bin/env node
/**
 * session-trail-start.mjs — SessionStart and SubagentStart hook, writer of the session trail's
 * session-level files (spec spec-session-trail-a-session-local-record-of-what-each-run-4):
 *
 *   SessionStart  → retention over other sessions (idle > 14 days replaced by removed.json,
 *                   markers older than 90 days removed), then session.json {started_at} once.
 *   SubagentStart → helpers/<agent_id>.json {run, started_at, end_count: 0}.
 *
 * Dispatches on the payload's `hook_event_name`; any other event does nothing. Not registered in
 * the shipped roster here (a later task owns distribution-hooks.ts); tests call it with `node`.
 *
 * Contract (spec D13, BR-1092): writes NOTHING to stdout or stderr on any path and always exits 0.
 * A payload without a usable session_id, malformed stdin or an unwritable state base all end
 * silently: there is no trail to carry a `measured:false` for a start that never happened.
 */

import { readHookPayload, resolveSessionId, getStateBase } from './lib/turn-state.mjs';
import { recordHelperStart, recordSessionStart } from './lib/session-trail.mjs';
import { trackOutcome, skipOutcome } from './lib/check-outcome.mjs';
trackOutcome('hook:session-trail-start');

try {
  const payload = readHookPayload();
  const sessionId = resolveSessionId(payload);
  const base = getStateBase();
  if (payload.hook_event_name === 'SessionStart') {
    recordSessionStart(base, sessionId);
  } else if (payload.hook_event_name === 'SubagentStart') {
    recordHelperStart(base, sessionId, payload.agent_id, Date.now(), payload.cwd);
  }
} catch {
  // reason: a start that failed (malformed stdin, no usable session_id or agent id) never happened, so there is nothing
  // to measure and the hook leaves no outcome row (and no file in a state base it was never meant to write to).
  skipOutcome();
  // reason: spec D13 — a trail hook never speaks; failures surface later as measured:false
  // in the readers, or not at all when the trail itself was never started.
}
process.exit(0);
