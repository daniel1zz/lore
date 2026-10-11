#!/usr/bin/env node
/**
 * post-edit-mark.mjs — PostToolUse hook on Edit|Write|MultiEdit|NotebookEdit.
 *
 * Producer of `edited.flag` + `edited-files.jsonl` in the current turn dir, which
 * stop-doc-sync.mjs reads to let no-edit turns stop silently. Session dir comes from the
 * stdin payload `session_id`; the edited path from `tool_input.file_path` (Edit/Write/MultiEdit)
 * or `tool_input.notebook_path` (NotebookEdit) — PostToolUse input,
 * https://code.claude.com/docs/en/hooks.
 *
 * No started turn (current-turn.id absent) → writes NOTHING and says so on stderr: inventing a
 * turn dir here would let the consumer read a state nobody opened.
 * Fail-open: never blocks the tool; stdout stays empty.
 */

import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTurnDir, readHookPayload } from './lib/turn-state.mjs';

try {
  const payload = readHookPayload();
  const turnDir = getTurnDir(payload);
  if (!turnDir) {
    throw new Error('no turn started for this session (current-turn.id absent)');
  }
  mkdirSync(turnDir, { recursive: true });
  writeFileSync(join(turnDir, 'edited.flag'), '');

  const input = payload.tool_input;
  const filePath = input?.file_path ?? input?.notebook_path;
  if (typeof filePath === 'string' && filePath.length > 0) {
    appendFileSync(join(turnDir, 'edited-files.jsonl'),
      JSON.stringify({ file: filePath, ts: Date.now() }) + '\n');
  }
} catch (err) {
  process.stderr.write(`[post-edit-mark] turn state not measured: ${err.message}\n`);
}
process.exit(0);
