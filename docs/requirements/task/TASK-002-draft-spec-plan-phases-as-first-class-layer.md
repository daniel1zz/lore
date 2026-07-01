---
id: TASK-002
type: task
role: plan
title: "Draft SPEC: plan.phases as first-class layer"
status: archived
priority: medium
created: 2026-06-30
updated: 2026-06-30
tags: []
parent: PLAN-001
plan: PLAN-001
---
Track B · Task B5

Source: Dogfood session 2026-06-30 — building this very plan revealed that lore intentionally dropped the docman phase layer (doc-type-rules.ts:18 → task: ["plan"]), leaving only plan.extra.phase as an optional string tag with no semantics.

Problem: A roadmap with 10+ tasks across 2 tracks has no native grouping. Workarounds (title prefix "Track A · ...", tags, multiple plans) lose tooling support — lore tree, lore list cannot group.

Goal: Stub SPEC for first-class phases. Resolve:

- Shape: planExtraSchema.phases: Array<{name, task_ids}> vs new doc type "phase" between plan and task?
- If extra-only: lore tree renders phase headers? lore list --phase filter?
- If new type: doc-type-rules update — task: ["phase"], phase: ["plan"]
- Backwards compat: existing 0-phase plans must keep working
- CLI surface: lore phase create / list / assign?

Deliverable: spec-plan-phases-first-class in draft, with extra-vs-entity tradeoff in §6.
