/**
 * session-trail.mjs — writers, retention and reader of the session trail, for hooks.
 *
 * Purpose: hook-side twin of `packages/core/src/session-trail.ts` (+ `session-trail-node.ts`):
 * the trail lives under `<stateBase>/sessions/<session_id>/` (spec
 * spec-session-trail-a-session-local-record-of-what-each-run-4, Design > Trail layout).
 *
 * Public surface: getStateBase, parseRunId, sessionOfRun, readSessionTrail (reader);
 *   writeJsonAtomic, writeJsonExclusive, recordSessionStart, recordHelperStart,
 *   recordHelperEnd, measureHelperChanges, applyRetention, RETENTION_DAYS, MARKER_RETENTION_DAYS
 *   (writers); snapshotWorkingTree, readHeadState, diffTrees, attributeTurn, recordTurnChanges
 *   (turn-end attribution; `attributeTurn` is the PURE part, the rest gathers git facts); typed errors.
 *
 * Invariants:
 *   - Hooks are standalone files with no access to `@lore/core`, so the reader and the schemas
 *     are a copy. `tests/integration/hooks/session-trail-runs.test.ts` pins this module equal to
 *     the @lore/core reader (fixture trail, state base, run-id parsing). Change both or neither.
 *   - Every trail write is a temp file in the same directory + rename (`writeJsonAtomic`), or a
 *     temp file + hard link when an existing file must never be overwritten (`writeJsonExclusive`).
 *   - Each file has ONE writer: session.json (SessionStart, once), removed.json (retention),
 *     helpers/<agent>.json (SubagentStart/Stop), changes.json (the turn-end review, through
 *     `recordTurnChanges`) and *.judged.json (the turn-end review, not this module).
 *     edited-files.jsonl stays post-edit-mark's (BR-1088).
 *   - The reader mirrors the core one: unknown keys are invalid; per-turn files degrade to
 *     `{measured:false, reason}` with fixed reason strings; session-level files throw.
 *   - Writers throw on failure; the hook entrypoints (session-trail-start.mjs) turn that into
 *     silence (spec D13: trail hooks write nothing on any path).
 *
 * Side-effect class: IO (filesystem).
 */

import {
  existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, realpathSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getStateBase } from './turn-state.mjs';

export { getStateBase };

/** A trail idle for more than this many days is replaced by a removal marker (spec D11). */
export const RETENTION_DAYS = 14;
/** A removal marker is itself removed this many days after it was written (spec D17). */
export const MARKER_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

// ---------------------------------------------------------------------------
// Typed errors (names are part of the parity contract with core)
// ---------------------------------------------------------------------------

export class TrailRunIdInvalidError extends Error {
  constructor(run) {
    super(`not a claude-code run id (cc:<session>[:<agent>]): ${JSON.stringify(run)}`);
    this.name = 'TrailRunIdInvalidError';
    this.run = run;
  }
}

export class TrailSessionIdInvalidError extends Error {
  constructor(sessionId) {
    super(`unusable session id for a trail path: ${JSON.stringify(sessionId)}`);
    this.name = 'TrailSessionIdInvalidError';
    this.sessionId = sessionId;
  }
}

export class TrailFileInvalidError extends Error {
  constructor(file, reason) {
    super(`session trail file ${file} is invalid: ${reason}`);
    this.name = 'TrailFileInvalidError';
    this.file = file;
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Run ids (twin of parseRunId / sessionOfRun in core)
// ---------------------------------------------------------------------------

function isUsableId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id) && id !== '.' && id !== '..';
}

/**
 * @param {unknown} run - candidate run id.
 * @returns {{session: string, agent: string | null}}
 * @throws {TrailRunIdInvalidError} for anything but `cc:<session>[:<agent>]` over `[A-Za-z0-9._-]+`.
 */
export function parseRunId(run) {
  if (typeof run !== 'string') throw new TrailRunIdInvalidError(run);
  const parts = run.split(':');
  if (parts[0] !== 'cc' || parts.length < 2 || parts.length > 3) throw new TrailRunIdInvalidError(run);
  const [, session, agent] = parts;
  if (!isUsableId(session)) throw new TrailRunIdInvalidError(run);
  if (agent === undefined) return { session, agent: null };
  if (!ID_PATTERN.test(agent)) throw new TrailRunIdInvalidError(run);
  return { session, agent };
}

/** @param {unknown} run @returns {string} the session id of `cc:S` / `cc:S:A`. */
export function sessionOfRun(run) {
  return parseRunId(run).session;
}

function assertSessionId(sessionId) {
  if (!isUsableId(sessionId)) throw new TrailSessionIdInvalidError(sessionId);
}

// ---------------------------------------------------------------------------
// Schema validators (strict: exact key sets), twin of the zod schemas in core
// ---------------------------------------------------------------------------

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.length > 0;
const isCount = (v) => Number.isInteger(v) && v >= 0;

/** Exact key set: every `required` key present, no key outside required ∪ optional. */
function hasShape(value, required, optional = []) {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  return required.every((k) => k in value) && keys.every((k) => required.includes(k) || optional.includes(k));
}

function validSource(v) {
  if (!isObject(v)) return false;
  if (v.kind === 'run') return hasShape(v, ['kind', 'run']) && isText(v.run);
  if (v.kind === 'vcs' || v.kind === 'unknown') return hasShape(v, ['kind']);
  return false;
}

function validChange(v) {
  return hasShape(v, ['path', 'status', 'lines', 'source'])
    && isText(v.path) && ['A', 'M', 'D'].includes(v.status) && isCount(v.lines) && validSource(v.source);
}

function validMeasured(v, validValue) {
  if (!isObject(v)) return false;
  if (v.measured === true) return hasShape(v, ['measured', 'value']) && validValue(v.value);
  if (v.measured === false) return hasShape(v, ['measured', 'reason']) && isText(v.reason);
  return false;
}

const validChangeList = (v) => Array.isArray(v) && v.every(validChange);

function validTurnChanges(v) {
  return hasShape(v, ['turn', 'at', 'shared_working_copy', 'changes'])
    && isText(v.turn) && isText(v.at) && typeof v.shared_working_copy === 'boolean'
    && validMeasured(v.changes, validChangeList);
}

