---
id: PLAN-163
type: plan
role: plan
title: "Fresh-install probe fixes"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-23
tags: []
parent: SPEC-164
phases:
  - {name: "fixes", description: "F2-F10 + probe automation"}
---
# Plan: fresh-install probe fixes

## Invariants
- Red-first per task (expected-fail recorded before the fix).
- Never write the repo's .lore from tests (mkdtemp + lore init).
- F1 already landed via ad-hoc task task-hotfix-f1-review-tree-position-rejects-every-parentless (AC-FIP-1 attested).

## Governance
governance_mode: unattended

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| skills text and setup next-steps overlap | L | skills task owns assets/skills only; provenance task owns setup-project-flow.ts |

## Tasks
| Task | ac_scope |
|---|---|
| skills | AC-FIP-2 |
| provenance | AC-FIP-3 |
| status AS totals | AC-FIP-4 |
| hint + tree | AC-FIP-5 |
| probe script | AC-FIP-6 (green only after the other four merge) |
