---
id: TASK-458
type: task
role: plan
title: "[Skill:implement] core leaves — memory-markers constants plus FsReadPort FsWritePort interfaces and InMemoryFsPort double"
status: archived
priority: medium
phase: "Phase 1: Pure Core"
created: 2026-07-27
updated: 2026-08-01
tags: []
parent: PLAN-088
plan: PLAN-088
---
Objective: create @lore/core leaves per spec-context-verb-family-two-zone-claude-md-anatomy-lore D5/D9 — memory-markers.ts (CLAUDE_MD_MARKER_START/END relocated from flows/setup-project-flow.ts, ManagedSectionMeta, fingerprint comment grammar '<!-- lore:managed section=<id> hash=<8hex> -->') and fs-ports.ts (FsReadPort/FsWritePort + InMemoryFsPort test double). Types/constants only — browser-safe barrel MUST stay Node-free. Old constants in setup-project-flow re-exported/imported from core (no dup). No test pair needed (types/constants/DI exempt) but typecheck must pass.