function validHelperChanges(v) {
  return hasShape(v, ['base', 'files']) && isText(v.base) && validChangeList(v.files);
}

function validHelperHead(v) {
  return hasShape(v, ['commit', 'branch']) && isText(v.commit) && (v.branch === null || isText(v.branch));
}

function validHelperRecord(v) {
  return hasShape(v, ['run', 'started_at', 'end_count'], ['ended_at', 'working_copy', 'isolated', 'base', 'changes', 'head'])
    && isText(v.run) && isText(v.started_at) && isCount(v.end_count)
    && (v.base === undefined || isText(v.base))
    && (v.ended_at === undefined || isText(v.ended_at))
    && (v.working_copy === undefined || isText(v.working_copy))
    && (v.isolated === undefined || typeof v.isolated === 'boolean')
    && (v.changes === undefined || validMeasured(v.changes, validHelperChanges))
    && (v.head === undefined || validMeasured(v.head, validHelperHead));
}

const validJudged = (v) => hasShape(v, ['judged_end_count'], ['judged_at_ms'])
  && isCount(v.judged_end_count) && (v.judged_at_ms === undefined || isCount(v.judged_at_ms));
const validSessionJson = (v) => hasShape(v, ['started_at']) && isText(v.started_at);
const validRemoved = (v) => hasShape(v, ['removed_at', 'started_at'])
  && isText(v.removed_at) && (v.started_at === null || isText(v.started_at));
const validEditRecord = (v) => hasShape(v, ['file', 'ts'], ['agent_id', 'agent_type'])
  && isText(v.file) && typeof v.ts === 'number' && Number.isFinite(v.ts)
  && (v.agent_id === undefined || (typeof v.agent_id === 'string' && ID_PATTERN.test(v.agent_id)))
  && (v.agent_type === undefined || typeof v.agent_type === 'string');

function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function parseSessionFile(file, text, valid) {
  const json = parseJson(text);
  if (!json.ok) throw new TrailFileInvalidError(file, 'not valid JSON');
  if (!valid(json.value)) throw new TrailFileInvalidError(file, 'does not match the trail schema');
  return json.value;
}

// ---------------------------------------------------------------------------
// Reader (twin of buildSessionTrail + readSessionTrail in core)
// ---------------------------------------------------------------------------

function readEdits(session, text) {
  if (text === null) return { measured: true, value: [] };
  const edits = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const json = parseJson(lines[i]);
    if (!json.ok || !validEditRecord(json.value)) {
      return { measured: false, reason: `edited-files.jsonl line ${i + 1} is not a valid edit record` };
    }
    const { file, ts, agent_id: agentId, agent_type: agentType } = json.value;
    edits.push({
      file,
      ts,
      run: agentId === undefined ? `cc:${session}` : `cc:${session}:${agentId}`,
      agent_type: agentType ?? null,
    });
  }
  return { measured: true, value: edits };
}

function readTurn(session, raw) {
  const openedAt = raw.opened_at_ms === null ? null : new Date(raw.opened_at_ms).toISOString();
  const edits = readEdits(session, raw.edited_files_jsonl);
  const unmeasured = (reason) => ({
    turn: raw.turn, opened_at: openedAt, edits, at: null, shared_working_copy: null,
    changes: { measured: false, reason },
  });
  if (raw.changes_json === null) return unmeasured('changes.json absent');
  const json = parseJson(raw.changes_json);
  if (!json.ok) return unmeasured('changes.json is not valid JSON');
  if (!validTurnChanges(json.value)) return unmeasured('changes.json does not match the trail schema');
  return {
    turn: raw.turn, opened_at: openedAt, edits, at: json.value.at,
    shared_working_copy: json.value.shared_working_copy, changes: json.value.changes,
  };
}

