---
id: TASK-876
type: task
role: plan
title: "[Skill:test] contract section parity + real-binary pre-push trip — RED"
status: archived
priority: medium
phase: "Phase 2: Surfaces"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-149
plan: PLAN-149
---
Estimate: S
Source: spec-claude-md-root-section-structure-check-and-adoption-mode AC-STR-3, AC-STR-7; pattern pre-push-trip.bun.test.ts but with the REAL compiled binary (realBinDir as in AC-BFI-3), never the always-0 shim
TDD-Role: red | Paired-Impl: I5
Covers: AC-STR-3, AC-STR-7

Scenarios:
- The numbered root-section list in assets/governance/claude-md-contract.md equals ROOT_REQUIRED_SECTIONS exactly and in order.
- The contract contains 'must contain' + 'in this order' wording and an 'Adoption Mode' heading; it no longer says 'exactly these headings'.
- Temp repo, adoption enforce, root missing '## Commands' → assets/project/pre-push exits non-zero and its output names section_missing; failure text does not tell the user only to 'trim'.
- Same repo with adoption warn → exit 0.

AC:
- RED on the current base; record expected-fail evidence at the moment it is red (--ac AC-STR-3, AC-STR-7).
