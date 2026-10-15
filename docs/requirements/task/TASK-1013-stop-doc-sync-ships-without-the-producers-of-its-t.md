---
id: TASK-1013
type: task
role: plan
title: "stop-doc-sync ships without the producers of its turn state, so it blocks turns that made no edits"
status: archived
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"hook-state","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"428b1673-9025-4c22-90d7-2dd254a78b49"}
---

assets/hooks/stop-doc-sync.mjs skips only when current-turn.id exists AND <turn>/edited.flag is absent (line 51: if (turnId && !existsSync(...edited.flag))). The producers of that state, inject-context.mjs (UserPromptSubmit, writes current-turn.id) and post-edit-mark.mjs (PostToolUse, writes edited.flag), exist only in ~/.claude/hooks, are not in assets/hooks, are not in distribution-hooks.ts, and are registered in no settings file. getCurrentTurnId() therefore always returns null, the guard is skipped, and the hook blocks every turn whose last message lacks a DOC_SYNC line. ~/.claude/session-state/sessions is empty. Separately, resolveSessionId() reads CLAUDE_SESSION_ID (falls back to ppid-$PPID, which differs per hook process) rather than the session_id in the hook stdin payload, so even with producers registered, producer and consumer can resolve different session dirs.

**Expected:** A turn with no Edit/Write/NotebookEdit passes silently; a fresh lore setup install ships and registers every producer that stop-doc-sync reads; missing turn state is reported as not-measured, never treated as an edited turn
**Actual:** Session e25636da: the doc-sync block fired on a turn whose only tool call was a read-only Agent dispatch; the assistant had to emit a DOC_SYNC line to end the turn
**Repro command:** `grep -rn 'inject-context\|post-edit-mark' ~/.claude/settings.json .claude/settings.json packages/core/src/distribution-hooks.ts; ls assets/hooks`

Reported by: agent:session-e25636da
