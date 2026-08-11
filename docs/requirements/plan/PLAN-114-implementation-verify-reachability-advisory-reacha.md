---
id: PLAN-114
type: plan
role: plan
title: "Implementation — verify reachability advisory, reachability-aware feeding pack, exemption kind"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: SPEC-100
---
# Implementation plan

Single-spec plan (deliberately parented under spec-verify-reachability-plan-promote-early-warning so lore verify stays reachable — applying the retro lesson this spec mechanizes). One task, one implementer.

## Approach
M1+M2 share one derivation (verifyReachability in gate-predicates.ts, consumed by plan-promote advisory and feedAttestationFloor branch). M3 adds attestationExemptKindSchema to @lore/core schemas.ts and tightens checkPlanClose. Tests per the 4 declared script ACs; oracle policy: scoped in worktree, lore verify (attested) + full suite on main after merge.
