---
id: TASK-1572
type: task
role: plan
title: "[Skill:implement] IV-2 user-level state guard for the test run (lore-owned paths of the starting HOME)"
status: archived
priority: medium
phase: "P1 stop the bleeding"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-208
plan: PLAN-208
---
Implement spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D2 (AS-27). Fingerprint the D2 lore-owned paths of the HOME the runner started with before any test, re-check at teardown, fail naming each changed path and AS-27. Test: scripts/tests/iv-user-state-guard.test.ts drives the guard against a fixture starting home (never the real one).
