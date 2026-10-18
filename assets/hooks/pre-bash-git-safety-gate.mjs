#!/usr/bin/env node
/**
 * pre-bash-git-safety-gate.mjs  (Design B — state-aware, evidence-surfacing)
 *
 * Blocks Bash commands that could destroy uncommitted/unmerged work without
 * prompting. Triggered by a PreToolUse hook with matcher "Bash".
 *
 * Rationale (original incident): a wave-5 implementer ran `git reset --hard HEAD`
 * inside its worktree, blowing away ~12 modified files belonging to peer
 * subagents. Recovery: ~30 min manual + 4 implementer re-runs. Later (2026-07-20,
 * the "W4" incident): `git worktree remove --force` on a never-committed worktree
 * after a merge printed "Already up to date" destroyed the only copy of 4 fixes.
 * Later still (2026-08-02): an orchestrator ran `git worktree remove <path>` with
 * NO `--force` at all. The gate's worktree rule matched only `--force`/`-f`, so
 * it passed straight through. At that instant the branch carried two commits not
 * in main, and a LIVE peer agent was working in that directory — its most recent
 * commit was 90 seconds old — so the directory was deleted out from under a
 * running agent. The blocking predicate (below, "worktree is clean but its
 * branch … is NOT merged") already existed; it was simply unreachable without
 * --force. See task-the-git-safety-gate-s-worktree-rule-matches-only-force-and.
 *
 * DESIGN B — the gate ALWAYS BLOCKS a matched destructive op (exit 2, fail-safe:
 * a false block only costs friction; a false allow costs data). But for the rules
 * where "is there actually work at risk" is cheaply determinable from repo state,
 * it runs READ-ONLY git probes and puts the REAL risk in the block message —
 * "this would DESTROY 3 uncommitted files: A,B,C" vs "this looks SAFE (clean tree
 * / branch already merged) — if you've confirmed, run it yourself". The decision
 * still routes to the human/agent, but on evidence, not a generic warning.
 * Auto-allowing on a "looks safe" probe was deliberately NOT done: a probe bug
 * would become a false-allow (data loss), trading away the gate's core guarantee.
 * `git worktree remove` (below) is the ONE rule that is the exception to this
 * "always blocks" summary — see its own entry for the CLEAN+MERGED+UNOCCUPIED
 * carve-out and why it exists.
 *
 * State-probed rules (block + evidence):
 *   git reset --hard/--keep/--merge   → dirty-tree file list, or "clean"
 *   git checkout -- <path> / git restore <path> → that path's dirty state
 *   git clean -f/-fd/-fdx             → `git clean -n` preview of what dies
 *   git stash drop <rev> / clear      → that entry / the whole `git stash list`
 *   git worktree remove [--force] <p> → dirty state, branch/detached-HEAD merged
 *                                        into base?, and lore's ONE removal test
 *                                        (`lore worktree check`: owning run / open
 *                                        claim not ended, a process inside, another
 *                                        live session's worktree) —
 *                                        force or not, BOTH are assessed; see the
 *                                        rule entry for the one pass-through case
 *   git branch -D <b>                 → branch merged/ancestor? unmerged commits?
 * Unconditional hard-block (no safe variant / not cheaply determinable):
 *   git push --force / -f / --force-with-lease
 *   rm -rf .git
 *   git update-ref -d
 *   git reflog delete / expire --expire=now
 *
 * Not a git rule — `lore decide` (rule `human-channel-only`, spec-autonomy-phase-1 AC-AU-3): an agent's Bash
 * call containing `lore decide` is denied (exit 2) before it starts; see LORE_DECIDE_PAT below. The git rules
 * and their probes are unchanged.
 *
 * Allowed (safe variants, never matched):
 *   git reset --soft/--mixed · git restore --staged · git stash (non-destructive verbs)
 *   git clean -n · git branch -d (merged-only)
 *
 * `git worktree remove` WITHOUT --force is now MATCHED (2026-08-02 fix) and
 * passes through ONLY when the probe finds the worktree CLEAN, its branch (or
 * detached HEAD) MERGED into the default branch, AND lore's removal test says
 * removable — the exact legitimate post-merge cleanup path CLAUDE.md mandates.
 * Merged-ness alone answers "will commits be lost", never "is someone in there",
 * so the hook asks `lore worktree check <path> --session <payload session_id> --json`:
 * the ONE place that decides occupancy (owning agent run / open claim not ended, a
 * process other than the caller's own ancestry inside, another live session's
 * worktree). The hook carries no process scan of its own. Every other combination
 * (dirty, unmerged, any lore verdict other than `removable`, or a check that cannot
 * be read) blocks too, --force or not — the previous blanket "no --force is safe"
 * claim here was false in exactly the case that mattered most.
 *
 * Incident rationale for the occupancy rule (replaces a 30-minute reflog-quiet
 * window chosen 2026-08-02, when no liveness signal existed): on 2026-10-12 four
 * clean, merged implementer worktrees were refused for 30 minutes although
 * their agents had already stopped (`runs.ended_at` was written at subagent
 * stop), and an agent thinking for 31 minutes without a commit would have been
 * unprotected. Elapsed time is never consulted now. See
 * spec-worktree-removal-is-decided-by-who-is-inside-not-by-how (BR-1070) and
 * spec-one-worktree-removal-test-for-the-guard-lore-done-and-a (BR-1079).
 *
 * Escape hatch: a matched op is BLOCKED with a clear message; when genuinely
 * needed the human runs it in their own shell (they can run anything directly).
 * Subagents MUST NOT bypass by chaining (bash -c "…") — inner commands are
 * inspected too.
 *
 * The evidence must be PROPORTIONATE to the command, not to the command's
 * whole-repository variant — a gate that renders a one-entry `stash drop` as the
 * destruction of 8 unrelated stashes trains its readers to discount every
 * warning it prints, including the true ones. Probes therefore read their
 * arguments (spec-git-safety-gate-probes-report-the-wrong-blast-radius): each
 * segment is carried as a `{ raw, sanitized }` pair (D1), an undecidable
 * argument WIDENS the report behind the literal `[ARG-FALLBACK]` marker and never
 * narrows it (D4), and `probeDirtyTree` stays argument-blind on purpose (D2).
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { spawnSync } from 'node:child_process';

let payload;
try {
  payload = JSON.parse(readFileSync(0, 'utf-8'));
} catch {
  process.exit(0); // malformed input — best-effort hook, let the call through
}

const cmd = (payload?.tool_input?.command ?? '').trim();
if (!cmd) process.exit(0);

// Session cwd (Claude Code supplies it top-level); probes default here when the
// target repo isn't an explicit path argument.
const CWD = payload?.cwd || process.cwd();

// ── read-only git helper (probes ONLY — never a mutating subcommand) ──────────
function git(args, cwd = CWD) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function defaultBranch() {
  // best-effort: origin/HEAD → main → master → current
  for (const cand of ['main', 'master']) {
    if (git(['rev-parse', '--verify', '--quiet', cand]).ok) return cand;
  }
  const cur = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  return cur.ok ? cur.out : 'HEAD';
}
function firstLines(text, n) {
  const lines = text.split('\n').filter(Boolean);
  const head = lines.slice(0, n).join('\n');
  return lines.length > n ? `${head}\n… (+${lines.length - n} more)` : head;
}

// ── argument extraction (spec-git-safety-gate-probes-report-the-wrong-blast-
// radius, "Argument extraction (normative)") ─────────────────────────────────
//
// Probes receive the RAW command segment (D1), so a quoted argument is legible
// to them. Everything below turns that raw text into git arguments.

/**
 * The literal D4 marker. Fixed text, never re-worded: an assertion keys on it to
 * prove that a probe which could not identify its target WIDENED its report
 * rather than silently narrowing it.
 */
