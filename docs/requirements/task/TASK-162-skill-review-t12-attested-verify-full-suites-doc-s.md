---
id: TASK-162
type: task
role: plan
title: "[Skill:review] T12 attested verify + full suites + doc sync + code anchors"
status: archived
priority: critical
phase: "Phase 4: Integration & verification"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-038
plan: PLAN-038
---
Estimate: S
Approach: Main-checkout verification pass: bun run typecheck; bun run test (both runners); full Playwright e2e; LORE_ACTOR=agent:main-orchestrator lore verify <plan> for attested script-AC evidence; doc sync — root CLAUDE.md SPEC-078 line, packages/lore/src/adapters/http/CLAUDE.md, packages/dashboard/CLAUDE.md, packages/lore/src/store/CLAUDE.md (busy_timeout); declare spec code anchors post-landing (lore anchor add spec-078 ... for mount-registry.ts, project-api.ts, projects-route.ts); lore status --check-drift exit 0.
Source: plan Exit Criteria; DoD checklist.
Dimensions: D-FUNC
Scope-Alt: none.
Covers: (verification umbrella — attests AC-078-1..10 via lore verify)

AC:
- Given lore verify on this plan, Then every script-mode AC yields an attested pass (no inconclusive, no under-match).
- Given full suites on main, Then vitest + bun test + Playwright all green.
- Given lore status --check-tree --check-drift, Then exit 0 after anchor declarations.
