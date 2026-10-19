#!/usr/bin/env node
/**
 * pre-helper-write-scope-gate.mjs — PreToolUse hook on Write|Edit|MultiEdit|NotebookEdit.
 *
 * Refuses, BEFORE it happens, a file write by a worktree-isolated helper whose canonical target
 * lies outside that helper's own worktree. Twice (2026-10-18/19) an isolated implementer wrote a
 * file into the orchestrator's session scratchpad despite the written rule; only the turn-end
 * helper-scope review caught it, after the fact. A prose rule is not enforcement.
 *
 * Public surface: none. Executable script, no exports.
 * Side-effect class: IO — reads stdin and the filesystem/git metadata, writes only to stderr.
 *
 * ## Which tool calls this hook governs (and which it never touches)
 *
 *   - Only a call made BY A HELPER: the payload carries `agent_id` (the harness sets it for
 *     subagent tool calls only). The main session has no `agent_id` and is never affected.
 *   - Only an ISOLATED helper: the payload `cwd` (or the trail's recorded `working_copy`, when the
 *     helper already ended once) sits in a linked git worktree (git dir != git common dir) — the
 *     same test `measureHelperChanges` in lib/session-trail.mjs uses. A helper sharing the main
 *     checkout, or a cwd that is not in a git repo at all, cannot be identified as isolated, so
 *     this hook does not apply.
 *   - If it IS identified as isolated but its worktree root cannot be resolved, the call is
 *     refused loud (exit 2). No silent allow.
 *
 * ## Allowed set (exactly)
 *
 *   1. the helper's worktree root, including its gitignored `.scratch/`;
 *   2. a `tmp.*` directory directly under the temp root (`os.tmpdir()`, which honours the run-root
 *      `TMPDIR`) — the shape `mktemp -d` produces. The hook cannot know WHICH `tmp.*` dirs the run
 *      created, so the whole `tmp.*` family is allowed.
 *
 * The target is canonicalised before comparison (relative paths resolved against `cwd`, `..`
 * collapsed, symlinks resolved on the deepest existing ancestor) so neither a `..` hop nor a symlink
 * inside the worktree escapes the check.
 *
 * ## Out of scope
 *
 * Shell redirects inside Bash: a hook cannot parse arbitrary shell reliably. The turn-end
 * helper-scope review stays the detector for those.
 *
 * Exit codes: 2 = refused. 0 = not applicable or allowed. A malformed payload exits 0 (nothing to
 * assert on); an isolated helper whose worktree is unresolvable exits 2.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep, basename } from 'node:path';

import { getStateBase, resolveSessionId } from './lib/turn-state.mjs';

/** Tools whose target path this hook checks, with the payload field that carries it. */
const PATH_FIELD_BY_TOOL = {
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
};

/** Prefix `mktemp -d` gives its directories. */
const MKTEMP_PREFIX = 'tmp.';

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
    stdio: ['ignore', 'pipe', 'ignore'],
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

/** True when `target` is inside a `tmp.*` directory directly under the temp root. */
function isInMktempDir(target, tempRoot) {
  if (!target.startsWith(tempRoot + sep)) return false;
  const first = target.slice(tempRoot.length + 1).split(sep)[0];
  return first.startsWith(MKTEMP_PREFIX) && first.length > MKTEMP_PREFIX.length;
}

/** The trail's recorded working copy for this helper, or null (no record / no field / unreadable). */
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

function refuse(target, worktree, tempRoot, why) {
  process.stderr.write(`[HELPER_WRITE_SCOPE_GATE] Refused: ${why}

  target:    ${target}
  worktree:  ${worktree}

An isolated helper may write only inside:
  1. its own worktree (including the gitignored .scratch/ directory): ${worktree}
  2. a \`mktemp -d\` directory under the temp root: ${join(tempRoot, `${MKTEMP_PREFIX}*`)}

Other sessions' scratchpads and other worktrees are off limits. Put scratch files in
<worktree>/.scratch/ or create a directory with \`mktemp -d\`, then retry.
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

const recordedCopy = trailWorkingCopy(payload);
const anchor = recordedCopy ?? cwd;

// Identification: is the helper's working copy a linked worktree?
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

const tempRoot = canonicalize(tmpdir());
let worktree;
try {
  worktree = realpathSync(git(anchor, ['rev-parse', '--show-toplevel']));
} catch {
  // Isolated but unresolvable: refuse loud rather than allow silently.
  refuse(rawTarget, '<unresolved>', tempRoot, `this call comes from an isolated helper (agent_id ${payload.agent_id}) but its worktree root could not be resolved from ${anchor}`);
}

const target = canonicalize(isAbsolute(rawTarget) ? rawTarget : resolve(cwd, rawTarget));
if (isWithin(target, worktree) || isInMktempDir(target, tempRoot)) process.exit(0);

refuse(target, worktree, tempRoot, `${payload.tool_name} target is outside this isolated helper's worktree`);
