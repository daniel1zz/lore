---
id: TASK-2126
type: task
role: plan
title: "Tokens per landed task from session records"
status: draft
priority: medium
phase: "Overhead, fitness and safety"
created: 2026-10-25
updated: 2026-10-25
tags: []
parent: PLAN-272
plan: PLAN-272
links:
  - {id: TASK-2092, type: blocks}
---
## Objective
Read token usage from the harness session records (setting metrics.sources.session_records), join by session and helper-agent reference, give each task the tokens spent during its own claim, report unapportioned and cache-read tokens apart, and no_data naming missing or unjoinable sources. Follow branch O6-S1 of plan 1 (accepted bet).

Spec: spec-governance-cost-reuse-stability-and-safety-metrics (BR-1400).

Covers: AC-GV-3
