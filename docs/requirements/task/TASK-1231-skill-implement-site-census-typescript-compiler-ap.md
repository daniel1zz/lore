---
id: TASK-1231
type: task
role: plan
title: "[Skill:implement] Site census (TypeScript compiler API) + leaf coverage + baseline sites/coverage/map verbs"
status: archived
priority: medium
phase: "Phase 2: Indexes and census"
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-178
plan: PLAN-178
links:
  - {id: TASK-1217, type: blocks}
  - {id: TASK-1216, type: blocks}
---
Estimate: L
Approach: TypeScript compiler API (typescript 5.9, root devDependency): build a Program over packages/lore/src, resolve the command handler's call graph into service methods, collect return err({code}) sites, gate predicate failures and recorded outcomes; calls through registries/maps are not_measured; leaf extra.site_map {siteKey -> BR-n | non-business:reason} as a dedicated extra key; CLI lore baseline sites <command>, coverage <leaf|branch>, map <leaf> --site --rule|--non-business
Source: spec C1/C2; owner chose static analysis 2026-10-08; context7 TypeScript compiler API docs before use
Covers: AC-BLS2-5
AC:
- Before editing: record expected-fail of AC-BLS2-5's command on THIS task
- bunx vitest run packages/lore/tests/unit/service/site-census.test.ts passes
- lore baseline sites ac-add on this repo lists >= 10 sites (printed count in the evidence tail)
- Census of one real command compared against a grep of `return err(` in the files it reaches: every grep hit is either listed or not_measured (comparison recorded in evidence)
