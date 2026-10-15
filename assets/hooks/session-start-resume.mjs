#!/usr/bin/env node
/**
 * session-start-resume.mjs — SessionStart hook.
 *
 * Phase C: REMOVED (spec-context-fragments-config-driven-layered-rule-injection
 *          D6). The governance prose (`lore governance`, formerly injected
 *          here) now ships as context fragments under assets/context/
 *          rendered into the project CLAUDE.md Z1 by `lore context refresh`
 *          (run by `lore setup --project`); dynamic fragments come from the
 *          SECOND SessionStart hook, `session-start-fragments.mjs`, so each
 *          hook string stays under the 10,000-char cap on its own. Phase
 *          letters D-F are kept unchanged so cross-references stay valid.
 * Phase D: linked-worktree seat detection (SPEC-047) — auto-injects the
 *          seat-briefing discipline block for sessions opened inside a
 *          linked git worktree of a lore-governed repo. SPEC-085 D2: the
 *          template source is now the RUNTIME `lore governance
 *          --seat-briefing` verb (the SAME resolved binary Phase C/E spawn),
 *          never an installed file snapshot — the pre-SPEC-085 two-candidate
 *          lookup (`<claude-dir>/governance/seat-briefing.md`, then
 *          `<main-checkout>/assets/governance/seat-briefing.md`) is retired
 *          along with the install-set entry (D3). Placeholder substitution
 *          and the fail-open contract are unchanged.
 * Phase E: lore bootstrap injection (the seat's OWN items only, when the
 *          resolved corpus root — main checkout for a linked worktree, cwd
 *          otherwise — has .lore/). spec-session-start-injection-carries-only-
 *          the-session-s-own D2/D6/D11/D12. This hook is a BLIND PIPE:
 *            (E-b) `lore bootstrap --injection` runs FIRST. A linked-worktree
 *                  seat passes `--seat-branch <branch> --seat-worktree
 *                  <realpath of git rev-parse --show-toplevel>` (the binary
 *                  requires both together); the main checkout passes neither.
 *                  Exit 0 + EMPTY stdout means "nothing to inject": no fence,
 *                  no framing line, NO degradation entry, and E-a is never
 *                  spawned. A non-zero exit or a missing binary still degrades.
 *            (E-a) `lore governance bootstrap-framing` — the scope-boundary
 *                  line (`BOOTSTRAP_FRAMING_LINE`, `@lore/core`), spawned ONLY
 *                  when E-b produced a payload. Fail-open, same contract as
 *                  Phase C/D's governance topics: a missing binary, non-zero
 *                  exit, or empty stdout leaves the line absent, never a
 *                  degradation entry (advisory framing, not the payload).
 *          The two are composed as ONE rendered block: E-a's line OUTSIDE the
 *          markdown fence, E-b's JSON INSIDE it. This hook never parses,
 *          re-serializes, or inspects either spawn's output — it relays each
 *          verbatim. (Printing the framing line inside `--injection`'s own
 *          stdout was rejected: it breaks the bare-JSON `--injection`
 *          contract and makes the hook parse-adjacent.)
 *          `INJECTION_BACKSTOP_CAP` (12000 chars) remains a pure safety
 *          backstop on E-b's JSON stdout alone — the projection is already
 *          char-budgeted binary-side, so exceeding it signals a binary-side
 *          bug. On overflow the hook drops the whole block rather than
 *          slicing stdout and records a degradation entry naming the length.
 * Phase F: session-start upgrade advisory (SPEC-076 §C6, BR-1086). Reads BOTH
 *          the global cache `<claude-dir>/.lore-setup-check.json` and the
 *          project cache `<repo>/.lore/.lore-project-check.json` (repo = nearest
 *          ancestor of cwd with `.lore/`) and emits ONE directive line: which
 *          side(s) are behind, why (binary version changed / settings changed /
 *          files edited by hand, named) and the command to run before other work
 *          (`lore setup`, `lore setup --project`). Hand-edited files are named
 *          and never advised to be replaced. Both in sync -> nothing. No rule
 *          text is injected. A missing / unparseable / expired cache fires a
 *          DETACHED, UNREF'D refresh of that side (`lore setup --check --json` /
 *          `lore setup --project --check --json` in the repo; never awaited) and
 *          is never read as "in sync". `LORE_SETUP_NO_CHECK=1` is a hard
 *          kill-switch checked BEFORE any cache read.
 *
 *          Known gap (documented, not silently dropped): SPEC-076 §C6's
 *          illustrative advisory text shows "(binary X / installed Y)", but
 *          the ACTUAL `SetupCheckCache` shape (`adapters/cli/setup-check.ts`,
 *          §C6 Downstream Handoff) carries only the CURRENTLY-RUNNING
 *          binary's own `binary_version` — no separate "installed" version
 *          field exists in the cache. This phase renders what the cache
 *          actually contains (`binary_version` + stale-file counts) rather
 *          than inventing a phantom installed-version field.
 *
 *          `setup.check_reminder` (`packages/core/src/config.ts`, default
 *          true) is enforced end-to-end as of task task-skill-implement-t8b:
 *          this standalone installed hook script still never parses
 *          `.lore/config.yaml` itself (no guaranteed local `node_modules`,
 *          so no `yaml` parser reachable) — instead the CLI-side write path
 *          (`adapters/cli/setup-check.ts::resolveCheckReminderEnabled`)
 *          resolves the config and stamps `reminder_enabled: false` onto the
 *          cache when the reminder is disabled; this phase just honors that
 *          field (`cache.reminder_enabled === false` → suppress, same as the
 *          `LORE_SETUP_NO_CHECK=1` kill-switch but per-config instead of
 *          per-env-var). A cache with NO `reminder_enabled` field (legacy,
 *          or the reminder enabled) behaves byte-identically to before this
 *          task — fail-open on absence.
 *
 * Graceful degradation — a missing lore binary or corpus must never block
 * session start. Projects without .lore/ simply get no bootstrap block.
 * Phase D follows the same rule: any git/fs error there must never block
 * session start — it silently produces no seat block and the rest of the
 * hook runs exactly as if this were a main-checkout session (g1-hook
 * fail-open precedent). Phase F follows the SAME rule (I6 fail-open) — any
 * fs/JSON/spawn error there must never block or crash session start.
 */