const ARG_FALLBACK = 'Assessment: [ARG-FALLBACK]';

/**
 * Strips ONE matched surrounding quote pair from a shell token.
 *
 * @param {string} token raw token as produced by whitespace splitting
 * @returns {string | null} the unquoted token, or null when it is unusable
 *
 * reason: returns null — never a best-effort guess — when a quote character
 * survives unquoting. A token that lost its partner to whitespace splitting
 * (`'src/a b.ts'` → `'src/a` + `b.ts'`) must never reach git as a pathspec:
 * git accepts a non-matching pathspec silently and reports nothing, which would
 * turn "work at risk" into a falsely reassuring empty assessment. Callers treat
 * null as the D4 fallback (wider report), which is the only safe direction.
 * Compare by `=== null`: an empty string is a legitimately-unusable value too
 * and is folded into null here, but a caller testing falsiness would also
 * swallow a real path of `"0"`.
 */
function unquoteToken(token) {
  const paired =
    token.length >= 2 &&
    ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'")));
  const unquoted = paired ? token.slice(1, -1) : token;
  if (unquoted === '' || /['"]/.test(unquoted)) return null;
  return unquoted;
}

// Matches the `drop|clear` verb inside a raw segment. The verb set is CLOSED by
// the rule pattern that routes here (RULES → probeStash), so a third verb is
// unreachable by construction rather than by convention.
const STASH_VERB_RE = /\bgit\s+stash\s+(drop|clear)\b/;

// git's own default target for a bare `git stash drop`.
const DEFAULT_STASH_TARGET = 'stash@{0}';

// The two verbs that route to probePathArg (see RULES).
const PATH_VERB_RE = /\bgit\s+(?:checkout|restore)\b/;

/**
 * The revision a `git stash drop` would destroy.
 *
 * @param {string} inner raw command segment
 * @param {RegExpMatchArray} verbMatch a non-global STASH_VERB_RE match on `inner`
 * @returns {string | null} the candidate revision token, or null when unusable
 */
function extractStashTarget(inner, verbMatch) {
  const after = inner.slice(verbMatch.index + verbMatch[0].length);
  const candidate = after
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .find((t) => !t.startsWith('-'));
  if (candidate === undefined) return DEFAULT_STASH_TARGET;
  return unquoteToken(candidate);
}

/**
 * The `git stash list` line for `target`, or null when `target` is not a stash entry.
 *
 * @param {string} listOut raw `git stash list` stdout
 * @param {string} target candidate revision token
 * @param {string} cwd repo to resolve against
 * @returns {string | null}
 *
 * reason: the accepted spellings of a stash revision are delegated to
 * `git rev-parse`, never to a syntax rule this gate invents, so the gate cannot
 * drift from whatever the installed git accepts. Resolving is not sufficient on
 * its own — `HEAD` resolves too — so the resolved sha must also equal one of
 * `stash@{i}`; anything else is the D4 fallback.
 */
function findStashEntry(listOut, target, cwd) {
  const targetSha = git(['rev-parse', '--verify', '--quiet', target], cwd);
  if (!targetSha.ok || !targetSha.out) return null;
  const lines = listOut.split('\n').filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const sha = git(['rev-parse', '--verify', '--quiet', `stash@{${index}}`], cwd);
    if (sha.ok && sha.out === targetSha.out) return lines[index];
  }
  return null;
}

/**
 * The pathspec a `git checkout` / `git restore` would act on.
 *
 * @param {string} inner raw command segment
 * @returns {string[]} derived paths; EMPTY means "undecidable" → D4 fallback
 */
function extractPathArgs(inner) {
  const verbAt = inner.search(PATH_VERB_RE);
  if (verbAt === -1) return [];
  const tokens = inner
    .slice(verbAt)
    .replace(PATH_VERB_RE, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const separatorAt = tokens.indexOf('--');
  let candidates;
  if (separatorAt === -1) {
    const nonFlag = tokens.filter((t) => !t.startsWith('-'));
    // A leading `HEAD` in this position is a ref, not a path (`git checkout HEAD
    // -- <path>` is covered by the `--` branch above).
    candidates = nonFlag[0] === 'HEAD' ? nonFlag.slice(1) : nonFlag;
  } else {
    candidates = tokens.slice(separatorAt + 1);
  }
  const paths = [];
  for (const token of candidates) {
    const path = unquoteToken(token);
    if (path === null) return []; // undecidable → wider report, never a narrower one
    paths.push(path);
  }
  return paths;
}

// ── probes: return an "Assessment:" evidence string (safe or dangerous) ───────

/**
 * The whole-working-tree report, carrying the D4 marker.
 *
 * @param {string} cwd repo to inspect
 * @param {string} reason why the narrower report was unavailable
 * @returns {string} assessment string prefixed with ARG_FALLBACK
 */
function wholeTreeFallback(cwd, reason) {
  const st = git(['status', '--porcelain'], cwd);
  if (!st.ok) {
    return `${ARG_FALLBACK} ${reason}, and the repo state is unreadable (${st.err || 'git failed'}) — treat as UNSAFE.`;
  }
  if (!st.out) return `${ARG_FALLBACK} ${reason}; the WHOLE working tree is clean — nothing would be lost.`;
  const n = st.out.split('\n').filter(Boolean).length;
  return (
    `${ARG_FALLBACK} ${reason} — reporting the WHOLE working tree instead, ` +
    `${n} uncommitted change(s):\n${firstLines(st.out, 8)}`
  );
}

/**
 * D2 — DELIBERATELY argument-blind, and it must stay that way.
 *
 * reason: `git reset --hard/--keep/--merge` discards the ENTIRE working tree, so
 * whole-tree `git status --porcelain` IS its exact blast radius, not a rounding
 * up. A future sweep for "probes that ignore their argument" must not convert
 * this correct probe into a wrong one — pinned by the D2 assertion in
 * packages/lore/tests/unit/hooks/git-safety-gate.test.ts.
 */
function probeDirtyTree(_inner, cwd = CWD) {
  const st = git(['status', '--porcelain'], cwd);
  if (!st.ok) return `Assessment: could not read repo state (${st.err || 'git failed'}) — treat as UNSAFE.`;
  if (!st.out) return 'Assessment: working tree is CLEAN — nothing would be lost. If that is what you intend, run it yourself.';
  const n = st.out.split('\n').filter(Boolean).length;
  return `Assessment: WOULD DESTROY ${n} uncommitted change(s):\n${firstLines(st.out, 8)}`;
}

/**
 * Path-scoped dirty state for `git checkout -- <path>` / `git restore <path>`.
 *
 * @param {string} inner RAW command segment (D1) — a quoted path is legible here
 * @param {string} cwd repo to inspect
 * @returns {string} assessment naming the command's OWN paths, or a D4 fallback
 *
 * reason: the `--` separator is always passed, even for a single path, so a path
 * that happens to look like a flag can never be reinterpreted as one.
 */
function probePathArg(inner, cwd = CWD) {
  const paths = extractPathArgs(inner);
  if (paths.length === 0) return wholeTreeFallback(cwd, 'could not derive the target path(s) from the command');
  const st = git(['status', '--porcelain', '--', ...paths], cwd);
  if (!st.ok) {
    return wholeTreeFallback(cwd, `could not read the named path(s) (${st.err || 'git failed'})`);
  }
  const named = paths.join(' ');
  if (!st.out) return `Assessment: the named path(s) (${named}) have NO uncommitted changes — nothing would be lost.`;
  const n = st.out.split('\n').filter(Boolean).length;
  return (
    `Assessment: WOULD DESTROY ${n} uncommitted change(s) at the named path(s) ` +
    `(${named}):\n${firstLines(st.out, 8)}`
  );
}

function probeClean(inner, cwd = CWD) {
  // mirror the flags but force dry-run: git clean -n[flags]
  const m = inner.match(/\bgit\s+clean\s+(-\S+)/);
  const flags = (m ? m[1] : '-f').replace(/f/g, ''); // drop the force letter
  const dry = git(['clean', '-n' + flags], cwd);
  if (!dry.ok) return `Assessment: could not preview (${dry.err || 'git failed'}) — treat as UNSAFE.`;
  if (!dry.out) return 'Assessment: nothing untracked to remove — no-op. Safe.';
  return `Assessment: WOULD REMOVE these untracked path(s):\n${firstLines(dry.out.replace(/^Would remove /gm, ''), 8)}`;
}

/**
 * Verb- and revision-aware stash report.
 *
 * @param {string} inner RAW command segment (D1) — a quoted revision is legible here
 * @param {string} cwd repo to inspect
 * @returns {string} `clear` → the whole stash; `drop <rev>` → that entry alone;
 *   bare `drop` → the `stash@{0}` entry alone; undecidable → D4 fallback (whole stash)
 */
function probeStash(inner, cwd = CWD) {
  const ls = git(['stash', 'list'], cwd);
  if (!ls.ok) return 'Assessment: could not read stash list — treat as UNSAFE.';
  if (!ls.out) return 'Assessment: stash is EMPTY — no-op. Safe.';
  const wholeStash = firstLines(ls.out, 8);

  const verbMatch = inner.match(STASH_VERB_RE);
  // Unreachable while the routing rule pattern stays `(drop|clear)`; kept as the
  // D4 fallback so a future widening of that pattern over-reports instead of
  // dropping through to a narrower claim.
  if (!verbMatch) {
    return `${ARG_FALLBACK} could not read the stash verb from the command — reporting the WHOLE stash:\n${wholeStash}`;
  }
  // `clear` destroys every entry, so the whole list IS its exact blast radius.
  if (verbMatch[1] === 'clear') return `Assessment: WOULD DESTROY these stash entrie(s):\n${wholeStash}`;

  const target = extractStashTarget(inner, verbMatch);
  if (target === null) {
    return `${ARG_FALLBACK} could not read the drop target from the command — reporting the WHOLE stash:\n${wholeStash}`;
  }
  const entry = findStashEntry(ls.out, target, cwd);
  if (entry === null) {
    return `${ARG_FALLBACK} "${target}" does not resolve to a stash entry — reporting the WHOLE stash:\n${wholeStash}`;
  }
  return `Assessment: WOULD DESTROY this single stash entry:\n${entry}`;
}

/**
 * The first non-flag token after `verbRe` — a worktree path or a branch name.
 *
 * @param {string} inner RAW command segment (D1)
 * @param {RegExp} verbRe the git verb to skip past
 * @returns {string | null} null when no usable token exists (caller treats as UNSAFE)
 */
function extractPathArg(inner, verbRe) {
  const rest = inner.replace(verbRe, ' ').trim().split(/\s+/);
  const token = rest.find((t) => t && !t.startsWith('-'));
  // reason: unquote here too. These probes use the token as a `cwd` / a rev
  // argument; since D1 now hands them RAW text, a quoted path would otherwise
  // reach spawnSync with its quotes attached, every git call would fail, and
  // probeWorktreeRemove's final branch would report "SAFE" — a narrowing that
  // D4 forbids. null routes to the probes' explicit UNSAFE message instead.
  return token === undefined ? null : unquoteToken(token);
}

const WORKTREE_REMOVE_VERB_RE = /\bgit\s+worktree\s+remove\b/;
const WORKTREE_REMOVE_FORCE_RE = /\bgit\s+worktree\s+remove\b[^\n]*?\s(--force|-f)(?=\s|$)/;

// ── occupancy: delegated to lore's ONE removal test ───────────────────────────
// (spec-one-worktree-removal-test-for-the-guard-lore-done-and-a D1/D2). `lore worktree check` owns every
// occupancy clause — owning run / open claim not ended, a process inside, another live session's worktree — and the
// process scan itself; the hook only asks, then names each reason. Elapsed time is never consulted, and a check that
// cannot be read REFUSES (never a guess).

const CHECK_VERDICTS = new Set(['removable', 'keep', 'not-measured']);

/**
 * Reads `lore worktree check <path> --session <id> --json` and validates its documented shape.
 *
 * @param {string} worktree absolute worktree path
 * @returns {{ ok: true, data: { verdict: string, reasons: string[], owner: object | null,
 *   occupancy: { agent_run: { id: string } | null, open_claims: { task_slug: string, run_id: string | null, run_ended: boolean | null }[] } | null,
 *   processes: { pid: number, command: string }[] } } | { ok: false, detail: string }}
 */
function readWorktreeCheck(worktree) {
  const session = typeof payload?.session_id === 'string' && payload.session_id ? ['--session', payload.session_id] : [];
  const r = spawnSync('lore', ['worktree', 'check', worktree, ...session, '--json'], { cwd: CWD, encoding: 'utf8' });
  if (r.error) return { ok: false, detail: `lore could not run (${r.error.code || r.error.message})` };
  if (r.status !== 0) return { ok: false, detail: `lore exited ${r.status}${r.stderr ? `: ${firstLines(r.stderr.trim(), 1)}` : ''}` };
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return { ok: false, detail: 'lore printed output that is not JSON' };
  }
  const d = parsed?.data;
  const shapeOk =
    parsed?.ok === true &&
    CHECK_VERDICTS.has(d?.verdict) &&
    Array.isArray(d?.reasons) &&
    d.reasons.every((x) => typeof x === 'string') &&
    Array.isArray(d?.processes) &&
    d.processes.every((x) => Number.isInteger(x?.pid) && typeof x?.command === 'string');
  if (!shapeOk) return { ok: false, detail: 'lore printed JSON that is not the documented worktree-check shape' };
  return { ok: true, data: d };
}

/**
 * One block-message line per reason lore gave, naming the way out where there is one.
 *
 * @param {string} reason a reason token (or a `<clause>-not-measured: <detail>` entry)
 * @param {ReturnType<typeof readWorktreeCheck> & { ok: true }} check
 * @param {string} absolute worktree path
 * @returns {string[]}
 */
function describeCheckReason(reason, check, absolute) {
  const d = check.data;
  if (reason === 'run-not-ended') {
    const id = d.occupancy?.agent_run?.id;
    return [
      id
        ? `agent run ${id} owns this worktree and has no end recorded — its agent may still be working here. ` +
          `If that agent is gone: lore run end ${id} --reason "<why>"`
        : `a run of the agent owning this worktree has no end recorded — see \`lore run occupancy --worktree ${absolute}\`.`,
    ];
  }
  if (reason === 'open-claim') {
    const claims = (d.occupancy?.open_claims ?? []).filter((c) => c.run_ended !== true);
    if (claims.length === 0) return [`an open task claim names this worktree — see \`lore run occupancy --worktree ${absolute}\`.`];
    return claims.map(
      (claim) =>
        `task ${claim.task_slug} holds an open claim recorded for this worktree (` +
        (claim.run_id === null ? 'its claim names no run' : `run ${claim.run_id} has no end recorded`) +
        `) — release it: lore release ${claim.task_slug}` +
        (claim.run_id === null ? '' : `, or if that run is gone: lore run end ${claim.run_id} --reason "<why>"`),
    );
  }
  if (reason === 'process-inside') {
    if (d.processes.length === 0) return ['a process has its working directory inside this worktree.'];
    return d.processes.map(
      (proc) => `process ${proc.pid} (${proc.command}) has its working directory inside this worktree — wait for it to exit or stop it (kill ${proc.pid}).`,
    );
  }
  if (reason === 'foreign-live-session') {
    const owner = d.owner;
    return [
      `agent run ${owner?.run_id ?? '(unknown)'} belongs to another session${owner ? ` (${owner.session})` : ''} that is still live — ` +
        'it may resume its stopped agent in this worktree. Wait until that session ends, or ask it to remove its own worktree.',
    ];
  }
  if (/-not-measured: /.test(reason)) return [`cannot measure (${reason}) — refusing rather than guessing.`];
  return [`lore worktree check reports: ${reason}`];
}

/**
 * Occupancy verdict for a clean, merged worktree: lore's removal test.
 *
 * @param {string} path worktree path as typed (resolved against the session cwd here)
 * @returns {{ refusals: string[] }} empty = lore says removable
 */
function assessOccupancy(path) {
  const absolute = resolvePath(CWD, path);
  const check = readWorktreeCheck(absolute);
  if (!check.ok) {
    return {
      refusals: [`cannot read lore's removal test (${check.detail}) — refusing rather than guessing; fix \`lore worktree check ${absolute}\` first.`],
    };
  }
  if (check.data.verdict === 'removable') return { refusals: [] };
  const refusals = check.data.reasons.flatMap((reason) => describeCheckReason(reason, check, absolute));
  // reason: a non-removable verdict that lists no reason must still block — never read as "nothing wrong".
  if (refusals.length === 0) refusals.push(`lore worktree check says ${check.data.verdict} without a reason — refusing.`);
  return { refusals };
}

/**
 * Assesses a `git worktree remove` invocation — force or not (2026-08-02 fix:
 * previously only the --force path reached any assessment at all).
 *
 * @param {string} inner RAW command segment (D1)
 * @returns {string | null} a block-message assessment, or `null` when this
 *   specific invocation is safe to PASS THROUGH with no block at all: clean +
 *   merged + unoccupied + NO --force — the mandated post-merge cleanup path
 *   (CLAUDE.md). Every other outcome blocks, --force or not.
 */
function probeWorktreeRemove(inner) {
  const forced = WORKTREE_REMOVE_FORCE_RE.test(inner);
  const path = extractPathArg(inner, WORKTREE_REMOVE_VERB_RE);
  if (!path) return 'Assessment: could not parse the worktree path — treat as UNSAFE.';

  const st = git(['status', '--porcelain'], path);
  if (!st.ok) {
    return `Assessment: could not read the worktree's status (${st.err || 'git failed'}) — treat as UNSAFE.`;
  }
  if (st.out) {
    const n = st.out.split('\n').filter(Boolean).length;
    if (forced) {
      // AC3 regression: this exact string is pinned unchanged.
      return `Assessment: WORKTREE HAS ${n} UNCOMMITTED change(s) — --force DELETES them:\n${firstLines(st.out, 8)}`;
    }
    // git itself refuses a non-force remove of a dirty worktree (verified:
    // exit 128, "contains modified or untracked files, use --force to delete
    // it") — this is defense-in-depth so the gate's OWN evidence, not git's
    // stderr, is what the operator sees first.
    return `Assessment: WORKTREE HAS ${n} UNCOMMITTED change(s) — git itself refuses this without --force, but treat as UNSAFE:\n${firstLines(st.out, 8)}`;
  }

  const br = git(['rev-parse', '--abbrev-ref', 'HEAD'], path);
  const base = defaultBranch();
  const detached = br.ok && br.out === 'HEAD';
  let ref = null;
  if (br.ok && br.out && !detached) ref = br.out;
  else if (detached) {
    const sha = git(['rev-parse', 'HEAD'], path);
    ref = sha.ok && sha.out ? sha.out : null;
  }
  if (!ref) return "Assessment: could not resolve the worktree's HEAD — treat as UNSAFE.";

  const merged = git(['merge-base', '--is-ancestor', ref, base]).ok;
  if (!merged) {
    const ahead = git(['log', '--oneline', `${base}..${ref}`]);
    const label = detached ? `detached HEAD (${ref.slice(0, 12)})` : `branch "${ref}"`;
    return `Assessment: worktree is clean but its ${label} is NOT merged into ${base} — removing loses these commit(s):\n${firstLines(ahead.out || '(unknown)', 6)}`;
  }

  const label = detached ? 'its detached HEAD' : `its branch "${ref}"`;
  const { refusals } = assessOccupancy(path);
  if (refusals.length > 0) {
    return (
      `Assessment: worktree is clean and ${label} is merged into ${base}, but it is NOT safe to remove — ` +
      `(merged-ness only answers "will commits be lost", never "is someone in there"):\n` +
      refusals.map((r) => `  - ${r}`).join('\n')
    );
  }

  if (forced) {
    return (
      `Assessment: worktree is CLEAN, ${label} is merged into ${base}, and nobody is inside it ` +
      `(lore worktree check: removable) — SAFE. --force is only ` +
      `needed for untracked leftovers (e.g. node_modules); run it yourself to confirm.`
    );
  }
  // CLEAN + MERGED + UNOCCUPIED + no --force: the mandated post-merge cleanup path
  // (CLAUDE.md). Blocking it would train operators to bypass the gate
  // entirely, so this is the ONE rule in this file with a pass-through.
  return null;
}

function probeBranchForceDelete(inner) {
  const br = extractPathArg(inner, /\bgit\s+branch\s+/);
  if (!br) return 'Assessment: could not parse the branch name — treat as UNSAFE.';
  const base = defaultBranch();
  const isAncestor = git(['merge-base', '--is-ancestor', br, base]).ok;
  if (isAncestor) {
    return `Assessment: branch "${br}" is already merged into ${base} — \`git branch -d ${br}\` (lowercase, safe) would accept it. No unmerged commits to lose.`;
  }
  const ahead = git(['log', '--oneline', `${base}..${br}`]);
  if (!ahead.ok) return `Assessment: "${br}" not found or unreadable — treat as UNSAFE.`;
  const n = ahead.out ? ahead.out.split('\n').filter(Boolean).length : 0;
  if (n === 0) {
    return `Assessment: "${br}" has no commits ahead of ${base} but git doesn't see it as merged (stash-shaped / rebased content). Verify its content is on ${base} before deleting.`;
  }
  return `Assessment: WOULD LOSE ${n} unmerged commit(s) on "${br}":\n${firstLines(ahead.out, 6)}`;
}

// ── RULES ─────────────────────────────────────────────────────────────────────
const RULES = [
  {
    pat: /\bgit\s+reset\s+(--hard|--keep|--merge)\b/,
    why: 'git reset --hard/--keep/--merge discards working-tree changes',
    safe: 'Commit the work first (a WIP commit on your own branch), or use `git reset --soft` (HEAD only).',
    probe: probeDirtyTree,
  },
  {
    pat: /\bgit\s+checkout\s+(--\s+\S|\.(\s|$)|HEAD(\s|$)|HEAD\s+--\s)/,
    why: 'git checkout -- <path> / . / HEAD discards working-tree changes',
    safe: 'Commit first if you want to compare, or read files explicitly.',
    probe: probePathArg,
  },
  {
    pat: /\bgit\s+restore\b(?!.*--staged\b)/,
    why: 'git restore (default --worktree) discards working-tree changes',
    safe: 'Use `git restore --staged <path>` to unstage only, or commit to save.',
    probe: probePathArg,
  },
  {
    pat: /\bgit\s+clean\s+-\S*[fF]/,
    why: 'git clean -f/-fd/-fdx removes untracked files irreversibly',
    safe: 'Run `git clean -n` first to preview, then ask the user to confirm.',
    probe: probeClean,
  },
  {
    pat: /\bgit\s+stash\s+(drop|clear)\b/,
    why: 'git stash drop/clear destroys stashed work',
    safe: 'Use `git stash list` + `git stash show` to inspect first.',
    probe: probeStash,
  },
  {
    // Matches WITH or WITHOUT --force (2026-08-02 fix). Force is no longer
    // required to reach this rule: a clean, unmerged, non-force removal is
    // exactly the 2026-08-02 incident this rule now catches.
    pat: WORKTREE_REMOVE_VERB_RE,
    why: 'git worktree remove destroys a worktree — with uncommitted/unmerged work (the W4 near-data-loss), OR, even without --force, when the branch is unmerged or a peer may still be working there (the 2026-08-02 incident)',
    safe:
      'Verify the work landed — `git log <base>..<branch>` empty OR the branch merged. A merge that says ' +
      '"Already up to date" on a branch that SHOULD carry work is the STOP signal. Merged-ness alone is not ' +
      'enough: also check nobody is inside — `lore worktree check <path>` (owning agent run / open ' +
      'claim not ended, a process with its cwd there, another live session\'s worktree) — a peer can still be mid-session on a merged ' +
      'branch. Only a CLEAN + MERGED + UNOCCUPIED worktree is safe to remove WITHOUT --force — that IS the mandated post-merge ' +
      'cleanup path (CLAUDE.md) and this gate lets it through; every other combination needs the human/agent ' +
      'to run it directly in their own shell.',
    probe: probeWorktreeRemove,
  },
  {
    pat: /\bgit\s+branch\s+(-D\b|--delete\s+--force\b|--force\s+--delete\b|-d\s+-f\b)/,
    why: 'git branch -D force-deletes a branch, losing unmerged commits',
    safe: 'Use `git branch -d` (lowercase) to require merged status, or merge first.',
    probe: probeBranchForceDelete,
  },
  // ── unconditional hard-block (no probe) ──
  {
    pat: /\bgit\s+push\s+(--force\b|-f\b|--force-with-lease\b)/,
    why: 'force-push overwrites remote history (may destroy collaborators\' commits)',
    safe: 'Ask the user explicitly. If a normal push fails, investigate why before forcing.',
  },
  {
    pat: /\brm\s+(-rf?|--recursive)\s+.*\.git\b/,
    why: 'rm -rf .git nukes the entire repository',
    safe: 'Never. If you really want a fresh clone, ask the user.',
  },
  {
    pat: /\bgit\s+update-ref\s+-d\b/,
    why: 'git update-ref -d deletes a ref, possibly orphaning commits',
    safe: 'Ask the user.',
  },
  {
    pat: /\bgit\s+reflog\s+(delete|expire\s+--expire=now)\b/,
    why: 'git reflog delete/expire removes the safety-net of the reflog',
    safe: 'Never. The reflog is how we recover from accidents.',
  },
];

// ── SPEC-066 D1: strip heredoc BODIES before segmentation ─────────────────────
// A heredoc body is DATA, not a command: `cat <<'EOF' ... git branch -D
// old-feature ... EOF` (a runbook/knowledge-doc write) must never be treated as
// if `git branch -D` were about to execute (verified dogfood failure P1-4,
// 2026-07-22 — the branch-probe helper went on to parse a prose word as a
// branch name). Detects `<<` / `<<-` redirects with an unquoted, single- or
// double-quoted delimiter word, then blanks every line up to (and including)
// the matching terminator line — same length, so later regex/position logic
// needs no adjustment. Multiple heredocs in one command are handled
// left-to-right by resuming the scan after each terminator (or, for an
// unterminated heredoc, at end-of-text: that body cannot execute either way —
// D1/AC-066-5). `<<-` strips leading tabs from the terminator line only, per
// shell semantics, not from body lines (body content is discarded regardless).
const HEREDOC_RE = /<<(-?)\s*(?:'([^']*)'|"([^"]*)"|([A-Za-z_][A-Za-z0-9_]*))/g;

