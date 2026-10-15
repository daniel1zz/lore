---
id: TASK-929
type: task
role: plan
title: "[Skill:test] RED - plan-close cascade floors, port contract and human output (#47)"
status: archived
priority: high
phase: "plan-close-floors"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-154
plan: PLAN-154
links:
  - {id: TASK-930, type: blocks}
---
Estimate: M
Source: spec-approval-and-plan-closure-go-through-the-same-checks-on AC-AP-4, AC-AP-5, AC-AP-6
TDD-Role: red | Paired-Impl: task-skill-implement-plan-close-cascade-checks-lore-done-floors
Scenarios:
- RE-BASELINE packages/lore/tests/integration/plan-close-cascade.bun.test.ts (AC-AP-4 cases a-f): createApp throwaway corpus; members T1 attested pass (runner-attested path), T2 no evidence, T3 red_first + attested pass + no red row, T4 fresh claim, handoff H. Rewrite the existing HAPPY case that archived an unattested task so that task holds an attested pass (record the original assertion and why). Case (e) disables workflow.gates."plan-close". Case (f) compares error.details.floor of taskWorkflowService.done with the cascade floor — never message text.
- RE-BASELINE packages/lore/tests/unit/service/plan-close-cascade-plan-membership.test.ts (AC-AP-5 cases a-d): bare CorpusService + stub DoneFloorPort returning {floor, error} / err / null; stub logs every id it is asked about.
- EXTEND packages/lore/tests/e2e/plan-close-invariants-compiled.bun.test.ts (AC-AP-6): compiled binary; human stdout 'Cascade archived: <A>' and 'Cascade skipped: <B> (attested-pass)'; --json cascade.skipped[0].floor.
Dimensions: HAPPY (T1, H), NEGATIVE (T2, T3), BOUNDARY (T4 fresh claim; gate disabled), ERROR (port err -> failed), STATE (statuses + audit counts), REGRESSION (membership by plan_id).
AC:
- Run every listed file against current main. New cases must fail on ASSERTIONS, not harness errors; a red that is a call to the not-yet-existing method the paired task adds (TypeError ... is not a function) is acceptable only for that method; say so in the evidence.
- At the moment of red, the agent that ran it records `lore evidence <this task> --oracle <test|e2e> --command "<exact command> 2>&1" --result expected-fail --capture`, one row per file (`2>&1` is required: --capture stores all stdout then all stderr, so without it the runner summary can fall out of the stored tail). Never transcribe a red later.
- Commit the tests on this task's branch; the paired implement task branches from that commit; never merge red to main alone.
