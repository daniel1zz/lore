#!/usr/bin/env node
/**
 * session-start-fragments.mjs — SessionStart hook (matchers: startup/resume, compact).
 *
 * Spec: spec-context-fragments-config-driven-layered-rule-injection (D6, D7, D10, D12).
 *
 * A BLIND PIPE: spawns the resolved `lore` binary's
 * `lore fragments render --outlet hook:session-start --cwd <payload.cwd>` and
 * prints its stdout (hook JSON, already capped and carrying the D7 stale-Z1
 * notice) VERBATIM. This is the SECOND SessionStart hook entry on purpose: Claude
 * Code measures each hook's string on its own, so splitting it from
 * `session-start-resume.mjs` keeps each under the 10,000-char cap (D6).
 *
 * The `compact` registration (D10) re-injects dynamic `main` fragments after
 * `/compact`, which would otherwise lose them.
 *
 * Never writes files (D7: hooks never write CLAUDE.md). Never blocks (D12): a
 * missing binary, non-zero exit, or non-hook stdout yields an
 * `additionalContext` banner naming the failure, exit 0 — never empty output.
 *
 * stdin:  {"cwd": string, ...} (a bad payload degrades to process.cwd())
 * stdout: {"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": string}}
 *
 * Public surface: none. Executable script with no exports.
 * Side-effect class: IO — reads stdin, spawns `lore`, writes stdout.
 */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SPAWN_TIMEOUT_MS = 8000;

let payload = {};
try {
  const parsed = JSON.parse(readFileSync(0, 'utf8'));
  if (parsed !== null && typeof parsed === 'object') payload = parsed;
} catch {
  // proceed with an empty payload; the render below still runs against process.cwd()
}
const cwd = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : process.cwd();

function banner(reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `[session-start-fragments] lore fragments render failed: ${reason}`,
    },
  });
}

let out;
try {
  const r = spawnSync('lore', ['fragments', 'render', '--outlet', 'hook:session-start', '--cwd', cwd], {
    cwd,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    env: { ...process.env, CLAUDECODE: '1' }, // agent surface → AI defaults off (SPEC-024)
  });
  if (r.error) {
    out = banner(r.error.message);
  } else if (r.status !== 0) {
    out = banner(`exit ${r.status === null ? `signal ${r.signal}` : r.status}`);
  } else if (typeof r.stdout === 'string' && r.stdout.trim() !== '') {
    try {
      const text = JSON.parse(r.stdout)?.hookSpecificOutput?.additionalContext;
      out = typeof text === 'string' && text !== '' ? r.stdout : banner('render emitted no additionalContext');
    } catch {
      out = banner('render stdout is not hook JSON');
    }
  } else {
    out = banner('render emitted empty stdout');
  }
} catch (e) {
  out = banner(e instanceof Error ? e.message : String(e));
}

process.stdout.write(out);
process.exit(0);