function stripHeredocs(raw) {
  let out = '';
  let i = 0;
  HEREDOC_RE.lastIndex = 0;
  let m;
  while ((m = HEREDOC_RE.exec(raw)) !== null) {
    if (m.index < i) continue; // inside a body region already consumed below
    const dashed = m[1] === '-';
    const delim = m[2] ?? m[3] ?? m[4];
    const matchEnd = m.index + m[0].length;
    out += raw.slice(i, matchEnd);
    i = matchEnd;
    if (!delim) continue; // pattern matched `<<` with no parseable delimiter — leave as-is

    // Body starts on the NEXT line — the redirect's own line may carry further
    // tokens (`cat <<EOF > out.txt`) and stays intact.
    const firstNl = raw.indexOf('\n', i);
    if (firstNl === -1) continue; // redirect written but no body lines present in this text
    out += raw.slice(i, firstNl + 1);
    i = firstNl + 1;

    let terminated = false;
    while (i <= raw.length) {
      const nextNl = raw.indexOf('\n', i);
      const lineEnd = nextNl === -1 ? raw.length : nextNl;
      const line = raw.slice(i, lineEnd);
      const compareLine = dashed ? line.replace(/^\t+/, '') : line;
      out += ' '.repeat(line.length); // blank the line, preserve its length + any newline below
      if (compareLine === delim) {
        terminated = true;
        if (nextNl === -1) { i = raw.length; break; }
        out += '\n';
        i = nextNl + 1;
        break;
      }
      if (nextNl === -1) { i = raw.length; break; } // AC-066-5: unterminated — strip to end of text
      out += '\n';
      i = nextNl + 1;
    }
    HEREDOC_RE.lastIndex = i;
    if (!terminated) break; // already blanked through end of text; nothing left to scan
  }
  out += raw.slice(i);
  return out;
}

