---
id: PLAN-043
type: plan
role: plan
title: "Plan — SPEC-074 dashboard Issues triage"
status: archived
priority: medium
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: SPEC-074
phases:
  - {name: "Phase 1: Implementation", description: "Backend projection route then frontend page + e2e"}
links:
  - {id: SPEC-074, type: implements}
---
## Overview
Execute SPEC-074 (dashboard Issues triage, 5 ACs). 2 tasks (backend → frontend), 1 phase. Governance: unattended (autopilot). Small-plan routing: verification at orchestrator closure.

## Governance Mode
unattended

## Invariants
1. No new write semantics — adjudication composes existing SPEC-022 cookie routes; reject requires non-empty reason.
2. Read route auth: cookie OR bearer for GET (SPEC-062 precedent); adjudication cookie-only (SPEC-022 invariant).
3. E2E seeds reports via the REAL report-issue CLI from a twin consumer fixture (never hand-inserted rows); Playwright serialized on the fixed dev-server port (standing lesson); throwaway corpora only.
4. @lore/core default barrel stays browser-safe (dashboard imports it).

## Exit Criteria
All 5 ACs attested via lore verify; typecheck + dual-runner + Playwright e2e green on main.
