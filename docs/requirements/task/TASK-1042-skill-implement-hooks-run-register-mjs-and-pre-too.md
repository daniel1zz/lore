---
id: TASK-1042
type: task
role: plan
title: "[Skill:implement] hooks run-register.mjs and pre-tool-harness-run.mjs"
status: archived
priority: high
phase: "P4 Adapter and distribution"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1038, type: blocks}
  - {id: TASK-1033, type: blocks}
---
Estimate: S
Approach: blind pipes per spec D7, D10, following session-start-fragments.mjs (spawnSync lore from PATH, exit 0 always, banner on failure); pre-tool hook pre-filters on the word `lore` / tool name only
Source: assets/hooks/session-start-fragments.mjs, assets/hooks/stop-handoff-coverage.mjs
Dimensions: D-FUNC
Scope-Alt: none
Covers: AC-RID-3

AC:
- Given `bunx vitest run packages/lore/tests/unit/hooks/run-register-hook.test.ts packages/lore/tests/unit/hooks/pre-tool-harness-run-hook.test.ts`, Then all pass.
- Integration: From a fresh session start with both hooks registered, a subagent's first `lore claim` arrives at the CLI carrying `--harness-run cc:<session>:<agent_id>` (proved end to end by the e2e task).
- Given invariant I3, When `grep -c -- '--harness-run' assets/hooks/pre-tool-harness-run.mjs`, Then 0.
