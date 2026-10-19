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
 *   (b) anchor drift — a file deleted (rm / mv / git mv / Edit-less shell) between the
 *       snapshot and now that a live spec declares as a code anchor. An anchor already missing at
 *       the snapshot is pre-existing drift, not a finding. ONE `lore status --check-drift`
 *       spawn, made only when something was deleted and `.lore/` exists.
 *   (c) a CLAUDE.md changed this turn that is over its ceiling per `lore status --check-claude-md`
 *       (config-only check; spawned only when a CLAUDE.md changed).
 *
 *   (d) helper review — ONE `lore session trail-review` spawn, only when a helper end is unjudged
 *       (`end_count > judged_end_count`, snapshotted at start) or the `workflow.turn_end.co_change` key is
 *       present; its findings join the single block, and only after it succeeded are the snapshotted helpers
 *       marked judged (`helpers/<agent>.judged.json`). A failed or timed-out spawn marks nothing and leaves one
 *       not-measured line naming the unjudged helpers (spec-session-trail, AC-ST-9 / AC-ST-10).
 *
 * Flow: stop_hook_active=true -> exit 0 silent (loop prevention) | turn state unreadable ->
 * exit 0 + ONE stderr line "turn state not measured: ..." (lore issue #156, same policy as
 * the retired stop-doc-sync hook) | measure (a)(b)(c) | no finding -> exit 0 silent | else one block.
 *
 * Side-effect class: IO — reads the turn dir and `.lore/config.yaml`, spawns git (temporary
 * index under os.tmpdir(), removed afterwards) and, conditionally, `lore`. Writes only to
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
import { diffTrees, recordTurnChanges, runTrailReview, snapshotUnjudgedHelpers, snapshotWorkingTree } from './lib/session-trail.mjs';

/** Setting path inside `.lore/config.yaml`; values: off (default) | block. */
const SETTING_KEYS = ['workflow', 'turn_end', 'main_session_source_edits'];
const SETTING_VALUES = ['off', 'block'];
/** Co-change rule list; its PRESENCE arms the `trail-review` spawn (spec Design, "Spawn gating"). */
const CO_CHANGE_KEYS = ['workflow', 'turn_end', 'co_change'];

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

const DEAD_SPEC_STATUSES = new Set(['deprecated', 'archived']);

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

/**
 * True when `.lore/config.yaml` carries the `workflow.turn_end.co_change` key at all (presence only: the rule
 * list is judged by `lore session trail-review`, this hook has no list grammar). An unreadable config is
 * reported as not measured and counts as absent.
 */
