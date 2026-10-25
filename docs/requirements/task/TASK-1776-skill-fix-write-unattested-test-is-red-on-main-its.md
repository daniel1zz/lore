---
id: TASK-1776
type: task
role: plan
title: "[Skill:fix] write-unattested test is red on main: its lore done fixture no longer clears the done floors"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Problem (observed 2026-10-19 on main a8d1c465, reproduced by the DC2-24 implementer in a detached worktree): `bun run test:file packages/lore/tests/integration/write-unattested.bun.test.ts` fails 1 of 17 — "a write that produces several rows (lore done walks several lifecycle steps) still prints exactly one warning": `lore done` exits 4 instead of 0. Most likely the fixture's task no longer satisfies the DCL-1 done floors (runner-produced evidence, unmerged-branch), so the test now exercises a refusal instead of the multi-row write it is about. A red test on main hides real regressions in the unattested-write warning.
Approach: read the exit-4 refusal text from the test's own run; make the fixture reach `done` legitimately (runner-produced pass evidence via --capture, no unmerged claimed branch) rather than loosening the floor; keep the assertion on exactly one warning.
AC: the test file passes 17/17 on main; the fixture's `lore done` exits 0 with the floors armed. Runner-produced red (the current failure).
