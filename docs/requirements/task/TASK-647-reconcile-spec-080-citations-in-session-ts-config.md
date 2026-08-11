---
id: TASK-647
type: task
role: plan
title: "Reconcile SPEC-080 citations in session.ts/config.ts comments after SPEC-084 renumbering — buildBootstrapInjection/config budgets cite 'SPEC-080 §Projection Contract/D1-D8' which belong to the bootstrap-injection spec, not PRD-as-outline (triple numbering collision)"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PRD-001
---
## Context
Triple SPEC-080 collision (see knowledge-triple-spec-080-numbering-collision-across-concurrent): packages/core/src/session.ts and packages/core/src/config.ts comments cite 'SPEC-080 §Projection Contract', '§Public Interface', 'D1-D8' — sections of the bootstrap-injection projection spec, unresolvable against the PRD-as-outline SPEC-080. SPEC-084 (corpus-allocated ordinal identity) defines the renumbering; its scope does NOT include a code-comment sweep.
## Expected
After SPEC-084's repair migration assigns final numbers, sweep session.ts/config.ts (and any other collision-affected citation: grep 'SPEC-080') to cite the renumbered spec by its stable slug or new number. Blocked-on: SPEC-084 execution.
## Anchor
packages/core/src/session.ts, packages/core/src/config.ts
## Provenance
Judge recommendation, knowledge-assessment-implementation-spec-080-prd-as-outline (Typed Recommendations #4).
