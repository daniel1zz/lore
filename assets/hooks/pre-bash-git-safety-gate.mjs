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
 *
 * State-probed rules (block + evidence):
 *   git reset --hard/--keep/--merge   → dirty-tree file list, or "clean"
 *   git checkout -- <path> / git restore <path> → that path's dirty state
 *   git clean -f/-fd/-fdx             → `git clean -n` preview of what dies
 *   git stash drop/clear              → `git stash list` (what would be lost)
 *   git worktree remove --force <p>   → worktree dirty state + branch merged?
 *   git branch -D <b>                 → branch merged/ancestor? unmerged commits?
 * Unconditional hard-block (no safe variant / not cheaply determinable):
 *   git push --force / -f / --force-with-lease
 *   rm -rf .git
 *   git update-ref -d
 *   git reflog delete / expire --expire=now
 *
 * Allowed (safe variants, never matched):
 *   git reset --soft/--mixed · git restore --staged · git stash push/pop
 *   git clean -n · git branch -d (merged-only) · git worktree remove (no --force)
 *
 * Escape hatch: a matched op is BLOCKED with a clear message; when genuinely
 * needed the human runs it in their own shell (they can run anything directly).
 * Subagents MUST NOT bypass by chaining (bash -c "…") — inner commands are
 * inspected too.
 */

import { readFileSync } from 'node:fs';
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

// ── probes: return an "Assessment:" evidence string (safe or dangerous) ───────
function probeDirtyTree(_inner, cwd = CWD) {
  const st = git(['status', '--porcelain'], cwd);
  if (!st.ok) return `Assessment: could not read repo state (${st.err || 'git failed'}) — treat as UNSAFE.`;
  if (!st.out) return 'Assessment: working tree is CLEAN — nothing would be lost. If that is what you intend, run it yourself.';
  const n = st.out.split('\n').filter(Boolean).length;
  return `Assessment: WOULD DESTROY ${n} uncommitted change(s):\n${firstLines(st.out, 8)}`;
}

