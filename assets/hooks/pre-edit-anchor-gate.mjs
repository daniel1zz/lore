#!/usr/bin/env node
/**
 * pre-edit-anchor-gate.mjs — PreToolUse hook on Write|Edit|MultiEdit|NotebookEdit.
 *
 * A helper's edit outside the anchors of its claimed task is declared (one lore command, overlap-checked) or
 * denied BEFORE it happens, instead of being found by the turn-end review after the work.
 *
 * Public surface: none. Executable script, no exports.
 * Side-effect class: IO — reads stdin, the trail record, git metadata; spawns `git check-ignore` and at most two
 * `lore` processes; writes only to stderr. The one corpus write (an anchor) is done BY `lore anchor declare`.
 *
 * ## Which calls it governs
 *
 *   - Only a call made BY A HELPER (payload carries `agent_id`). The main session is never affected.
 *   - Only a target inside the helper's own working copy. A path in no working copy (scratchpad, mktemp) is not an
 *     anchorable repository path; the foreign-working-copy gate and the turn-end review keep those.
 *   - The helper's working copy is the trail record's `working_copy` (SubagentStart), NOT the drifting payload
 *     `cwd`; the payload cwd is the fallback only when no record carries one.
 *
 * ## Decision (fail-closed: anything undecidable is a denial that names why)
 *
 *   1. target git-ignored in that working copy (`git check-ignore`)      -> allow
 *   0. target is the scope file itself (`.lore-scope.json`)                  -> deny (only lore writes it)
 *   2. the open claims of the working copy, their anchors and holder runs, from `<wc>/.lore-scope.json` (kept
 *      current by `lore claim`, `anchor declare|add|rm`, `release`; no process spawned). A missing, unreadable,
 *      other-schema or empty file, or one with an unmeasured claim, is NOT trusted: the hook asks
 *      `lore anchor scope --worktree <wc> --json` instead (also the path for a claim made before the file existed).
 *        - cannot be read (lore missing, non-zero exit, unparseable)     -> deny, naming the reason
 *        - claims not all measured (worktree unresolved)                 -> deny, naming them
 *        - no open claim                                                 -> deny, naming `lore claim`
 *        - target inside some claim's anchors (file or directory anchor) -> allow, no write
 *   3. otherwise `lore anchor declare <task> <path> --worktree <wc>`
 *        - exit 0 (free: anchor added, or covered/ignored)               -> allow
 *        - any other exit (exit 4 = held by another live claim)          -> deny, quoting lore's refusal
 *      The claim is the one the helper's run holds; several claims and none held by this run -> deny.
 *
 * ## Invariant: the overlap rule lives in lore, not here
 *
 * The in-anchor test below is the membership fast path only (a file anchor equals the path, a directory anchor
 * `dir/` is a whole-segment prefix of it) — the same two cases `anchorsOverlap` reduces to for one file. Anything
 * not provably covered is handed to `lore anchor declare`, which runs the task-claim gate's own predicate.
 *
 * ## Out of scope
 *
 * Bash file writes (a hook cannot parse shell reliably): the turn-end helper-scope review stays their backstop.
 *
 * Exit codes: 2 = denied. 0 = not applicable or allowed. A malformed payload exits 0 (nothing to assert on).
 */

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { getStateBase, resolveSessionId } from './lib/turn-state.mjs';
import { deriveClaudeCodeRunId } from './lib/run-id.mjs';

/** Tools whose target path this hook checks, with the payload field that carries it. */
const PATH_FIELD_BY_TOOL = {
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
};

/** Hard caps: a hung child must not stall the tool call forever (a denial names the timeout). */
const GIT_TIMEOUT_MS = 3000;
const LORE_TIMEOUT_MS = 30000;
const LORE_BINARY = 'lore';

