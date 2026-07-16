/**
 * turn-state.mjs — session/turn path resolution (node port of session-state.sh).
 *
 * Contract:
 *   - resolveSessionId(): CLAUDE_SESSION_ID env > ppid-$PPID fallback.
 *     ⛔ Never returns "unknown" (fail-loud rule — prevents cross-instance collision).
 *   - getStateBase(): respects CLAUDE_STATE_BASE_OVERRIDE for testing.
 *   - getSessionDir(): {base}/sessions/{session_id}
 *   - getCurrentTurnId(): reads {session}/current-turn.id, returns null if missing.
 *   - getTurnDir(): {session}/{turn_id} or {session}/pre-turn sentinel.
 *
 * @module turn-state
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function getStateBase() {
  return process.env.CLAUDE_STATE_BASE_OVERRIDE
    || join(homedir(), '.claude', 'session-state');
}

export function resolveSessionId() {
  const envId = process.env.CLAUDE_SESSION_ID;
  if (envId && envId.length > 0) return envId;

  const ppid = process.ppid;
  if (!ppid || ppid <= 0) {
    // Fail-loud: no "unknown" fallback to prevent cross-instance state collision.
    throw new Error(
      'Cannot resolve session_id: CLAUDE_SESSION_ID env unset and process.ppid unavailable'
    );
  }
  return `ppid-${ppid}`;
}

export function getSessionDir() {
  return join(getStateBase(), 'sessions', resolveSessionId());
}

export function getCurrentTurnId() {
  const turnFile = join(getSessionDir(), 'current-turn.id');
  if (!existsSync(turnFile)) return null;
  const content = readFileSync(turnFile, 'utf8').trim();
  return content.length > 0 ? content : null;
}

export function getTurnDir() {
  const turnId = getCurrentTurnId();
  if (!turnId) {
    // Sentinel dir — not "unknown" (would collide with other broken state).
    return join(getSessionDir(), 'pre-turn');
  }
  return join(getSessionDir(), turnId);
}
