---
id: TASK-1368
type: task
role: plan
title: "Restore the instruction parts the rule-only reword dropped"
status: archived
priority: medium
phase: "W1"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-187
plan: PLAN-187
---
Restore the instruction parts that task-reword-the-ten-always-loaded-fragments-to-the-rule-only dropped, as found by knowledge-assessment-always-loaded-lore-fragments-state-the (AC-RW-5 scored 65). The main agent's manual AC-RW-5 PASS on that task was wrong: these are how-to-act instructions, not explanation.

Restore, in the shortest rule-only wording:
1. ac-design: editing a red oracle — record the original command, its failure and why it corrects IN PLACE (in the spec/AC itself).
2. ac-design: comment anchors — find every comment naming the gap by grepping its wording.
3. evidence-attestation: a silent oracle is fixed in the declared AC command, not in the recorder.
4. corpus-workflow-3-execute: editing an approved doc's content demotes it to draft and blocks task-claim until it is re-reviewed and re-approved.
5. corpus-workflow-3-execute: `lore release` does not remove the task from the ready set.
6. corpus-workflow-1-feed: the handoff-verification floor arms only for a ticket authored by a different actor or in an earlier session.
Then re-check every other removed span of the reword commit against the same test (instruction vs explanation) and restore any further instruction found.
