---
id: TASK-723
type: task
role: plan
title: "The defect channel has no adopt verb: a filed report can be closed but never given an owner, so every accepted defect stays plan-less forever"
status: draft
priority: medium
created: 2026-08-13
updated: 2026-08-13
tags: []
parent: PRD-001
---
lore report-issue creates a task-typed doc with plan_id null, phase null, file_anchors null and ac_scope []. Nothing in the CLI can move it out of that state into a plan. lore issue exposes only resolve, whose documented values are terminal and derogatory (rejected/wontfix). lore set has no --plan-id. lore plan exposes only the two plan-close exemption writers. lore anchor can add anchors to an already-plan-less task, which does not help: without plan_id the task is invisible to lore ready, to the anchor mutex (plan-scoped), and to lore verify's declared-scope intersection. Measured 2026-08-13: 21 open reports, the four newest (2 critical, 2 high) filed 13h-47m ago, ALL plan_id null. spec-the-defect-channel-cannot-be-honestly-maintained-an is approved and covers the cap, the two disagreeing reads and non-derogatory supersession, but greps zero for adopt/assign/plan_id/unowned/orphan - so this is an unrecorded gap, not a known one. The only available workaround is to create a SECOND, parallel task under a real plan and lore link it back to the report, which leaves the channel's own record permanently open and makes the report count a meaningless number.
