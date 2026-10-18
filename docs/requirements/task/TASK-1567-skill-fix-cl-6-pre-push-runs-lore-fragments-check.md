---
id: TASK-1567
type: task
role: plan
title: "[Skill:fix] CL-6 pre-push runs lore fragments check so a hand-edited rendered rules file cannot reach main"
status: draft
priority: high
phase: "Phase 1: cleanup without a human"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-205
plan: PLAN-205
---
Estimate: S
Approach: CL-4 hand-edited a rendered rules file; nothing before the full suite caught it (hooks/pre-push runs provenance, tree/drift, audit, PRD budget, --check-claude-md, anchor ratchet, prose pins — not lore fragments check). Add `lore fragments check` to hooks/pre-push and the shipped assets/project/pre-push, in the gate order the file defines. Red-first: a commit with a drifted rules file -> pre-push exits non-zero naming rules_drift.
Source: CL-5 report 2026-10-18
AC: red-first case; pre-push passes on clean main.
