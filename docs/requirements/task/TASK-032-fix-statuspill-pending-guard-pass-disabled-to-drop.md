---
id: TASK-032
type: task
role: plan
title: "Fix StatusPill pending guard: pass disabled to DropdownMenuTrigger (defect found by AC-DH-8 tests)"
status: archived
priority: high
phase: surface
created: 2026-07-03
updated: 2026-07-03
tags: [spec-027, bugfix]
parent: PLAN-006
plan: PLAN-006
---
T5 component tests uncovered: StatusPill.tsx sets disabled={isPending} only on the inner button; Radix DropdownMenuTrigger gates its own onPointerDown open handler on its own disabled prop (never passed) — dropdown still opens mid-transition, contradicting the documented invariant. One-line fix: pass disabled to DropdownMenuTrigger. Oracle: the deliberately-failing test in StatusPill.test.tsx goes green without test changes.
