---
id: TASK-1793
type: task
role: plan
title: "[Skill:fix] setup-service hook-registration test is red on main after two hooks landed"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Problem (observed on main 27f487fe, 2026-10-19): `packages/lore/tests/unit/service/setup-service.test.ts` "resolves {{lore:claude_dir}} ... all 16 hook files registered" fails on main: the registered hook list now also contains post-edit-bindings.mjs (da79b5aa) and pre-helper-foreign-working-copy-gate.mjs (e42cea7d), which landed without the test's expected list (or the manifest it is derived from) being updated. A red test on main hides any real registration regression.
Approach: the test derives its expected hook set from the shipped manifest (one source), not a hand-kept list, and asserts each registered command resolves {{lore:claude_dir}}; confirm both new hooks are meant to be registered (BR-1092 allows the foreign-working-copy gate).
AC: the test passes on main; removing a hook from the manifest without removing its registration turns it red. Runner-produced red.
