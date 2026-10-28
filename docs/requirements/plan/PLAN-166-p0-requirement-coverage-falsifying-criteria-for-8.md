---
id: PLAN-166
type: plan
role: plan
title: "P0 requirement coverage: falsifying criteria for 8 rules"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-25
tags: []
parent: SPEC-161
phases:
  - {name: "tests", description: "New falsifying test cases, one task per rule group"}
---
# Plan: P0 requirement coverage — falsifying criteria for 8 rules

## Invariants
- Test-only: no product source under packages/*/src changes (a falsifier mutation is applied, run, recorded as expected-fail, and reverted before commit).
- Never write the repo's .lore/ from tests; corpus-touching tests use mkdtemp + lore init or InMemoryStore.
- Each new test file is named exactly as its AC's command names it (spec-p0-requirement-coverage-falsifying-criteria-for-the-8).
- Playwright multi-project e2e binds fixed ports 8787/5173: only one run at a time machine-wide.

## Governance
governance_mode: unattended

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| A new test shows code violates its rule | M | record the failing run, report it; orchestrator files an issue or rewrites the rule — code is not changed here |
| e2e port collision between concurrent runs | M | assertPortFree fails loud; T5 runs its e2e once, serially |
