---
id: TASK-766
type: task
role: plan
title: "[Skill:test] stamp axis and the arming cutoff — RED test scenarios"
status: draft
priority: high
phase: "P2 Stamp mechanisms"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-765, type: blocks}
---
Estimate: S
Source: AC of the paired stamp-axis task; SPEC-143 AC-CT-3, C2, ADR-034 (v5, amended)
TDD-Role: red | Paired-Impl: the AC-CT-3 stamp-axis task
Dimensions: D-FUNC

Scenarios:
- Given a throwaway corpus and a stamp-less row whose audit.id is ABOVE arming_rev, When attestationFloor evaluates it, Then it is REFUSED (stamp = unbound).
- Given a stamp-less row whose audit.id is at or BELOW arming_rev, When the SAME floor evaluates it, Then it is ACCEPTED (stamp = legacy_unbound). ⛔ This half is the CONTROL; without it the test cannot distinguish the design from a blanket refusal.
- Given both rows, When the capture_source distribution is read, Then both appear DISTINCTLY labelled — neither silently dropped nor merged.
- Given an UNDEFINED recorded stamp, When stampCurrency classifies it, Then stamp is never "stamped".

AC:
- All four scenarios exist as executable tests against a throwaway corpus.
- RED before implementation, failing for missing-implementation reasons.
- ⛔ Red recorded by THIS agent at the moment it is red (lore evidence --result expected-fail).
