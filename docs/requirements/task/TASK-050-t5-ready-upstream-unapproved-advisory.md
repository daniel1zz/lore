---
id: TASK-050
type: task
role: plan
title: "T5 ready() upstream_unapproved advisory"
status: archived
priority: high
phase: readiness
created: 2026-07-06
updated: 2026-07-06
tags: []
parent: PLAN-012
plan: PLAN-012
---
AC-6 (SPEC-032 §3.4). evaluateReadiness() pure fn gains parent-spec-status param (direct unit test required); ready() sets upstream_unapproved=true when plan's parent spec not approved; lore ready surfaces warning; NEVER blocks. Anchors: packages/lore/src/service/task-workflow-service.ts, packages/lore/src/adapters/cli/commands/ready.ts. Oracle: unit test on pure fn; CLI shows advisory; readiness computation unchanged otherwise.
