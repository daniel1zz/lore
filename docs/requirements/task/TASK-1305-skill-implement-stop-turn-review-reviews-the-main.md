---
id: TASK-1305
type: task
role: plan
title: "[Skill:implement] stop-turn-review reviews the main session's turn once: source edits (setting-gated), anchor drift, CLAUDE.md budget"
status: draft
priority: high
phase: "Phase 2: Turn-end review"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-181
plan: PLAN-181
links:
  - {id: TASK-1304, type: blocks}
  - {id: TASK-1303, type: blocks}
---
Estimate: L
Approach: New assets/hooks/stop-turn-review.mjs reading the turn record (B2): silent when no finding; one block listing all findings; stop_hook_active silent; unmeasured -> exit 0 + one stderr line (#156). Setting workflow.turn_end.main_session_source_edits: off|block in packages/core/src/config.ts (default off). Exemptions and the 3-line allowance per spec Scope 4(a), measured against the turn-start snapshot. Anchor drift per Scope 4(b) via the snapshot. CLAUDE.md budget delegates to lore status --check-claude-md. Do NOT touch the roster here (B4).
Source: spec AC-TE-3, AC-TE-4, AC-TE-7; BR-1087, BR-1089, BR-1090, BR-1091
Covers: AC-TE-3, AC-TE-4, AC-TE-7
AC:
- AC-TE-3 green via its declared command (lore ac list <spec>), red recorded first
- AC-TE-4 green via its declared command (lore ac list <spec>), red recorded first
- AC-TE-7 green via its declared command (lore ac list <spec>), red recorded first

Red first (Invariant I3): write the AC test file(s) first, run the AC command, record `lore evidence <this task> --oracle test --result expected-fail --output-tail-file <log>` yourself, then implement to green and record the pass. Commit before attesting. Scoped oracles only in the worktree (I4).