import {
  existsSync, readFileSync, readdirSync, realpathSync, rmSync, statSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { readHookPayload, resolveSessionId } from './lib/turn-state.mjs';

// No longer read for a roster (removed 2026-07-17 — harness lists agents
// natively); retained because Phase D derives <claude-dir> as its dirname,
// and CLAUDE_AGENTS_DIR_OVERRIDE keeps tests hermetic.
const AGENTS_DIR = process.env.CLAUDE_AGENTS_DIR_OVERRIDE
  || join(homedir(), '.claude', 'agents');
const SESSION_STATE_BASE = process.env.CLAUDE_STATE_BASE_OVERRIDE
  || join(homedir(), '.claude', 'session-state');
// SPEC-080 D3 — a pure safety backstop on the ALREADY char-budgeted tier-1
// injection payload (`buildBootstrapInjection`, `@lore/core`), never a
// second truncation policy: exceeding it means the binary side is not
// honoring its own budget, so the hook drops the whole block rather than
// mid-JSON-slicing (which would violate the projection contract's
// no-mid-JSON-slice rule at this layer too).
const INJECTION_BACKSTOP_CAP = 12000;

// Phase F (SPEC-076 §C6) — cache filename is a DELIBERATE literal duplicate of
// `adapters/cli/setup-check.ts`'s private `CHECK_CACHE_FILENAME` constant of
// the same value: that module owns the write side, this hook only ever reads
// it, and the two live in physically separate deployable artifacts (compiled
// binary vs. standalone installed .mjs file) with no shared import surface —
// same "deliberate literal duplicate" precedent `setup-check.ts`'s own module
// doc documents for `MANIFEST_FILENAME`.
const SETUP_CHECK_CACHE_FILENAME = '.lore-setup-check.json';
// Project check cache (BR-1085), repo-relative — literal duplicate of `PROJECT_CHECK_CACHE_RELATIVE_PATH`
// in `adapters/cli/setup-check.ts`, same reason as the filename above.
const PROJECT_CHECK_CACHE_RELATIVE_PATH = '.lore/.lore-project-check.json';
// 24h — SPEC-076 §C6/D4: the timestamp only gates *when* to recheck; the
// truth of "sync vs stale" always comes from the cache's own `status` field
// (oh-my-zsh lesson named explicitly in the spec), never re-derived here.
const SETUP_CHECK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function emit(additionalContext) {
  if (!additionalContext) {
    process.stdout.write('{}');
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
  }));
  process.exit(0);
}

