---
id: TASK-275
type: task
role: plan
title: "[Skill:research] Migration shape spike (read-only, corpus copy)"
status: archived
priority: high
phase: "Phase 1: Core contracts"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-068
plan: PLAN-068
links:
  - {id: TASK-268, type: blocks}
---
Estimate: S
Approach: read-only scan of live corpus task rows (SELECT via a throwaway corpus COPY, never the live .lore/) -> enumerate extra shapes (claim variants, legacy_phase, evidence sizes) -> emit fixture seed JSON + the FULL consumer-rename grep list (getPlanBundle/assessPlan/resolveTargetTask/badges) into this plan's P2/P3 task docs via lore set
Source: SPEC-056 D6 edge rules; R1/R2 mitigations
Dimensions: D-FUNC
Scope-Alt: consumer-grep half can fall back to tsc-error-driven discovery in P2
Covers: AC-P-5
AC:
- Given the corpus copy, When scanned, Then fixture seed covers every distinct extra-shape found (count logged) including legacy_phase residue and >50-evidence merge case
- Given the grep list, When P2/P3 task docs updated, Then each names its exact touched call sites
