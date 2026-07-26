---
id: TASK-201
type: task
role: plan
title: "[Skill:implement] GET /api/issue-reports projection + auth tests"
status: archived
priority: critical
phase: "Phase 1: Implementation"
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-043
plan: PLAN-043
links:
  - {id: TASK-200, type: blocks}
---
Estimate: M
Approach: GET /api/issue-reports in the HTTP adapter (study packages/lore/src/adapters/http/ route layout + SPEC-062 GET /api/config auth precedent: cookie OR bearer): rows = tasks with status in {draft,in-review} AND extra.issue_report present, projected to {id, slug, title, reporter_project, reporter_actor, lore_version, reported_at, possible_duplicates, status} + open_count; sorted reported_at desc; implemented over existing CorpusService list surface (filter in adapter; if list cannot express it, a narrow read-only service method is acceptable — never a write). Write vitest suite packages/lore/tests/unit/adapters/http-issue-reports.test.ts (study existing http route tests for the harness; InMemoryStore fixtures fine here — route projection logic, not cross-corpus).
Source: spec-074 §Design; SPEC-062/022 auth precedents
Dimensions: D-FUNC
Scope-Alt: none
Covers: AC-074-5

AC: bunx vitest run packages/lore/tests/unit/adapters/http-issue-reports.test.ts -t 'AC-074-5' exit 0 ≥1 matched; full file green; bun run typecheck exit 0.
Integration: consumed by T2 frontend; curl-able with bearer token.
