---
id: TASK-333
type: task
role: plan
title: "Correct the tree-check hint that claims the plan-close gate never evaluated, and the CLAUDE.md rule built on that false clause"
status: archived
priority: medium
phase: "visibility"
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-078
plan: PLAN-078
---
`tree-check-service.ts:183` prints a paste-ready `lore set <slug> --status archived` justified by *"The plan-close gate never evaluated it"*. Measured 2026-08-10: that sentence is FALSE under the default config (`corpus-service.ts:2029`; `resolveGateEnabled` returns `!== false`, and this repo's config carries a `plan-close` entry that does not disable it).

⛔ SAME UNIT: the root `CLAUDE.md` carries a ⛔-level standing rule asserting `lore set <plan> --status archived` "evaluates NO gate". Grep that wording, correct it, and phrase the replacement so a future reader can CHECK it mechanically — name `corpus-service.ts:2029` and the vacuous-predicate mechanism. ⛔ Never write "fixed"; an unverifiable claim is what produced this defect.

Note the cascade IS deliberately ungated (documented in place as a data-integrity mechanism). Do not re-gate it — make its outcome legible.