// ── preprocess: strip heredocs, expand `bash -c "…"` ─────────────────────────
function expandInlineShellPayloads(raw) {
  return raw.replace(
    /\b(?:bash|sh|zsh)\s+(?:-l\s+)?-c\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
    (_m, q) => ` ; ${q.slice(1, -1)} ; `,
  );
}

// ── D1: one scan, TWO texts per segment ──────────────────────────────────────
//
// Quote-blanking exists so a quoted payload cannot smuggle a trigger into
// command position (SPEC-066 D2). A probe needs the exact opposite — the true
// argv — because its whole job is to name the ONE entry / ONE path the command
// would destroy. One string cannot serve both consumers, and the single string
// this hook used to build silently served matching correctly and probes
// incorrectly (`git stash drop 'stash@{0}'` → `git stash drop ''` → all entries
// reported). So each segment is carried as a PAIR: `sanitized` feeds
// isCommandPositionMatch, `raw` feeds rule.probe and the Segment line (D5).
//
// reason: segmentation and blanking happen in ONE left-to-right scan rather than
// blank-then-split. Splitting the blanked text and slicing the raw text at the
// same offsets is not possible — blanking changes length — and splitting the raw
// text independently would disagree with the blanked split whenever a separator
// sits inside a quoted literal (`echo 'x && git stash drop'`). Recognising a
// complete quoted literal as one unit makes both texts fall out of the same walk,
// and only a literal with BOTH quotes present is treated as quoted, so an
// unterminated quote still splits (over-block, the safe direction).
const SEGMENT_SEPARATOR_RE = /^(?:&&|\|\||\||;|\n)+/;
const DOUBLE_QUOTED_RE = /^"(?:[^"\\]|\\.)*"/;
const SINGLE_QUOTED_RE = /^'(?:[^'\\]|\\.)*'/;

