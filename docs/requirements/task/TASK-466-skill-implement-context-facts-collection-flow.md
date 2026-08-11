---
id: TASK-466
type: task
role: plan
title: "[Skill:implement] context facts collection flow orchestration CLI verbs and AI narrative template"
status: archived
priority: medium
phase: "Phase 2: Capability"
created: 2026-07-27
updated: 2026-08-01
tags: []
parent: PLAN-088
plan: PLAN-088
---
Objective: implement per spec-context-verb-family-two-zone-claude-md-anatomy-lore D1/D2/D3 — collectContextFacts (FsReadPort), flows/context-flow.ts runContextInit/runContextRefresh (writes via FsWritePort; refresh NEVER AI, Z1-only), CLI lore context init|refresh (strict flags; --ai orchestration in adapter ONLY: resolve provider, render context-narrative-template, pass narrative string into flow; provider absent = skeleton + loud stderr warning + exit 0). Register command in CLI index. Green oracle: AC-CTX-3 command.