function readHelper(session, raw) {
  const recordFile = `helpers/${raw.agent_id}.json`;
  const record = parseSessionFile(recordFile, raw.record_json, validHelperRecord);
  if (record.run !== `cc:${session}:${raw.agent_id}`) {
    throw new TrailFileInvalidError(recordFile, 'run does not name this session and agent');
  }
  const judged = raw.judged_json === null
    ? { judged_end_count: 0 }
    : parseSessionFile(`helpers/${raw.agent_id}.judged.json`, raw.judged_json, validJudged);
  return {
    ...record,
    agent_id: raw.agent_id,
    judged_end_count: judged.judged_end_count,
    ...(judged.judged_at_ms === undefined ? {} : { judged_at_ms: judged.judged_at_ms }),
  };
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function compareTurns(a, b) {
  const am = a.opened_at_ms ?? Number.POSITIVE_INFINITY;
  const bm = b.opened_at_ms ?? Number.POSITIVE_INFINITY;
  if (am !== bm) return am < bm ? -1 : 1;
  return byText(a.turn, b.turn);
}

function readTextOrNull(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function readRawTurns(sessionDir) {
  return readdirSync(sessionDir)
    .filter((name) => name !== 'helpers' && statSync(join(sessionDir, name)).isDirectory())
    .map((turn) => {
      const dir = join(sessionDir, turn);
      const snapshot = join(dir, 'turn-start-snapshot.json');
      return {
        turn,
        opened_at_ms: existsSync(snapshot) ? statSync(snapshot).mtimeMs : null,
        edited_files_jsonl: readTextOrNull(join(dir, 'edited-files.jsonl')),
        changes_json: readTextOrNull(join(dir, 'changes.json')),
      };
    });
}

function readRawHelpers(sessionDir) {
  const dir = join(sessionDir, 'helpers');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.judged.json'))
    .map((name) => {
      const agentId = name.slice(0, -'.json'.length);
      return {
        agent_id: agentId,
        record_json: readFileSync(join(dir, name), 'utf8'),
        judged_json: readTextOrNull(join(dir, `${agentId}.judged.json`)),
      };
    });
}

/**
 * Read one session's trail.
 * @param {string} sessionId
 * @param {string} [base] - state base; default `getStateBase()`.
 * @returns {object | null} the trail (same shape as core `SessionTrail`), or null when the session dir is absent.
 * @throws {TrailSessionIdInvalidError | TrailFileInvalidError}
 */
export function readSessionTrail(sessionId, base = getStateBase()) {
  assertSessionId(sessionId);
  const sessionDir = join(base, 'sessions', sessionId);
  if (!existsSync(sessionDir) || !statSync(sessionDir).isDirectory()) return null;
  const sessionJson = readTextOrNull(join(sessionDir, 'session.json'));
  const removedJson = readTextOrNull(join(sessionDir, 'removed.json'));
  return {
    session: sessionId,
    started_at: sessionJson === null ? null : parseSessionFile('session.json', sessionJson, validSessionJson).started_at,
    removed: removedJson === null ? null : parseSessionFile('removed.json', removedJson, validRemoved),
    turns: readRawTurns(sessionDir).sort(compareTurns).map((t) => readTurn(sessionId, t)),
    helpers: readRawHelpers(sessionDir).sort((a, b) => byText(a.agent_id, b.agent_id)).map((h) => readHelper(sessionId, h)),
  };
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

function tempPathFor(file) {
  return join(dirname(file), `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`);
}

/**
 * Write JSON to `file` through a temp file in the same directory + rename (atomic replace).
 * @param {string} file @param {unknown} value
 * @throws on any filesystem failure; the temp file is removed first.
 */
export function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = tempPathFor(file);
  try {
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Create `file` with JSON content only when it does not exist yet (temp file + hard link:
 * atomic and never overwriting, unlike rename).
 * @returns {boolean} true when this call created the file, false when it already existed.
 */
export function writeJsonExclusive(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = tempPathFor(file);
  try {
    writeFileSync(tmp, JSON.stringify(value));
    linkSync(tmp, file);
    return true;
  } catch (err) {
    if (err?.code === 'EEXIST') return false;
    throw err;
  } finally {
    rmSync(tmp, { force: true });
  }
}

function readValidOrNull(file, valid) {
  try {
    const json = parseJson(readFileSync(file, 'utf8'));
    return json.ok && valid(json.value) ? json.value : null;
  } catch {
    return null;
  }
}

/**
 * SessionStart: apply retention to OTHER sessions, then write session.json once.
 * A session resumed after removal restores `started_at` from removed.json so the own-commit
 * window never shrinks. A second SessionStart (compact / resume) changes nothing in an
 * existing trail.
 * @param {string} base - state base. @param {string} sessionId @param {number} [nowMs]
 */
export function recordSessionStart(base, sessionId, nowMs = Date.now()) {
  assertSessionId(sessionId);
  applyRetention(base, sessionId, nowMs);
  const sessionDir = join(base, 'sessions', sessionId);
  const removed = readValidOrNull(join(sessionDir, 'removed.json'), validRemoved);
  const startedAt = removed?.started_at ?? new Date(nowMs).toISOString();
  writeJsonExclusive(join(sessionDir, 'session.json'), { started_at: startedAt });
}

/**
 * SubagentStart: create helpers/<agent_id>.json with end_count 0. An existing record is kept
 * (a repeated SubagentStart must not reset what SubagentStop wrote); `judged_end_count` is
 * never written here (single-writer rule). `workingCopy` (the SubagentStart payload cwd) is
 * recorded as `working_copy` so a later reader (pre-helper-foreign-working-copy-gate.mjs) knows
 * the helper's own working copy even after the helper's shell cwd drifts.
 * @returns {boolean} true when the record was created.
 */
export function recordHelperStart(base, sessionId, agentId, nowMs = Date.now(), workingCopy = undefined) {
  assertSessionId(sessionId);
  if (typeof agentId !== 'string' || !ID_PATTERN.test(agentId)) throw new TrailRunIdInvalidError(`cc:${sessionId}:${agentId}`);
  return writeJsonExclusive(join(base, 'sessions', sessionId, 'helpers', `${agentId}.json`), {
    run: `cc:${sessionId}:${agentId}`,
    started_at: new Date(nowMs).toISOString(),
    end_count: 0,
    ...(typeof workingCopy === 'string' && workingCopy !== '' ? { working_copy: workingCopy } : {}),
  });
}

/** Newest mtime (ms) of `path` and everything under it; symlinks count as themselves, never followed. */
function newestWriteMs(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return readdirSync(path).reduce((newest, name) => Math.max(newest, newestWriteMs(join(path, name))), stat.mtimeMs);
}

function expireTrail(sessionDir, nowMs) {
  const startedAt = readValidOrNull(join(sessionDir, 'session.json'), validSessionJson)?.started_at
    ?? readValidOrNull(join(sessionDir, 'removed.json'), validRemoved)?.started_at
    ?? null;
  // marker first: a crash between the two steps leaves a marker plus a fresh-looking partial
  // trail (kept until idle again), never a removed trail with no marker
  writeJsonAtomic(join(sessionDir, 'removed.json'), { removed_at: new Date(nowMs).toISOString(), started_at: startedAt });
  for (const name of readdirSync(sessionDir)) {
    if (name !== 'removed.json') rmSync(join(sessionDir, name), { recursive: true, force: true });
  }
}

/**
 * Retention (spec D11, D17) over `<base>/sessions/*`: a trail whose newest write is older than
 * 14 days is replaced by removed.json; a directory holding only a removal marker is removed when
 * the marker is older than 90 days. Never touches `startingSessionId`, non-directories (state.db,
 * stray files) or symlinks. One failing entry never stops the others.
 * @returns {{expired: string[], markersRemoved: string[]}} session ids acted on (for tests/diagnostics).
 */
export function applyRetention(base, startingSessionId, nowMs = Date.now()) {
  const sessionsDir = join(base, 'sessions');
  const result = { expired: [], markersRemoved: [] };
  if (!existsSync(sessionsDir)) return result;
  for (const entry of readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === startingSessionId || !isUsableId(entry.name)) continue;
    const dir = join(sessionsDir, entry.name);
    try {
      const names = readdirSync(dir);
      if (names.length === 1 && names[0] === 'removed.json') {
        if (nowMs - lstatSync(join(dir, 'removed.json')).mtimeMs > MARKER_RETENTION_DAYS * DAY_MS) {
          rmSync(dir, { recursive: true, force: true });
          result.markersRemoved.push(entry.name);
        }
      } else if (nowMs - newestWriteMs(dir) > RETENTION_DAYS * DAY_MS) {
        expireTrail(dir, nowMs);
        result.expired.push(entry.name);
      }
    } catch {
      // reason: retention is housekeeping at session start; one unreadable entry (a peer
      // session writing it, a permission fault) must not stop the others or the session.
      // The entry is simply retried at the next SessionStart. See spec D13.
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helper measurement (SubagentStop) — spec Design > Helper measurement, D6
// ---------------------------------------------------------------------------

/**
 * Copy the real index to `tempIndex` so unchanged files are not re-hashed, keeping its mtime.
 * reason: git treats an entry as "racily clean" (re-hashes it) only while the entry's mtime is not older
 * than the index FILE's mtime. A plain copy gets a fresh mtime, so a file edited in the same second
 * the real index was written, with an unchanged size, would be trusted as unchanged and the edit
 * would vanish from the diff. The copy takes the real index's mtime, floored to the millisecond so
 * rounding can only make more entries racy (safe), never fewer.
 */
function seedTempIndex(realIndex, tempIndex) {
  copyFileSync(realIndex, tempIndex);
  const { mtimeMs } = statSync(realIndex);
  const seconds = Math.floor(mtimeMs) / 1000;
  utimesSync(tempIndex, seconds, seconds);
}

function runGit(cwd, args, env = {}) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  });
}

/** Parse `--name-status -z` and `--numstat` output into trail changes labelled with the helper run. */
function parseDiff(nameStatusZ, numstat, run, workingCopy) {
  const lines = new Map();
  for (const row of numstat.split('\n')) {
    if (row === '') continue;
    const [added, deleted, ...rest] = row.split('\t');
    // binary files report "-": they count as 0 lines but are still listed by status
    lines.set(rest.join('\t'), (Number(added) || 0) + (Number(deleted) || 0));
  }
  const parts = nameStatusZ.split('\0').filter((p) => p !== '');
  const files = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i];
    const path = parts[i + 1];
    if (!['A', 'M', 'D'].includes(status)) continue;
    const absolute = resolve(workingCopy, path);
    // spec: paths outside the working copy are excluded from the helper's diff
    if (!absolute.startsWith(workingCopy + sep)) continue;
    files.push({ path, status, lines: lines.get(path) ?? 0, source: { kind: 'run', run } });
  }
  return files.sort((a, b) => byText(a.path, b.path));
}

/**
 * Paths the helper itself changed since `base`: what its own first-parent commits changed (a merge
 * commit contributes only the paths it changed against BOTH parents, i.e. conflict resolutions), plus
 * everything uncommitted or untracked. A path that only arrived by merging another branch (main) into
 * the helper's branch is not the helper's. The stored base is unchanged (spec D6); this only narrows
 * which paths of diff(base, working tree) are charged, and holds however many times main was merged.
 * @param {string} workingCopy
 * @param {string} base
 * @param {Record<string,string>} env - carries the temporary index already `add -A`'d.
 * @returns {Set<string>}
 */
function helperOwnPaths(workingCopy, base, env) {
  const own = new Set();
  const addZ = (out) => { for (const p of out.split('\0')) if (p !== '') own.add(p); };
  addZ(runGit(workingCopy, ['log', '--first-parent', '--no-merges', '--no-renames', '--name-only', '--format=', '-z', `${base}..HEAD`]));
  addZ(runGit(workingCopy, ['log', '--first-parent', '--merges', '--cc', '--no-renames', '--name-only', '--format=', '-z', `${base}..HEAD`]));
  addZ(runGit(workingCopy, ['diff', '--cached', '--no-renames', '--name-only', '-z', 'HEAD'], env));
  return own;
}

/** HEAD commit and branch (null when detached) of `workingCopy`; a failed read is measured:false, never ''. */
function readHelperHead(workingCopy) {
  try {
    const commit = runGit(workingCopy, ['rev-parse', 'HEAD']).trim();
    if (commit === '') return { measured: false, reason: 'git rev-parse HEAD printed nothing' };
    let branch = null;
    try {
      branch = runGit(workingCopy, ['symbolic-ref', '--short', '-q', 'HEAD']).trim() || null;
    } catch {
      branch = null; // reason: detached HEAD exits 1; the commit alone still proves landing
    }
    return { measured: true, value: { commit, branch } };
  } catch (err) {
    const detail = String(err?.stderr || err?.message || err).trim().split('\n')[0];
    return { measured: false, reason: `git head read failed: ${detail}` };
  }
}

/**
 * Measure an isolated helper's changes in its own working copy: diff(base, working tree) through
 * a temporary index seeded from the helper's real index plus `add -A`, so committed, staged,
 * modified and untracked files all count. Never throws: failure is a measured:false value.
 * @param {string} cwd - SubagentStop payload cwd (the helper worktree when isolated).
 * @param {string} run - `cc:<session>:<agent>`, the source label of every file.
 * @param {string | null} storedBase - base stored at the first measured end; null at the first.
 * The result also carries `head`: the working copy's HEAD commit and checked-out branch (null when detached), read
 * while the working copy still exists so a later review can show landing after the copy is removed. Unreadable =
 * `{measured:false, reason}`, never an empty string.
 * @returns {{isolated?: boolean, changes: object, head: object}}
 */
export function measureHelperChanges(cwd, run, storedBase) {
  if (typeof cwd !== 'string' || cwd === '' || !existsSync(cwd)) {
    return { changes: { measured: false, reason: 'working copy not found' }, head: { measured: false, reason: 'working copy not found' } };
  }
  let tempIndex = null;
  let isolated;
  let head = { measured: false, reason: 'not read' };
  try {
    const gitDir = realpathSync(runGit(cwd, ['rev-parse', '--absolute-git-dir']).trim());
    const commonDir = realpathSync(resolve(cwd, runGit(cwd, ['rev-parse', '--git-common-dir']).trim()));
    isolated = gitDir !== commonDir;
    if (!isolated) return { isolated, changes: { measured: false, reason: 'not isolated' }, head: { measured: false, reason: 'not isolated' } };
    const workingCopy = realpathSync(runGit(cwd, ['rev-parse', '--show-toplevel']).trim());
    head = readHelperHead(workingCopy);
    // reason: in a non-bare repo the common dir's HEAD is the main checkout's HEAD (spec D6)
    const mainHead = runGit(workingCopy, [`--git-dir=${commonDir}`, 'rev-parse', 'HEAD']).trim();
    const base = storedBase ?? runGit(workingCopy, ['merge-base', 'HEAD', mainHead]).trim();
    tempIndex = join(tmpdir(), `lore-helper-index-${process.pid}-${randomUUID()}`);
    const realIndex = resolve(workingCopy, runGit(workingCopy, ['rev-parse', '--git-path', 'index']).trim());
    if (existsSync(realIndex)) seedTempIndex(realIndex, tempIndex);
    const env = { GIT_INDEX_FILE: tempIndex };
    runGit(workingCopy, ['add', '-A'], env);
    const nameStatus = runGit(workingCopy, ['diff', '--cached', '--no-renames', '--name-status', '-z', base], env);
    const numstat = runGit(workingCopy, ['diff', '--cached', '--no-renames', '--numstat', base], env);
    const own = helperOwnPaths(workingCopy, base, env);
    const files = parseDiff(nameStatus, numstat, run, workingCopy).filter((f) => own.has(f.path));
    return { isolated, changes: { measured: true, value: { base, files } }, head };
  } catch (err) {
    const detail = String(err?.stderr || err?.message || err).trim().split('\n')[0];
    return {
      ...(isolated === undefined ? {} : { isolated }),
      changes: { measured: false, reason: `git measurement failed: ${detail}` },
      head,
    };
  } finally {
    if (tempIndex !== null) rmSync(tempIndex, { force: true });
  }
}

/**
 * SubagentStop: overwrite the helper's measurement and `ended_at`, increment `end_count`, keep
 * `run` / `started_at`, and reuse the base stored by an earlier measured end. Never writes
 * `judged_end_count` (single-writer rule). A missing or invalid prior record counts from 0.
 * @returns {object} the record written.
 * @throws {TrailSessionIdInvalidError | TrailRunIdInvalidError | Error} on unusable ids or a failed write.
 */
export function recordHelperEnd(base, sessionId, agentId, cwd, nowMs = Date.now()) {
  assertSessionId(sessionId);
  if (typeof agentId !== 'string' || !ID_PATTERN.test(agentId)) throw new TrailRunIdInvalidError(`cc:${sessionId}:${agentId}`);
  const file = join(base, 'sessions', sessionId, 'helpers', `${agentId}.json`);
  const run = `cc:${sessionId}:${agentId}`;
  const prior = readValidOrNull(file, validHelperRecord);
  // reason: spec D6 — the base is fixed at the FIRST measured end; a failed end in between keeps it
  // in the top-level `base` field, so the next successful end still reuses it.
  const storedBase = prior?.base ?? (prior?.changes?.measured === true ? prior.changes.value.base : null);
  const measurement = measureHelperChanges(cwd, run, storedBase);
  const keptBase = measurement.changes.measured === true ? measurement.changes.value.base : storedBase;
  const at = new Date(nowMs).toISOString();
  const record = {
    run,
    started_at: prior?.started_at ?? at,
    ended_at: at,
    end_count: (prior?.end_count ?? 0) + 1,
    // reason: the working copy recorded at SubagentStart wins over the stop-time cwd, which may have drifted
    ...(prior?.working_copy !== undefined ? { working_copy: prior.working_copy } : typeof cwd === 'string' && cwd !== '' ? { working_copy: cwd } : {}),
    ...(measurement.isolated === undefined ? {} : { isolated: measurement.isolated }),
    ...(keptBase === null ? {} : { base: keptBase }),
    changes: measurement.changes,
    // reason: a failed read at a later end must not erase the head an earlier end measured
    head: measurement.head.measured === false && prior?.head?.measured === true ? prior.head : measurement.head,
  };
  writeJsonAtomic(file, record);
  return record;
}

// ---------------------------------------------------------------------------
// Turn-end attribution — spec Design > Attribution at turn end, D5, D14, D15
// ---------------------------------------------------------------------------

/** A fact needed for attribution could not be gathered; the turn's changes become measured:false. */
export class TrailAttributionError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'TrailAttributionError';
    this.reason = reason;
  }
}