function probePathArg(inner, cwd = CWD) {
  // paths after the git verb (best-effort; already-blanked quotes won't appear)
  const st = git(['status', '--porcelain'], cwd);
  if (!st.ok) return `Assessment: could not read repo state — treat as UNSAFE.`;
  if (!st.out) return 'Assessment: working tree is CLEAN — the target path has no uncommitted changes to lose.';
  return `Assessment: uncommitted changes exist; the target path may lose work:\n${firstLines(st.out, 8)}`;
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

function probeStash(_inner, cwd = CWD) {
  const ls = git(['stash', 'list'], cwd);
  if (!ls.ok) return 'Assessment: could not read stash list — treat as UNSAFE.';
  if (!ls.out) return 'Assessment: stash is EMPTY — no-op. Safe.';
  return `Assessment: WOULD DESTROY these stash entrie(s):\n${firstLines(ls.out, 8)}`;
}

function extractPathArg(inner, verbRe) {
  // tokens after the matched verb, first that isn't a flag
  const rest = inner.replace(verbRe, ' ').trim().split(/\s+/);
  return rest.find((t) => t && !t.startsWith('-')) || null;
}

function probeWorktreeForce(inner) {
  const path = extractPathArg(inner, /\bgit\s+worktree\s+remove\b/);
  if (!path) return 'Assessment: could not parse the worktree path — treat as UNSAFE.';
  const st = git(['status', '--porcelain'], path);
  const dirty = st.ok && st.out;
  const br = git(['rev-parse', '--abbrev-ref', 'HEAD'], path);
  const base = defaultBranch();
  let merged = false;
  if (br.ok && br.out && br.out !== 'HEAD') {
    merged = git(['merge-base', '--is-ancestor', br.out, base]).ok;
  }
  if (dirty) {
    const n = st.out.split('\n').filter(Boolean).length;
    return `Assessment: WORKTREE HAS ${n} UNCOMMITTED change(s) — --force DELETES them:\n${firstLines(st.out, 8)}`;
  }
  if (br.ok && br.out && br.out !== 'HEAD' && !merged) {
    const ahead = git(['log', '--oneline', `${base}..${br.out}`]);
    return `Assessment: worktree is clean but its branch "${br.out}" is NOT merged into ${base} — removing loses these commit(s):\n${firstLines(ahead.out || '(unknown)', 6)}`;
  }
  return `Assessment: worktree is CLEAN and its branch is merged into ${base} (or detached) — --force is only needed for untracked leftovers (e.g. node_modules). Likely SAFE; run it yourself to confirm.`;
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
    safe: 'Use `git stash push -m "wip"` first, or `git reset --soft` (HEAD only).',
    probe: probeDirtyTree,
  },
  {
    pat: /\bgit\s+checkout\s+(--\s+\S|\.(\s|$)|HEAD(\s|$)|HEAD\s+--\s)/,
    why: 'git checkout -- <path> / . / HEAD discards working-tree changes',
    safe: 'Use `git stash` if you want to compare, or read files explicitly.',
    probe: probePathArg,
  },
  {
    pat: /\bgit\s+restore\b(?!.*--staged\b)/,
    why: 'git restore (default --worktree) discards working-tree changes',
    safe: 'Use `git restore --staged <path>` to unstage only, or `git stash` to save.',
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
    pat: /\bgit\s+worktree\s+remove\b[^\n]*?\s(--force|-f)(?=\s|$)/,
    why: 'git worktree remove --force destroys a worktree even with uncommitted/unmerged work (the W4 near-data-loss)',
    safe: 'Verify the work landed — `git log <base>..<branch>` empty OR the branch merged. A merge that says "Already up to date" on a branch that SHOULD carry work is the STOP signal. Legit cleanup of a merged worktree uses `git worktree remove` WITHOUT --force.',
    probe: probeWorktreeForce,
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

// ── preprocess: strip heredocs, expand `bash -c "…"`, blank quoted strings ────
function preprocessForInspection(raw) {
  let work = raw.replace(
    /\b(?:bash|sh|zsh)\s+(?:-l\s+)?-c\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
    (_m, q) => ` ; ${q.slice(1, -1)} ; `,
  );
  work = stripHeredocs(work);
  work = work.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  work = work.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  return work;
}

// SPEC-066 D3: fail-closed. A preprocessing exception falls back to inspecting
// the ORIGINAL raw text — the gate may over-block on pathological input it
// cannot parse, but must never silently under-block (same posture as the
// probe try/catch blocks below).
let preprocessed;
try {
  preprocessed = preprocessForInspection(cmd);
} catch {
  preprocessed = cmd;
}

const segments = preprocessed
  .split(/(?:&&|\|\||\||;|\n)+/)
  .map((s) => s.trim())
  .filter(Boolean);

const PRINT_LIKE = /^(echo|printf|cat|head|tail|less|more|grep|rg|ag|sed|awk|jq|cut|tr|sort|uniq|wc|find|ls|stat|file|test|\[|true|false)\b/;

function shouldInspect(segment) {
  const shInline = segment.match(/^(?:bash|sh|zsh)\s+(?:-l\s+)?-c\s+['"]([^'"]*)['"]/);
  if (shInline) return { inner: shInline[1], inspect: true };
  if (PRINT_LIKE.test(segment)) return { inner: segment, inspect: false };
  return { inner: segment, inspect: true };
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

for (const segment of segments) {
  const { inner, inspect } = shouldInspect(segment);
  if (!inspect) continue;
  for (const rule of RULES) {
    if (isCommandPositionMatch(inner, rule.pat)) {
      let assessment = '';
      if (rule.probe) {
        try { assessment = rule.probe(inner); } catch { assessment = 'Assessment: probe failed — treat as UNSAFE.'; }
      }
      process.stderr.write(
        `\n⛔ [git-safety-gate] BLOCKED — destructive operation detected.\n` +
          `Segment : ${inner}\n` +
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