function hasCoChangeKey(root) {
  const configPath = join(root, '.lore', 'config.yaml');
  if (!existsSync(configPath)) return false;
  try {
    return readYamlScalar(readFileSync(configPath, 'utf8'), CO_CHANGE_KEYS) !== undefined;
  } catch (err) {
    notMeasuredReasons.push(`co_change key not measured (${configPath} unreadable: ${err.message})`);
    return false;
  }
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

/** (b) Live-spec code anchors deleted since the snapshot; one `lore status --check-drift` spawn. */
function findAnchorDrift(realRoot, deletedPaths) {
  if (deletedPaths.length === 0 || !existsSync(join(realRoot, '.lore'))) return [];
  const run = runProcess('lore', ['status', '--check-drift', '--json'], realRoot);
  let drift;
  try { drift = JSON.parse(run.stdout)?.data?.code_drift; } catch { drift = undefined; }
  if (!drift) {
    notMeasuredReasons.push(`anchor drift (lore status --check-drift gave no readable report: ${run.error?.message ?? run.stderr.trim() ?? `exit ${run.status}`})`);
    return [];
  }
  if (drift.enabled === false || !Array.isArray(drift.drifts)) return [];
  const findings = [];
  for (const row of drift.drifts) {
    if (row.kind !== 'file_missing' || DEAD_SPEC_STATUSES.has(row.doc_status)) continue;
    const anchorPath = String(row.anchor).split('#')[0].replace(/\/+$/, '');
    const removed = deletedPaths.find((p) => p === anchorPath || p.startsWith(`${anchorPath}/`));
    if (removed) findings.push({ spec: row.doc_slug, anchor: anchorPath });
  }
  return findings;
}

/**
 * (c) Report lines for the changed CLAUDE.md files that are over a ceiling, from the JSON of
 * `lore status --check-claude-md`; null when all are within budget.
 * reason: the exit code is NOT the verdict here — negative headroom is the ceiling fact itself, read per
 * changed file (the exit code only says that SOME memory file has a finding).
 */
function findClaudeMdBreach(realRoot, changedPaths) {
  const run = runProcess('lore', ['status', '--check-claude-md', '--json'], realRoot);
  let report;
  try { report = JSON.parse(run.stdout)?.data?.claude_md; } catch { report = undefined; }
  if (!report || !Array.isArray(report.headroom)) {
    notMeasuredReasons.push(`CLAUDE.md budget (lore status --check-claude-md gave no readable report: ${run.error?.message ?? (run.stderr.trim() || `exit ${run.status}`)})`);
    return null;
  }
  const lines = [];
  for (const row of report.headroom) {
    if (!changedPaths.has(row.path)) continue;
    const overLines = row.lines?.remaining < 0;
    const overBytes = row.bytes?.remaining < 0;
    if (!overLines && !overBytes) continue;
    lines.push(`${row.path} (${row.role}): lines ${row.lines.used}/${row.lines.ceiling} (${row.lines.remaining} remaining), bytes ${row.bytes.used}/${row.bytes.ceiling} (${row.bytes.remaining} remaining)`);
  }
  const ceilingKinds = new Set(['max_lines', 'max_bytes']);
  for (const finding of [...(report.findings ?? []), ...(report.advisory ?? [])]) {
    const kind = finding.kind === 'downgraded' ? finding.downgraded_kind : finding.kind;
    if (changedPaths.has(finding.path) && ceilingKinds.has(kind)) lines.push(finding.message);
  }
  return lines.length > 0 ? lines : null;
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
  noteUnmeasured('not a git work tree; source edits and anchor drift need the turn-start snapshot');
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
if (!quiet) {
  const sourceEdits = findSourceEdits(turnChanges, `cc:${sessionId}`, diff?.changedLines ?? new Map(), realRoot ?? cwd);
  const notCounted = sourceEdits.notCounted.map(describeFile);
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
if (diff && !quiet) {
  const deleted = diff.entries.filter((e) => e.status === 'D').map((e) => e.path);
  const drifted = findAnchorDrift(realRoot, deleted);
  if (drifted.length > 0) {
    findings.push([
      'Anchor drift (a live spec anchors a file this turn deleted or renamed):',
      ...drifted.map((d) => `   - ${d.spec}: ${d.anchor}`),
      '   Restore the file, or update the spec anchor (lore anchor rm / lore anchor add) to the new path.',
    ].join('\n'));
  }
}

// reason: with a measured diff the changed set is what the working tree really shows (Bash edits
// included, an edit reverted within the turn excluded); without one the edit records are all we have.
const changedClaudeMd = new Set(
  diff
    ? diff.entries.filter((e) => e.status !== 'D' && basename(e.path) === 'CLAUDE.md').map((e) => e.path)
    : records.filter((r) => basename(r.file) === 'CLAUDE.md')
        .map((r) => (realRoot ? toRepoRelative(realRoot, r.file, cwd) : r.file)).filter(Boolean),
);
if (changedClaudeMd.size > 0 && !quiet) {
  const report = findClaudeMdBreach(realRoot ?? cwd, changedClaudeMd);
  if (report) {
    findings.push(['A CLAUDE.md edited this turn is over its ceiling (lore status --check-claude-md):', ...report.map((l) => `   - ${l}`), '   Evict detail into the corpus (or split into a module CLAUDE.md) before finishing.'].join('\n'));
  }
}

// ── 4b. helper review: one `lore session trail-review` spawn, only when something needs judging ──
// reason: the unjudged-helper snapshot is read ONCE here and is what gets marked judged afterwards, never a
// re-read (a SubagentStop landing during the spawn is judged by the NEXT review — AC-ST-9). A quiet turn
// (continuing after a block) neither spawns nor marks: its findings could not be spoken.
let helperReview = null;
if (!quiet) {
  const unjudged = snapshotUnjudgedHelpers(dirname(dirname(dirname(turnDir))), sessionId);
  if (unjudged.unreadable) notMeasuredReasons.push(`helper review ${unjudged.unreadable}`);
  if (unjudged.helpers.length > 0 || hasCoChangeKey(realRoot ?? cwd)) {
    helperReview = runTrailReview({ base: dirname(dirname(dirname(turnDir))), sessionId, turnId: basename(turnDir), cwd: realRoot ?? cwd, helpers: unjudged.helpers });
    findings.push(...helperReview.findings);
    notMeasuredReasons.push(...helperReview.notMeasured);
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
// reason: marked only now, after the findings were written — a review that dies before here leaves the helpers
// unjudged, so the next review reports them again instead of losing them.
for (const failure of helperReview?.markJudged() ?? []) process.stderr.write(`[stop-turn-review] ${failure}\n`);
process.exit(0);
