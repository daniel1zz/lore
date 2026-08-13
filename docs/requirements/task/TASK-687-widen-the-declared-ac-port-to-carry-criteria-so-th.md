---
id: TASK-687
type: task
role: plan
title: "Widen the declared-AC port to carry criteria so the evidence stamp stops duplicating the task-plan-spec walk"
status: archived
priority: medium
phase: "cap-honesty"
created: 2026-08-11
updated: 2026-08-12
tags: []
parent: PLAN-127
plan: PLAN-127
---
Removes the SSOT compromise the M5 implementer disclosed and could not avoid inside its anchors: the oracle-generation stamp needs the CRITERION, but both injected ac_ref ports return Set<string> (ids only), so TaskWorkflowService now carries a bounded SECOND traversal of the task->plan->spec edge, contradicting its own 'CorpusService owns this walk' invariant. Widen the port to return the criteria, then DELETE the duplicate traversal — the implementer left a grep-checkable marker naming it. ⛔ Blocked on the sub-type-filter task merging: corpus-service.ts is in its anchors.
