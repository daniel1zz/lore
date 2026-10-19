#!/usr/bin/env node
/**
 * pre-helper-foreign-working-copy-gate.mjs — PreToolUse hook on Write|Edit|MultiEdit|NotebookEdit.
 *
 * Refuses, BEFORE it happens, a file write by a worktree-isolated helper whose canonical target lies
 * inside a git working copy OTHER than the helper's own: the shared checkout, another helper's
 * worktree, or another repository's working copy. That harm lands before turn end on someone else
 * and the actor cannot undo it (BR-1092 permits a per-tool-call refusal for exactly this class and
 * for irreversible git operations).
 *
 * Public surface: none. Executable script, no exports.
 * Side-effect class: IO — reads stdin, the trail record, the filesystem and git metadata; writes
 * only to stderr.
 *
 * ## Which tool calls this hook governs (and which it never touches)
 *
 *   - Only a call made BY A HELPER: the payload carries `agent_id` (subagent tool calls only). The
 *     main session has no `agent_id` and is never affected.
 *   - Only an ISOLATED helper: its own working copy is a linked git worktree (git dir != git common
 *     dir, the test `measureHelperChanges` in lib/session-trail.mjs uses). The own working copy is
 *     read from the trail record written at SubagentStart (`working_copy`), NOT from the payload
 *     `cwd`, which drifts when the helper `cd`s; the payload cwd is the fallback only when no trail
 *     record carries one. A helper sharing the shared checkout, or one not in a git repo at all,
 *     cannot be identified as isolated, so the hook does not apply.
 *   - If it IS identified as isolated but its worktree root cannot be resolved, or the target's
 *     working copy cannot be determined for a reason other than "not a git repository", the call is
 *     refused loud (exit 2). No silent allow.
 *
 * ## Allowed
 *
 * Anything inside the helper's own worktree (including its gitignored `.scratch/`), and anything
 * in no git working copy at all (session scratchpad, /tmp, `mktemp -d`). The latter is NOT this
 * hook's job: the turn-end helper-scope review keeps reporting those.
 *
 * The target is canonicalised before comparison (relative paths resolved against the payload
 * `cwd`, `..` collapsed, symlinks resolved on the deepest existing ancestor), so neither a `..`
 * hop nor a symlink inside the worktree escapes the check.
 *
 * ## Out of scope
 *
 * Shell redirects inside Bash: a hook cannot parse arbitrary shell reliably.
 *
 * Exit codes: 2 = refused. 0 = not applicable or allowed. A malformed payload exits 0 (nothing to
 * assert on).
 */

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join, resolve, sep, basename } from 'node:path';

import { getStateBase, resolveSessionId } from './lib/turn-state.mjs';

/** Tools whose target path this hook checks, with the payload field that carries it. */
const PATH_FIELD_BY_TOOL = {
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
};

/** Hard cap per git call: a hung git must not stall the tool call forever. */
const GIT_TIMEOUT_MS = 3000;

