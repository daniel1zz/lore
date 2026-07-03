---
id: PLAN-009
type: plan
role: plan
title: "SPEC-029 Implementation — assess reliability"
status: archived
priority: high
created: 2026-07-03
updated: 2026-07-03
tags: [spec-029]
parent: SPEC-029
phases:
  - {name: "hardening", description: "implementation"}
  - {name: "closeout", description: "oracles + rebuild + self-assess"}
---
Round-3 of the self-evolution loop. Single implementation task (one file cluster: core/assessment.ts clip helper + schema additive field, ai/assess-template.ts prompt statements, service/ai-provider-service.ts pre-validation clip, cli/commands/assess.ts hint) + closeout (oracles, rebuild, self-assess with new binary). Tester subagent authors tests independently (C1 precedent).
