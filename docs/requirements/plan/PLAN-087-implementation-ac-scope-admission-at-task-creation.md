---
id: PLAN-087
type: plan
role: plan
title: "Implementation — ac_scope admission at task creation"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: SPEC-124
---
Implements spec-declaring-ac-scope-is-required-at-task-creation-so-the (8 ACs). Single slice: a task-create checkpoint predicate plus the CLI flag, with the retroactive policy fixed by D4 (binds at CREATE only, never re-evaluates the back-catalogue).
