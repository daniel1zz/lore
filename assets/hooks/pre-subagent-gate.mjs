#!/usr/bin/env node
/**
 * pre-subagent-gate.mjs — PreToolUse hook on Edit|Write|MultiEdit.
 *
 * ADVISORY gate (every path exits 0, never blocks; BR-1068). The notice goes to the MODEL via
 * PreToolUse hookSpecificOutput.additionalContext on stdout — Claude Code never shows stderr
 * from a hook that exits 0. Warns the main agent against direct code edits unless:
 *   1. diff ≤ 3 lines AND file was already Read this turn
 *   2. User explicitly said "直接改" / "just do it" (session opt-out via env)
 *   3. Running inside a subagent (CLAUDE_AGENT_TYPE set)
 *
 * Bypass: CLAUDE_SUBAGENT_GATE_BYPASS=1  (single-turn override)
 *         CLAUDE_NO_SUBAGENT_MODE=1      (session-level opt-out)
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getTurnDir } from './lib/turn-state.mjs';

const MAX_EXEMPT_LINES = 3;

function readPayload() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

function countDiffLines(payload) {
  const tool = payload.tool_name;
  if (tool === 'Write') {
    const content = payload?.tool_input?.content ?? '';
    return content.split('\n').length;
  }
  if (tool === 'Edit') {
    const oldStr = payload?.tool_input?.old_string ?? '';
    const newStr = payload?.tool_input?.new_string ?? '';
    const oldLines = oldStr.split('\n').length;
    const newLines = newStr.split('\n').length;
    return Math.max(Math.abs(newLines - oldLines), newLines);
  }
  if (tool === 'MultiEdit') {
    const edits = payload?.tool_input?.edits ?? [];
    let total = 0;
    for (const edit of edits) {
      const oldLines = (edit.old_string ?? '').split('\n').length;
      const newLines = (edit.new_string ?? '').split('\n').length;
      total += Math.max(Math.abs(newLines - oldLines), newLines);
    }
    return total;
  }
  return 999;
}

function wasFileReadThisTurn(filePath, payload) {
  try {
    // session id from the PreToolUse stdin payload (see lib/turn-state.mjs); null turn dir → join throws → false.
    const turnDir = getTurnDir(payload);
    const readLog = join(turnDir, 'read-files.jsonl');
    if (!existsSync(readLog)) return false;
    const lines = readFileSync(readLog, 'utf8').trim().split('\n');
    return lines.some(line => {
      try {
        const entry = JSON.parse(line);
        return entry.file === filePath;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

// --- Main ---

const payload = readPayload();
if (!payload) process.exit(0);

const tool = payload.tool_name;
if (!['Edit', 'Write', 'MultiEdit'].includes(tool)) process.exit(0);

// Subagents are exempt — they ARE the execution layer
if (process.env.CLAUDE_AGENT_TYPE) process.exit(0);

// Bypass: single-turn override
if (process.env.CLAUDE_SUBAGENT_GATE_BYPASS === '1') {
  process.stderr.write(`[subagent-gate] bypass via CLAUDE_SUBAGENT_GATE_BYPASS=1\n`);
  process.exit(0);
}

// Bypass: session-level opt-out
if (process.env.CLAUDE_NO_SUBAGENT_MODE === '1') {
  process.stderr.write(`[subagent-gate] session opt-out via CLAUDE_NO_SUBAGENT_MODE=1\n`);
  process.exit(0);
}

const filePath = payload?.tool_input?.file_path || '';
if (!filePath) process.exit(0);

// Exempt: config files and markdown — main agent manages these directly
const CONFIG_PATTERNS = [
  /\.md$/,
  /\.json$/,
  /\.ya?ml$/,
  /\.toml$/,
  /\.env(\..+)?$/,
  /\.config\.(ts|js|mjs|cjs)$/,
  /\/(hooks|\.claude|\.github|\.vscode|\.lore)\//,
];
if (CONFIG_PATTERNS.some(re => re.test(filePath))) {
  process.exit(0);
}

// Write tool to a new file: always count as > 3 lines (must use subagent)
const diffLines = countDiffLines(payload);
const fileRead = wasFileReadThisTurn(filePath, payload);

if (diffLines <= MAX_EXEMPT_LINES && fileRead) {
  process.stderr.write(`[subagent-gate] exempt: ${diffLines} lines, file previously read — ${filePath}\n`);
  process.exit(0);
}

// Block
const reason = !fileRead
  ? `file not Read this turn`
  : `diff ${diffLines} lines > ${MAX_EXEMPT_LINES} threshold`;

const notice = `[SUBAGENT_GATE] ${tool} on ${filePath} was NOT blocked.
Reason: ${reason}
Consider dispatching a subagent for large edits.
Exemptions: a ${MAX_EXEMPT_LINES}-line exemption (diff of at most ${MAX_EXEMPT_LINES} lines on a file already Read this turn); config and markdown files; subagents.
Escape settings: CLAUDE_SUBAGENT_GATE_BYPASS=1 (single-turn override), CLAUDE_NO_SUBAGENT_MODE=1 (session-level opt-out).`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: notice },
}));
process.exit(0);
