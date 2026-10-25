---
id: TASK-1861
type: task
role: plan
title: "[Skill:implement] HR-T7 lore decide and lore pending print the detail and its dashboard link"
status: archived
priority: medium
phase: "surfaces"
created: 2026-10-18
updated: 2026-10-19
tags: []
parent: PLAN-237
plan: PLAN-237
---
Estimate: S
Approach: decide-flow.ts builds the confirmation summary from the decision's detail (summary, before/after, on_accept, on_reject) and appends 'Details: <url>/needs-you/decisions/<id>' from the T4 registry reader, or the start-the-dashboard line with the path when absent. Pass it to confirmHumanNonce (human-channel.ts) as extra lines printed before the code. lore pending (pending-decisions-render.ts) prints the same link per open decision and audit row. The link never contains the nonce.
Source: spec-human-review-surface-decisions-audit-items-and-pending D5.
AC: AC-HR-6.
