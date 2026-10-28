#!/usr/bin/env node
/**
 * pre-edit-anchor-gate.mjs — PreToolUse hook on Write|Edit|MultiEdit|NotebookEdit|Bash.
 *
 * A helper's edit outside the anchors of its claimed task is declared (one lore command, overlap-checked) or
 * denied BEFORE it happens, instead of being found at `lore integrate` (own-diff judgment, BR-1346) after the work.
 *
 * Public surface: none. Executable script, no exports.
 * Side-effect class: IO — reads stdin, the trail record, the scope file, the edited file, git metadata; spawns
 * `git check-ignore` and at most one `lore` process per unit to declare; writes only to stderr. The one corpus write
 * (an anchor) is done BY `lore anchor declare`.
 *
 * ## Which calls it governs
 *
 *   - Only a call made BY A HELPER (payload carries `agent_id`). The main session is never affected.
 *   - Only a target inside the helper's own working copy. A path in no working copy (scratchpad, mktemp) is not an
 *     anchorable repository path; the foreign-working-copy gate and integrate's own-diff judgment (BR-1346) keep those.
 *   - The helper's working copy is the trail record's `working_copy` (SubagentStart), NOT the drifting payload
 *     `cwd`; the payload cwd is the fallback only when no record carries one.
 *
 * ## What an edit touches (the unit of an anchor)
 *
 *   - Write, NotebookEdit, a non-source file, an Edit whose old_string cannot be located, a Bash write: the WHOLE file
 *     (`path`).
 *   - Edit / MultiEdit on a source file (`lib/top-level-symbols.mjs`): the top-level symbols whose region contains the
 *     replaced text (`path#Symbol`; imports and re-exports are `path#$toplevel`).
 *   - An anchor is `path` (whole file), `path#Symbol`, or `dir/`. A directory anchor holds only the files its holder
 *     really touched, so it never covers an edit by itself: the first edit of a file under it is declared as a file anchor
 *     (after the overlap check against every other live claim).
 *
 * ## Decision (fail-closed for Edit/Write: anything undecidable is a denial that names why)
 *
 * Order of work: the in-anchor fast path runs FIRST (scope file + the edited file; no process is spawned, the working copy
 * is found by walking up to `.git`), so an edit inside a file/symbol anchor never pays for `git check-ignore`. Steps 1-3
 * below run only for a unit that no anchor of the scope file covers.
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
 *        - every unit equals / lies inside one claim's file or symbol anchor -> allow, no write
 *   3. otherwise `lore anchor declare <task> <unit> --worktree <wc>` per uncovered unit
 *        - exit 0 (free: anchor added, or covered/ignored)               -> allow
 *        - any other exit (exit 4 = held by another live claim)          -> deny, quoting lore's refusal
 *      The claim is the one the helper's run holds; several claims and none held by this run -> deny.
 *
 * ## Bash (BR-1092: refuse only what lands on someone else and cannot be undone)
 *
 * A helper's shell write whose targets are readable from the command text (`sed -i f`, `> f`, `tee f`, `cp a f`, python
 * `open(f, 'w')`, see lib/shell-writes.mjs) goes through steps 1-3 as a whole-file touch. It is REFUSED only when
 * another live claim holds the file (declare's `held-by-other-claim`) or the target is the scope file. Everything else
 * (no claim, ambiguous claim, lore unavailable) is allowed: the harm is the helper's own and integrate's own-diff
 * judgment (BR-1346) reports it. A free file outside the anchors is auto-declared, never refused.
 *
 * A write the text shows but does not place (`unmeasured`: a variable path, `sed -i "$f"`, `python3 -c "$CODE"`) is
 * refused (BR-1493) when a live claim held by ANOTHER run holds a path anywhere in the project (one
 * `lore anchor scope --all` read, spawned only then), allowed otherwise; an unreadable read is refused too. A command the
 * parser cannot segment is not refused. A program in a script file is out of scope: BR-1346 judges it at integrate.
 *
 * ## Invariant: the overlap rule lives in lore, not here
 *
 * The in-anchor test below is the membership fast path only (a file anchor equals the path, a symbol anchor equals the
 * unit or the whole file) — the cases `anchorsOverlap` reduces to for ONE unit against the helper's own claim. Anything
 * not provably covered is handed to `lore anchor declare`, which runs the task-claim gate's own predicate.
 *
 * Exit codes: 2 = denied. 0 = not applicable or allowed. A malformed payload exits 0 (nothing to assert on).
 */

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { getStateBase, resolveSessionId } from './lib/turn-state.mjs';
import { deriveClaudeCodeRunId } from './lib/run-id.mjs';
import { extractShellWriteTargets, mayWriteFiles } from './lib/shell-writes.mjs';
import { isSymbolScannable, locateAll, touchedSymbols } from './lib/top-level-symbols.mjs';
import { trackOutcome, noteHookCwd } from './lib/check-outcome.mjs';
trackOutcome('hook:pre-edit-anchor-gate');

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
    const parsed = noteHookCwd(JSON.parse(readFileSync(0, 'utf8')));
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

