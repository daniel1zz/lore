---
id: TASK-1033
type: task
role: plan
title: "[Skill:test] end to end — real hooks to built CLI to stamped writes, distinct runs per subagent"
status: archived
priority: critical
phase: "P5 Integration and purge"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1024, type: blocks}
---
Estimate: M
Source: AC-RID-18; validation ledger F1–F3 (payload shapes measured from a real headless run)
Covers: AC-RID-18

Scenarios:
- Given a mkdtemp corpus and the built CLI on PATH, When the real run-register hook gets one SessionStart and two SubagentStart payloads (distinct agent_ids) and the real pre-tool hook rewrites one `lore evidence` per run which is then executed, Then three evidence audit rows carry three distinct registered runs and both subagent runs name the main run as parent.
- Given a fourth PreToolUse payload from an agent_id never registered, Then the write is stored unattested (input to branch B2).

AC:
- Given the file, When `cd packages/lore && bun test --timeout 180000 tests/e2e/run-identity-e2e.bun.test.ts`, Then it passes; the count of unattested subagent writes in the run is recorded as manual evidence (branch B2 input).
