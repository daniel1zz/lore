#!/usr/bin/env node
/**
 * stop-turn-review.mjs — the ONE Stop hook that reviews the MAIN session's turn, once.
 *
 * Purpose: replace per-tool-call interception with a single end-of-turn review. Silent
 * (exit 0, no stdout) when the turn has no finding; otherwise ONE block that lists every
 * finding together (spec-interception-moves-off-every-tool-call-one-turn-end-review,
 * Scope 3-4; BR-1087..BR-1091; ADR adr-rule-delivery-tiers-gate-hook-skill-and-optimistic §2).
 *
 * Findings (all measured against the turn-start snapshot `turn-start-snapshot.json`
 * written by user-prompt-turn-start.mjs — a git TREE id of the working tree; this hook builds
 * the same kind of tree at Stop through a temporary index and diffs the two, so changes left
 * by EARLIER turns are never re-reported and the real index is never touched):
 *   (a) main-session source edits — OFF by default; armed by `.lore/config.yaml`
 *       `workflow.turn_end.main_session_source_edits: block`. Counts only edit records
 *       WITHOUT `agent_id` (helper-agent edits are never the main session's). Exempt:
 *       non-source file types (settings/config/docs), config-named files, any path with a
 *       `hooks`, `.claude`, `.github`, `.vscode` or `.lore` segment, and a turn whose main-session
 *       source edits total <= SOURCE_EDIT_ALLOWANCE changed lines (per file: max(added, deleted),
 *       summed). AUTHORITATIVE reading per the spec's #198 note — the reserved rule text is
 *       imprecise.
 *   (b) shared-checkout changes (BR-1349) — see below. (The anchor-drift and CLAUDE.md-budget findings
 *       were removed: own-diff BR-1355 and check:memory-files already cover them; AC-LG-7.)
 *
 *       ONE `git status --porcelain` on the shared checkout (the main working
 *       tree: the parent of `git rev-parse --git-common-dir`). Every changed or untracked, not-ignored path is a
 *       finding in the single block, except a path finding (a) already lists. A clean checkout adds nothing. The
 *       cost is one git call however many helpers ran; helper work is judged at `lore integrate`, not here (the
 *       per-turn helper review this replaced took 117 s for 1296 helpers).
 *
 * Flow: stop_hook_active=true -> exit 0 silent (loop prevention) | turn state unreadable ->
 * exit 0 + ONE stderr line "turn state not measured: ..." (lore issue #156, same policy as
 * the retired stop-doc-sync hook) | measure (a)(b) | no finding -> exit 0 silent | else one block.
 *
 * Side-effect class: IO — reads the turn dir and `.lore/config.yaml`, spawns git (temporary
 * index under os.tmpdir(), removed afterwards). Writes only to
 * stdout/stderr. The setting is read with a small indentation scan because a standalone hook
 * has no YAML parser (same constraint session-start-resume.mjs documents).
 *
 * Fail-silent by design: a Stop hook that crashes on its own infra faults would trap every
 * turn. Every measurement fault degrades to "not measured" on stderr (never a block, never a
 * silent skip).
 *
 * Env: CLAUDE_STATE_BASE_OVERRIDE — session-state root (testing, shared with turn-state.mjs).
 */

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getTurnDir, readHookPayload } from './lib/turn-state.mjs';
import { diffTrees, recordTurnChanges, snapshotWorkingTree } from './lib/session-trail.mjs';

/** Setting path inside `.lore/config.yaml`; values: off (default) | block. */
const SETTING_KEYS = ['workflow', 'turn_end', 'main_session_source_edits'];
const SETTING_VALUES = ['off', 'block'];
/** Most shared-checkout paths listed in the block; the rest are counted (the block must stay readable). */
const SHARED_CHECKOUT_LIST_LIMIT = 50;

/** Main-session source edits totalling this many changed lines or fewer are exempt (spec Scope 4a). */
const SOURCE_EDIT_ALLOWANCE = 3;

