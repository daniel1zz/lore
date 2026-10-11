#!/usr/bin/env node
/**
 * user-prompt-turn-start.mjs — UserPromptSubmit hook, producer of `current-turn.id`.
 *
 * Opens a fresh turn per user message so stop-doc-sync.mjs can tell "edits made THIS turn"
 * from edits of earlier turns. Session dir comes from the stdin payload `session_id`
 * (UserPromptSubmit input, https://code.claude.com/docs/en/hooks) — the same source the
 * PostToolUse producer and the Stop consumer use.
 *
 * Emits nothing on stdout (no context injection). Fail-open: a fault is reported on stderr
 * and never blocks the prompt; the Stop consumer then reports "not measured".
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSessionDir, readHookPayload } from './lib/turn-state.mjs';

try {
  const sessionDir = getSessionDir(readHookPayload());
  const turnId = randomUUID().toLowerCase();
  mkdirSync(join(sessionDir, turnId), { recursive: true });
  writeFileSync(join(sessionDir, 'current-turn.id'), turnId);
} catch (err) {
  process.stderr.write(`[user-prompt-turn-start] turn state not measured: ${err.message}\n`);
}
process.exit(0);
