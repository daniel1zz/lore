#!/usr/bin/env node
/**
 * user-prompt-turn-start.mjs — UserPromptSubmit hook, producer of `current-turn.id`.
 *
 * Opens a fresh turn per user message so stop-doc-sync.mjs can tell "edits made THIS turn"
 * from edits of earlier turns. Session dir comes from the stdin payload `session_id`
 * (UserPromptSubmit input, https://code.claude.com/docs/en/hooks) — the same source the
 * PostToolUse producer and the Stop consumer use.
 *
 * Also writes `<turn>/turn-start-snapshot.json` (working-tree tree id + duration, see
 * snapshotWorkingTree); `tree: null` + `reason` means unmeasured.
 *
 * Emits nothing on stdout (no context injection). Fail-open: a fault is reported on stderr
 * and never blocks the prompt; the Stop consumer then reports "not measured".
 */

import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { getSessionDir, readHookPayload } from './lib/turn-state.mjs';

/**
 * Snapshot the working tree as a git tree id without touching the real index or any ref:
 * `GIT_INDEX_FILE=<tmp> git add -A && git write-tree`. Returns the record written to
 * `turn-start-snapshot.json`: `{tree, durationMs}` or, when no snapshot could be taken
 * (not a git repo / a git step failed), `{tree: null, reason, durationMs}` — the consumer
 * treats the turn as unmeasured; a fake tree id is never recorded.
 */
function snapshotWorkingTree(cwd) {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  let tmpDir;
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'lore-turn-index-'));
    const env = { ...process.env, GIT_INDEX_FILE: join(tmpDir, 'index') };
    const run = (args) => spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    const inside = run(['rev-parse', '--is-inside-work-tree']);
    if (inside.error || inside.status !== 0 || inside.stdout.trim() !== 'true') {
      return { tree: null, reason: 'not a git work tree', durationMs: elapsed() };
    }
    // reason: seed the temp index from HEAD so `add -A` only re-hashes changed files (fast on
    // big repos); an unborn HEAD simply leaves the index empty and add -A adds everything.
    run(['read-tree', 'HEAD']);
    const add = run(['add', '-A']);
    if (add.status !== 0) {
      return { tree: null, reason: `git add -A failed: ${add.stderr.trim()}`, durationMs: elapsed() };
    }
    const write = run(['write-tree']);
    const tree = write.stdout.trim();
    if (write.status !== 0 || !/^[0-9a-f]{40,64}$/.test(tree)) {
      return { tree: null, reason: `git write-tree failed: ${write.stderr.trim()}`, durationMs: elapsed() };
    }
    return { tree, durationMs: elapsed() };
  } catch (err) {
    // an unexpected fault must not stop the turn from opening; it is recorded, not hidden
    return { tree: null, reason: `snapshot fault: ${err.message}`, durationMs: elapsed() };
  } finally {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  }
}

try {
  const payload = readHookPayload();
  const sessionDir = getSessionDir(payload);
  const turnId = randomUUID().toLowerCase();
  mkdirSync(join(sessionDir, turnId), { recursive: true });
  const snapshot = snapshotWorkingTree(typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd());
  writeFileSync(join(sessionDir, turnId, 'turn-start-snapshot.json'), JSON.stringify(snapshot));
  writeFileSync(join(sessionDir, 'current-turn.id'), turnId);
} catch (err) {
  process.stderr.write(`[user-prompt-turn-start] turn state not measured: ${err.message}\n`);
}
process.exit(0);
