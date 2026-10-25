/**
 * turn-state.mjs — session/turn path resolution shared by the turn-state hooks:
 *   user-prompt-turn-start.mjs (UserPromptSubmit, writes current-turn.id)
 *   post-edit-mark.mjs         (PostToolUse, writes edited.flag / edited-files.jsonl)
 *   stop-turn-review.mjs       (Stop, reads them)
 *
 * Contract:
 *   - resolveSessionId(payload): the hook stdin payload's `session_id`.
 *     Claude Code hook input (https://code.claude.com/docs/en/hooks, "Common input fields"
 *     + UserPromptSubmit / PostToolUse / Stop input): every event carries `session_id`.
 *     ⛔ No env / ppid fallback: the ppid differs per hook process, so a producer and the
 *     consumer would resolve DIFFERENT dirs (lore issue #156). Missing id → throws (fail-loud).
 *   - getStateBase(): respects CLAUDE_STATE_BASE_OVERRIDE for testing.
 *   - getSessionDir(payload): {base}/sessions/{session_id}
 *   - getCurrentTurnId(payload): reads {session}/current-turn.id, null if absent/empty.
 *   - getTurnDir(payload): {session}/{turn_id}; null when no turn has started (never a sentinel
 *     dir — a missing turn must stay distinguishable from "a turn with no edits").
 *   - readHookPayload(): parses stdin JSON; throws on malformed/non-object input.
 *
 * @module turn-state
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { noteHookCwd } from './check-outcome.mjs';

export function getStateBase() {
  return process.env.CLAUDE_STATE_BASE_OVERRIDE
    || join(homedir(), '.claude', 'session-state');
}

export function readHookPayload() {
  const raw = readFileSync(0, 'utf8');
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('hook stdin is not a JSON object');
  }
  return noteHookCwd(parsed);
}

export function resolveSessionId(payload) {
  const id = payload?.session_id;
  if (typeof id !== 'string' || id.length === 0 || /[\\/]/.test(id) || id === '.' || id === '..') {
    throw new Error('hook payload has no usable string session_id');
  }
  return id;
}

export function getSessionDir(payload) {
  return join(getStateBase(), 'sessions', resolveSessionId(payload));
}

export function getCurrentTurnId(payload) {
  const turnFile = join(getSessionDir(payload), 'current-turn.id');
  if (!existsSync(turnFile)) return null;
  const content = readFileSync(turnFile, 'utf8').trim();
  return content.length > 0 ? content : null;
}

export function getTurnDir(payload) {
  const turnId = getCurrentTurnId(payload);
  if (!turnId) return null;
  return join(getSessionDir(payload), turnId);
}