/**
 * The root of the git working copy containing `dir`, found by walking up to the nearest `.git` entry (a directory, or the
 * file a linked worktree has) — no process spawned. Null when none is found (the caller then asks git).
 */
function findWorkingCopyRoot(dir) {
  let probe = canonicalize(dir);
  for (;;) {
    try {
      statSync(join(probe, '.git'));
      return probe;
    } catch {
      // keep climbing
    }
    const parent = dirname(probe);
    if (parent === probe) return null;
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

/** `path#Symbol` split on the last `#` when the tail is an identifier (the anchor grammar); otherwise the whole string is the path. */
function splitAnchor(anchor) {
  const hash = anchor.lastIndexOf('#');
  if (hash <= 0) return { path: anchor, symbol: undefined };
  const head = anchor.slice(0, hash);
  const tail = anchor.slice(hash + 1);
  if (head.endsWith('/') || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(tail)) return { path: anchor, symbol: undefined };
  return { path: head, symbol: tail };
}

/**
 * Whether ONE anchor covers the unit (`path`, optional symbol): the same file, and the anchor is whole-file or names the
 * same symbol. A directory anchor never covers (it holds only the files its holder touched; lore decides by declaring).
 */
function anchorCovers(anchor, path, symbol) {
  const held = splitAnchor(anchor);
  if (held.path.endsWith('/')) return false;
  const a = held.path.split('/').filter(Boolean);
  const p = path.split('/').filter(Boolean);
  if (a.length === 0 || a.length !== p.length || !a.every((seg, i) => seg === p[i])) return false;
  return held.symbol === undefined || held.symbol === symbol;
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

/**
 * The units an Edit/MultiEdit touches in `target`: `[undefined]` (the whole file) or one symbol name per touched
 * top-level symbol. Undecidable -> the whole file.
 */
function touchedUnits(payload, target) {
  const wholeFile = [undefined];
  if (payload.tool_name !== 'Edit' && payload.tool_name !== 'MultiEdit') return wholeFile;
  if (!isSymbolScannable(target)) return wholeFile;
  const input = payload.tool_input ?? {};
  const olds = payload.tool_name === 'Edit' ? [input.old_string] : (Array.isArray(input.edits) ? input.edits.map((e) => e?.old_string) : []);
  if (olds.length === 0 || olds.some((o) => typeof o !== 'string' || o === '')) return wholeFile;
  let text;
  try {
    text = readFileSync(target, 'utf8');
  } catch {
    return wholeFile;
  }
  const spans = olds.flatMap((old) => locateAll(text, old));
  // reason: every old_string must be located; one that is missing means the edit's extent is unknown, so hold the file.
  if (olds.some((old) => locateAll(text, old).length === 0)) return wholeFile;
  return touchedSymbols(text, spans) ?? wholeFile;
}

const payload = readPayload();
if (payload === null) process.exit(0);

const isBash = payload.tool_name === 'Bash';
const pathField = PATH_FIELD_BY_TOOL[payload.tool_name];
if (pathField === undefined && !isBash) process.exit(0);
if (typeof payload.agent_id !== 'string' || payload.agent_id === '') process.exit(0);

const cwd = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : process.cwd();

/**
 * BR-1493: a helper's shell write the text shows but does not place (`unmeasured`, other than an unsegmentable command)
 * is refused while a live claim held by ANOTHER run holds a path anywhere in the project; with no such claim the harm
 * can only be the helper's own and integrate's own-diff judgment (BR-1346) stays the check. When the project's claims
 * cannot be read the call is refused too (fail closed): whether another run holds a path is unknown.
 * Exits the process on a refusal, returns otherwise.
 */
function refuseUnreadableWrites(entries) {
  if (entries.length === 0) return;
  const named = entries.map((entry) => entry.text).join('; ');
  const advice = 'Use Edit/Write on the file, or a command whose target is a literal path.';
  let run;
  try {
    run = deriveClaudeCodeRunId(payload);
  } catch (err) {
    deny(`a shell write whose target cannot be read (${named}) was attempted and the helper's run id could not be derived (${err.message}), so whether another run holds a path is unknown. ${advice}`);
  }
  let claims;
  try {
    const read = runLore(trailWorkingCopy(payload) ?? cwd, ['anchor', 'scope', '--all', '--json', '--harness-run', run]);
    if (read.status !== 0) throw `\`lore anchor scope --all\` exited ${read.status}: ${(read.stderr || read.stdout).trim().split('\n')[0]}`;
    const data = JSON.parse(read.stdout)?.data;
    if (!Array.isArray(data?.claims)) throw '`lore anchor scope --all --json` did not return {claims}';
    claims = data.claims;
  } catch (err) {
    deny(`a shell write whose target cannot be read (${named}) was attempted and the project's claims could not be read, so whether another run holds a path is unknown: ${typeof err === 'string' ? err : `\`lore anchor scope --all\` output was not readable (${err?.message ?? err})`}. ${advice}`);
  }
  const others = claims.filter((claim) => claim?.holder_run !== run && Array.isArray(claim.anchors) && claim.anchors.length > 0);
  if (others.length === 0) return;
  deny(
    `shell write whose target cannot be read from the command text: ${named}. Another run holds paths (${others.map((c) => c.task).join(', ')}), ` +
      `so this write could land on a file it holds. ${advice} (BR-1493)`,
  );
}

// The targets: one file for a write tool, every readable shell-write target for Bash.
let rawTargets;
if (isBash) {
  const command = payload.tool_input?.command;
  if (typeof command !== 'string' || !mayWriteFiles(command)) process.exit(0);
  const extracted = extractShellWriteTargets(command, { cwd: resolve(cwd), env: process.env });
  rawTargets = extracted.paths;
  // reason: an unsegmentable command is reported but never refused (BR-1493): its writes are unknown in kind as well as
  // target, and refusing it would refuse arbitrary complex read-only commands.
  refuseUnreadableWrites(extracted.unmeasured.filter((entry) => entry.kind !== 'unsegmentable'));
  if (rawTargets.length === 0) process.exit(0);
} else {
  const rawTarget = payload.tool_input?.[pathField];
  if (typeof rawTarget !== 'string' || rawTarget === '') process.exit(0);
  rawTargets = [isAbsolute(rawTarget) ? rawTarget : resolve(cwd, rawTarget)];
}

/** Bash refuses only what lands on someone else; every other problem is the helper's own and is left to integrate's own-diff judgment (BR-1346). */
function refuse(why) {
  if (isBash) process.exit(0);
  deny(why);
}

const anchorDir = trailWorkingCopy(payload) ?? cwd;
let workingCopy;
try {
  workingCopy = findWorkingCopyRoot(anchorDir) ?? realpathSync(git(anchorDir, ['rev-parse', '--show-toplevel']));
} catch (err) {
  const stderr = String(err?.stderr ?? '');
  // Not a git repository at all: no anchors can exist for it.
  if (/not a git repository/i.test(stderr)) process.exit(0);
  refuse(`the helper's working copy could not be resolved from ${anchorDir}: ${stderr.trim().split('\n')[0] || err?.message || err}`);
}

/** Units still to place, as `{ rel, target, symbol }` (symbol undefined = the whole file). No process is spawned to build them. */
const units = [];
for (const rawTarget of rawTargets) {
  const target = canonicalize(rawTarget);
  // A target outside the helper's own working copy is not an anchorable repository path (see header).
  if (target === workingCopy || !target.startsWith(workingCopy + sep)) continue;
  const rel = relative(workingCopy, target).split(sep).join('/');

  // The scope file is lore's record of this helper's scope: git ignores it, so without this line an edit to it would
  // pass as "ignored" and a helper could widen its own scope. Only lore's verbs write it.
  if (rel === SCOPE_FILE_NAME) deny(`${SCOPE_FILE_NAME} is written by lore (claim, anchor declare|add|rm, release); do not edit it. Declare scope with \`lore anchor declare <task> <path> --worktree ${workingCopy}\`.`);

  for (const symbol of isBash ? [undefined] : touchedUnits(payload, target)) units.push({ rel, target, symbol });
}
if (units.length === 0) process.exit(0);

// 0. In-anchor fast path: every unit is covered by a file or symbol anchor in the scope file lore keeps current. Nothing
// is spawned (no git, no lore); a covered path that is also git-ignored is allowed either way, so ignore is not asked.
let scope = readScopeFile(workingCopy);
const isCovered = ({ rel, symbol }) => scope.claims.some((claim) => Array.isArray(claim.anchors) && claim.anchors.some((anchor) => anchorCovers(String(anchor), rel, symbol)));
if (scope !== undefined && units.every(isCovered)) process.exit(0);

// 1. Git-ignored in the helper's working copy (scratch dirs, build output): not repository content.
{
  const ignoredByFile = new Map();
  for (const { rel, target } of units) {
    if (ignoredByFile.has(rel)) continue;
    const probeDir = nearestExistingDir(dirname(target));
    const ignored = spawnSync('git', ['-C', probeDir, 'check-ignore', '-q', '--', target], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS });
    if (ignored.error) {
      refuse(`git check-ignore could not run for ${rel}: ${ignored.error.message}`);
      ignoredByFile.set(rel, true);
      continue;
    }
    // reason: status 1 = not ignored; anything else (128 = fatal) is an unmeasurable answer -> fail closed (Edit/Write).
    if (ignored.status !== 0 && ignored.status !== 1) {
      refuse(`git check-ignore failed for ${rel} (exit ${ignored.status}): ${(ignored.stderr ?? '').trim().split('\n')[0]}`);
    }
    ignoredByFile.set(rel, ignored.status === 0);
  }
  for (let i = units.length - 1; i >= 0; i -= 1) if (ignoredByFile.get(units[i].rel) === true) units.splice(i, 1);
}
if (units.length === 0) process.exit(0);

let run;
try {
  run = deriveClaudeCodeRunId(payload);
} catch (err) {
  refuse(`the helper's run id could not be derived (${err.message}); without it its claim cannot be found`);
}

// 2. The working copy's open claims: the scope file read above, else one lore read.
if (scope === undefined) {
  try {
    const read = runLore(workingCopy, ['anchor', 'scope', '--worktree', workingCopy, '--json', '--harness-run', run]);
    if (read.status !== 0) refuse(`\`lore anchor scope\` exited ${read.status}: ${(read.stderr || read.stdout).trim().split('\n')[0]}`);
    scope = JSON.parse(read.stdout)?.data;
  } catch (err) {
    refuse(typeof err === 'string' ? err : `\`lore anchor scope\` output was not readable (${err?.message ?? err})`);
  }
}
if (scope === undefined || !Array.isArray(scope.claims) || !Array.isArray(scope.not_measured)) {
  refuse('`lore anchor scope --json` did not return {claims, not_measured}');
}
if (scope.not_measured.length > 0) refuse(`an open claim of this working copy could not be resolved: ${scope.not_measured.join('; ')}`);
if (scope.claims.length === 0) {
  refuse(
    `no open task claim records the working copy ${workingCopy}, so ${units[0].rel} is in no task's scope. ` +
      'Claim your task first: `lore claim <task-slug> --worktree <branch>` (run it from inside this working copy).',
  );
}
const uncovered = units.filter((unit) => !isCovered(unit));
if (uncovered.length === 0) process.exit(0);

// 3. Out of every anchor: declare each uncovered unit on this run's claim, or be refused by lore.
const own = scope.claims.filter((claim) => claim.holder_run === run);
const chosen = scope.claims.length === 1 ? scope.claims[0] : own.length === 1 ? own[0] : undefined;
const unitName = ({ rel, symbol }) => (symbol === undefined ? rel : `${rel}#${symbol}`);
if (chosen === undefined) {
  refuse(
    `${unitName(uncovered[0])} is outside every anchor and the claim to declare it on is ambiguous (open claims here: ` +
      `${scope.claims.map((c) => c.task).join(', ')}; held by run ${run}: ${own.map((c) => c.task).join(', ') || 'none'}). ` +
      `Declare it yourself with \`lore anchor declare <task> ${unitName(uncovered[0])} --worktree ${workingCopy}\`, then retry.`,
  );
}
for (const unit of uncovered) {
  const name = unitName(unit);
  try {
    const declared = runLore(workingCopy, ['anchor', 'declare', String(chosen.task), name, '--worktree', workingCopy, '--harness-run', run]);
    if (declared.status === 0) continue;
    const reason = (declared.stderr || declared.stdout).trim();
    // reason: BR-1092 — a shell write is refused only when another live claim holds the target.
    if (isBash && !/held-by-other-claim/.test(reason)) continue;
    deny(
      `${name} is outside the anchors of ${chosen.task} and \`lore anchor declare\` refused it (exit ${declared.status}): ${reason}\n` +
        'Do not edit this file. Report STATUS: BLOCKED naming the claim above.',
    );
  } catch (err) {
    refuse(typeof err === 'string' ? err : `\`lore anchor declare\` could not complete (${err?.message ?? err})`);
  }
}
