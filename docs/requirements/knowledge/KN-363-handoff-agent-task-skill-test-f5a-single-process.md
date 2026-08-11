---
id: KN-363
type: knowledge
role: knowledge
title: "Handoff — agent:task-skill-test-f5a-single-process-static-e2e-harness"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-112
---
# Handoff — agent:task-skill-test-f5a-single-process-static-e2e-harness

## Plan

plan-implementation-dashboard-production-packaging-f5a-one

## Task Refs

(none)

## Modified Files

- packages/dashboard/tests/e2e/static-serving.static.ts

## Key Decisions

| Judgment | Confidence |
|---|---|
| Static e2e harness built+committed; existing suite still green. Surfaced 2 upstream gaps (not harness bugs): missing /api/health dashboard stamp (AC-F5A-1/8); packaged-mode nonce session unauthenticatable (401s all /api/*). See static-serving.static.ts header.@HIGH | — |

## Failing Oracle

(none)

## Next Steps

- Dispatch [Skill:implement] anchored packages/lore/src/adapters/http/{index.ts,static-serving.ts,sessions.ts}: add dashboard stamp to /api/health; fix nonce-session resolve (no matching api_keys row for dashboard-local in packaged mode -> SessionStore.resolve() INNER JOIN always null). Then rerun playwright.static.config.ts, no harness edits needed, re-record AC-F5A-1/2/8 as pass.
