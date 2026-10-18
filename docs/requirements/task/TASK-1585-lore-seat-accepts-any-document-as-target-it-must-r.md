---
id: TASK-1585
type: task
role: plan
title: "lore seat accepts any document as target; it must refuse a non-plan with exit 4"
status: draft
priority: medium
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-194
plan: PLAN-194
---
Owner decision 2026-10-18 (BR-370, escalated question on baseline-enter-a-seat judgment 01M54V5F2TWHRXVH4HSHRWX9P7): taking a seat is plan-only. Today the target's type is not checked, the conflict check fails quietly and is treated as passed, and the output still says 'seat for plan' (reproduced 2026-10-09). Expected: a non-plan target is refused with exit 4 naming its type, nothing changes (no worktree, no branch, no main-checkout change). When it lands, rewrite BR-370 to the refusal and raise its confidence with a citing criterion.
