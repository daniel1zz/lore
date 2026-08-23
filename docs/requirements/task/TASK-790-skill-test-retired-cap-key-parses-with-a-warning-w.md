---
id: TASK-790
type: task
role: plan
title: "[Skill:test] retired cap key parses with a warning while strict mode stays intact — RED"
status: archived
priority: critical
phase: "P1: Cap removal"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
---
Estimate: S
Source: AC-GI-10 of the governing spec; Invariant 4; Risk PR-2
TDD-Role: red | Paired-Impl: the cap-removal task in this phase

Scenarios:
- Given a config object carrying feedback.inbound.open_report_cap with a numeric value, When the schema parses it, Then parsing SUCCEEDS and a warning naming `open_report_cap` is emitted
- Given the same config, When parsing succeeds, Then the resolved config exposes no cap-derived value that any code path could act on
- Given a config with no feedback section at all, When parsing runs, Then it succeeds with no warning — proving the warning is conditional on the key's presence rather than unconditional noise
- Given a config carrying an unrelated unknown key under feedback.inbound, When parsing runs, Then it still FAILS — proving the retired key is a targeted exemption and strict mode is otherwise intact

AC:
- All four scenarios exist as executable vitest cases in the anchored file
- The anchored file exits non-zero before the paired implementation lands
- The fourth scenario is mandatory: without it, replacing `.strict()` with `.passthrough()` would satisfy the other three and silently destroy schema strictness everywhere
- `lore evidence --result expected-fail` recorded BY THIS TASK when the red is observed