function readPayload() {
  try {
    const parsed = JSON.parse(readFileSync(0, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: GIT_TIMEOUT_MS,
  }).trim();
}

/** Resolve `p` to a canonical absolute path even when its tail does not exist yet. */
function canonicalize(p) {
  const absolute = resolve(p);
  const tail = [];
  let probe = absolute;
  for (;;) {
    try {
      return join(realpathSync(probe), ...tail.reverse());
    } catch {
      const parent = dirname(probe);
      if (parent === probe) return absolute;
      tail.push(basename(probe));
      probe = parent;
    }
  }
}

const isWithin = (child, root) => child === root || child.startsWith(root.endsWith(sep) ? root : root + sep);

/** Nearest existing directory at or above `target` (git needs a real directory to run in). */
function nearestExistingDir(target) {
  let probe = target;
  for (;;) {
    try {
      if (statSync(probe).isDirectory()) return probe;
    } catch {
      // keep climbing
    }
    const parent = dirname(probe);
    if (parent === probe) return probe;
    probe = parent;
  }
}

/**
 * Root of the git working copy containing `target`, or null when it is in none.
 * @throws {Error} when git fails for any reason other than "not a git repository" — the caller refuses loud.
 */
function workingCopyRootOf(target) {
  try {
    return realpathSync(git(nearestExistingDir(target), ['rev-parse', '--show-toplevel']));
  } catch (err) {
    const stderr = String(err?.stderr ?? '');
    // reason: inside a repo's .git dir there is no work tree either; that is not a working copy a helper can corrupt by file writes
    if (/not a git repository|this operation must be run in a work tree/i.test(stderr)) return null;
    throw new Error(`git could not tell which working copy contains the target: ${stderr.trim().split('\n')[0] || err?.message || err}`);
  }
}

/** The working copy the SubagentStart trail record carries for this helper, or null (no record / no field / unreadable). */
function trailWorkingCopy(payload) {
  try {
    if (!/^[A-Za-z0-9._-]+$/.test(payload.agent_id)) return null;
    const file = join(getStateBase(), 'sessions', resolveSessionId(payload), 'helpers', `${payload.agent_id}.json`);
    const record = JSON.parse(readFileSync(file, 'utf8'));
    return typeof record.working_copy === 'string' && record.working_copy !== '' ? record.working_copy : null;
  } catch {
    return null;
  }
}

function refuse(target, worktree, foreignRoot, why) {
  process.stderr.write(`[HELPER_FOREIGN_WORKING_COPY_GATE] Refused (BR-1092): ${why}

  target:               ${target}
  your worktree:        ${worktree}
  foreign working copy: ${foreignRoot}

An isolated helper writes only inside its own worktree. A file written into the shared checkout,
another helper's worktree or another repository lands there immediately and you cannot undo it.
Write inside your own worktree (scratch files: <worktree>/.scratch/), then retry. A path outside
every git working copy (a \`mktemp -d\` dir) is not refused by this hook.
`);
  process.exit(2);
}

const payload = readPayload();
if (payload === null) process.exit(0);

const pathField = PATH_FIELD_BY_TOOL[payload.tool_name];
if (pathField === undefined) process.exit(0);

// The main session has no agent_id: not a helper, not governed.
if (typeof payload.agent_id !== 'string' || payload.agent_id === '') process.exit(0);

const cwd = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : process.cwd();
const rawTarget = payload.tool_input?.[pathField];
// Nothing checkable: let the tool report its own missing-argument error.
if (typeof rawTarget !== 'string' || rawTarget === '') process.exit(0);

const anchor = trailWorkingCopy(payload) ?? cwd;

// Identification: is the helper's own working copy a linked worktree?
let isolated;
try {
  const gitDir = realpathSync(git(anchor, ['rev-parse', '--absolute-git-dir']));
  const commonDir = realpathSync(resolve(anchor, git(anchor, ['rev-parse', '--git-common-dir'])));
  isolated = gitDir !== commonDir;
} catch {
  // Not inside a git repo (or git unavailable): cannot be identified as an isolated helper.
  process.exit(0);
}
if (!isolated) process.exit(0);

const target = canonicalize(isAbsolute(rawTarget) ? rawTarget : resolve(cwd, rawTarget));

let worktree;
try {
  worktree = realpathSync(git(anchor, ['rev-parse', '--show-toplevel']));
} catch {
  // Isolated but unresolvable: refuse loud rather than allow silently.
  refuse(target, '<unresolved>', '<unknown>', `this call comes from an isolated helper (agent_id ${payload.agent_id}) but its worktree root could not be resolved from ${anchor}`);
}

if (isWithin(target, worktree)) process.exit(0);

let root;
try {
  root = workingCopyRootOf(target);
} catch (err) {
  refuse(target, worktree, '<unknown>', err.message);
}
if (root === null || root === worktree) process.exit(0);

refuse(target, worktree, root, `${payload.tool_name} target is inside a git working copy that is not this isolated helper's own`);