// ── Clear stale autopilot lock ─────────────────────────────────────
// Session id = the SessionStart stdin payload `session_id` (common input field,
// https://code.claude.com/docs/en/hooks) — the same source every turn-state hook
// uses. No usable id (empty/malformed stdin) is NOT guessed (no env/ppid
// fallback, lore issue #156): the lock clear AND the GC below are skipped,
// because without the current id the GC could not protect the live session dir.
// Session start itself still proceeds (fail-open).
let sessionId = null;
try {
  sessionId = resolveSessionId(readHookPayload());
} catch (err) {
  process.stderr.write(`[session-start-resume] session id not measured, autopilot-lock clear and GC skipped: ${err.message}\n`);
}
if (sessionId !== null) {
  const lockFile = join(SESSION_STATE_BASE, 'sessions', sessionId, 'autopilot.lock');
  try { if (existsSync(lockFile)) rmSync(lockFile); } catch {}
}

// ── GC: sweep session-state dirs idle > 14 days ────────────────────
// Turn-state marks (read/edit jsonl + per-turn dirs) accumulate one dir per
// turn with NO other reclaimer (observed 2026-07-17: 37MB / 1146 dirs).
// Old sessions are worthless — sweep at session start, fail-silent, never
// touching the CURRENT session's dir.
try {
  const sessionsRoot = join(SESSION_STATE_BASE, 'sessions');
  if (sessionId !== null && existsSync(sessionsRoot)) {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    for (const name of readdirSync(sessionsRoot)) {
      if (name === sessionId) continue;
      const dir = join(sessionsRoot, name);
      try {
        if (statSync(dir).mtimeMs < cutoff) rmSync(dir, { recursive: true, force: true });
      } catch { /* skip entry */ }
    }
  }
} catch { /* GC is best-effort — must never block session start */ }

// ── Degradation tracker — critical component failures only ────────
const degradations = [];