/**
 * Splits preprocessed command text into `{ raw, sanitized }` segment pairs.
 *
 * @param {string} text heredoc-stripped, `bash -c`-expanded command text
 * @returns {{ raw: string, sanitized: string }[]} one pair per non-empty segment
 */
function splitSegmentPairs(text) {
  const pairs = [];
  let raw = '';
  let sanitized = '';
  const flush = () => {
    const trimmedRaw = raw.trim();
    const trimmedSanitized = sanitized.trim();
    if (trimmedRaw || trimmedSanitized) pairs.push({ raw: trimmedRaw, sanitized: trimmedSanitized });
    raw = '';
    sanitized = '';
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const quoted = rest.match(DOUBLE_QUOTED_RE) ?? rest.match(SINGLE_QUOTED_RE);
    if (quoted) {
      raw += quoted[0];
      sanitized += quoted[0][0] + quoted[0][0]; // "…" → "" · '…' → ''
      i += quoted[0].length;
      continue;
    }
    const separator = rest.match(SEGMENT_SEPARATOR_RE);
    if (separator) {
      flush();
      i += separator[0].length;
      continue;
    }
    raw += text[i];
    sanitized += text[i];
    i += 1;
  }
  flush();
  return pairs;
}

// SPEC-066 D3: fail-closed. A preprocessing exception falls back to inspecting
// the ORIGINAL raw text with a naive split and NO blanking — the gate may
// over-block on pathological input it cannot parse, but must never silently
// under-block (same posture as the probe try/catch blocks below).
let segmentPairs;
try {
  segmentPairs = splitSegmentPairs(stripHeredocs(expandInlineShellPayloads(cmd)));
} catch {
  segmentPairs = cmd
    .split(/(?:&&|\|\||\||;|\n)+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ raw: s, sanitized: s }));
}

