---
id: TASK-2065
type: task
role: plan
title: "Red tests: render in effect, governed telemetry decision, prose refusal, unbound finding, import, export and judge"
status: draft
priority: medium
phase: "P1 Red"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-261
plan: PLAN-261
links:
  - {id: TASK-2110, type: blocks}
  - {id: TASK-2061, type: blocks}
---
Covers: AC-CV-1, AC-CV-2, AC-CV-3, AC-CV-4, AC-CV-5, AC-CV-6
TDD-Role: red
Approach: throwaway corpora; config variants written as .lore/config.yaml in the temp corpus. CV-2 stubs the registry entry and asserts createApp's telemetry type. CV-6 fixture: a batch whose patch binds an unknown governed id (refused at stage), and a staged batch whose registry entry is removed before approval (refused at approve).
Done when: all six commands (CV-1..6) run red; expected-fail captured.
