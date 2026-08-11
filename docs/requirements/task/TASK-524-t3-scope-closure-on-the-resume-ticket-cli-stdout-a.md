---
id: TASK-524
type: task
role: plan
title: "T3 scope closure on the resume ticket, CLI stdout and MCP response"
status: archived
priority: medium
phase: "P2 surfaces"
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PLAN-101
plan: PLAN-101
links:
  - {id: TASK-523, type: blocks}
---
lore feed session-resume renders RESUME_SCOPE_CLOSURE verbatim on BOTH the CLI stdout and the MCP lore_feed response for checkpoint session-resume. The constant names every member of BOOTSTRAP_INJECTION_KNOWN_KEYS as outside the ticket scope. A surface that renders the ticket without the closure block reproduces the original defect for that surface consumers. Satisfies the implementation half of AC-CP-4.
