---
id: PLAN-165
type: plan
role: plan
title: "Baseline close-out fixes"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: SPEC-162
phases:
  - {name: "fixes", description: "One task per defect"}
---
# Plan: baseline close-out fixes

## Invariants
- Red-first: each task records an expected-fail run of its new test on the pre-fix code before the fix.
- Never write the repo's .lore/ from tests (InMemoryStore or mkdtemp + lore init).
- Only the isolation-e2e task runs Playwright (fixed ports 8787/5173).
- Criteria AC-BLC-1..8 are declared on the spec with their cites; each task owns exactly the one in its ac_scope and never edits criteria.

## Governance
governance_mode: unattended

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| corpus-service.ts touched by audit-surface and link-atomicity tasks | M | link task blocked by audit task |
| a fix changes behaviour other tests pin | M | scoped tests incl. direct consumers; full suite on main after merge |

## Notes
- AC-BLC-3 names no new test file: its red-first run is the existing `tests/e2e/multi-project-isolation.spec.ts`, which already fails on main (approve on project A not ok, measured 2026-10-10 in the P0C plan). The isolation task re-runs it once on pre-fix code and records that run as expected-fail before changing anything; the fix lands in test or product code depending on the root cause it finds.
