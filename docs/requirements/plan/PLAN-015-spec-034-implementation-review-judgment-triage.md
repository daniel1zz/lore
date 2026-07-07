---
id: PLAN-015
type: plan
role: plan
title: "SPEC-034 Implementation — review judgment + triage"
status: archived
priority: high
created: 2026-07-06
updated: 2026-07-06
tags: [spec-034, implementation]
parent: SPEC-034
---
R1 shadow-mode judgment machinery. Serial order (file mutex): A core schemas+migration+store → B services (JudgmentService + judgeDoc + getReviewBundle) → C adapters (CLI review/pending badges + MCP). Oracle: tsc + both runners + hermetic CLI tests (stub-claude helper mandatory).
