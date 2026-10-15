---
id: TASK-1310
type: task
role: plan
title: "[Skill:implement] retire the hook:session-start outlet and the session-start-fragments hook; fragments check refuses dynamic main fragments"
status: draft
priority: high
phase: "Phase 2: Advisory and outlet retirement"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-182
plan: PLAN-182
links:
  - {id: TASK-1304, type: blocks}
  - {id: TASK-1309, type: blocks}
---
Estimate: M
Approach: Remove 'hook:session-start' from OUTLET_IDS (core/context-fragments.ts) and its routing (select.ts), the stale-notice assembly (flows/fragments-flow.ts composeSessionStart/NOTICE_LINE/detectProjectRulesDrift use at render), the CLI outlet option (commands/fragments.ts, refuse it as retired with exit 2), the main-run composition in commands/run.ts; add the dynamic-main-fragment finding to check; drop session-start-fragments.mjs from distribution-hooks.ts and assets/hooks; regenerate the assets manifest.
Source: spec AC-UR-3, AC-UR-4, AC-UR-5; BR-912, BR-907 (modified), BR-1066 (modified), BR-823, BR-975; retires BR-909, BR-910
Covers: AC-UR-3, AC-UR-4, AC-UR-5
AC:
- AC-UR-3 green via its declared command (lore ac list <spec>), red recorded first
- AC-UR-4 green via its declared command (lore ac list <spec>), red recorded first
- AC-UR-5 green via its declared command (lore ac list <spec>), red recorded first

Red first (Invariant I3): write the AC test file(s) first, run the AC command, record `lore evidence <this task> --oracle test --result expected-fail --output-tail-file <log>` yourself, then implement to green and record the pass. Commit before attesting. Scoped oracles only in the worktree (I4).