function readPayload() {
  try {
    const parsed = JSON.parse(readFileSync(0, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function deny(why) {
  process.stderr.write(`[EDIT_ANCHOR_GATE] Edit refused before it happened: ${why}\n`);
  process.exit(2);
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

/** The working copy the SubagentStart trail record carries for this helper, or null. */
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

/** Anchor membership for ONE file path: equal segments, or a directory anchor that is a whole-segment prefix. */
function anchorCovers(anchor, path) {
  const isDir = anchor.endsWith('/');
  const a = anchor.split('/').filter(Boolean);
  const p = path.split('/').filter(Boolean);
  if (a.length === 0) return false;
  if (a.length === p.length) return a.every((seg, i) => seg === p[i]);
  return isDir && a.length < p.length && a.every((seg, i) => seg === p[i]);
}

/** Name and shape version of the scope file `lore` keeps in each claiming worktree (SCOPE_FILE_NAME / SCOPE_FILE_SCHEMA in service/edit-scope.ts). */
const SCOPE_FILE_NAME = '.lore-scope.json';
const SCOPE_FILE_SCHEMA = 1;

/**
 * The scope file's `{claims, not_measured}`, or undefined when the hook must ask lore instead: no file, unreadable,
 * not this schema, naming another working copy, any unmeasured claim, or no claim at all (a released worktree must
 * get lore's authoritative "no claim" answer, never a stale list). Never an allow by itself.
 */
function readScopeFile(workingCopy) {
  try {
    const data = JSON.parse(readFileSync(join(workingCopy, SCOPE_FILE_NAME), 'utf8'));
    if (data?.schema !== SCOPE_FILE_SCHEMA || !Array.isArray(data.claims) || !Array.isArray(data.not_measured)) return undefined;
    if (data.not_measured.length > 0 || data.claims.length === 0) return undefined;
    if (typeof data.working_copy !== 'string' || realpathSync(data.working_copy) !== workingCopy) return undefined;
    if (!data.claims.every((c) => typeof c?.task === 'string' && Array.isArray(c.anchors))) return undefined;
    return { claims: data.claims, not_measured: [] };
  } catch {
    return undefined;
  }
}

/** Runs lore; returns { status, stdout, stderr } or throws a reason string on spawn failure / timeout. */
function runLore(cwd, args) {
  const child = spawnSync(LORE_BINARY, args, { cwd, encoding: 'utf8', timeout: LORE_TIMEOUT_MS });
  if (child.error) throw `\`lore\` could not run (${child.error.message})`;
  if (child.status === null) throw `\`lore ${args[0]} ${args[1]}\` did not exit (${child.signal ?? 'no signal'})`;
  return { status: child.status, stdout: child.stdout ?? '', stderr: child.stderr ?? '' };
}

const payload = readPayload();
if (payload === null) process.exit(0);

const pathField = PATH_FIELD_BY_TOOL[payload.tool_name];
if (pathField === undefined) process.exit(0);
if (typeof payload.agent_id !== 'string' || payload.agent_id === '') process.exit(0);

const cwd = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : process.cwd();
const rawTarget = payload.tool_input?.[pathField];
if (typeof rawTarget !== 'string' || rawTarget === '') process.exit(0);

const anchorDir = trailWorkingCopy(payload) ?? cwd;
let workingCopy;
try {
  workingCopy = realpathSync(git(anchorDir, ['rev-parse', '--show-toplevel']));
} catch (err) {
  const stderr = String(err?.stderr ?? '');
  // Not a git repository at all: no anchors can exist for it.
  if (/not a git repository/i.test(stderr)) process.exit(0);
  deny(`the helper's working copy could not be resolved from ${anchorDir}: ${stderr.trim().split('\n')[0] || err?.message || err}`);
}

const target = canonicalize(isAbsolute(rawTarget) ? rawTarget : resolve(cwd, rawTarget));
// A target outside the helper's own working copy is not an anchorable repository path (see header).
if (target === workingCopy || !target.startsWith(workingCopy + sep)) process.exit(0);
const rel = relative(workingCopy, target).split(sep).join('/');

let run;
try {
  run = deriveClaudeCodeRunId(payload);
} catch (err) {
  deny(`the helper's run id could not be derived (${err.message}); without it its claim cannot be found`);
}

// The scope file is lore's record of this helper's scope: git ignores it, so without this line an edit to it would
// pass as "ignored" and a helper could widen its own scope. Only lore's verbs write it.
if (rel === SCOPE_FILE_NAME) deny(`${SCOPE_FILE_NAME} is written by lore (claim, anchor declare|add|rm, release); do not edit it. Declare scope with \`lore anchor declare <task> <path> --worktree ${workingCopy}\`.`);

// 1. Git-ignored in the helper's working copy (scratch dirs, build output): not repository content.
{
  const probeDir = nearestExistingDir(dirname(target));
  const ignored = spawnSync('git', ['-C', probeDir, 'check-ignore', '-q', '--', target], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS });
  if (ignored.error) deny(`git check-ignore could not run for ${rel}: ${ignored.error.message}`);
  if (ignored.status === 0) process.exit(0);
  // reason: status 1 = not ignored; anything else (128 = fatal) is an unmeasurable answer -> fail closed.
  if (ignored.status !== 1) deny(`git check-ignore failed for ${rel} (exit ${ignored.status}): ${(ignored.stderr ?? '').trim().split('\n')[0]}`);
}

// 2. The working copy's open claims: the scope file lore keeps current (no process spawned), else one lore read.
let scope = readScopeFile(workingCopy);
if (scope === undefined) {
  try {
  const read = runLore(workingCopy, ['anchor', 'scope', '--worktree', workingCopy, '--json', '--harness-run', run]);
  if (read.status !== 0) deny(`\`lore anchor scope\` exited ${read.status}: ${(read.stderr || read.stdout).trim().split('\n')[0]}`);
  scope = JSON.parse(read.stdout)?.data;
} catch (err) {
  deny(typeof err === 'string' ? err : `\`lore anchor scope\` output was not readable (${err?.message ?? err})`);
  }
}
if (scope === undefined || !Array.isArray(scope.claims) || !Array.isArray(scope.not_measured)) {
  deny('`lore anchor scope --json` did not return {claims, not_measured}');
}
if (scope.not_measured.length > 0) deny(`an open claim of this working copy could not be resolved: ${scope.not_measured.join('; ')}`);
if (scope.claims.length === 0) {
  deny(
    `no open task claim records the working copy ${workingCopy}, so ${rel} is in no task's scope. ` +
      'Claim your task first: `lore claim <task-slug> --worktree <branch>` (run it from inside this working copy).',
  );
}
const covering = scope.claims.find((claim) => Array.isArray(claim.anchors) && claim.anchors.some((anchor) => anchorCovers(String(anchor), rel)));
if (covering !== undefined) process.exit(0);

// 3. Out of every anchor: declare it on this run's claim, or be refused by lore.
const own = scope.claims.filter((claim) => claim.holder_run === run);
const chosen = scope.claims.length === 1 ? scope.claims[0] : own.length === 1 ? own[0] : undefined;
if (chosen === undefined) {
  deny(
    `${rel} is outside every anchor and the claim to declare it on is ambiguous (open claims here: ` +
      `${scope.claims.map((c) => c.task).join(', ')}; held by run ${run}: ${own.map((c) => c.task).join(', ') || 'none'}). ` +
      `Declare it yourself with \`lore anchor declare <task> ${rel} --worktree ${workingCopy}\`, then retry.`,
  );
}
try {
  const declared = runLore(workingCopy, ['anchor', 'declare', String(chosen.task), rel, '--worktree', workingCopy, '--harness-run', run]);
  if (declared.status === 0) process.exit(0);
  const reason = (declared.stderr || declared.stdout).trim();
  deny(
    `${rel} is outside the anchors of ${chosen.task} and \`lore anchor declare\` refused it (exit ${declared.status}): ${reason}\n` +
      'Do not edit this file. Report STATUS: BLOCKED naming the claim above.',
  );
} catch (err) {
  deny(typeof err === 'string' ? err : `\`lore anchor declare\` could not complete (${err?.message ?? err})`);
}
