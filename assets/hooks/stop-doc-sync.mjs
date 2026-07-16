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
