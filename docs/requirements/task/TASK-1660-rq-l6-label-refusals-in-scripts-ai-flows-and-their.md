---
id: TASK-1660
type: task
role: plan
title: "RQ-L6: label refusals in scripts, ai, flows and their tests"
status: approved
priority: high
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PLAN-216
plan: PLAN-216
---
Plan task RQ-L. Base: branch rq-integration (contains RQ-1). Label every refusal construction the type checker lists in this scope with the rule of the predicate or check that decides it, per spec-every-refusal-carries-its-rule-as-a-required-type-checked. Use 'infrastructure' only on dependency-failure codes. Hints only: knowledge-baseline-site-map-mappings-as-of-2026-10-20-labelling. A refusal with no describing live rule gets no guessed rule: list it in the report for a spec change. Fix this scope's tests to the new type. Scope: scripts/**, packages/lore/src/ai, packages/lore/src/flows, tests unit/flows, unit/eval, unit/ai.
