---
id: TASK-1378
type: task
role: plan
title: "[Skill:implement] lore session trail lists the caller's own session trail by whole session, turn or run"
status: draft
priority: high
phase: "consumers"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-188
plan: PLAN-188
links:
  - {id: TASK-1377, type: blocks}
  - {id: TASK-1373, type: blocks}
---
Estimate: M
Approach: new subcommand 'trail' in packages/lore/src/adapters/cli/commands/session.ts beside list|show; the session comes from the attested run (--harness-run rewritten by pre-tool-harness-run, or MCP harness_run), never a --session flag (D12); cc:<session>[:<agent>] parsed by the core run-id helper; reads via @lore/core/node session-trail-node; no attested run or a non-cc run -> exit 4 with a message naming the trail-access rule; removed and unmeasured parts rendered as such (I7). Follow the adapters/cli *-render.ts split so vitest can cover rendering.
Source: spec Design > Run -> session for CLI consumers; D12.
AC: AC-ST-6.
Governing spec: spec-session-trail-a-session-local-record-of-what-each-run-4 (read its Design section and Design Decisions before starting; cite rules through the spec's ACs, never restate them). Plan invariants I1-I7 apply.
