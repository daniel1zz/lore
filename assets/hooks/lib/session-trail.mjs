/**
 * session-trail.mjs — writers, retention and reader of the session trail, for hooks.
 *
 * Purpose: hook-side twin of `packages/core/src/session-trail.ts` (+ `session-trail-node.ts`):
 * the trail lives under `<stateBase>/sessions/<session_id>/` (spec
 * spec-session-trail-a-session-local-record-of-what-each-run-4, Design > Trail layout).
 *
 * Public surface: getStateBase, parseRunId, sessionOfRun, readSessionTrail (reader);
 *   writeJsonAtomic, writeJsonExclusive, recordSessionStart, recordHelperStart,
 *   applyRetention, RETENTION_DAYS, MARKER_RETENTION_DAYS (writers); typed errors.
 *
 * Invariants:
 *   - Hooks are standalone files with no access to `@lore/core`, so the reader and the schemas
 *     are a copy. `tests/integration/hooks/session-trail-runs.test.ts` pins this module equal to
 *     the @lore/core reader (fixture trail, state base, run-id parsing). Change both or neither.
 *   - Every trail write is a temp file in the same directory + rename (`writeJsonAtomic`), or a
 *     temp file + hard link when an existing file must never be overwritten (`writeJsonExclusive`).
 *   - Each file has ONE writer: session.json (SessionStart, once), removed.json (retention),
 *     helpers/<agent>.json (SubagentStart/Stop), changes.json and *.judged.json (the turn-end
 *     review, not this module). edited-files.jsonl stays post-edit-mark's (BR-1088).
 *   - The reader mirrors the core one: unknown keys are invalid; per-turn files degrade to
 *     `{measured:false, reason}` with fixed reason strings; session-level files throw.
 *   - Writers throw on failure; the hook entrypoints (session-trail-start.mjs) turn that into
 *     silence (spec D13: trail hooks write nothing on any path).
 *
 * Side-effect class: IO (filesystem).
 */

import {
  existsSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
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

function validHelperRecord(v) {
  return hasShape(v, ['run', 'started_at', 'end_count'], ['ended_at', 'working_copy', 'isolated', 'changes'])
    && isText(v.run) && isText(v.started_at) && isCount(v.end_count)
    && (v.ended_at === undefined || isText(v.ended_at))
    && (v.working_copy === undefined || isText(v.working_copy))
    && (v.isolated === undefined || typeof v.isolated === 'boolean')
    && (v.changes === undefined || validMeasured(v.changes, validHelperChanges));
}

const validJudged = (v) => hasShape(v, ['judged_end_count']) && isCount(v.judged_end_count);
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
    ? 0
    : parseSessionFile(`helpers/${raw.agent_id}.judged.json`, raw.judged_json, validJudged).judged_end_count;
  return { ...record, agent_id: raw.agent_id, judged_end_count: judged };
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
 * never written here (single-writer rule).
 * @returns {boolean} true when the record was created.
 */
export function recordHelperStart(base, sessionId, agentId, nowMs = Date.now()) {
  assertSessionId(sessionId);
  if (typeof agentId !== 'string' || !ID_PATTERN.test(agentId)) throw new TrailRunIdInvalidError(`cc:${sessionId}:${agentId}`);
  return writeJsonExclusive(join(base, 'sessions', sessionId, 'helpers', `${agentId}.json`), {
    run: `cc:${sessionId}:${agentId}`,
    started_at: new Date(nowMs).toISOString(),
    end_count: 0,
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