/** Run git without throwing; `status` is the exit code (null when git could not be spawned). */
function gitRaw(cwd, args, { env = {}, input } = {}) {
  const r = spawnSync('git', args, {
    cwd, encoding: 'utf8', env: { ...process.env, ...env }, input, maxBuffer: 256 * 1024 * 1024,
  });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

/** Run git and return stdout; an exit status outside `okStatuses` is a TrailAttributionError naming the command. */
function gitText(cwd, args, { input, okStatuses = [0] } = {}) {
  const r = gitRaw(cwd, args, { input });
  if (r.status === null || !okStatuses.includes(r.status)) {
    const detail = (r.error?.message ?? r.stderr.trim().split('\n')[0]) || `exit ${r.status}`;
    throw new TrailAttributionError(`git ${args[0]} failed: ${detail}`);
  }
  return r.stdout;
}

/**
 * Build a git TREE id of the working tree (untracked files included, ignored excluded) through a
 * temporary index SEEDED FROM THE REAL INDEX so unchanged files are not re-hashed; the real index
 * and every ref stay untouched. Used by the turn-start and turn-end hooks, which must build their
 * trees identically or every unchanged file would show up as a diff.
 * @param {string} cwd
 * @returns {{tree: string} | {tree: null, reason: string}}
 */
export function snapshotWorkingTree(cwd) {
  let tmpDir = null;
  try {
    const inside = gitRaw(cwd, ['rev-parse', '--is-inside-work-tree']);
    if (inside.status !== 0 || inside.stdout.trim() !== 'true') return { tree: null, reason: 'not a git work tree' };
    tmpDir = mkdtempSync(join(tmpdir(), 'lore-turn-index-'));
    const tempIndex = join(tmpDir, 'index');
    const realIndex = resolve(cwd, gitRaw(cwd, ['rev-parse', '--git-path', 'index']).stdout.trim());
    // reason: an unborn HEAD or a fresh repo has no index file; add -A then starts from empty.
    if (existsSync(realIndex)) seedTempIndex(realIndex, tempIndex);
    const env = { GIT_INDEX_FILE: tempIndex };
    const add = gitRaw(cwd, ['add', '-A'], { env });
    if (add.status !== 0) return { tree: null, reason: `git add -A failed: ${add.stderr.trim()}` };
    const write = gitRaw(cwd, ['write-tree'], { env });
    const tree = write.stdout.trim();
    if (write.status !== 0 || !/^[0-9a-f]{40,64}$/.test(tree)) return { tree: null, reason: `git write-tree failed: ${write.stderr.trim()}` };
    return { tree };
  } catch (err) {
    return { tree: null, reason: `snapshot fault: ${err.message}` };
  } finally {
    if (tmpDir !== null) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * HEAD and HEAD-reflog length, recorded at turn start so the turn's reflog steps can be told apart
 * at turn end. `{head: null, reflog_len: 0}` on an unborn HEAD.
 * @param {string} cwd @returns {{head: string | null, reflog_len: number}}
 */
export function readHeadState(cwd) {
  const head = gitRaw(cwd, ['rev-parse', '--verify', '-q', 'HEAD']);
  if (head.status !== 0) return { head: null, reflog_len: 0 };
  const log = gitRaw(cwd, ['reflog', 'show', '--format=%H', 'HEAD']);
  return { head: head.stdout.trim(), reflog_len: log.stdout.split('\n').filter(Boolean).length };
}

/**
 * Diff two trees without rename detection (a rename is D old + A new).
 * `lines` = added + deleted (trail convention); `changedLines` = max(added, deleted) per path (BR-1089 convention).
 * @returns {{ok: true, entries: Array<{status: string, path: string, lines: number}>, changedLines: Map<string, number>}
 *   | {ok: false, reason: string}}
 */
export function diffTrees(root, fromTree, toTree) {
  const names = gitRaw(root, ['diff-tree', '-r', '--no-renames', '--name-status', '-z', fromTree, toTree]);
  const stats = gitRaw(root, ['diff-tree', '-r', '--no-renames', '--numstat', '-z', fromTree, toTree]);
  if (names.status !== 0 || stats.status !== 0) return { ok: false, reason: `git diff-tree failed: ${(names.stderr || stats.stderr).trim()}` };
  const counts = new Map();
  for (const record of stats.stdout.split('\0').filter(Boolean)) {
    const [added, deleted, ...pathParts] = record.split('\t');
    // binary files report "-": 0 lines, still listed by status
    counts.set(pathParts.join('\t'), { added: Number(added) || 0, deleted: Number(deleted) || 0 });
  }
  const entries = [];
  const changedLines = new Map();
  const fields = names.stdout.split('\0').filter(Boolean);
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const path = fields[i + 1];
    const { added, deleted } = counts.get(path) ?? { added: 0, deleted: 0 };
    entries.push({ status: fields[i], path, lines: added + deleted });
    changedLines.set(path, Math.max(added, deleted));
  }
  return { ok: true, entries, changedLines };
}

const TAKE_IN_ACTIONS = new Set(['merge', 'pull', 'checkout', 'rebase', 'reset', 'cherry-pick']);

/** Classify a HEAD reflog subject: `own-commit` | `merge-commit` (commit (merge)) | `take-in` | `other`. */
function classifyReflogSubject(subject) {
  const colon = subject.indexOf(':');
  const head = (colon < 0 ? subject : subject.slice(0, colon)).trim();
  const word = head.split(/\s+/)[0];
  const qualifier = /\(([^)]*)\)/.exec(head)?.[1] ?? null;
  if (word === 'commit') {
    if (qualifier === null || qualifier === 'amend') return 'own-commit';
    return qualifier === 'merge' ? 'merge-commit' : 'other';
  }
  return TAKE_IN_ACTIONS.has(word) ? 'take-in' : 'other';
}

/** The HEAD reflog, oldest first: `{sha, ts (unix seconds), kind}`; empty on an unborn HEAD. */
function readHeadReflog(root) {
  if (gitRaw(root, ['rev-parse', '--verify', '-q', 'HEAD']).status !== 0) return [];
  const out = gitText(root, ['reflog', 'show', '--date=unix', '--format=%H%x09%gd%x09%gs', 'HEAD']);
  return out.split('\n').filter(Boolean).map((line) => {
    const [sha, selector, ...subject] = line.split('\t');
    return { sha, ts: Number(/@\{(\d+)\}/.exec(selector)?.[1] ?? 0), kind: classifyReflogSubject(subject.join('\t')) };
  }).reverse();
}

/** Index in `log` where the turn's steps start; the recorded length is trusted only while it still matches the start head. */
function turnStepsStart(log, snapshot) {
  const { head, reflog_len: len } = snapshot;
  if (head === null) return 0; // unborn at turn start: every entry belongs to the turn
  if (len > 0 && len <= log.length && log[len - 1].sha === head) return len;
  // reason: reflog expired or rewritten since turn start - fall back to the newest entry that is the start head.
  for (let i = log.length - 1; i >= 0; i--) if (log[i].sha === head) return i + 1;
  if (len === 0) return 0; // the reflog was empty at turn start: every entry belongs to the turn
  throw new TrailAttributionError(`turn-start head ${head} not found in the HEAD reflog`);
}

const nameSet = (text) => new Set(text.split('\0').filter(Boolean));

/** `commit -> patch-id` for `shas` through one diff-tree + patch-id pipeline (`--stable`). */
function patchIdsOf(root, shas) {
  const result = new Map();
  if (shas.length === 0) return result;
  const diff = gitText(root, ['diff-tree', '--stdin', '-p', '--root', '--no-renames', '-r'], { input: `${shas.join('\n')}\n` });
  for (const line of gitText(root, ['patch-id', '--stable'], { input: diff }).split('\n').filter(Boolean)) {
    const [patchId, sha] = line.split(' ');
    result.set(sha, patchId);
  }
  return result;
}

/** Own-commit set: non-merge commits this checkout's reflog records as commit / commit (amend) since started_at. */
function ownCommitSet(root, log, startedAt) {
  const sinceSec = Math.floor(Date.parse(startedAt) / 1000);
  const shas = log.filter((e) => e.kind === 'own-commit' && e.ts >= sinceSec).map((e) => e.sha);
  return { shas: new Set(shas), patchIds: new Set(patchIdsOf(root, shas).values()) };
}

/** Facts about one take-in step: everything `attributeTurn` needs, nothing it must fetch itself. */
function collectStepFacts(root, step, nowTree, own) {
  const parents = gitText(root, ['rev-list', '--parents', '-n1', step.sha]).trim().split(' ').slice(1);
  if (parents.length > 2) throw new TrailAttributionError(`octopus merge ${step.sha} (${parents.length} parents) is not attributable`);
  // a concluded merge (commit (merge)) is diffed against its first parent
  const from = step.kind === 'merge-commit' ? parents[0] : step.old;
  const base = from ?? gitText(root, ['hash-object', '-t', 'tree', '--stdin'], { input: '' }).trim();
  const paths = nameSet(gitText(root, ['diff-tree', '-r', '--no-renames', '--name-only', '-z', base, step.sha]));
  const diverged = nameSet(gitText(root, ['diff-tree', '-r', '--no-renames', '--name-only', '-z', step.sha, nowTree]));
  const conflicted = new Set();
  if (parents.length === 2) {
    // reason: recomputed from the two parents so the result never depends on the index state at Stop.
    const merged = gitText(root, ['merge-tree', '--write-tree', '--name-only', '-z', parents[0], parents[1]], { okStatuses: [0, 1] });
    const fields = merged.split('\0');
    for (let i = 1; i < fields.length && fields[i] !== ''; i++) conflicted.add(fields[i]);
  }
  const range = from === null || from === undefined ? step.sha : `${from}..${step.sha}`;
  const commits = gitText(root, ['rev-list', '--no-merges', range]).split('\n').filter(Boolean);
  const patchIds = patchIdsOf(root, commits);
  const ownTouched = new Set();
  for (const commit of commits) {
    if (!own.shas.has(commit) && !own.patchIds.has(patchIds.get(commit))) continue;
    const touched = gitText(root, ['diff-tree', '--root', '--no-commit-id', '-r', '--no-renames', '--name-only', '-z', commit]);
    for (const path of nameSet(touched)) ownTouched.add(path);
  }
  return { paths, diverged, conflicted, ownTouched };
}

/**
 * PURE attribution of every turn change to run, version control or unknown (spec Design >
 * Attribution at turn end).
 *   1. a path named by an edit record -> `run`, always first;
 *   2. else the newest take-in step whose range touched the path, whose post-step HEAD content equals
 *      the working tree (not `diverged`) and where the path is not conflicted -> `vcs`, downgraded to
 *      `unknown` when an own commit (or one sharing an own patch-id) changed it: own commits are never laundered (D5);
 *   3. else `unknown` (shell edits, own commits of shell edits, squash merges (D15), stash pop, hand-resolved conflicts).
 * @param {{entries: Array<{status: string, path: string, lines: number}>,
 *   editRuns: Map<string, string>,
 *   steps: Array<{paths: Set<string>, diverged: Set<string>, conflicted: Set<string>, ownTouched: Set<string>}>}} input
 *   `steps` = take-in steps in chronological order; `editRuns` maps repo-relative path -> run id.
 * @returns {Array<{path: string, status: 'A'|'M'|'D', lines: number, source: object}>} sorted by path.
 */
export function attributeTurn({ entries, editRuns, steps }) {
  const sourceOf = (path) => {
    const run = editRuns.get(path);
    if (run !== undefined) return { kind: 'run', run };
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (!step.paths.has(path) || step.diverged.has(path) || step.conflicted.has(path)) continue;
      return step.ownTouched.has(path) ? { kind: 'unknown' } : { kind: 'vcs' };
    }
    return { kind: 'unknown' };
  };
  return entries
    .map((e) => ({ path: e.path, status: e.status === 'A' || e.status === 'D' ? e.status : 'M', lines: e.lines, source: sourceOf(e.path) }))
    .sort((a, b) => byText(a.path, b.path));
}

