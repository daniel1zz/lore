---
id: TASK-1334
type: task
role: plan
title: "[Skill:implement] Route the settings-hook claude dir through expandTemplate"
status: archived
priority: medium
phase: "Phase 3: Settings-hook claude dir and tool count"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-185
plan: PLAN-185
links:
  - {id: TASK-1327, type: blocks}
  - {id: TASK-1332, type: blocks}
---
Estimate: S
Approach: register claude_dir (invocation, outlet setup:settings-hook); replace resolveClaudeDirPlaceholder (setup-service.ts ~1013) with expandTemplate; rename the token in packages/core/src/distribution-hooks.ts and real-asset-source.ts (~100); regenerate manifest if hooks assets change.
Source: spec D7
Covers: AC-CV-7

AC:
- AC-CV-7 command exit 0; existing setup / distribution-hooks tests green.
