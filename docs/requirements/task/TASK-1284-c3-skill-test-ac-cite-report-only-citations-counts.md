---
id: TASK-1284
type: task
role: plan
title: "[C3] [Skill:test] ac cite: report-only citations, counts, no demotion — RED"
status: archived
priority: high
phase: "Phase C: services and surfaces"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
plan: PLAN-172
---
Estimate: S
Source: Spec: `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (read it first: `lore get spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`). §C4, QA-6
TDD-Role: red | Paired-Impl: C4
Covers: AC-BLS1-6

Scenarios:
- Given an approved spec and a live rule, When `ac cite <spec> <AC> BR-n`, Then cites stored, 1 version logged with audit operation `cite`, status stays approved.
- Given a missing id / deprecated rule / retired rule, When cited, Then written, exactly 1 warning naming the id, and the count function returns cites_dangling=1 / cites_to_inactive=1 respectively.
- Given the same id cited twice, Then stored once.
- Given `ac add --cite BR-n`, Then no demotion; `ac set --cite` follows set's demotion rule.
- Given `ac cite --remove`, Then the id is removed and a version logged.
- Falsifier: dropping a dangling citation instead of storing and counting it turns the dangling scenario red.

AC:
- All scenarios are executable tests in the anchored file.
- Running the file's command yields every scenario RED, and each failure message names the missing behaviour (not a syntax/import error in the test itself).
- Record `lore evidence <this-task> --result expected-fail --oracle test --command "<cmd>"` AT THE MOMENT it runs red (not transcribed later).
