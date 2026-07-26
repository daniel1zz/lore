---
id: TASK-168
type: task
role: plan
title: "[Skill:implement] T9 client factory triple + full call-site migration + ESLint rule"
status: archived
priority: high
phase: "Phase 3: Client wave"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-038
plan: PLAN-038
links:
  - {id: TASK-165, type: blocks}
---
Estimate: L
Approach: packages/dashboard/src/lib/project-api.ts — apiFetch(project, path) wrapper over the existing fetchJson; queryKeys factory with project-first segment; useProjectParam() reading the /p/:name route param (registry-less → null project, paths unchanged). Migrate ALL ~31 hardcoded /api/ literals and ~43 queryKey sites in src/lib + hooks to the factory. ESLint flat-config rule (no-restricted-syntax on raw '/api/' template literals) scoped to src/**, factory module exempted; negative fixture proving the rule fires.
Source: spec-078 D5 + Components; DX review honest counts (api.ts:317,724 etc.).
Dimensions: D-CODE, D-FUNC
Scope-Alt: none — partial migration violates Invariant 3.
Covers: AC-078-8 (lint half)

AC:
- Given the ESLint rule and a fixture file containing a raw /api/ literal outside the factory, When lint runs, Then it fails naming the dedicated rule id; with the fixture removed the repo lints clean.
- Given grep for '/api/' template literals under packages/dashboard/src excluding the factory module, Then 0 hits.
- Given registry-less mode, When the existing e2e suite runs, Then green (factory emits today's paths when project is null).
- Given tsc --noEmit, Then 0 errors.
