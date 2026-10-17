---
id: TASK-1534
type: task
role: plan
title: "[Skill:refactor] CT-6b one stamp-verdict derivation in core; drop the tallyStampReadings allowlist row"
status: archived
priority: medium
phase: "Phase 2: implement"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-202
plan: PLAN-202
links:
  - {id: TASK-1526, type: blocks}
---
Estimate: S
Approach: CT-6's scan (merge after e7017bb8) passes only with 2 allowlist entries on the stamp axis. One is a real second derivation: `tallyStampReadings` in packages/core/src/stamp-binding.ts switches on `reading.stamp` with 7 accumulators to feed the evidence panel, because @lore/core cannot import `readStampVerdict` (gate-predicates.ts, packages/lore). Move `readStampVerdict` (with its exhaustive `never` switch) into @lore/core next to `readStampedRadius` / `computeStampVerdictDistribution`, re-export it from gate-predicates.ts, make `tallyStampReadings` consume it (or delete it in favour of the one distribution predicate), and remove that allowlist row so the scan enforces it. The second row (`reportImpact` in state-binding-service.ts, a pre-arming prediction) stays allowlisted with its reason. Red-first: re-introduce a raw switch → scan exits non-zero.
Source: spec-corpus-truthfulness-a-verdict-must-carry-the-state-it AC-CT-7/AC-CT-10 (one derivation)
AC: scan allowlist has exactly one row (reportImpact); check:ac-state-renderers and the scan pass.