const PRINT_LIKE = /^(echo|printf|cat|head|tail|less|more|grep|rg|ag|sed|awk|jq|cut|tr|sort|uniq|wc|find|ls|stat|file|test|\[|true|false)\b/;
const SH_INLINE_RE = /^(?:bash|sh|zsh)\s+(?:-l\s+)?-c\s+['"]([^'"]*)['"]/;

/**
 * Decides whether a segment pair is inspected, and narrows an inline `sh -c`
 * payload to its inner command on BOTH texts.
 *
 * @param {{ raw: string, sanitized: string }} pair
 * @returns {{ raw: string, sanitized: string, inspect: boolean }}
 */
function selectInspectionTarget(pair) {
  const shInline = pair.sanitized.match(SH_INLINE_RE);
  if (shInline) {
    const rawInline = pair.raw.match(SH_INLINE_RE);
    // reason: when the raw form of the payload cannot be narrowed, the probe gets
    // the WHOLE raw segment — wider, per D4. Never the sanitized inner text: a
    // probe reading blanked argv is the defect this spec removes.
    return { sanitized: shInline[1], raw: rawInline ? rawInline[1] : pair.raw, inspect: true };
  }
  if (PRINT_LIKE.test(pair.sanitized)) return { ...pair, inspect: false };
  return { ...pair, inspect: true };
}

// ── SPEC-066 D2: command-position trigger matching (SPEC-050 D4 semantics) ────
// A rule fires only when its trigger sits at the START of the (already
// separator-split) segment — optionally after simple `VAR=value` env-assignment
// prefixes — never when it merely appears in ARGUMENT position, e.g.
// `notify-send git branch -D backup` passes "git branch -D backup" as literal
// argv to notify-send; nothing named `git` ever executes there.
const ENV_ASSIGN_PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/;

function isCommandPositionMatch(segment, pattern) {
  const stripped = segment.replace(ENV_ASSIGN_PREFIX, '');
  const anchored = new RegExp('^' + pattern.source, pattern.flags.replace('g', ''));
  return anchored.test(stripped);
}

// ── lore-decide-gate (spec-autonomy-phase-1 AC-AU-3, adr-autonomy D7) ─────────
// `lore decide` is the HUMAN's channel for answering a pending autonomy decision. An agent's Bash call may never
// run it, whatever the outcome would be: the verb itself refuses non-TTY / agent-ancestry callers, and this rule
// stops the attempt before it starts. Same command-position matching as the git rules (a quoted mention such as
// `git commit -m "… lore decide …"` or `echo lore decide` never fires). Allows wrappers (`env`, `sudo`, `npx`, …),
// a path-qualified binary, global flags before the verb, and `bun|node run …/index.(ts|js) decide`.
// reason: the git refusals below are untouched; this block only ADDS a deny and exits 2 like they do.
const LORE_DECIDE_RULE_NAME = 'human-channel-only';
const LORE_DECIDE_PAT =
  /(?:(?:env|command|exec|nohup|time|sudo|npx|bunx|xargs)\s+(?:-\S+\s+)*)*(?:(?:\S*\/)?lore|(?:bun|node)\s+(?:run\s+)?\S*index\.(?:ts|js))\s+(?:-\S+\s+(?:[^-\s]\S*\s+)?)*decide(?:\s|$)/;

for (const pair of segmentPairs) {
  const target = selectInspectionTarget(pair);
  if (!target.inspect) continue;
  if (isCommandPositionMatch(target.sanitized, LORE_DECIDE_PAT)) {
    process.stderr.write(
      `\n⛔ [lore-decide-gate] BLOCKED — rule ${LORE_DECIDE_RULE_NAME}.\n` +
        `Segment : ${target.raw}\n` +
        `Why     : \`lore decide\` answers a pending decision and is the human's own channel (interactive terminal, ` +
        `nonce typed back). An agent's Bash call may never run it.\n` +
        `Safer   : Run \`lore pending\` to read the open decision, tell the user its id, and ask them to run ` +
        `\`lore decide <id> --accept|--reject\` in their own terminal.\n`,
    );
    process.exit(2);
  }
  for (const rule of RULES) {
    // Matching consumes the SANITIZED text — SPEC-066's guarantee that a quoted
    // string cannot smuggle a trigger into command position is untouched by D1.
    if (isCommandPositionMatch(target.sanitized, rule.pat)) {
      let assessment = '';
      if (rule.probe) {
        // Probes consume the RAW text (D1). Safe because git() is
        // spawnSync('git', argsArray) with no shell (D3): raw,
        // attacker-influenced text only ever becomes a single array element.
        try { assessment = rule.probe(target.raw); } catch { assessment = 'Assessment: probe failed — treat as UNSAFE.'; }
      }
      // A probe returning `null` (currently only probeWorktreeRemove, for its
      // CLEAN+MERGED+UNOCCUPIED+no-force case) declares THIS specific invocation
      // safe to pass through with no block at all — try the next rule instead
      // of this segment's match. Every other probe always returns a string,
      // so this is a no-op for them.
      if (assessment === null) continue;
      process.stderr.write(
        `\n⛔ [git-safety-gate] BLOCKED — destructive operation detected.\n` +
          // D5: what the user actually typed. Printing the blanked segment
          // (`git stash drop ''`) misrepresented the command and cost the
          // finding session an incorrect root-cause attribution.
          `Segment : ${target.raw}\n` +
          `Why     : ${rule.why}\n` +
          (assessment ? `${assessment}\n` : '') +
          `Safer   : ${rule.safe}\n` +
          `\n` +
          `If this is genuinely necessary, ask the user to run it in their own shell.\n` +
          `Subagents MUST NOT bypass this gate by chaining (e.g., bash -c "git reset --hard").\n`,
      );
      process.exit(2);
    }
  }
}

process.exit(0);
