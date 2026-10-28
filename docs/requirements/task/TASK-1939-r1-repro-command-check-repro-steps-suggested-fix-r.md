---
id: TASK-1939
type: task
role: plan
title: "R1 repro command check, repro steps / suggested fix / refs sections, severity and category stated as required"
status: archived
priority: medium
phase: "R"
created: 2026-10-24
updated: 2026-10-28
tags: []
parent: PLAN-273
plan: PLAN-273
links:
  - {id: TASK-2037, type: blocks}
---
Covers: AC-RI-1, AC-RI-2, AC-RI-5. Spec sections: Repro command check (input adapters only: CLI flag and MCP handler; lexing rules; builtins; Invocation.env.PATH), Body sections (fenced repro with max(3, longest backtick run + 1) fence; update the existing BR-494 body-contract assertion from the inline to the fenced form), Severity / category (help text; MCP describe() says required, shape stays optional so BR-489's remedy still comes first; hint configured and unconfigured variants). Base: current main.
