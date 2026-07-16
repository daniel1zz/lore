#!/usr/bin/env node
/**
 * subagent-context.mjs — SubagentStart hook.
 *
 * Injects minimal Layer-2 contract into every subagent:
 *   - Universal: STATUS output contract
 *   - Per-type: executor / Explore / Plan / reviewer directive
 *
 * Layer 0/1 content (质量优先 / Research-First / 沟通语言) deliberately
 * excluded — those are LLM-known and already in CLAUDE.md. This hook
 * only emits project-specific conventions that survive context drift.
 *
 * stdin:  {"agent_type": string, ...}
 * stdout: JSON hookSpecificOutput envelope
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

// ── stdin parse (fail-silent) ─────────────────���───
let payload = {};
try {
  const raw = readFileSync(0, 'utf8');
  payload = JSON.parse(raw);
} catch {
  // bad stdin → proceed with empty payload, still emit valid envelope
}
const agentType = typeof payload.agent_type === 'string' ? payload.agent_type : 'unknown';

// ── Project context (F13) — executor/general-purpose enrichment ───
// Slim pointer lines from `lore bootstrap` when cwd owns a corpus.
function buildProjectContext() {
  if (!existsSync(join(process.cwd(), '.lore'))) return '';
  const r = spawnSync('lore', ['bootstrap', '--json'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 5000,
    env: { ...process.env, CLAUDECODE: '1' },
  });
  if (r.status !== 0 || !r.stdout) return '';
  let bs;
  try { bs = JSON.parse(r.stdout); } catch { return ''; }
  if (!bs?.ok || !bs.data) return '';

  const d = bs.data;
  const parts = [];
  if (d.root?.title) parts.push(`Corpus root: ${d.root.title} (${d.root.slug})`);
  if (Array.isArray(d.active_plans) && d.active_plans.length > 0) {
    const plan = d.active_plans[0];
    const c = plan.task_counts;
    const stats = c ? ` (ready ${c.ready ?? 0} / claimed ${c.claimed ?? 0} / done ${c.done ?? 0})` : '';
    parts.push(`Plan: ${plan.title || plan.slug}${stats}`);
  }
  if (d.pending_reviews?.count > 0) parts.push(`Pending reviews: ${d.pending_reviews.count}`);
  if (parts.length === 0) return '';
  return `## Project Context (lore)\n${parts.join('\n')}\nDeep-dive: \`lore get <slug>\` / \`lore tree <plan>\` / \`lore ready <plan> --json\``;
}

// ── Universal contract ────────────────────────────
const UNIVERSAL = '## Subagent Contract\n- Output: `STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`';

// ── Per-type directives (Layer 2 only) ────────────
const DIRECTIVES = {
  executor: [
    '## Executor',
    '- Task packet 含 spec 引用 → `lore get <spec-slug>` 加载规格（`lore ac list <spec>` 看结构化 AC）',
    '- 类型→Skill：refactor→refactor / bug|perf→diagnose / tests→test',
    '- ⛔ research-first：新文件/新依赖前搜 npm/PyPI/GitHub SDK + 官方文档',
  ].join('\n'),

  Explore: [
    '## Explore',
    '- 搜索顺序：Glob → Grep → Read；只读不改',
    '- 结构化报告：位置 / 关键代码片段 / 关联符号',
  ].join('\n'),

  Plan: [
    '## Plan',
    '- 方案评估调 `Skill(research)` 加载方法论',
    '- 每个 implement task 的 Approach 必须注明 Source（搜索/文档出处）',
    '- ≥2 方案对比，列出 trade-offs',
  ].join('\n'),

  reviewer: [
    '## Reviewer',
    '- Dual-engine（Codex 并行）— 各自独立读 lore spec 的 AC（`lore get <spec>` / `lore ac list <spec>`）',
    '- 读 ACTUAL 文件内容（Read/Grep/Glob），不信 prompt 描述',
    '- 结构化输出 PASS/FAIL + per-AC evidence（结论由 orchestrator 落 `lore evidence`）',
  ].join('\n'),
};
// Alias: general-purpose behaves as executor
DIRECTIVES['general-purpose'] = DIRECTIVES.executor;

// ── Compose ───────────────────────────────────────
const directive = DIRECTIVES[agentType] || '';
const CONTEXT_TYPES = new Set(['executor', 'general-purpose']);
const projectCtx = CONTEXT_TYPES.has(agentType) ? buildProjectContext() : '';

const sections = [UNIVERSAL, directive, projectCtx].filter(Boolean);
const context = sections.join('\n\n');

if (context.length > 1200) {
  process.stderr.write(`[subagent-context] WARNING: ${context.length} chars exceeds 1200 cap\n`);
}

// ── Emit envelope ─────────────────────────────────
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SubagentStart',
    additionalContext: context,
  },
}));
process.exit(0);