/**
 * Gather the reflog facts for the changes no edit record explains, then run `attributeTurn`.
 * Never throws: a failed step is `{measured:false, reason}` (spec attribution step 5).
 * @returns {{measured: true, value: object[]} | {measured: false, reason: string}}
 */
function measureTurnChanges({ root, snapshot, nowTree, entries, editRuns, sessionStartedAt }) {
  try {
    let steps = [];
    if (entries.some((e) => !editRuns.has(e.path))) {
      if (snapshot.head === undefined || snapshot.reflog_len === undefined) {
        throw new TrailAttributionError('turn-start snapshot has no head (written before attribution existed)');
      }
      const log = readHeadReflog(root);
      const turnLog = log.slice(turnStepsStart(log, snapshot));
      const takeIns = turnLog
        .map((e, i) => ({ ...e, old: i === 0 ? snapshot.head : turnLog[i - 1].sha }))
        .filter((e) => (e.kind === 'take-in' || e.kind === 'merge-commit') && e.old !== e.sha);
      if (takeIns.length > 0) {
        if (typeof sessionStartedAt !== 'string') throw new TrailAttributionError('session.json absent: the own-commit window is unknown');
        const own = ownCommitSet(root, log, sessionStartedAt);
        steps = takeIns.map((step) => collectStepFacts(root, step, nowTree, own));
      }
    }
    return { measured: true, value: attributeTurn({ entries, editRuns, steps }) };
  } catch (err) {
    return { measured: false, reason: err instanceof TrailAttributionError ? err.reason : `attribution fault: ${err.message}` };
  }
}

