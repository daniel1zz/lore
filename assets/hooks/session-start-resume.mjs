#!/usr/bin/env node
/**
 * session-start-resume.mjs — SessionStart hook.
 *
 * Phase C: governance-prose injection (`lore governance`) — SPEC-083 D2:
 *          spawns the resolved `lore` binary's `governance` verb (the SAME
 *          binary Phase E already spawns for `lore bootstrap`) and injects
 *          its stdout verbatim, ONLY when the session's resolved corpus root
 *          has .lore/ (computed after Phase D, which may redirect the root
 *          to a worktree's main checkout). Replaces the pre-SPEC-083
 *          file-read of an INSTALLED governance-snippet snapshot under
 *          `<claude-dir>/governance/` — that installed copy could silently
 *          drift out of sync with the
 *          running binary across an unreinstalled upgrade (the exact defect
 *          SPEC-083 fixes: the binary now emits its own governance prose at
 *          runtime, from its OWN assets root, so prose and binary version
 *          can never diverge). Fail-open is UNCHANGED: a missing `lore`
 *          binary, non-zero exit, or empty stdout silently skips this phase
 *          — never blocks session start, never double-injects. Unified
 *          2026-07-17: the ORIGINAL previous source
 *          (prompt/global-instructions.md) was NEVER written by `lore setup`
 *          (it installs under governance/) — the phase was a reader without
 *          a writer, product-wide dead code. The former subagent-roster
 *          block was REMOVED the same day: the harness natively lists custom
 *          agents from ~/.claude/agents.
 * Phase D: linked-worktree seat detection (SPEC-047) — auto-injects the
 *          seat-briefing.md discipline block for sessions opened inside a
 *          linked git worktree of a lore-governed repo
 * Phase E: lore bootstrap injection (corpus pointer set, when the resolved
 *          corpus root — main checkout for a linked worktree, cwd otherwise —
 *          has .lore/). SPEC-080 D3 — this hook is a BLIND PIPE: it spawns
 *          `lore bootstrap --injection`, trims stdout, and wraps it verbatim
 *          in the markdown fence with ZERO knowledge of the payload's field
 *          names or shape (the binary side owns the tier-1 projection
 *          contract entirely, `buildBootstrapInjection` in `@lore/core`).
 *          `INJECTION_BACKSTOP_CAP` (12000 chars) is a pure safety backstop,
 *          not a truncation policy — the projection is already
 *          char-budgeted binary-side, so exceeding this cap signals a
 *          binary-side bug. On overflow the hook drops the bootstrap block
 *          ENTIRELY (never slices stdout) and records a degradation entry
 *          naming the observed length.
 * Phase F: session-start advisory — cache-first asset-freshness check
 *          (SPEC-076 §C6). Reads `<claude-dir>/.lore-setup-check.json`
 *          (written by `lore setup --check`, T4 of SPEC-076) — a fresh
 *          (<24h) `sync` cache injects nothing, a fresh `stale` cache injects
 *          exactly one advisory line, and a missing/expired/corrupted cache
 *          fires a DETACHED, UNREF'D `lore setup --check --json` refresh
 *          (never awaited — this session gets nothing, the NEXT session may
 *          see a fresh cache). `LORE_SETUP_NO_CHECK=1` is a hard kill-switch
 *          checked BEFORE any cache read.
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
 * Bootstrap is hook-injected (was lazy-loaded by AI). Rationale: SessionStart
 * is low-frequency, `lore bootstrap` is a slim progressive-disclosure pointer
 * set, 100% delivery rate beats AI self-trigger (~70-90%).
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
  existsSync, readFileSync, readdirSync, rmSync, statSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { resolveSessionId } from './lib/turn-state.mjs';

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
const sessionId = resolveSessionId();
const lockFile = join(SESSION_STATE_BASE, 'sessions', sessionId, 'autopilot.lock');
try { if (existsSync(lockFile)) rmSync(lockFile); } catch {}

// ── GC: sweep session-state dirs idle > 14 days ────────────────────
// Turn-state marks (read/edit jsonl + per-turn dirs) accumulate one dir per
// turn with NO other reclaimer (observed 2026-07-17: 37MB / 1146 dirs).
// Old sessions are worthless — sweep at session start, fail-silent, never
// touching the CURRENT session's dir.
try {
  const sessionsRoot = join(SESSION_STATE_BASE, 'sessions');
  if (existsSync(sessionsRoot)) {
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

// Phase C is computed AFTER Phase D (it needs the resolved corpus root);
// see "Phase C: governance-prose injection" below. Declared here so the
// compose order (workflow first) is unaffected.
let workflowBlock = '';

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
// SPEC-057 AC-S-4 — the resolved seat/worktree branch, threaded onto Phase E's
// `lore bootstrap` spawn as `--seat-branch <branch>` so SessionService can scope
// resume_hint to this worktree's seat plan. Stays `null` for a main-checkout
// session (bootstrapCwd never redirects) — Phase E's spawn args stay
// byte-unchanged in that case (REGRESSION, AC-S-4).
let seatBranchForBootstrap = null;
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

        // SPEC-057 AC-S-4 — threaded onto Phase E's `lore bootstrap --seat-branch`
        // below. Set for EVERY linked-worktree session with a resolved corpus root,
        // including the detached-HEAD synthetic `worktree-<shortsha>` label —
        // SessionService.bootstrap's own `parseSeatBranch` resolves that as
        // unresolvable and degrades to corpus-global + `seat_unresolved: true`,
        // never this hook's job to pre-filter.
        seatBranchForBootstrap = branch;

        const actorSlug = branch
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        const actor = `agent:${actorSlug}`;

        // "claude-dir" per the hook's existing home-resolution convention:
        // AGENTS_DIR is always <claude-dir>/agents (default or override), so
        // its dirname is <claude-dir> under either default or test override.
        const claudeDir = dirname(AGENTS_DIR);
        const briefingCandidates = [
          join(claudeDir, 'governance', 'seat-briefing.md'),
          join(mainCheckout, 'assets', 'governance', 'seat-briefing.md'),
        ];
        const briefingPath = briefingCandidates.find((p) => existsSync(p));
        if (briefingPath) {
          const template = readFileSync(briefingPath, 'utf8');
          seatBlock = template
            .split('{{ACTOR}}').join(actor)
            .split('{{BRANCH}}').join(branch)
            .split('{{MAIN_CHECKOUT}}').join(mainCheckout);
        } else {
          process.stderr.write(
            'session-start-resume: linked worktree detected but no seat-briefing.md found '
            + `(checked ${briefingCandidates.join(', ')}); skipping seat injection\n`,
          );
        }
      }
    }
  }
} catch {
  // Fail-open — any git/fs error here must never block session start.
}

// ── Phase C: governance-prose injection (lore-governed sessions) ───
// SPEC-083 D2 — source is now the RUNTIME `lore governance` verb (never an
// installed file snapshot). Injection is gated on the RESOLVED corpus root
// (Phase D may have redirected it to a worktree's main checkout) having
// .lore/ — non-lore projects get nothing. `cwd: bootstrapCwd` mirrors Phase
// E's own spawn (below) even though `lore governance` itself needs no
// corpus — one consistent invocation shape. Fail-open: a missing binary
// (ENOENT), non-zero exit, or empty stdout leaves `workflowBlock` at its
// initial `''` — identical in effect to the pre-SPEC-083 missing-file case.
try {
  if (existsSync(join(bootstrapCwd, '.lore'))) {
    const governanceResult = spawnSync('lore', ['governance'], {
      cwd: bootstrapCwd,
      encoding: 'utf8',
      timeout: 5000,
    });
    if (governanceResult.status === 0 && typeof governanceResult.stdout === 'string'
        && governanceResult.stdout.length > 0) {
      workflowBlock = governanceResult.stdout;
    }
  }
} catch { /* fail-open — governance injection must never block session start */ }

