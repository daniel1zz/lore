#!/usr/bin/env node
/**
 * session-start-resume.mjs — SessionStart hook.
 *
 * Phase C: corpus-workflow governance injection — reads the `lore setup`-
 *          installed snippet at <claude-dir>/governance/corpus-workflow.md
 *          and injects it ONLY when the session's resolved corpus root has
 *          .lore/ (computed after Phase D, which may redirect the root to a
 *          worktree's main checkout). Unified 2026-07-17: the previous
 *          source (prompt/global-instructions.md) was NEVER written by
 *          `lore setup` (it installs under governance/) — the phase was a
 *          reader without a writer, product-wide dead code. A machine whose
 *          personal CLAUDE.md already carries the discipline simply has no
 *          governance file installed → fail-open skip, no double injection.
 *          The former subagent-roster block was REMOVED the same day: the
 *          harness natively lists custom agents from ~/.claude/agents.
 * Phase D: linked-worktree seat detection (SPEC-047) — auto-injects the
 *          seat-briefing.md discipline block for sessions opened inside a
 *          linked git worktree of a lore-governed repo
 * Phase E: lore bootstrap injection (corpus pointer set, when the resolved
 *          corpus root — main checkout for a linked worktree, cwd otherwise —
 *          has .lore/)
 * Phase F: test health check (silent, non-blocking)
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
 * fail-open precedent).
 */

import {
  existsSync, readFileSync, readdirSync, rmSync, statSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { resolveSessionId } from './lib/turn-state.mjs';

// No longer read for a roster (removed 2026-07-17 — harness lists agents
// natively); retained because Phase D derives <claude-dir> as its dirname,
// and CLAUDE_AGENTS_DIR_OVERRIDE keeps tests hermetic.
const AGENTS_DIR = process.env.CLAUDE_AGENTS_DIR_OVERRIDE
  || join(homedir(), '.claude', 'agents');
const SESSION_STATE_BASE = process.env.CLAUDE_STATE_BASE_OVERRIDE
  || join(homedir(), '.claude', 'session-state');
const BOOTSTRAP_CHAR_CAP = 8000;

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
// see "Phase C: corpus-workflow governance" below. Declared here so the
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

// ── Phase C: corpus-workflow governance (lore-governed sessions) ───
// Source path = what `lore setup` actually installs. Injection is gated on
// the RESOLVED corpus root (Phase D may have redirected it to a worktree's
// main checkout) having .lore/ — non-lore projects get nothing.
try {
  if (existsSync(join(bootstrapCwd, '.lore'))) {
    const governancePath = join(dirname(AGENTS_DIR), 'governance', 'corpus-workflow.md');
    if (existsSync(governancePath)) {
      workflowBlock = readFileSync(governancePath, 'utf8');
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
  const r = spawnSync('lore', ['bootstrap', '--json'], {
    cwd: bootstrapCwd,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, CLAUDECODE: '1' }, // agent surface → AI defaults off (SPEC-024)
  });
  let parsed = null;
  if (r.status === 0 && r.stdout) {
    try { parsed = JSON.parse(r.stdout); } catch {}
  }
  if (parsed?.ok && parsed.data) {
    let json = JSON.stringify(parsed.data, null, 2);
    if (json.length > BOOTSTRAP_CHAR_CAP) {
      json = `${json.slice(0, BOOTSTRAP_CHAR_CAP)}\n… (truncated — run \`lore bootstrap --json\` for the full set)`;
    }
    bootstrapBlock = `## Lore Bootstrap (hook-injected)

Corpus pointer set — deep-dive via \`lore get <slug>\`, \`lore tree <plan>\`, \`lore ready <plan> --json\`. Do NOT re-run \`lore bootstrap\` yourself.

\`\`\`json
${json}
\`\`\``;
  } else {
    const reason = r.error?.code === 'ENOENT'
      ? 'lore binary not on PATH (expected: symlink of <lore-repo>/dist/lore)'
      : `lore bootstrap failed (exit ${r.status ?? 'signal'}): ${(r.stderr || '').slice(0, 200)}`;
    degradations.push({ component: 'lore bootstrap', reason });
  }
}

// ── Phase F: Test health check (silent, non-blocking) ─────────────

/**
 * Run a command in its own detached process group, with a hard timeout that
 * SIGKILLs the WHOLE group. spawnSync's `timeout` only signals the direct
 * child (bash), orphaning every grandchild — a vitest run forks one worker
 * per CPU, and each orphaned fork keeps burning CPU/memory indefinitely
 * (observed 2026-07-17: 11 orphaned `node (vitest N)` workers at full CPU
 * for ~1h, machine-wide memory exhaustion). detached + kill(-pid) closes
 * that leak: the kill reaches bash, the test runner, AND its forks.
 */
function runInKillableGroup(cmd, args, { cwd, env, timeoutMs }) {
  return new Promise((resolvePromise) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, {
        cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      resolvePromise({ status: null, signal: null, timedOut, stdout, stderr });
      return;
    }
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already gone */ }
    }, timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      resolvePromise({ status: null, signal: null, timedOut, stdout, stderr });
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolvePromise({ status, signal, timedOut, stdout, stderr });
    });
  });
}

