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
 * Flow: stop_hook_active=true -> exit 0 silent (loop prevention) | turn state unreadable ->
 * exit 0 + ONE stderr line "turn state not measured: ..." (lore issue #156, same policy as
 * stop-doc-sync.mjs) | measure (a)(b)(c) | no finding -> exit 0 silent | else one block.
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

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getTurnDir, readHookPayload } from './lib/turn-state.mjs';

/** Setting path inside `.lore/config.yaml`; values: off (default) | block. */
const SETTING_KEYS = ['workflow', 'turn_end', 'main_session_source_edits'];
const SETTING_VALUES = ['off', 'block'];

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

function exitNotMeasured(reason) {
  process.stderr.write(`[stop-turn-review] turn state not measured: ${reason}\n`);
  process.exit(0);
}

function runProcess(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: !result.error && result.status === 0, status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
}

/** Builds a git tree id of the CURRENT working tree through a temporary index; null + reason on failure. */
function snapshotCurrentTree(root) {
  let tmpDir;
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'lore-turn-review-index-'));
    const env = { ...process.env, GIT_INDEX_FILE: join(tmpDir, 'index') };
    // reason: same recipe as user-prompt-turn-start.mjs snapshotWorkingTree — the two trees must be
    // built identically or every unchanged file would show up as a diff.
    runProcess('git', ['read-tree', 'HEAD'], root, env);
    const add = runProcess('git', ['add', '-A'], root, env);
    if (!add.ok) return { tree: null, reason: `git add -A failed: ${add.stderr.trim()}` };
    const write = runProcess('git', ['write-tree'], root, env);
    const tree = write.stdout.trim();
    if (!write.ok || !/^[0-9a-f]{40,64}$/.test(tree)) return { tree: null, reason: `git write-tree failed: ${write.stderr.trim()}` };
    return { tree };
  } catch (err) {
    return { tree: null, reason: `current tree fault: ${err.message}` };
  } finally {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Diffs two trees without rename detection: a rename is a delete of the old path + an add of the new. */
function diffTrees(root, fromTree, toTree) {
  const names = runProcess('git', ['diff-tree', '-r', '--no-renames', '--name-status', '-z', fromTree, toTree], root);
  const stats = runProcess('git', ['diff-tree', '-r', '--no-renames', '--numstat', '-z', fromTree, toTree], root);
  if (!names.ok || !stats.ok) return { ok: false, reason: `git diff-tree failed: ${(names.stderr || stats.stderr).trim()}` };
  const entries = [];
  const nameFields = names.stdout.split('\0').filter(Boolean);
  for (let i = 0; i + 1 < nameFields.length; i += 2) entries.push({ status: nameFields[i], path: nameFields[i + 1] });
  const changedLines = new Map();
  for (const record of stats.stdout.split('\0').filter(Boolean)) {
    const [added, deleted, ...pathParts] = record.split('\t');
    // binary files report "-"; they are not source, count them as 0 changed lines
    changedLines.set(pathParts.join('\t'), Math.max(Number(added) || 0, Number(deleted) || 0));
  }
  return { ok: true, entries, changedLines };
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

/** (a) Main-session source edits over the allowance; null when none or the setting is off. */
function findSourceEdits(records, realRoot, cwd, changedLines) {
  const mainFiles = new Set();
  for (const record of records) {
    if (typeof record.agent_id === 'string' && record.agent_id.length > 0) continue;
    const rel = toRepoRelative(realRoot, record.file, cwd);
    if (rel && isSourcePath(rel)) mainFiles.add(rel);
  }
  const touched = [...mainFiles].map((file) => ({ file, lines: changedLines.get(file) ?? 0 })).filter((f) => f.lines > 0);
  const total = touched.reduce((sum, f) => sum + f.lines, 0);
  if (total <= SOURCE_EDIT_ALLOWANCE) return null;
  // reason: the setting is read lazily so the common no-edit turn never opens config.yaml
  if (readSourceEditSetting(realRoot) !== 'block') return null;
  return { total, files: touched };
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
 * reason: the exit code is NOT the verdict — under the default `adoption: warn` an over-ceiling file
 * exits 0 with the breach downgraded to advisory; negative headroom is the ceiling fact itself.
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

function renderBlock(findings) {
  const sections = findings.map((finding, index) => `${index + 1}. ${finding}`);
  return [
    '<turn-end-review>',
    `Turn-end review: ${findings.length} finding${findings.length === 1 ? '' : 's'}. Resolve ${findings.length === 1 ? 'it' : 'all of them'}, then finish.`,
    '',
    ...sections,
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

// ── 1. loop prevention ────────────────────────────
if (payload.stop_hook_active === true) process.exit(0);

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
const top = runProcess('git', ['rev-parse', '--show-toplevel'], cwd);
if (!top.ok) {
  notMeasuredReasons.push('not a git work tree; source edits and anchor drift need the turn-start snapshot');
} else {
  realRoot = realpathSync(top.stdout.trim());
  let startTree = null;
  try {
    const snapshot = JSON.parse(readFileSync(join(turnDir, 'turn-start-snapshot.json'), 'utf8'));
    if (typeof snapshot.tree === 'string') startTree = snapshot.tree;
    else notMeasuredReasons.push(`turn-start snapshot absent (${snapshot.reason ?? 'no reason recorded'})`);
  } catch (err) {
    notMeasuredReasons.push(`turn-start snapshot unreadable (${err.message})`);
  }
  if (startTree) {
    const now = snapshotCurrentTree(realRoot);
    if (!now.tree) notMeasuredReasons.push(now.reason);
    else {
      const result = diffTrees(realRoot, startTree, now.tree);
      if (result.ok) diff = result;
      else notMeasuredReasons.push(result.reason);
    }
  }
}

// ── 4. findings ───────────────────────────────────
if (diff) {
  const sourceEdits = findSourceEdits(records, realRoot, cwd, diff.changedLines);
  if (sourceEdits) {
    const list = sourceEdits.files.map((f) => `   - ${f.file} (${f.lines} changed line${f.lines === 1 ? '' : 's'})`).join('\n');
    findings.push([
      `Main-session source edits (${sourceEdits.total} changed lines; allowance ${SOURCE_EDIT_ALLOWANCE}; ${SETTING_KEYS.join('.')} = block):`,
      list,
      '   Source changes belong to an implementer subagent. Hand this work to one (dispatch a lore implementer with these files as anchors) instead of editing in the main session.',
    ].join('\n'));
  }
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
if (changedClaudeMd.size > 0) {
  const report = findClaudeMdBreach(realRoot ?? cwd, changedClaudeMd);
  if (report) {
    findings.push(['A CLAUDE.md edited this turn is over its ceiling (lore status --check-claude-md):', ...report.map((l) => `   - ${l}`), '   Evict detail into the corpus (or split into a module CLAUDE.md) before finishing.'].join('\n'));
  }
}

// ── 5. report ─────────────────────────────────────
if (notMeasuredReasons.length > 0) {
  process.stderr.write(`[stop-turn-review] turn state not measured: ${notMeasuredReasons.join("; ").replace(/\s*\n\s*/g, " ")}\n`);
}
if (findings.length > 0) process.stdout.write(JSON.stringify({ decision: 'block', reason: renderBlock(findings) }));
process.exit(0);
