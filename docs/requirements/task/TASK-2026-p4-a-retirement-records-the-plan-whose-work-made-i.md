---
id: TASK-2026
type: task
role: plan
title: "P4 a retirement records the plan whose work made it; attribution reads only that"
status: archived
priority: medium
phase: "P"
created: 2026-10-23
updated: 2026-10-26
tags: []
parent: PLAN-268
plan: PLAN-268
---
Resolves #336.

Measured on the first automatic batch (main db548061): 11 plans wait on retired-AC confirmations that are mis-attributed. Decisions 534 and 544 ask about the same 109 retirements for two plans; 543 attributes 8 to another session's plan; AC-ST-9 is attributed to four unrelated plans; one plan errors on an old deprecation ("spec-version-history has no version 4").

Fix at the root: a retirement belongs to the plan whose work made it.
- The retiring write itself records the plan: `lore ac supersede` and a spec deprecation store `retired_in_plan` (the plan of the task the writing run holds a claim on) on the retirement record, in the same write. A retirement made by a run with no claimed task records none.
- retired-ac-service attributes ONLY by that recorded plan. Timestamp, spec and actor heuristics are deleted. Retirements written before this field existed carry none and are never attributed (they predate milestone confirmation; the 109 were owner-approved in knowledge-owner-approval-2026-10-23-109-acceptance-criteria).
- A pending ac-retire-confirm decision whose listed retirements no longer match the plan's current list is withdrawn (not left in lore pending), in the same settle step.

Tests (milestone-review.test.ts, prefix 'milestone review gates close'): two plans, retirements made by runs claiming tasks of plan A only → only A gets a decision; a retirement by a run with no claim → no plan; a pre-existing pending decision whose list changed to empty is withdrawn and the plan is no longer awaiting owner.