// ── Phase E: lore bootstrap injection ──────────────────────────────
// Corpus pointer set (root doc, active plans + task counts, pending
// reviews, active sessions, stale candidates). Only when the resolved
// corpus root (main checkout for a linked worktree, cwd otherwise) has
// .lore/.
let bootstrapBlock = '';
if (existsSync(join(bootstrapCwd, '.lore'))) {
  // SPEC-057 AC-S-4 — `--seat-branch <branch>` is appended ONLY for a linked-worktree
  // session with a resolved corpus root (`seatBranchForBootstrap` non-null); a
  // main-checkout session's spawn args stay byte-unchanged (REGRESSION).
  const bootstrapArgs = ['bootstrap', '--injection'];
  if (seatBranchForBootstrap !== null) {
    bootstrapArgs.push('--seat-branch', seatBranchForBootstrap);
  }
  const r = spawnSync('lore', bootstrapArgs, {
    cwd: bootstrapCwd,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, CLAUDECODE: '1' }, // agent surface → AI defaults off (SPEC-024)
  });
  const stdout = r.status === 0 && typeof r.stdout === 'string' ? r.stdout.trim() : '';
  if (stdout) {
    // Blind pipe (SPEC-080 D3) — the binary owns the payload shape entirely;
    // this hook never parses, re-serializes, or inspects a single field name.
    if (stdout.length > INJECTION_BACKSTOP_CAP) {
      degradations.push({
        component: 'lore bootstrap',
        reason: `injection payload ${stdout.length} chars exceeds ${INJECTION_BACKSTOP_CAP} backstop `
          + '— binary-side bug, run `lore setup` / investigate',
      });
    } else {
      bootstrapBlock = `## Lore Bootstrap (hook-injected)

Corpus pointer set — deep-dive via \`lore get <slug>\`, \`lore tree <plan>\`, \`lore ready <plan> --json\`. Do NOT re-run \`lore bootstrap\` yourself.

\`\`\`json
${stdout}
\`\`\``;
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

// ── Phase F: session-start advisory — cache-first freshness (SPEC-076 §C6) ─
// See this file's module-header "Phase F" note for the full contract,
// including the documented `setup.check_reminder` config-knob gap.

/**
 * Fires a DETACHED, UNREF'D `lore setup --check --json` refresh — never
 * awaited, never blocks this session. `--claude-dir` is passed explicitly
 * (rather than relying on the child's own `$CLAUDE_CONFIG_DIR`/`~/.claude`
 * default resolution) so the refresh always targets the SAME directory this
 * phase read the cache from, including under a test's
 * `CLAUDE_AGENTS_DIR_OVERRIDE`. An 'error' listener is attached so a missing
 * `lore` binary (ENOENT) surfaces as a swallowed async event instead of an
 * unhandled 'error' throw — fail-open (I6), mirrors every other phase in
 * this hook.
 */
function spawnSetupCheckRefresh(claudeDir) {
  try {
    const child = spawn('lore', ['setup', '--check', '--json', '--claude-dir', claudeDir], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Fail-open — spawn() throwing synchronously (rare) must never block session start.
  }
}

let advisoryBlock = '';
try {
  if (process.env.LORE_SETUP_NO_CHECK !== '1') {
    const claudeDir = dirname(AGENTS_DIR);
    const cachePath = join(claudeDir, SETUP_CHECK_CACHE_FILENAME);

    let cache = null;
    if (existsSync(cachePath)) {
      try {
        cache = JSON.parse(readFileSync(cachePath, 'utf8'));
      } catch {
        cache = null; // corrupted JSON — treated as unusable below, never throws
      }
    }

    const isValidCache = cache !== null && typeof cache === 'object'
      && typeof cache.checked_at === 'string'
      && typeof cache.binary_version === 'string'
      && (cache.status === 'sync' || cache.status === 'stale');

    if (!isValidCache) {
      // Missing file, corrupted JSON, or a shape that doesn't match
      // SetupCheckCache — all treated identically: fire a background refresh,
      // inject nothing THIS session (never wait for it).
      spawnSetupCheckRefresh(claudeDir);
    } else {
      const ageMs = Date.now() - Date.parse(cache.checked_at);
      const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs < SETUP_CHECK_CACHE_TTL_MS;
      if (!fresh) {
        spawnSetupCheckRefresh(claudeDir);
      } else if (cache.status === 'stale' && cache.reminder_enabled !== false) {
        // `cache.reminder_enabled === false` is written ONLY when the team's
        // `setup.check_reminder` config resolved to false (setup-check.ts's
        // resolveCheckReminderEnabled); a legacy cache with no such field
        // falls through this check unaffected (fail-open, REGRESSION-safe).
        const counts = cache.stale_counts;
        const countsNote = counts && typeof counts === 'object'
          ? `${(counts.outdated ?? 0) + (counts.diverged ?? 0) + (counts.missing ?? 0)} file(s), binary ${cache.binary_version}`
          : `binary ${cache.binary_version}`;
        advisoryBlock = `⚠ lore assets outdated (${countsNote}) — run \`lore setup\``;
      }
      // fresh + sync, OR fresh + stale with reminder_enabled === false →
      // advisoryBlock stays '' (0 bytes, 0 spawn)
    }
  }
} catch {
  // Fail-open (I6) — any fs/JSON error here must never block or crash session start.
}

// ── Compose (order: workflow → seat → bootstrap → degradation → advisory) ─
const parts = [workflowBlock, seatBlock, bootstrapBlock, degradationBlock, advisoryBlock].filter(Boolean);
emit(parts.join('\n\n'));
