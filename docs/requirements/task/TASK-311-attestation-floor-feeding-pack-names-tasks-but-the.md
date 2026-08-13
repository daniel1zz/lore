---
id: TASK-311
type: task
role: plan
title: "attestation-floor feeding pack names tasks but the exemption mechanism is plan-level — pack should state the plan-level repair (extra.attestation_exempt on the PLAN) instead of per-task listing that misleads into writing dead task-level fields"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PRD-001
---
## Repro
Close a plan whose ratio < min_ratio: the ATTESTATION_FLOOR_NOT_MET pack lists offending TASKS, but checkpoint-registry.ts reads exemption ONLY from the closing PLAN's extra.attestation_exempt(+_reason). An operator following the pack writes task-level exempt fields (observed 2026-07-26, SPEC-080 close-out) which are silently dead.
## Expected
Pack names the literal plan-level repair command AND clarifies RED/TDD tasks' time-bound oracles as the canonical exemption rationale class.
## Anchor
packages/lore/src/service/checkpoint-registry.ts (feedPlanClose attestation branch)
