---
id: TASK-083
type: task
role: plan
title: "T1 core layer — assessment schemas + facts + derivation + clip"
status: archived
priority: high
created: 2026-07-10
updated: 2026-07-10
tags: []
parent: PLAN-020
plan: PLAN-020
links:
  - {id: TASK-082, type: blocks}
---
File anchors: packages/core/src/assessment.ts, packages/core/src/schemas.ts (knowledgeExtraSchema touchpoint), packages/core/tests/assessment-schema-compat.test.ts, packages/core/tests/assessment-facts.test.ts. Deliver SPEC-040 D1 (computeAssessmentFacts incl. knowledge_links/tests_touched/attested-ratio/dangling), D2 schema (3 dimensions, based_on, advisory confidence), D3 typed fields + legacy derivation, D9 extended clip. ACs: AC-ADF-2, AC-ADF-10.
