---
id: TASK-330
type: task
role: plan
title: "Report why each plan-close predicate passed, so a vacuous pass never renders like a satisfied one"
status: archived
priority: medium
phase: "visibility"
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-078
plan: PLAN-078
---
Every `plan-close` predicate must report WHY it passed. `satisfied` and `vacuous (no applicable data)` MUST carry a distinct machine-readable discriminator in `--json`, not merely different prose.

Live evidence this is needed, observed 2026-08-10 in this very session: promoting three specs with `lore set --status approved` produced ZERO gate output, and the only way to establish that `spec-promote` had actually evaluated was to read `corpus-service.ts:1979`. A silent pass is indistinguishable from an absent gate at the surface.

⛔ Do NOT touch `corpus-service.ts` — a sibling task owns it. Work in `checkpoint-registry.ts` / `gate-predicates.ts`.
