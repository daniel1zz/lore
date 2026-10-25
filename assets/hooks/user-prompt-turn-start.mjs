#!/usr/bin/env node
/**
 * user-prompt-turn-start.mjs — UserPromptSubmit hook, producer of `current-turn.id`.
 *
 * Opens a fresh turn per user message so stop-turn-review.mjs can tell "edits made THIS turn"
 * from edits of earlier turns. Session dir comes from the stdin payload `session_id`
 * (UserPromptSubmit input, https://code.claude.com/docs/en/hooks) — the same source the
 * PostToolUse producer and the Stop consumer use.
 *
 * Also writes `<turn>/turn-start-snapshot.json`: `{tree, head, reflog_len, durationMs}` — the working-tree
 * tree id (snapshotWorkingTree, seeded from the real index) plus the HEAD commit and HEAD-reflog length
 * the turn-end attribution needs to find the turn's reflog steps (spec
 * spec-session-trail-a-session-local-record-of-what-each-run-4). `tree: null` + `reason` means unmeasured.
 *
 * Emits nothing on stdout (no context injection). Fail-open: a fault is reported on stderr
 * and never blocks the prompt; the Stop consumer then reports "not measured".
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSessionDir, readHookPayload } from './lib/turn-state.mjs';
import { readHeadState, snapshotWorkingTree } from './lib/session-trail.mjs';
import { trackOutcome } from './lib/check-outcome.mjs';
trackOutcome('hook:user-prompt-turn-start');

/**
 * The record written to `turn-start-snapshot.json`. When no snapshot could be taken (not a repo /
 * a step failed) it is `{tree: null, reason, durationMs}` — the consumer treats the turn as
 * unmeasured; a fake tree id is never recorded.
 */
function buildSnapshotRecord(cwd) {
  const started = Date.now();
  const snapshot = snapshotWorkingTree(cwd);
  const durationMs = Date.now() - started;
  if (snapshot.tree === null) return { tree: null, reason: snapshot.reason, durationMs };
  return { tree: snapshot.tree, ...readHeadState(cwd), durationMs };
}

try {
  const payload = readHookPayload();
  const sessionDir = getSessionDir(payload);
  const turnId = randomUUID().toLowerCase();
  mkdirSync(join(sessionDir, turnId), { recursive: true });
  const snapshot = buildSnapshotRecord(typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd());
  writeFileSync(join(sessionDir, turnId, 'turn-start-snapshot.json'), JSON.stringify(snapshot));
  writeFileSync(join(sessionDir, 'current-turn.id'), turnId);
} catch (err) {
  process.stderr.write(`[user-prompt-turn-start] turn state not measured: ${err.message}\n`);
}
process.exit(0);