/** True when a record shows a NON-isolated helper that was running at any point in the turn (spec D14). */
function sharedWorkingCopyOpen(sessionDir, turnOpenedMs) {
  const dir = join(sessionDir, 'helpers');
  if (!existsSync(dir)) return false;
  const turnOpenedAt = new Date(turnOpenedMs).toISOString();
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json') && !n.endsWith('.judged.json'))) {
    const record = readValidOrNull(join(dir, name), validHelperRecord);
    if (record === null) throw new TrailAttributionError(`helpers/${name} is unreadable`);
    // reason: `isolated` is only known after a helper's first SubagentStop, so a still-running helper
    // (isolated undefined) is treated as sharing the working copy.
    if (record.isolated !== true && (record.ended_at === undefined || record.ended_at >= turnOpenedAt)) return true;
  }
  return false;
}

/**
 * Turn end: build the turn's `TurnChanges` record and write `<turn>/changes.json` atomically.
 * @param {object} input
 * @param {string} input.turnDir
 * @param {string} input.root - repo top level.
 * @param {{tree?: string | null, head?: string | null, reflog_len?: number}} input.snapshot - turn-start-snapshot.json.
 * @param {string | null} input.nowTree
 * @param {Array<{status: string, path: string, lines: number}> | null} input.entries - diff(turn start, now); null = unmeasured.
 * @param {string | null} input.unmeasuredReason - why `entries` is null.
 * @param {Map<string, string>} input.editRuns - repo-relative path -> run id from the turn's edit records.
 * @returns {object} the record written (same shape as core `TurnChanges`).
 * @throws on a failed write (the caller reports it as not measured).
 */
