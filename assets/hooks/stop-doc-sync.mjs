#!/usr/bin/env node
/**
 * stop-doc-sync.mjs — single-check Stop hook.
 *
 * The ONE check: did this turn's edits make related docs stale
 * (root/module CLAUDE.md, README, ARCH/ADR/spec)? Update or justify.
 *
 * Flow:
 *   1. stop_hook_active=true → exit 0 silent (loop prevention)
 *   2. no edited.flag this turn → exit 0 silent (no edits → no drift)
 *   3. edits present → block once with the inline doc-sync prompt
 *      (+ changed-file list from edited-files.jsonl when available)
 *
 * Fail-silent by design: a Stop hook that crashes on its own infra
 * faults would trap every session turn — supervisory gates must
 * degrade to "allow stop" (documented exception in US-01KXD1ZZ6N).
 *
 * Env overrides for testing:
 *   CLAUDE_STATE_BASE_OVERRIDE — session-state root
 *   CLAUDE_SESSION_ID          — session id
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTurnDir, getCurrentTurnId } from './lib/turn-state.mjs';

const PROMPT = `<stop-gate>
Doc Sync Check（唯一检查项）：本轮改动是否使相关文档过期？

范围：根/模块 CLAUDE.md、README、ARCH/ADR/spec（lore-tracked → \`lore set <doc>\`；新决策/学习 → \`lore create adr|knowledge\`；被推翻的旧知识 → \`lore invalidate\`）。
需要 → 立即更新完再结束；不需要 → 一句话理由。

Required output（最后一条消息必含一行）:
**[DOC_SYNC]** updated: [文件列表 | NONE] | reason: [已更新内容摘要，或为何无需更新]
</stop-gate>`;

// ── stdin parse (fail-silent) ─────────────────────
let payload = {};
try {
  const raw = readFileSync(0, 'utf8');
  if (raw.trim().length > 0) payload = JSON.parse(raw);
} catch {
  // malformed stdin → proceed with empty payload
}

// ── 1. passthrough (loop prevention) ──────────────
if (payload.stop_hook_active === true) process.exit(0);

// ── 2. no edits this turn → nothing to sync ───────
const turnId = getCurrentTurnId();
if (turnId && !existsSync(join(getTurnDir(), 'edited.flag'))) process.exit(0);

// ── 2b. already compliant → pass silently ─────────
// If the turn's final assistant message ALREADY carries the required
// **[DOC_SYNC]** line, blocking would only force the model to re-emit it —
// one wasted full model round-trip per editing turn (observed 2026-07-17:
// three consecutive compliant turns each blocked once anyway).
// AUTHORITATIVE source: payload.last_assistant_message (probe-verified field,
// 2026-07-17). The transcript file is only a FALLBACK for harnesses lacking
// the field — at Stop time the final text block may not be flushed to the
// transcript yet (observed flush race caused a false block), so when the
// payload field exists its verdict is final either way.
let lamText = '';
try {
  const lam = payload.last_assistant_message;
  lamText = typeof lam === 'string' ? lam : lam ? JSON.stringify(lam) : '';
  if (lamText.includes('[DOC_SYNC]')) process.exit(0);
} catch { /* fall through */ }
try {
  if (!lamText && payload.transcript_path && existsSync(payload.transcript_path)) {
    const lines = readFileSync(payload.transcript_path, 'utf8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry;
      try { entry = JSON.parse(lines[i]); } catch { continue; }
      if (entry?.type !== 'assistant') continue;
      const content = entry?.message?.content;
      const text = Array.isArray(content)
        ? content.filter(c => c?.type === 'text').map(c => c.text).join('\n')
        : typeof content === 'string' ? content : '';
      if (text.includes('[DOC_SYNC]')) process.exit(0);
      break; // last assistant message lacks the line → fall through to block
    }
  }
} catch { /* fall through to block */ }

// ── 3. inject the doc-sync check ──────────────────
function getChangedFiles() {
  const turnDir = getTurnDir();
  if (!turnDir) return [];
  const manifestPath = join(turnDir, 'edited-files.jsonl');
  if (!existsSync(manifestPath)) return [];
  try {
    return readFileSync(manifestPath, 'utf8')
      .split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l).file; } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

const changedFiles = getChangedFiles();
const fileList = changedFiles.length > 0
  ? `\n\n## 本轮改动文件\n${changedFiles.map(f => `- ${f}`).join('\n')}`
  : '';

process.stdout.write(JSON.stringify({ decision: 'block', reason: PROMPT + fileList }));
process.exit(0);
