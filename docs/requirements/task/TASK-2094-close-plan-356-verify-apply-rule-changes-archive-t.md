---
id: TASK-2094
type: task
role: plan
title: "Close plan 356: verify, apply rule changes, archive the four commitless evaluation tasks"
status: deprecated
priority: high
phase: "P3 Wiring and close"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-250
plan: PLAN-250
---
Covers: none (orchestrator close step; AC-ND-1..6 are attested by lore verify here)
Steps, after the wiring task has landed and bun run build has run:
1. lore verify plan-no-change-landing-for-commitless-tasks-356 (every AC-ND passes, runner-attested).
2. lore rule apply spec-lore-done-closes-a-commitless-task-through-an-audited-no (BR-1423 becomes live, BR-1291 rewritten).
3. For each of task-experiment-honesty-of-the-evaluation-data-o1-s1-o1-s2-o1-s3, task-experiment-ai-decision-labels-auc-and-audit-cost-o2-s1-o2, task-experiment-delivery-and-concurrency-measures-o3-s1-o4-s1 and task-experiment-overhead-cost-reuse-and-safety-sources-o5-o6-o7: confirm a runner-attested pass made after its claim (lore get --json), then lore done <task> --declare-no-change '<what the experiment measured, read-only>'. A refusal is reported, never bypassed with lore bulk deprecate.
4. lore ready plan-evaluation-1-experiments-and-honest-metric-envelope --json shows the four blocked implementation tasks as ready.
5. lore anchor add on the spec for task-workflow-service.ts#checkNoChangeDeclaration and the two test files.
