#!/usr/bin/env node
/**
 * user-prompt-fragments.mjs — UserPromptSubmit hook (thin caller) for per-turn fragments.
 *
 * Spec: spec-fragment-injection-timing-one-inject-enum-a-per-turn (hook:user-prompt outlet; BR-1378).
 *
 * Fast path: when no fragment in the user or project context dir names `user-prompt` inside its
 * frontmatter block, print `{}` and exit without spawning lore (this hook runs on EVERY prompt).
 * Otherwise one call: `lore fragments render --outlet hook:user-prompt --cwd <cwd>` (3 s timeout);
 * its stdout (hook JSON, or `{}` for an empty selection) passes through unchanged.
 *
 * Directory resolution mirrors lore: user dir = $LORE_CONFIG_HOME > $XDG_CONFIG_HOME/lore >
 * ~/.config/lore, plus /context; project dir = nearest ancestor of cwd holding `.lore/` (cwd itself
 * when none), plus /.lore/context. An unreadable directory counts as "mentions" (spawn, fail loud).
 *
 * Failure policy: never blocks the prompt (exit 0). Spawn failure, timeout, non-zero exit or
 * non-JSON stdout emit a banner naming the cause.
 *
 * stdin:  {"cwd": string, "prompt": string, ...}
 * stdout: {} | {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":string}}
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { trackOutcome, noteHookCwd } from './lib/check-outcome.mjs';
trackOutcome('hook:user-prompt-fragments');

const SPAWN_TIMEOUT_MS = 3000;
const TOKEN = 'user-prompt';

let payload = {};
try {
  const parsed = noteHookCwd(JSON.parse(readFileSync(0, 'utf8')));
  if (parsed !== null && typeof parsed === 'object') payload = parsed;
} catch {
  // empty payload: cwd falls back to process.cwd()
}
const cwd = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : process.cwd();

function userContextDir() {
  const env = process.env;
  if (env.LORE_CONFIG_HOME) return join(env.LORE_CONFIG_HOME, 'context');
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'lore', 'context');
  return join(homedir(), '.config', 'lore', 'context');
}

function projectContextDir(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, '.lore'))) return join(dir, '.lore', 'context');
    const parent = dirname(dir);
    if (parent === dir) return join(resolve(start), '.lore', 'context');
    dir = parent;
  }
}

/** Frontmatter block text: lines between the first two `---` lines ('' when the file has none). */
function frontmatterOf(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return '';
  const end = lines.indexOf('---', 1);
  return end === -1 ? '' : lines.slice(1, end).join('\n');
}

/** true when some `.md` frontmatter in the directory names the token; an unreadable directory counts as true. */
function dirMentions(dir) {
  if (!existsSync(dir)) return false;
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      if (frontmatterOf(readFileSync(join(dir, name), 'utf8')).includes(TOKEN)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function emitAndExit(obj) {
  process.stdout.write(typeof obj === 'string' ? obj : JSON.stringify(obj));
  process.exit(0);
}

function bannerOutput(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `[user-prompt-fragments] lore fragments render failed: ${reason}`,
    },
  };
}

if (!dirMentions(userContextDir()) && !dirMentions(projectContextDir(cwd))) emitAndExit('{}');

// reason: async spawn + own timer; spawnSync would wait for a grandchild holding the stdout pipe past the timeout.
let out = '';
let settled = false;
const finish = (result) => {
  if (settled) return;
  settled = true;
  emitAndExit(result);
};
const child = spawn('lore', ['fragments', 'render', '--outlet', 'hook:user-prompt', '--cwd', cwd], {
  cwd,
  env: { ...process.env, CLAUDECODE: '1' },
  stdio: ['ignore', 'pipe', 'ignore'],
});
const timer = setTimeout(() => {
  child.kill('SIGKILL');
  finish(bannerOutput(`timed out after ${SPAWN_TIMEOUT_MS} ms`));
}, SPAWN_TIMEOUT_MS);
child.stdout.on('data', (d) => { out += d; });
child.on('error', (e) => finish(bannerOutput(e.message)));
child.on('close', (code, signal) => {
  clearTimeout(timer);
  if (code !== 0) return finish(bannerOutput(`exit ${code === null ? `signal ${signal}` : code}`));
  try {
    JSON.parse(out);
  } catch {
    return finish(bannerOutput('render stdout is not JSON'));
  }
  finish(out.trim());
});
