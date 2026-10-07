---
id: TASK-883
type: task
role: plan
title: "stop-doc-sync blocks on every turn, including no-edit turns, because the turn-id/edited-flag producer hooks are not wired"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"hook-wiring","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"f3930466-82e0-4aa0-8e60-8a07fe6263a6"}
---

stop-doc-sync.mjs line 51: 'if (turnId && !existsSync(join(getTurnDir(), "edited.flag"))) process.exit(0);'. getCurrentTurnId() returns null when current-turn.id is absent; that file is written by inject-context.mjs (UserPromptSubmit) and edited.flag by post-edit-mark.mjs (PostToolUse), but neither is wired in ~/.claude/settings.json nor .claude/settings.json. With turnId null the early exit is skipped, so the hook blocks every Stop. Observed this session: a read-only turn (zero edits) was blocked by the doc-sync stop-gate. This contradicts the documented 'no-edit turns pass silently' contract and costs one model round-trip per turn. A null turn id should fail loud or the producer hooks must ship wired together with the consumer (single install unit).

**Expected:** Turns with no file edits pass the Stop hook silently
**Actual:** Every turn is blocked once with the DOC_SYNC prompt, even read-only turns
**Repro command:** `grep -n 'inject-context\|post-edit-mark' ~/.claude/settings.json .claude/settings.json`

Reported by: agent:main-orchestrator
