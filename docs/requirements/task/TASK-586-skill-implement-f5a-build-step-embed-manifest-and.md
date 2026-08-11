---
id: TASK-586
type: task
role: plan
title: "[Skill:implement] F5a build step, embed manifest and committed loader"
status: archived
priority: critical
phase: "Phase 1: Build & assets"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-112
plan: PLAN-112
links:
  - {id: TASK-585, type: blocks}
---
Estimate: M
Approach: scripts/build.ts gains a dashboard step BEFORE Bun.build: (1) content-digest over packages/dashboard/src/** + vite.config.ts + package.json → short-circuit if unchanged vs stamp; (2) run `bun run --filter '@lore/dashboard' build` (lifecycle fires prebuild routeTree gen — never bare vite build); (3) generate git-ignored packages/lore/src/generated/dashboard-assets.ts importing every packages/dashboard/dist/** file `with { type: "file" }` + build stamp; (4) add .gitignore entry. Committed loader packages/lore/src/adapters/http/dashboard-assets-loader.ts owns a guarded dynamic import returning { available: true, manifest } | { available: false, reason }. SPIKE FIRST (H-risk): verify bun compile-time embedding of generated `with {type:"file"}` imports with a 2-file proof (consult bun official docs via context7) before full wiring; if unusable, switch mechanism behind the same loader union (interface is mechanism-agnostic).
Source: spec DD-1 + scripts/build.ts existing assets-manifest/libsql embed precedents
Dimensions: D-FUNC, D-CODE
Scope-Alt: digest short-circuit may defer to a follow-up if spike burns budget — but then `bun run build` MUST still be correct, only slower
Covers: AC-F5A-6

AC:
- Given a clean checkout with no packages/dashboard/dist, When `bun run build` runs, Then it builds the dashboard first (routeTree generated via lifecycle) and dist/lore embeds the assets (proof: paired RED tests turn GREEN; binary serves a fixture read in later phases).
- Given an unchanged packages/dashboard source tree, When `bun run build` runs twice, Then the second run's build output contains the literal short-circuit marker line `dashboard: unchanged (digest match), skipping vite build` and does NOT contain the vite-build-start marker (both grep-assertable; no timing clause).
- Given no generated manifest, When `bun run typecheck` runs, Then exit 0 (AC-F5A-6).
- Given the paired RED suite, When run after implementation, Then all its scenarios are GREEN with matched-count > 0.
