---
id: TASK-592
type: task
role: plan
title: "T2 wire planPromoteReachabilityAdvisory into live enforcement path + CLI stderr render + e2e"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-114
plan: PLAN-114
---
Post-merge live probe found M1 inert in production: planPromoteReachabilityAdvisory exists in checkpoint-registry.ts with unit tests, but has ZERO consumers on the real approve path (grep gate-enforcer/review-service/cli approve: no references) — writer without reader, silent no-op. Wire it: GateEnforcer surfaces advisories alongside its allow verdict for plan-promote; ReviewService.approve returns them; CLI approve renders each to stderr (never affects exit code). Satisfy AC-VRW-5 (e2e file path contractual: packages/lore/tests/unit/adapters/cli-plan-promote-advisory.bun.test.ts, spawns dist/lore — run bun run build first). D1 still binding: advisory NEVER changes verdict/exit.