export function recordTurnChanges({ turnDir, root, snapshot, nowTree, entries, unmeasuredReason, editRuns }) {
  const sessionDir = dirname(turnDir);
  const startedAt = readValidOrNull(join(sessionDir, 'session.json'), validSessionJson)?.started_at;
  let shared = false;
  let changes;
  try {
    shared = sharedWorkingCopyOpen(sessionDir, statSync(join(turnDir, 'turn-start-snapshot.json')).mtimeMs);
    changes = entries === null
      ? { measured: false, reason: unmeasuredReason }
      : measureTurnChanges({ root, snapshot, nowTree, entries, editRuns, sessionStartedAt: startedAt });
  } catch (err) {
    changes = { measured: false, reason: err instanceof TrailAttributionError ? err.reason : `turn changes fault: ${err.message}` };
  }
  const record = { turn: basename(turnDir), at: new Date().toISOString(), shared_working_copy: shared, changes };
  if (!validTurnChanges(record)) throw new TrailFileInvalidError('changes.json', 'built record does not match the trail schema');
  writeJsonAtomic(join(turnDir, 'changes.json'), record);
  return record;
}

// ---------------------------------------------------------------------------
// Turn-end helper review — spec Design > Consumers, "Judging each helper end once", "Spawn gating"
// ---------------------------------------------------------------------------