/** File types that count as "source"; everything else (json/yaml/toml/md/...) is exempt by type. */
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.swift',
  '.rb', '.php', '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.sh', '.bash', '.zsh', '.sql',
  '.vue', '.svelte', '.scala', '.lua', '.dart', '.ex', '.exs',
]);
/** A path with any of these segments is tooling/config territory, never a "source edit". */
const EXEMPT_SEGMENTS = new Set(['hooks', '.claude', '.github', '.vscode', '.lore']);
/** Config-by-name source files (`vitest.config.ts`, `.eslintrc.js`, ...). */
const CONFIG_FILE_NAME = /(?:\.config\.[cm]?[jt]s|rc\.[cm]?js|\.setup\.[cm]?[jt]s)$/;

/** Reasons a measurement could not be made; flushed as ONE stderr line at the end. */
const notMeasuredReasons = [];
/** The subset about the source-edit finding (attribution unmeasured); the only ones shown to the user via systemMessage (D13). */
const sourceEditNotMeasured = [];
let sourceEditSetting;
/** True while the turn is already continuing from an earlier block: measure and record, never speak. */
let quiet = false;

function exitNotMeasured(reason) {
  if (quiet) process.exit(0);
  process.stderr.write(`[stop-turn-review] turn state not measured: ${reason}\n`);
  process.exit(0);
}

function runProcess(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: !result.error && result.status === 0, status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
}

/**
 * Reads a nested scalar from YAML text by indentation (no YAML parser available in a standalone
 * hook). Returns undefined when any key on the path is absent. Handles `key:` nesting, comments,
 * quoted scalars; not a general YAML reader.
 */