// ── Phase D: linked-worktree seat detection (SPEC-047) ─────────────
// A linked worktree's `.git` is a file pointing at a per-worktree gitdir
// under the MAIN checkout's `.git/worktrees/<name>`; `--git-common-dir`
// always resolves to the main checkout's real `.git` directory while
// `--git-dir` resolves to the per-worktree one — they differ iff cwd is a
// linked worktree (identical in the main checkout, and in a non-worktree
// repo). Detection is pure environment inference: no new state, no config,
// mirrors SPEC-042's "derived, never stored" session ethos.
let seatBlock = '';
let bootstrapCwd = process.cwd();
// The resolved seat/worktree branch, threaded onto Phase E's `lore bootstrap
// --injection` spawn as `--seat-branch <branch>` (with `--seat-worktree`, below).
// Stays `null` for a main-checkout session (bootstrapCwd never redirects) —
// Phase E's spawn args carry neither seat flag in that case.
let seatBranchForBootstrap = null;
// Realpath of this session's worktree top level (`git rev-parse --show-toplevel`,
// run from cwd so a subdirectory start still names the worktree root). The binary
// matches claims recorded as a worktree path against it (D11/D12) and REQUIRES it
// together with `--seat-branch` in `--injection` mode. `null` iff the branch is.
let seatWorktreeForBootstrap = null;
try {
  const commonDirRaw = spawnSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 5000,
  });
  const gitDirRaw = spawnSync('git', ['rev-parse', '--git-dir'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 5000,
  });
  if (commonDirRaw.status === 0 && gitDirRaw.status === 0
      && commonDirRaw.stdout && gitDirRaw.stdout) {
    const commonDirAbs = resolve(process.cwd(), commonDirRaw.stdout.trim());
    const gitDirAbs = resolve(process.cwd(), gitDirRaw.stdout.trim());
    if (commonDirAbs !== gitDirAbs) {
      // Linked worktree. The main checkout is the common gitdir's parent.
      const mainCheckout = dirname(commonDirAbs);
      if (existsSync(join(mainCheckout, '.lore'))) {
        bootstrapCwd = mainCheckout; // corpus lives at the main checkout, not here

        let branch = '';
        const branchRaw = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: process.cwd(), encoding: 'utf8', timeout: 5000,
        });
        if (branchRaw.status === 0 && branchRaw.stdout) branch = branchRaw.stdout.trim();
        if (!branch || branch === 'HEAD') {
          // Detached HEAD (or resolution failure) — fall back to a short-sha slug.
          const shaRaw = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
            cwd: process.cwd(), encoding: 'utf8', timeout: 5000,
          });
          const shortSha = shaRaw.status === 0 && shaRaw.stdout ? shaRaw.stdout.trim() : 'unknown';
          branch = `worktree-${shortSha}`;
        }

        // Threaded onto Phase E's `lore bootstrap --injection --seat-branch
        // <branch> --seat-worktree <top level>` below. Set for EVERY
        // linked-worktree session with a resolved corpus root, including the
        // detached-HEAD synthetic `worktree-<shortsha>` label (it simply matches
        // no claim) — never this hook's job to pre-filter. The two flags are set
        // together or not at all: the binary exits 2 on either alone.
        const topLevelRaw = spawnSync('git', ['rev-parse', '--show-toplevel'], {
          cwd: process.cwd(), encoding: 'utf8', timeout: 5000,
        });
        if (topLevelRaw.status === 0 && topLevelRaw.stdout.trim()) {
          seatWorktreeForBootstrap = realpathSync(topLevelRaw.stdout.trim());
          seatBranchForBootstrap = branch;
        } else {
          process.stderr.write(
            'session-start-resume: linked worktree top level unresolvable '
            + "('git rev-parse --show-toplevel' failed); bootstrap injection runs without a seat\n",
          );
        }

        const actorSlug = branch
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        const actor = `agent:${actorSlug}`;

        // SPEC-085 D2 — source is now the RUNTIME `lore governance --seat-briefing`
        // verb (never an installed file snapshot under `<claude-dir>/governance/`
        // or the worktree's `assets/governance/`, both retired from the install
        // set by D3). Same binary Phase C/E already spawn as bare `'lore'`, same
        // invocation shape (`cwd: mainCheckout` — the corpus root Phase D just
        // resolved). Fail-open: a missing binary (ENOENT), non-zero exit, or
        // empty stdout leaves `seatBlock` at its initial `''` and prints a
        // same-shaped stderr notice — identical fail-open contract to the
        // pre-SPEC-085 missing-file case, never blocks session start.
        let briefingTemplate = '';
        try {
          const briefingResult = spawnSync('lore', ['governance', '--seat-briefing'], {
            cwd: mainCheckout,
            encoding: 'utf8',
            timeout: 5000,
          });
          if (briefingResult.status === 0 && typeof briefingResult.stdout === 'string'
              && briefingResult.stdout.length > 0) {
            briefingTemplate = briefingResult.stdout;
          }
        } catch { /* fail-open — seat-briefing injection must never block session start */ }

        if (briefingTemplate) {
          seatBlock = briefingTemplate
            .split('{{ACTOR}}').join(actor)
            .split('{{BRANCH}}').join(branch)
            .split('{{MAIN_CHECKOUT}}').join(mainCheckout);
        } else {
          process.stderr.write(
            'session-start-resume: linked worktree detected but seat-briefing unavailable '
            + "from binary ('lore governance --seat-briefing' failed or returned empty); "
            + 'skipping seat injection\n',
          );
        }
      }
    }
  }
} catch {
  // Fail-open — any git/fs error here must never block session start.
}

