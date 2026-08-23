---
id: TASK-781
type: task
role: plan
title: "[Skill:test] retired transport keys parse with warnings while strict mode holds — RED"
status: draft
priority: high
phase: "P4: Transport removal"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
links:
  - {id: TASK-780, type: blocks}
---
Estimate: S
Source: AC-GI-14 of the governing spec; Invariant 4
TDD-Role: red | Paired-Impl: the transport-removal task in this phase

Scenarios:
- Given a config carrying feedback.upstream.corpus_path, When the schema parses it after the transport modules are gone, Then parsing SUCCEEDS and a warning names `corpus_path`
- Given a config carrying the retired `transport` key, When parsing runs, Then it succeeds and a warning names `transport`
- Given a config carrying BOTH retired transport keys, When parsing runs, Then both are named — not just the first
- Given a config carrying an unrelated unknown key under feedback.upstream, When parsing runs, Then it still FAILS, proving strict mode survives the targeted exemptions

AC:
- Every scenario exists as an executable vitest case in the anchored file
- The anchored file exits non-zero before the paired implementation lands
- The fourth scenario is mandatory for the same reason as its P1 counterpart: without it, a blanket `.passthrough()` satisfies the rest and destroys strictness
- `lore evidence --result expected-fail` recorded BY THIS TASK when the red is observed
