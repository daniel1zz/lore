---
id: TASK-935
type: task
role: plan
title: "stop-doc-sync charges a subagent's worktree edits to the main agent's turn, and lists each edit event instead of each file"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"hooks","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"fc9ef162-2efe-4f76-a7a4-3a9299915f92"}
---

post-edit-mark.mjs keys the turn by payload.session_id and appends one line to edited-files.jsonl per Edit/Write call; a subagent dispatched by the main agent shares that session_id, so every edit it makes inside its own isolated worktree sets edited.flag and is appended to the MAIN agent's current turn. stop-doc-sync.mjs (getChangedFiles, ~line 116-125) then reads that manifest without de-duplication. Measured 2026-10-12 in an autopilot run: the main agent made no edits in several turns (only merges, lore commands and subagent dispatches), yet every Stop was blocked by the doc-sync gate, and one block listed 30 lines for 9 distinct files, all under .claude/worktrees/agent-*/ (status.ts alone appeared 9 times). This reopens the no-edit-turn blocking that #21/#156 fixed, for any session that dispatches subagents.

**Expected:** Only edits made by the agent whose turn is ending count toward that turn's doc-sync check (a subagent's edits are attributed to the subagent's own run, or excluded), and the listed files are de-duplicated; a main-agent turn with no edits of its own exits silently.
**Actual:** Subagent edits in their own worktrees set edited.flag on the main agent's turn and block its Stop; the file list repeats one entry per edit event (30 entries for 9 files).

Reported by: agent:session-f0196b68
