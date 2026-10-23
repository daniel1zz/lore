---
id: TASK-1659
type: task
role: plan
title: "RQ-L4: label refusals in packages/core/src, distribution and src root, and their tests"
status: approved
priority: high
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PLAN-216
plan: PLAN-216
---
Plan task RQ-L. Base: branch rq-integration (contains RQ-1). Label every refusal construction the type checker lists in this scope with the rule of the predicate or check that decides it, per spec-every-refusal-carries-its-rule-as-a-required-type-checked. Use 'infrastructure' only on dependency-failure codes. Hints only: knowledge-baseline-site-map-mappings-as-of-2026-10-20-labelling. A refusal with no describing live rule gets no guessed rule: list it in the report for a spec change. Fix this scope's tests to the new type. Scope: packages/core/src, packages/lore/src/distribution, packages/lore/src/*.ts, tests unit/core, unit/distribution, unit/app, unit/cli, unit/setup, and dashboard typecheck errors that come through core.