/** Budget for one `lore session trail-review` spawn (cold start is ~230 ms; this only bounds a hang). */
const TRAIL_REVIEW_TIMEOUT_MS = 15000;

/**
 * Snapshot of every helper end not yet judged: `end_count > judged_end_count`, read ONCE at review start.
 * The snapshot, never a later re-read, is what `markHelpersJudged` records.
 * @param {string} base - state base. @param {string} sessionId
 * Each entry carries `snapshot_at_ms`, the instant of this read: `markHelpersJudged` stamps it as `judged_at_ms`, the
 * boundary before which a helper's edit records count as already judged.
 * @returns {{helpers: Array<{agent_id: string, end_count: number, snapshot_at_ms: number}>, unreadable?: string}}
 *   `unreadable` is set (and `helpers` empty) when the trail cannot be read: that is not "nothing to judge".
 */
export function snapshotUnjudgedHelpers(base, sessionId) {
  try {
    const snapshotAtMs = Date.now();
    const trail = readSessionTrail(sessionId, base);
    const helpers = (trail?.helpers ?? [])
      .filter((h) => h.end_count > h.judged_end_count)
      .map((h) => ({ agent_id: h.agent_id, end_count: h.end_count, snapshot_at_ms: snapshotAtMs }));
    return { helpers };
  } catch (err) {
    return { helpers: [], unreadable: `session trail unreadable (${err.message})` };
  }
}

/**
 * Write `helpers/<agent_id>.judged.json` = the snapshotted `end_count` and `judged_at_ms` = the snapshot instant
 * (the ONLY writer of that file).
 * @param {string} base @param {string} sessionId
 * @param {Array<{agent_id: string, end_count: number, snapshot_at_ms: number}>} helpers - the review-start snapshot.
 * @returns {string[]} reasons for helpers whose judged file could not be written (empty on success).
 */
export function markHelpersJudged(base, sessionId, helpers) {
  const failures = [];
  for (const { agent_id: agentId, end_count: endCount, snapshot_at_ms: judgedAtMs } of helpers) {
    try {
      writeJsonAtomic(join(base, 'sessions', sessionId, 'helpers', `${agentId}.judged.json`), { judged_end_count: endCount, judged_at_ms: judgedAtMs });
    } catch (err) {
      failures.push(`helper ${agentId} could not be marked judged (${err.message})`);
    }
  }
  return failures;
}

/**
 * Spawn `lore session trail-review` for this turn (the caller decides whether one is warranted) and turn its
 * answer into relay lines. Nothing is marked judged here: the caller calls `markJudged()` after its own output
 * is written, and only a successful review yields one that does anything.
 * @param {object} input
 * @param {string} input.base @param {string} input.sessionId @param {string} input.turnId
 * @param {string} input.cwd - where `lore` finds the corpus.
 * @param {Array<{agent_id: string, end_count: number, snapshot_at_ms: number}>} input.helpers - review-start snapshot.
 * @returns {{findings: string[], notMeasured: string[], markJudged: () => string[]}}
 */
export function runTrailReview({ base, sessionId, turnId, cwd, helpers }) {
  const argv = ['--harness-run', `cc:${sessionId}`, 'session', 'trail-review', '--turn', turnId, '--json'];
  const run = spawnSync('lore', argv, { cwd, encoding: 'utf8', timeout: TRAIL_REVIEW_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
  const names = helpers.length > 0 ? `helpers left unjudged: ${helpers.map((h) => h.agent_id).join(', ')}` : 'no helper left unjudged';
  const failed = (why) => ({
    findings: [],
    notMeasured: [`helper review not measured (lore session trail-review ${why}; ${names})`],
    markJudged: () => [],
  });
  if (run.error) return failed(run.error.code === 'ETIMEDOUT' ? `timed out after ${TRAIL_REVIEW_TIMEOUT_MS} ms` : `could not run: ${run.error.message}`);
  if (run.status !== 0) return failed(`exited ${run.status}: ${(run.stderr ?? '').trim().split('\n')[0] || 'no message'}`);
  let data;
  try { data = JSON.parse(run.stdout)?.data; } catch { data = undefined; }
  if (!data || !Array.isArray(data.findings) || !data.findings.every((f) => typeof f?.message === 'string')) {
    return failed('printed no readable result');
  }
  const notMeasured = Array.isArray(data.not_measured) ? data.not_measured.filter((r) => typeof r === 'string') : [];
  return { findings: data.findings.map((f) => f.message), notMeasured, markJudged: () => markHelpersJudged(base, sessionId, helpers) };
}
