---
id: TASK-173
type: task
role: plan
title: "[Skill:implement] T3 Q3 contract layer: dashboard.projects schema + MountState + mount interface types"
status: archived
priority: critical
phase: "Phase 1: Contracts & spikes"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-038
plan: PLAN-038
links:
  - {id: TASK-170, type: blocks}
  - {id: TASK-171, type: blocks}
  - {id: TASK-168, type: blocks}
---
Estimate: S
Approach: (1) packages/core/src/config.ts — extend GlobalLoreConfigSchema with optional `dashboard: { projects: [{name, path}] }` + duplicate-name superRefine + pure MountState union export; (2) new packages/lore/src/mount/types.ts — MountEntry, MountRegistry public interface, ProjectsResponse (/api/projects) type. Pure types/Zod only — NO runtime code, NO bun:sqlite imports (browser-safe rule for core; types.ts importable by vitest).
Source: spec-078 D3 + Components table; SPEC-064 GlobalLoreConfigSchema precedent (packages/core/src/config.ts:88-92).
Dimensions: D-CODE
Scope-Alt: ProjectsResponse could live in mount/types.ts vs core — decided: mount/types.ts (server contract), MountState in core (client renders it).
Covers: AC-078-1 (schema part), AC-078-5 (response type part)

AC:
- Given a config with duplicate project names, When GlobalLoreConfigSchema parses, Then it rejects with a named duplicate-name issue.
- Given a valid registry config, When parsed, Then dashboard.projects is typed [{name, path}] and absence of the dashboard key parses fine (back-compat).
- Given tsc --noEmit, Then 0 errors; packages/core default barrel still imports no Node builtins (dashboard Vite import stays safe).
- Integration: both waves import these types — this task merges to main BEFORE any Phase 2/3 dispatch.