let testHealthBlock = '';
{
  const projectDir = process.cwd();
  const pkgPath = join(projectDir, 'package.json');
  if (existsSync(pkgPath) && projectDir !== join(homedir(), '.claude')
      && !projectDir.startsWith(join(homedir(), '.claude') + '/')) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const scripts = pkg.scripts || {};
      const deps = { ...(pkg.devDependencies || {}), ...(pkg.dependencies || {}) };
      const hasTestRunner = deps.vitest || deps.jest || deps.mocha || scripts.test;

      if (hasTestRunner) {
        // `--run` is a vitest-only flag (disables watch mode); appending it to
        // arbitrary test scripts breaks non-vitest runners (e.g. `turbo run test`
        // rejects it with a CLI usage error → false FAILING alert).
        let testCmd = 'npm test 2>&1';
        if (deps.vitest) testCmd = 'npx vitest --run --reporter=verbose 2>&1';
        else if (deps.jest) testCmd = 'npx jest --forceExit 2>&1';
        else if (/\bvitest\b/.test(String(scripts.test || ''))) testCmd = 'npm test -- --run 2>&1';

        // VITEST_MAX_WORKERS bounds fork count during the health-check window
        // (vitest reads it in resolveConfig, overriding config maxWorkers);
        // harmless for non-vitest runners. Full-CPU forking here amplified
        // machine-wide memory pressure when sessions started concurrently.
        // CLAUDE_TEST_HEALTH_TIMEOUT_MS is a test-only override (regression
        // tests exercise the timeout path without waiting 30s).
        const timeoutMs = Number(process.env.CLAUDE_TEST_HEALTH_TIMEOUT_MS || 30000);
        const result = await runInKillableGroup('bash', ['-c', testCmd], {
          cwd: projectDir,
          // NODE_OPTIONS caps the runner's MAIN process heap too (workers are
          // additionally capped by the project's own vitest execArgv config);
          // without it each health-check run could balloon toward Node's
          // ~4GB default old-space ceiling.
          env: {
            ...process.env,
            VITEST_MAX_WORKERS: '2',
            NODE_OPTIONS: '--max-old-space-size=2048',
          },
          timeoutMs,
        });

        if (result.timedOut) {
          testHealthBlock = `## ⚠️ Test Health Alert

Test suite timed out (${Math.round(timeoutMs / 1000)}s). May indicate hanging tests or missing test teardown.`;
        } else if (result.status !== 0 && !result.signal) {
          const output = (result.stdout || '') + (result.stderr || '');
          const lastLines = output.split('\n').filter(Boolean).slice(-15).join('\n');
          testHealthBlock = `## ⚠️ Test Health Alert

Tests are currently FAILING in this project. Fix before adding new features.

\`\`\`
${lastLines}
\`\`\`

Action: Run \`npm test\` / \`npx vitest --run\` to see full output. Prioritize fixing existing failures.`;
        }
      }
    } catch { /* fail-silent — test health is advisory */ }
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

Action: Check installation. Non-critical features (agent roster, test health) are unaffected.`;
}

// ── Compose (order: workflow → seat → bootstrap → degradation → testHealth) ─
const parts = [workflowBlock, seatBlock, bootstrapBlock, degradationBlock, testHealthBlock].filter(Boolean);
emit(parts.join('\n\n'));
