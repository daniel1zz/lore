---
id: PLAN-016
type: plan
role: plan
title: "SPEC-037 Implementation — execution-tracking surface"
status: archived
priority: medium
created: 2026-07-07
updated: 2026-07-07
tags: [spec-037, dashboard]
parent: SPEC-037
phases:
  - {name: "Backend", description: "lore/core packages: store sentinels + ready route"}
  - {name: "Frontend", description: "dashboard package: tree gesture, projection, copy"}
---
# SPEC-037 implementation plan

Wave 1 (parallel, disjoint files): D5-backend, D1-backend, D4-tree. Wave 2 (after Wave-1 merge): D1-frontend+D2+D3+D5-frontend (one cohesive frontend task), D6 copy. Oracle gates: tsc + vitest + bun test + dashboard component tests + e2e.