function readYamlScalar(text, keys) {
  const indents = [];
  let level = 0;
  for (const raw of text.split('\n')) {
    if (/^\s*(#.*)?$/.test(raw)) continue;
    const indent = raw.length - raw.trimStart().length;
    while (level > 0 && indent <= indents[level - 1]) { level--; indents.pop(); }
    const match = raw.trim().match(/^([^:#\s][^:]*):\s*(.*)$/);
    if (!match || match[1] !== keys[level]) continue;
    const rest = match[2].replace(/\s+#.*$/, '').trim();
    if (level === keys.length - 1) return rest.replace(/^(['"])(.*)\1$/, '$2');
    if (rest === '' || rest.startsWith('#')) { indents.push(indent); level++; }
  }
  return undefined;
}

/** `off` (absent) | `block`; an unrecognised value is reported as not measured and treated as off. */
function readSourceEditSetting(root) {
  // reason: memoized — it is asked for by both the finding and the not-measured report, and an
  // invalid value must be reported once, not twice.
  sourceEditSetting ??= readSourceEditSettingUncached(root);
  return sourceEditSetting;
}

function readSourceEditSettingUncached(root) {
  const configPath = join(root, '.lore', 'config.yaml');
  if (!existsSync(configPath)) return 'off';
  let value;
  try {
    value = readYamlScalar(readFileSync(configPath, 'utf8'), SETTING_KEYS);
  } catch (err) {
    notMeasuredReasons.push(`${configPath} unreadable (${err.message})`);
    return 'off';
  }
  if (value === undefined || value === '') return 'off';
  if (!SETTING_VALUES.includes(value)) {
    notMeasuredReasons.push(`${SETTING_KEYS.join('.')} is "${value}" (expected ${SETTING_VALUES.join(' | ')}); treated as off`);
    return 'off';
  }
  return value;
}

function readEditRecords(turnDir) {
  const file = join(turnDir, 'edited-files.jsonl');
  if (!existsSync(file)) return [];
  const records = [];
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    try {
      const entry = JSON.parse(line);
      if (typeof entry?.file === 'string' && entry.file.length > 0) records.push(entry);
    } catch { notMeasuredReasons.push('edited-files.jsonl has an unreadable line'); }
  }
  return records;
}

function toRepoRelative(realRoot, filePath, cwd) {
  const absolute = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  let real = absolute;
  try { real = realpathSync(absolute); } catch { /* deleted file: fall back to the lexical path */ }
  const rel = relative(realRoot, real);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

function isSourcePath(rel) {
  if (!SOURCE_EXTENSIONS.has(extname(rel).toLowerCase())) return false;
  if (CONFIG_FILE_NAME.test(basename(rel))) return false;
  return !rel.split('/').some((segment) => EXEMPT_SEGMENTS.has(segment));
}

/**
 * (a) Source edits over the allowance, judged from the turn's attributed changes (spec Consumers):
 * main-session (`run` = this session's own run) and `unknown` changes count, `vcs` never, a helper's
 * run never; under a shared working copy `unknown` files are listed but not counted (D14).
 * Returns `{counted, total, notCounted}`; `counted` is null when there is no finding to raise.
 * Unmeasured attribution gives no verdict, only a not-measured reason (read from `.lore/config.yaml`
 * only when the setting is `block`, so a project that never armed the finding hears nothing).
 */
function findSourceEdits(turnChanges, mainRun, changedLines, realRoot) {
  if (!turnChanges.changes.measured) {
    if (readSourceEditSetting(realRoot) === 'block') {
      const reason = `source-edit finding not measured: turn changes unmeasured (${turnChanges.changes.reason})`;
      notMeasuredReasons.push(reason);
      sourceEditNotMeasured.push(reason);
    }
    return { counted: null, total: 0, notCounted: [] };
  }
  const touched = turnChanges.changes.value
    .filter((c) => isSourcePath(c.path) && (changedLines.get(c.path) ?? 0) > 0)
    .map((c) => ({ file: c.path, lines: changedLines.get(c.path), label: c.source.kind === 'run' ? 'main session' : 'source unknown', source: c.source }));
  const isMain = (c) => c.source.kind === 'run' && c.source.run === mainRun;
  const unknown = touched.filter((c) => c.source.kind === 'unknown');
  const counted = touched.filter((c) => isMain(c) || (c.source.kind === 'unknown' && !turnChanges.shared_working_copy));
  const notCounted = turnChanges.shared_working_copy ? unknown : [];
  const total = counted.reduce((sum, f) => sum + f.lines, 0);
  // reason: the setting is read lazily so the common no-edit turn never opens config.yaml
  const nothingToSay = total <= SOURCE_EDIT_ALLOWANCE && notCounted.length === 0;
  if (nothingToSay || readSourceEditSetting(realRoot) !== 'block') return { counted: null, total, notCounted: [] };
  return { counted: total > SOURCE_EDIT_ALLOWANCE ? counted : null, total, notCounted };
}

/**
 * (b) Changed or untracked, not-ignored paths of the shared checkout (BR-1349): one `git status --porcelain`.
 * The shared checkout is the main working tree, i.e. the parent of `git rev-parse --git-common-dir`; from a
 * linked worktree that is NOT the worktree the hook runs in.
 * Returns `{root, paths}`; `paths` is null when the checkout could not be read (a not-measured reason is recorded,
 * never a silent empty list).
 */
function findSharedCheckoutChanges(cwd) {
  const common = runProcess('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
  if (!common.ok) {
    notMeasuredReasons.push(`shared checkout changes (git rev-parse --git-common-dir failed: ${common.error?.message ?? (common.stderr.trim() || `exit ${common.status}`)})`);
    return { root: null, paths: null };
  }
  const gitDir = common.stdout.trim();
  const root = basename(gitDir) === '.git' ? dirname(gitDir) : null;
  if (root === null) {
    notMeasuredReasons.push(`shared checkout changes (${gitDir} is not a .git directory: bare repository?)`);
    return { root: null, paths: null };
  }
  const status = runProcess('git', ['status', '--porcelain', '-z', '--untracked-files=all'], root);
  if (!status.ok) {
    notMeasuredReasons.push(`shared checkout changes (git status failed in ${root}: ${status.error?.message ?? (status.stderr.trim() || `exit ${status.status}`)})`);
    return { root, paths: null };
  }
  const tokens = status.stdout.split('\0').filter(Boolean);
  const paths = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    paths.push(entry.slice(3));
    // reason: in -z output a rename/copy carries the ORIGINAL path as one extra token, which is not a changed path.
    if (entry[0] === 'R' || entry[0] === 'C' || entry[1] === 'R' || entry[1] === 'C') i++;
  }
  return { root, paths };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const describeFile = (f) => `   - ${f.file} (${plural(f.lines, 'changed line')}, ${f.label})`;

/** The block text: every finding, then — D13 — the parts that could not be measured, so the model sees them. */
function renderBlock(findings, notMeasured) {
  const sections = findings.map((finding, index) => `${index + 1}. ${finding}`);
  return [
    '<turn-end-review>',
    `Turn-end review: ${plural(findings.length, 'finding')}. Resolve ${findings.length === 1 ? 'it' : 'all of them'}, then finish.`,
    '',
    ...sections,
    ...(notMeasured.length > 0 ? ['', `Not measured: ${notMeasured.join('; ').replace(/\s*\n\s*/g, ' ')}`] : []),
    '</turn-end-review>',
  ].join('\n');
}

// ── stdin ─────────────────────────────────────────
let payload;
try {
  payload = readHookPayload();
} catch (err) {
  exitNotMeasured(`unreadable hook payload (${err.message})`);
}

// reason: a turn that is already continuing because of an earlier block stays silent (BR-1087) but is
// still measured, so changes.json describes the turn's final state and not the state at the first Stop.
quiet = payload.stop_hook_active === true;

// ── 2. turn state ─────────────────────────────────
let turnDir;
try {
  turnDir = getTurnDir(payload);
  if (!turnDir) exitNotMeasured('no turn started for this session (current-turn.id absent)');
  if (!statSync(turnDir).isDirectory()) exitNotMeasured(`turn dir ${turnDir} is not a directory`);
} catch (err) {
  exitNotMeasured(err.message);
}

const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
const records = readEditRecords(turnDir);
const findings = [];

// ── 3. working-tree diff against the turn-start snapshot ──
let diff = null;
let realRoot = null;
let snapshot = {};
let nowTree = null;
let diffFailure = null;
const noteUnmeasured = (reason) => { notMeasuredReasons.push(reason); diffFailure ??= reason; };
const top = runProcess('git', ['rev-parse', '--show-toplevel'], cwd);
if (!top.ok) {
  noteUnmeasured('not a git work tree; source edits need the turn-start snapshot');
} else {
  realRoot = realpathSync(top.stdout.trim());
  try {
    snapshot = JSON.parse(readFileSync(join(turnDir, 'turn-start-snapshot.json'), 'utf8'));
    if (typeof snapshot.tree !== 'string') noteUnmeasured(`turn-start snapshot absent (${snapshot.reason ?? 'no reason recorded'})`);
  } catch (err) {
    noteUnmeasured(`turn-start snapshot unreadable (${err.message})`);
  }
  if (typeof snapshot.tree === 'string') {
    const now = snapshotWorkingTree(realRoot);
    if (now.tree === null) noteUnmeasured(now.reason);
    else {
      nowTree = now.tree;
      const result = diffTrees(realRoot, snapshot.tree, nowTree);
      if (result.ok) diff = result;
      else noteUnmeasured(result.reason);
    }
  }
}

// ── 3b. attribute every change to run / vcs / unknown and write <turn>/changes.json ──
const sessionId = basename(dirname(turnDir));
const editRuns = new Map(); // repo-relative path -> run id; the main session's run wins a shared path
for (const record of realRoot ? records : []) {
  const rel = toRepoRelative(realRoot, record.file, cwd);
  const helper = typeof record.agent_id === 'string' && record.agent_id.length > 0;
  if (rel && (!helper || !editRuns.has(rel))) editRuns.set(rel, helper ? `cc:${sessionId}:${record.agent_id}` : `cc:${sessionId}`);
}
let turnChanges;
try {
  turnChanges = recordTurnChanges({
    turnDir, root: realRoot ?? cwd, snapshot, nowTree, entries: diff?.entries ?? null,
    unmeasuredReason: diffFailure ?? 'no working-tree diff', editRuns,
  });
} catch (err) {
  notMeasuredReasons.push(`changes.json not written (${err.message})`);
  turnChanges = { shared_working_copy: false, changes: { measured: false, reason: `changes.json not written (${err.message})` } };
}

// ── 4. findings ───────────────────────────────────
const infoLines = [];
const listedBySourceEdits = [];
if (!quiet) {
  const sourceEdits = findSourceEdits(turnChanges, `cc:${sessionId}`, diff?.changedLines ?? new Map(), realRoot ?? cwd);
  const notCounted = sourceEdits.notCounted.map(describeFile);
  listedBySourceEdits.push(...(sourceEdits.counted ?? []).map((c) => c.file), ...sourceEdits.notCounted.map((c) => c.file));
  if (sourceEdits.counted) {
    findings.push([
      `Main-session source edits (${plural(sourceEdits.total, 'changed line')}; allowance ${SOURCE_EDIT_ALLOWANCE}; ${SETTING_KEYS.join('.')} = block):`,
      ...sourceEdits.counted.map(describeFile),
      ...(notCounted.length > 0 ? ['   Listed, not counted (a non-isolated helper shared the working copy):', ...notCounted] : []),
      '   Source changes belong to an implementer subagent. Hand this work to one (dispatch a lore implementer with these files as anchors) instead of editing in the main session.',
    ].join('\n'));
  } else if (notCounted.length > 0) {
    infoLines.push(`Source-edit finding: listed, not counted (a non-isolated helper shared the working copy this turn):\n${notCounted.join('\n')}`);
  }
}
// ── 4b. shared checkout: one `git status --porcelain` (BR-1349) ──
if (!quiet) {
  const shared = findSharedCheckoutChanges(realRoot ?? cwd);
  // reason: a path finding (a) already lists is not raised twice; its paths are relative to this hook's own
  // repo root, so they only name the same files when that root IS the shared checkout.
  const alreadyListed = new Set(shared.root !== null && shared.root === realRoot ? listedBySourceEdits : []);
  const pending = (shared.paths ?? []).filter((p) => !alreadyListed.has(p));
  if (pending.length > 0) {
    const shown = pending.slice(0, SHARED_CHECKOUT_LIST_LIMIT);
    findings.push([
      `Shared checkout has ${plural(pending.length, 'changed or untracked path')} (BR-1349; ${shared.root}):`,
      ...shown.map((p) => `   - ${p}`),
      ...(pending.length > shown.length ? [`   ... and ${pending.length - shown.length} more`] : []),
      '   Land them on a branch (a task claim + commit) or revert them; the main checkout stays clean between turns.',
    ].join('\n'));
  }
}

// ── 5. report ─────────────────────────────────────
if (quiet) process.exit(0);
if (notMeasuredReasons.length > 0) {
  process.stderr.write(`[stop-turn-review] turn state not measured: ${notMeasuredReasons.join("; ").replace(/\s*\n\s*/g, " ")}\n`);
}
if (findings.length > 0) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason: renderBlock(findings, notMeasuredReasons) }));
} else {
  // D13: with no block the user (not the model) is told, through systemMessage with no decision
  const notes = [...infoLines, ...sourceEditNotMeasured.map((reason) => `Turn-end review: ${reason}; no verdict.`)];
  if (notes.length > 0) process.stdout.write(JSON.stringify({ systemMessage: notes.join('\n') }));
}
process.exit(0);
