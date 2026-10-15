---
id: TASK-1341
type: task
role: plan
title: "[Skill:test] Core variable expander — RED scenarios"
status: archived
priority: critical
phase: "Phase 1: Core expander and fragment outlets"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-185
plan: PLAN-185
---
Estimate: S
Source: spec AC-CV-1, D1-D3, Module Boundary
TDD-Role: red | Paired-Impl: T1
Covers: AC-CV-1

Scenarios (all with an INJECTED test registry):
- Given code var x (value "4000"), When expandTemplate("a {{lore:x}} b", ctx, reg), Then ok("a 4000 b").
- Given "{{lore:nope}}" on body line 2 with lineOffset 5, path p, Then err VALIDATION_ERROR, message contains "p:7" and "nope".
- Given var allowed only at rules:user, ctx.outlet rules:project, Then err naming var + outlet.
- Given invocation var with no ctx.invocation entry, Then err naming var.
- Given "{{file_list}} {{ lore:x }}", Then returned byte-identical.
- validateRegistry: code entry without value → err; invocation entry with 2 outlets → err; name "Bad-Name" → err; none of these throw.

AC:
- packages/core/src/context-variables.test.ts holds all scenarios; RED because the module does not exist (missing implementation); record `lore evidence --result expected-fail` at the moment it is red.
