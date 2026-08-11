---
id: TASK-578
type: task
role: plan
title: "[Skill:review] F5a final verification and assessment"
status: archived
priority: critical
phase: "Phase 5: Verification"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-112
plan: PLAN-112
---
Estimate: S
Approach: Main-orchestrator (LORE_ACTOR=agent:main-orchestrator) from main checkout after all merges: bun run build (fresh binary), lore verify <this plan> (all 8 script ACs attested, exit code decides), bun run typecheck, full two-runner suite (bun run test), record dist/lore size delta pre/post embed in evidence note (domain doc D6 observation), lore status --check-drift stays exit 0 after spec code anchors declared (lore anchor add on the F5a spec for scripts/build.ts, static-serving.ts, dashboard-assets-loader.ts, commands/dashboard.ts#packaged), lore assess <plan> --diff derived from the plan's first task commit.
Source: plan Exit Criteria + DoD checklist
Dimensions: D-VERIFY
Scope-Alt: none
Covers: AC-F5A-1..8 (attestation pass)

AC:
- Given all implementation tasks archived, When lore verify runs on this plan, Then every script AC reports attested pass with matched counts > 0 (zero-match or under-match = inconclusive, not pass).
- Given the full two-runner suite on main, When it runs once post-merge, Then exit 0.
- Given lore assess output, When reviewed, Then verdict recorded and gaps either fixed or explicitly accepted in the plan Decisions Log.
