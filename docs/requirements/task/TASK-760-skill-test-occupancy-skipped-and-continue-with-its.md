---
id: TASK-760
type: task
role: plan
title: "[Skill:test] occupancy SKIPPED-and-continue with its live control — RED test scenarios"
status: draft
priority: high
phase: "P2 Stamp mechanisms"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-759, type: blocks}
---
Estimate: S
Source: AC of the paired occupancy-skip task; SPEC-143 AC-CT-8, C6, QA-5, G5
TDD-Role: red | Paired-Impl: the AC-CT-8 occupancy-skip task
Dimensions: D-FUNC, D-ERROR

Scenarios:
- Given a throwaway corpus with occupancy PRESENT (a live pid holding the checkout-level lock), When the state-binding check runs, Then it emits SKIPPED, writes exactly one audit row, and the exit code EQUALS the same fixture's exit code with the check ABSENT. ⛔ Assert by running BOTH, never by hard-coding 0 — other pre-push checks may legitimately fail.
- Given occupancy RELEASED, When the SAME check runs, Then it produces a real verdict, NOT SKIPPED. ⛔ Live control: without it, an implementation that always skips passes the first scenario while G5 holds in name only.
- Given the skip has occurred, When the real `lore status` binary is spawned, Then its stdout contains the literal token SKIPPED on a line that ALSO contains the literal check identifier `state-binding`. ⛔ Not an internal field read; not a bare non-empty-output assertion.

AC:
- All three scenarios exist as executable tests against a throwaway corpus.
- RED before implementation.
- ⛔ Red recorded by THIS agent at the moment it is red (lore evidence --result expected-fail).
