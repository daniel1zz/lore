---
id: PLAN-078
type: plan
role: plan
title: "Make three governance outcomes legible: vacuous plan-close passes, silent AC demotions, and the empty feeding pack a fresh install receives"
status: draft
priority: medium
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: SPEC-131
phases:
  - {name: "visibility", description: "Per-predicate pass provenance, the corrected tree-check hint and CLAUDE.md rule, and a runtime notice for AC-caused demotions"}
  - {name: "distribution", description: "A fresh-install corpus receives a non-empty spec-create rule slice, proven against a live control"}
---
# Goal

Close three surfaces where lore reports an outcome that does not match the mechanism producing it.

⛔ B1's prevailing diagnosis is FALSE: `lore set <plan> --status archived` DOES evaluate the plan-close gate (`corpus-service.ts:2029`; `resolveGateEnabled` defaults to enabled). The real defect is a gate that evaluates and passes VACUOUSLY — measured consequence, recorded in the source itself: four plans were archived by riding a vacuous predicate. Do not re-fix the wrong defect.

⛔ Every fix here includes correcting the stale prose that recorded the gap, in the SAME unit as the fix.
