---
id: TASK-1039
type: task
role: plan
title: "[Skill:test] RED — attested · claimed rendering and status attribution share"
status: archived
priority: high
phase: "P3 Write surfaces"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1037, type: blocks}
---
Estimate: S
Source: AC-RID-9, AC-RID-11; validated wording from ledger X3b
TDD-Role: red | Paired-Impl: `task-skill-implement-get-log-attested-claimed-rendering`
Covers: AC-RID-9, AC-RID-11

Scenarios:
- Given a version written with run R and claimed N, When `lore get` and `lore log` (text and --json), Then both show `attested: R` and `claimed: N`; Given a row from before migration 016 with stored name M, Then both show `attested: unattested` and `claimed: M`.
- Given a seeded corpus with, inside 14 days, 7 claims, 7 evidence entries and 6 handoffs (the only unattested one is a handoff), one write exactly on the window edge, 5 older writes and 4 attested document writes, When `lore status --json` and `lore status` under an injected clock, Then both report total 20, attested 19, share 0.95.

AC:
- Given the two files, When each runs before `task-skill-implement-get-log-attested-claimed-rendering`, Then they fail on the missing output, recorded with `lore evidence --result expected-fail --output-tail-file`.
