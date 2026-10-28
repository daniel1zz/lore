---
id: TASK-2106
type: task
role: plan
title: "Delivery measures fed by live recorders: lead time, landings, change fail, rework, recovery"
status: draft
priority: medium
phase: "Measures"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-255
plan: PLAN-255
links:
  - {id: TASK-2091, type: blocks}
  - {id: TASK-2104, type: supersedes}
  - {id: TASK-2066, type: blocks}
---
## Objective
Report questions B and C: lead time from first claim, landings per UTC day on main's first-parent line, change fail rate attributed by commit range (one red range counts once, landings_in_red_ranges and pending beside it), rework from resolved-issue records, recovery from the range's first landing to the recorded green (check_interval_median beside it), and no_data source_absent for any window a recorder does not cover. Recreated from task-delivery-measures-lead-time-landings-change-fail-rework (plan-evaluation-3), which is retracted.

Spec: spec-delivery-concurrency-and-autonomy-metrics-fed-by-live (BR-1437, BR-1438, BR-1439, BR-1440, BR-1445).

Covers: AC-DC-1, AC-DC-2, AC-DC-3, AC-DC-8

## Must resolve before evidence

Carried verbatim from the original task. Rule ids map to the successor: BR-1394 -> BR-1437, BR-1395 -> BR-1438, BR-1396 -> BR-1439, BR-1414 -> BR-1440, BR-1420 -> BR-1451; the spec named is now spec-delivery-concurrency-and-autonomy-metrics-fed-by-live.

From the final review of the approved bundle (rev6). Resolve each item before recording evidence for this task.

1. spec-delivery-concurrency-and-autonomy-metrics, BR-1414 vs Scope row recovery_median: a main-red record that went red before the window and turned green inside it - is it in the median? Decide (the rule says 'turned green in the window') and assert it.
2. spec-delivery-concurrency-and-autonomy-metrics, BR-1420 / LANDING_COMMIT_PATTERN / AC-DC-1: the rule is enforced_by guaranteed but lore cannot prevent a force-push of main, and a hand-made merge commit matching /^merge\(/ would count as a landing. State both assumptions and how they are enforced or detected (e.g. the existing main ref guard, integrate-only merge marker), or weaken enforced_by.

Each decision must be recorded in the spec (rule text via `lore rule propose ... amend`, Design Decisions row, and the criterion if its assertion changes) when this task lands, through the normal review and approval of that spec revision.
