---
id: PLAN-048
type: plan
role: plan
title: "Plan — SPEC-070 review-fix wave"
status: archived
priority: medium
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: SPEC-070
phases:
  - {name: "wiring-core", description: "F1-F5,F9,F10 (AC-070-10..14,17,18)"}
  - {name: "mcp-dispatch", description: "F6,F7,F8 (AC-070-15,16)"}
---
# Plan — SPEC-070 review-fix wave (5-reviewer + Codex synthesis)

## Goal
Close the 6 MAJOR findings from the Complex-scale review of the landed SPEC-070
implementation (correctness: surrogate-split clip, silent evidence zero-out;
maintainability: coverage-precedence divergence; Codex: ac_scope silent-absent,
manufactured aux data, MCP config snapshot staleness; architecture: dispatch
triplication) plus the perf duplicate-read findings and the two test-quality gaps.
ACs: AC-070-10 … AC-070-18 on the parent spec.

governance_mode: unattended

## Invariants
- Existing ACs 1..9 stay green (their tests are the regression floor).
- computeAcCoverage output stays byte-identical on all existing fixtures (single-pass
  rebucketing is an internal restructure, not a semantics change) EXCEPT where
  AC-070-12's shared fail-first precedence deliberately changes the task-start label.
- @lore/core default barrel stays browser-safe.
- commands/ac.ts stays loader-importing; the shared precedence helper must live in
  a vitest-safe module (@lore/core acceptance.ts) and be consumed by ac.ts.
- Worktree oracles stay scoped; full suite once on main post-merge.

## Phases
- wiring-core: F1 headChars clip, F2 per-entry tolerant evidence + degraded line,
  F3 shared coverage precedence (core helper + ac.ts + wiring), F4 ac_scope
  fail-loud, F5 aux ports propagate errs, F10 duplicate-read elimination +
  computeAcCoverage single-pass, F9 test hardening (multi-line import filter,
  phase-start happy-path pin) — AC-070-10,11,12,13,14,17,18
- mcp-dispatch: F6 per-call config getter, F7 shared special-checkpoint descriptor
  map, F8 contradictory-combo rejection — AC-070-15,16

## Risk Register
- M: fail-first precedence change alters task-start acceptance labels on mixed
  evidence — deliberate (aligning to ac.ts convention); pinned by AC-070-12.
- M: config getter threading touches the MCP entry chain — REGRESSION floor is the
  existing 13-case MCP suite.
- L: descriptor-map consolidation touches three files' dispatch — existing byte pins
  (AC-070-7) plus new AC-070-18 happy-path pin guard it.

## Decisions Log
- Two tasks, PARALLEL (anchor sets disjoint; distinct actors).
- Architecture finding #2 (config belongs on App, not a param) is deliberately NOT
  refactored in this wave — recorded for an ADR: the getter param (F6) is the
  minimal freshness fix; App-carriage is a structural decision needing its own pass.
