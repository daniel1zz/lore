---
id: TASK-1644
type: task
role: plan
title: "RQ-D: INTERNAL_ERROR with rule 'defect'; tooling drops LoreError; relabel refusals an existing rule already describes"
status: approved
priority: high
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PLAN-216
plan: PLAN-216
---
Plan task RQ-D on rq-integration. (1) Add the INTERNAL_ERROR code, whose rule is always 'defect', with an exhaustive exit-code mapping and output that says it is a lore defect. (2) Convert every UNRULED marker that is an internal defect (unreachable guard, unwired service, port contract violation) to INTERNAL_ERROR/defect. Test doubles throw plain Error. (3) scripts/ and packages/lore/src/distribution/ stop constructing LoreError; use their own error type or exit codes. (4) Relabel UNRULED markers that an existing live rule already describes: config unusable -> BR-926, schema behind -> the explicit-upgrade rule, migrate child without an attested run -> BR-1351, real-mcp-registrar -> BR-826/BR-844 as decided per site. Leave genuine business refusals without a rule as BR-0 for the rules task.