// ── Phase E: lore bootstrap injection ──────────────────────────────
// The seat's OWN items only (see this file's module-header "Phase E" note).
// Only when the resolved corpus root (main checkout for a linked worktree,
// cwd otherwise) has .lore/.
let bootstrapBlock = '';
if (existsSync(join(bootstrapCwd, '.lore'))) {
  // E-b first: the bootstrap --injection JSON payload — bare compact JSON,
  // nothing else, on stdout (SPEC-080 AC-080-3). Blind pipe — this hook never
  // parses, re-serializes, or inspects a single field. Seat flags are passed
  // together, for a linked-worktree session only; a main-checkout session
  // passes neither and the binary prints nothing.
  const bootstrapArgs = ['bootstrap', '--injection'];
  if (seatBranchForBootstrap !== null && seatWorktreeForBootstrap !== null) {
    bootstrapArgs.push(
      '--seat-branch', seatBranchForBootstrap,
      '--seat-worktree', seatWorktreeForBootstrap,
    );
  }
  const r = spawnSync('lore', bootstrapArgs, {
    cwd: bootstrapCwd,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, CLAUDECODE: '1' }, // agent surface → AI defaults off (SPEC-024)
  });
  const stdout = r.status === 0 && typeof r.stdout === 'string' ? r.stdout.trim() : '';
  if (r.status === 0 && stdout === '') {
    // Exit 0 + empty stdout is the binary's "this seat has nothing to inject"
    // answer: no fence, no framing line, NO degradation entry, and the
    // framing spawn below never happens.
  } else if (stdout) {
    if (stdout.length > INJECTION_BACKSTOP_CAP) {
      // Drops the whole block, never slices mid-JSON.
      degradations.push({
        component: 'lore bootstrap',
        reason: `injection payload ${stdout.length} chars exceeds ${INJECTION_BACKSTOP_CAP} backstop `
          + '— binary-side bug, run `lore setup` / investigate',
      });
    } else {
      // E-a: the scope-boundary framing line — spawned ONLY now that there is
      // a payload for it to bound. Fail-open, same contract as Phase C/D's
      // governance topics: a missing binary, non-zero exit, or empty stdout
      // leaves `framingLine` at '' and the bare fence still renders — advisory
      // framing is never degradation-worthy on its own.
      let framingLine = '';
      try {
        const framingResult = spawnSync('lore', ['governance', 'bootstrap-framing'], {
          cwd: bootstrapCwd,
          encoding: 'utf8',
          timeout: 5000,
        });
        if (framingResult.status === 0 && typeof framingResult.stdout === 'string'
            && framingResult.stdout.length > 0) {
          framingLine = framingResult.stdout;
        }
      } catch { /* fail-open — framing-line injection must never block session start */ }

      // D2 placement: framing line OUTSIDE the markdown fence, JSON INSIDE it.
      const fence = `\`\`\`json\n${stdout}\n\`\`\``;
      bootstrapBlock = framingLine ? `${framingLine}\n\n${fence}` : fence;
    }
  } else {
    const reason = r.error?.code === 'ENOENT'
      ? 'lore binary not on PATH (expected: symlink of <lore-repo>/dist/lore)'
      : `lore bootstrap failed (exit ${r.status ?? 'signal'}): ${(r.stderr || '').slice(0, 200)}`;
    degradations.push({ component: 'lore bootstrap', reason });
  }
}

// ── Degradation report — only for critical component failures ─────
let degradationBlock = '';
if (degradations.length > 0) {
  const seen = new Set();
  const unique = degradations.filter(d => {
    if (seen.has(d.component)) return false;
    seen.add(d.component);
    return true;
  });
  const items = unique.map(d => `- **${d.component}**: ${d.reason}`).join('\n');
  degradationBlock = `## ⚠️ Degradation Report

Critical hook component(s) unavailable this session. Some workflow features may be reduced:

${items}

Action: Check installation. Non-critical features are unaffected.`;
}

// ── Phase F: session-start upgrade advisory — cache-first, global + project ─
// See this file's module-header "Phase F" note for the full contract.

/**
 * Fires a DETACHED, UNREF'D `lore setup [--project] --check --json` refresh —
 * never awaited, never blocks this session. `scopeArgs` / `tailArgs` wrap the
 * fixed `--check --json`; `cwd` pins the project refresh to
 * the repo whose cache was read. An 'error' listener turns a missing `lore`
 * binary (ENOENT) into a swallowed async event — fail-open (I6).
 */
function spawnDetachedSetupCheck(scopeArgs, tailArgs, cwd) {
  try {
    const child = spawn('lore', ['setup', ...scopeArgs, '--check', '--json', ...tailArgs], { detached: true, stdio: 'ignore', ...(cwd ? { cwd } : {}) });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Fail-open — spawn() throwing synchronously (rare) must never block session start.
  }
}

