#!/usr/bin/env node
/**
 * post-edit-bindings.mjs — PostToolUse hook on Edit|Write|MultiEdit|NotebookEdit.
 *
 * Purpose: right after a file is edited, tell the agent which prose is bound to it (spec and
 * knowledge code anchors, memory-file lines, context-fragment lines), so the description is
 * checked against the change while the change is in context
 * (spec-prose-about-code-is-bound-to-what-it-describes-one, D3 / AC-BIND-4).
 *
 * Public surface: stdin = PostToolUse payload (`cwd`, `tool_name`, `tool_input` with `file_path`
 * or `notebook_path`; Edit adds `old_string`/`new_string`/`replace_all`, MultiEdit `edits`);
 * stdout = one `{hookSpecificOutput:{hookEventName:'PostToolUse',additionalContext}}` line, or
 * nothing.
 *
 * Invariants:
 *   - The ONE reverse index is `lore refs <path> --json` (P1); this hook holds no second index
 *     and no reference grammar. It only filters and formats the answer.
 *   - A script binding (a `bun run <script>` reference bound to package.json) is reported only
 *     when that script's command text differs between the file before and after the edit:
 *     Edit/MultiEdit reconstruct "before" by undoing the edit on the file as it now is; Write
 *     compares with git HEAD (an untracked new file has no prior text, so every script counts as
 *     changed). Anything not provable as unchanged (unparseable JSON, an ambiguous undo) is
 *     reported — noise is cheaper than a missed stale statement.
 *   - Never blocks (BR-1092): no `decision`, no `permissionDecision`, always exit 0. A fault
 *     (no `lore`, no git root, unreadable file) is one stderr line and silence on stdout.
 *
 * Side-effect class: IO (spawns `git` and `lore refs`, both read-only; writes nothing).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { readHookPayload } from './lib/turn-state.mjs';

const HOOK_NAME = 'post-edit-bindings';
const CHILD_OUTPUT_BYTE_CEILING = 16 * 1024 * 1024;
const PACKAGE_JSON_NAME = 'package.json';

/** One stderr line, then a clean exit: this hook never refuses and never fails the tool. */
function stopWithNote(reason) {
  process.stderr.write(`[${HOOK_NAME}] ${reason}\n`);
  process.exit(0);
}

function gitOutput(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: CHILD_OUTPUT_BYTE_CEILING });
}

/** Nearest existing directory at or above `path`, so a just-created file's folder resolves. */
function nearestExistingDir(path) {
  let dir = dirname(path);
  while (!existsSync(dir)) {
    const parent = dirname(dir);
    if (parent === dir) return dir;
    dir = parent;
  }
  return dir;
}

function parseScripts(text) {
  try {
    const scripts = JSON.parse(text)?.scripts;
    return scripts !== null && typeof scripts === 'object' && !Array.isArray(scripts) ? scripts : {};
  } catch {
    return undefined;
  }
}

/**
 * Undoes one edit on `text`. Returns the text before the edit, or `undefined` when the edit cannot be
 * undone unambiguously (empty new_string, or new_string occurring more than once without replace_all).
 */
function undoEdit(text, edit) {
  const { old_string: before, new_string: after, replace_all: all } = edit;
  if (typeof before !== 'string' || typeof after !== 'string' || after === '') return undefined;
  const parts = text.split(after);
  if (parts.length === 1) return undefined;
  if (all === true) return parts.join(before);
  return parts.length === 2 ? parts[0] + before + parts[1] : undefined;
}

/** The file's text before this tool call, or `null` for "no prior text", or `undefined` for "cannot tell". */
function textBeforeEdit(payload, afterText, root, rel) {
  const toolName = payload.tool_name;
  const input = payload.tool_input;
  if (toolName === 'Edit') return undoEdit(afterText, input);
  if (toolName === 'MultiEdit') {
    let text = afterText;
    for (const edit of [...(input.edits ?? [])].reverse()) {
      text = text === undefined ? undefined : undoEdit(text, edit);
    }
    return text;
  }
  if (toolName === 'Write') {
    try {
      return gitOutput(root, ['show', `HEAD:${rel}`]);
    } catch {
      return null;
    }
  }
  return undefined;
}

/** True when the script's command text may differ between before and after (reported unless provably equal). */
function scriptMayHaveChanged(script, beforeText, afterText) {
  if (beforeText === undefined) return true;
  if (beforeText === null) return true;
  const afterScripts = parseScripts(afterText);
  const beforeScripts = parseScripts(beforeText);
  if (afterScripts === undefined || beforeScripts === undefined) return true;
  return beforeScripts[script] !== afterScripts[script];
}

function describeBinding(binding) {
  const where = binding.line === undefined ? binding.document : `${binding.document}:${binding.line}`;
  const what = binding.script === undefined ? `\`${binding.reference}\`` : `\`${binding.reference}\` (script ${binding.script})`;
  return `- ${where} [${binding.document_kind}] ${what}`;
}

function main() {
  let payload;
  try {
    payload = readHookPayload();
  } catch (err) {
    stopWithNote(`payload not read: ${err.message}`);
  }
  const input = payload.tool_input ?? {};
  const rawPath = input.file_path ?? input.notebook_path;
  if (typeof rawPath !== 'string' || rawPath.length === 0) return;

  const cwd = typeof payload.cwd === 'string' && payload.cwd.length > 0 ? payload.cwd : process.cwd();
  const absolute = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
  let root;
  let realFile;
  try {
    root = gitOutput(nearestExistingDir(absolute), ['rev-parse', '--show-toplevel']).trim();
    realFile = join(realpathSync(nearestExistingDir(absolute)), basename(absolute));
  } catch (err) {
    // Not in a git working copy (scratchpad, tmp): nothing is bound to it.
    if (err.code === 'ENOENT') stopWithNote('`git` not found on PATH');
    return;
  }
  const rel = relative(realpathSync(root), realFile);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return;

  const refs = spawnSync('lore', ['refs', rel, '--json'], { cwd: root, encoding: 'utf8', maxBuffer: CHILD_OUTPUT_BYTE_CEILING });
  if (refs.error) {
    stopWithNote(refs.error.code === 'ENOENT' ? '`lore` not found on PATH; bindings not measured' : `could not run \`lore refs\`: ${String(refs.error)}`);
  }
  if (refs.status !== 0) {
    const detail = (refs.stderr ?? '').trim().split(/\r?\n/)[0] ?? '';
    stopWithNote(`\`lore refs ${rel}\` failed with exit ${refs.status}${detail === '' ? '' : `: ${detail}`}; bindings not measured`);
  }
  let bindings;
  try {
    bindings = JSON.parse(refs.stdout).data.bindings;
    if (!Array.isArray(bindings)) throw new Error('data.bindings is not a list');
  } catch (err) {
    stopWithNote(`\`lore refs --json\` output not understood: ${err.message}`);
  }

  const scriptBound = bindings.some((b) => b.script !== undefined);
  let shown = bindings;
  if (scriptBound && basename(rel) === PACKAGE_JSON_NAME) {
    const afterText = readFileSync(absolute, 'utf8');
    const beforeText = textBeforeEdit(payload, afterText, root, rel);
    shown = bindings.filter((b) => b.script === undefined || scriptMayHaveChanged(b.script, beforeText, afterText));
  }
  if (shown.length === 0) return;

  const text = [
    `Prose is bound to ${rel} (\`lore refs ${rel}\`). Check each statement below still describes the file after this edit, and update it if not:`,
    ...shown.map(describeBinding),
  ].join('\n');
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } })}\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`[${HOOK_NAME}] bindings not measured: ${err.message}\n`);
}
process.exit(0);
