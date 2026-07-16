#!/usr/bin/env node
/**
 * session-start-resume.mjs — SessionStart hook.
 *
 * Phase C: workflow-core (global-instructions.md) + subagent roster
 * Phase E: lore bootstrap injection (corpus pointer set, when cwd has .lore/)
 * Phase F: test health check (silent, non-blocking)
 *
 * Bootstrap is hook-injected (was lazy-loaded by AI). Rationale: SessionStart
 * is low-frequency, `lore bootstrap` is a slim progressive-disclosure pointer
 * set, 100% delivery rate beats AI self-trigger (~70-90%).
 *
 * Graceful degradation — a missing lore binary or corpus must never block
 * session start. Projects without .lore/ simply get no bootstrap block.
 */

import {
  existsSync, readFileSync, readdirSync, rmSync, statSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolveSessionId } from './lib/turn-state.mjs';

const GLOBAL_PROMPT = process.env.CLAUDE_GLOBAL_PROMPT_OVERRIDE
  || join(homedir(), '.claude', 'prompt', 'global-instructions.md');
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

// ── Degradation tracker — critical component failures only ────────
const degradations = [];

// ── Phase C: workflow-core + subagent roster ───────────────────────
let workflowBlock = '';
if (existsSync(GLOBAL_PROMPT)) {
  workflowBlock = readFileSync(GLOBAL_PROMPT, 'utf8');
}

// Minimal YAML-frontmatter reader (name/description only) — avoids an
// external gray-matter dependency for two scalar fields.
function parseFrontmatter(content) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = /^(name|description):\s*(.*)$/.exec(line.trim());
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

let agentBlock = '';
if (existsSync(AGENTS_DIR)) {
  const entries = readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md'));
  const roster = [];
  for (const fname of entries) {
    const full = join(AGENTS_DIR, fname);
    try {
      if (!statSync(full).isFile()) continue;
      const { name, description } = parseFrontmatter(readFileSync(full, 'utf8'));
      if (!name) continue;
      roster.push(description ? `- **${name}** — ${description}` : `- **${name}**`);
    } catch {}
  }
  if (roster.length > 0) {
    agentBlock = `## Available Custom Subagents (~/.claude/agents/)

Dispatch via Agent(subagent_type=<name>) when the task matches. Built-in types (general-purpose, Explore, Plan, etc.) are listed in the system prompt.

${roster.join('\n')}\n`;
  }
}

// ── Phase E: lore bootstrap injection ──────────────────────────────
// Corpus pointer set (root doc, active plans + task counts, pending
// reviews, active sessions, stale candidates). Only when cwd has .lore/.
let bootstrapBlock = '';
if (existsSync(join(process.cwd(), '.lore'))) {
  const r = spawnSync('lore', ['bootstrap', '--json'], {
    cwd: process.cwd(),
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

        const result = spawnSync('bash', ['-c', testCmd], {
          cwd: projectDir, encoding: 'utf8', timeout: 30000,
        });

        if (result.status !== 0 && !result.signal) {
          const output = (result.stdout || '') + (result.stderr || '');
          const lastLines = output.split('\n').filter(Boolean).slice(-15).join('\n');
          testHealthBlock = `## ⚠️ Test Health Alert

Tests are currently FAILING in this project. Fix before adding new features.

\`\`\`
${lastLines}
\`\`\`

Action: Run \`npm test\` / \`npx vitest --run\` to see full output. Prioritize fixing existing failures.`;
        } else if (result.signal === 'SIGTERM') {
          testHealthBlock = `## ⚠️ Test Health Alert

Test suite timed out (30s). May indicate hanging tests or missing test teardown.`;
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

// ── Compose (order: workflow → agents → bootstrap → degradation → testHealth) ─
const parts = [workflowBlock, agentBlock, bootstrapBlock, degradationBlock, testHealthBlock].filter(Boolean);
emit(parts.join('\n\n'));