/** Nearest ancestor of `start` holding a `.lore/` directory, or null (no project side then). */
function findProjectRoot(start) {
  let dir = resolve(start);
  for (;;) {
    try {
      if (statSync(join(dir, '.lore')).isDirectory()) return dir;
    } catch {
      // not here — keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Reads one check cache. Returns { kind: 'usable', cache } for a parsed,
 * well-shaped, <24h cache; { kind: 'refresh' } for a missing / unparseable /
 * mis-shaped / expired one. A cache that fails to parse is NEVER read as
 * "in sync" (BR-1086) — it schedules a refresh instead.
 */
function readCheckCache(cachePath) {
  let cache = null;
  if (existsSync(cachePath)) {
    try {
      cache = JSON.parse(readFileSync(cachePath, 'utf8'));
    } catch {
      cache = null;
    }
  }
  const valid = cache !== null && typeof cache === 'object'
    && typeof cache.checked_at === 'string'
    && typeof cache.binary_version === 'string'
    && (cache.status === 'sync' || cache.status === 'stale');
  if (!valid) return { kind: 'refresh' };
  const ageMs = Date.now() - Date.parse(cache.checked_at);
  const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs < SETUP_CHECK_CACHE_TTL_MS;
  return fresh ? { kind: 'usable', cache } : { kind: 'refresh' };
}

const ADVISORY_FILE_CAP = 5;

function nameFiles(paths) {
  const list = paths.filter((p) => typeof p === 'string');
  const shown = list.slice(0, ADVISORY_FILE_CAP).join(', ');
  return list.length > ADVISORY_FILE_CAP ? `${shown} (+${list.length - ADVISORY_FILE_CAP} more)` : shown;
}

/**
 * Describes ONE behind side: `{ text, needsCommand }`. Reasons are derived from
 * the cache's per-state `files` lists (same rule as `deriveSetupCheckReasons`:
 * a `#` entry is a settings key, any other behind path is a binary-shipped
 * file); a legacy cache with no `files` detail falls back to counts + binary
 * version. Diverged files are only ever named as hand-edited and left alone —
 * `needsCommand` is false when they are the sole reason, so no command that
 * could replace them is advised.
 */
function describeBehindSide(label, cache) {
  const f = cache.files && typeof cache.files === 'object' ? cache.files : null;
  if (!f) {
    const c = cache.stale_counts;
    const n = c && typeof c === 'object' ? (c.outdated ?? 0) + (c.diverged ?? 0) + (c.missing ?? 0) : null;
    const detail = n === null ? `binary ${cache.binary_version}` : `${n} file(s), binary ${cache.binary_version}`;
    return { text: `${label}: ${detail}`, needsCommand: true };
  }
  const list = (k) => (Array.isArray(f[k]) ? f[k].filter((p) => typeof p === 'string') : []);
  const behind = [...list('outdated'), ...list('missing'), ...list('orphaned')];
  const settingsEntries = behind.filter((p) => p.includes('#'));
  const plainFiles = behind.filter((p) => !p.includes('#'));
  const diverged = list('diverged');
  const parts = [];
  if (plainFiles.length > 0) parts.push(`binary version changed (binary ${cache.binary_version}; ${nameFiles(plainFiles)})`);
  if (settingsEntries.length > 0) parts.push(`${label} settings changed (${nameFiles(settingsEntries)})`);
  if (diverged.length > 0) parts.push(`edited by hand, left as they are: ${nameFiles(diverged)}`);
  if (parts.length === 0) parts.push(`binary ${cache.binary_version}`);
  return { text: `${label}: ${parts.join('; ')}`, needsCommand: behind.length > 0 || diverged.length === 0 };
}

let advisoryBlock = '';
try {
  if (process.env.LORE_SETUP_NO_CHECK !== '1') {
    const claudeDir = dirname(AGENTS_DIR);
    const projectRoot = findProjectRoot(process.cwd());
    const sides = [{
      label: 'global',
      command: '`lore setup`',
      read: readCheckCache(join(claudeDir, SETUP_CHECK_CACHE_FILENAME)),
      refresh: () => spawnDetachedSetupCheck([], ['--claude-dir', claudeDir]),
    }];
    if (projectRoot !== null) {
      sides.push({
        label: 'project',
        command: '`lore setup --project`',
        read: readCheckCache(join(projectRoot, PROJECT_CHECK_CACHE_RELATIVE_PATH)),
        refresh: () => spawnDetachedSetupCheck(['--project'], [], projectRoot),
      });
    }

    const behind = [];
    for (const side of sides) {
      if (side.read.kind === 'refresh') {
        side.refresh(); // this session gets nothing from this side; the NEXT one may see a fresh cache
      } else if (side.read.cache.status === 'stale' && side.read.cache.reminder_enabled !== false) {
        // `reminder_enabled === false` is stamped only when `setup.check_reminder`
        // resolved to false; absence (legacy cache) means enabled — fail-open.
        behind.push({ ...describeBehindSide(side.label, side.read.cache), command: side.command });
      }
    }

    if (behind.length > 0) {
      const commands = behind.filter((b) => b.needsCommand).map((b) => b.command);
      const action = commands.length > 0
        ? `run before other work: ${commands.join(' then ')}`
        : 'nothing to run: lore setup leaves hand-edited files as they are';
      advisoryBlock = `⚠ lore assets outdated — ${behind.map((b) => b.text).join(' | ')} — ${action}`;
    }
  }
} catch {
  // Fail-open (I6) — any fs/JSON error here must never block or crash session start.
}

// ── Compose (order: seat → bootstrap → degradation → advisory) ─
const parts = [seatBlock, bootstrapBlock, degradationBlock, advisoryBlock].filter(Boolean);
emit(parts.join('\n\n'));
