---
id: TASK-1550
type: task
role: plan
title: "[Skill:implement] AU-T3 human channel: lore decide with TTY, nonce and agent-ancestry refusal; lore pending lists decisions"
status: draft
priority: critical
phase: "Phase 1b: human channel and verbs"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
links:
  - {id: TASK-1546, type: blocks}
  - {id: TASK-1545, type: blocks}
  - {id: TASK-1544, type: blocks}
  - {id: TASK-1543, type: blocks}
---
Estimate: L
Approach: lore decide <id> --accept|--reject [--reason]: refuse unless stdin+stdout TTY, no ancestor is the agent harness, no agent run identity in env; per-invocation nonce shown only on the controlling terminal, typed back; record channel human-tty with ancestry snapshot and chain head. PreToolUse hook denies Bash calls containing 'lore decide'. No MCP tool / HTTP route (registry assertion). lore pending: escalations and the audit queue, with score, factors, recommended answer; nonce never printed. Test with a pseudo-terminal (no agent identity) for the positive control and with agent env for (5b).
Source: spec-autonomy-phase-1-decision-function-human-channel-lore; decision: adr-autonomy-is-decided-by-measured-facts-one-decision-function
AC: AC-AU-3.
