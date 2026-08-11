---
id: TASK-483
type: task
role: plan
title: "T3 exercised_acs rename, DeclaredScopeCoverage, and the demoted per-task floor"
status: archived
priority: medium
phase: "Facts and gate"
created: 2026-07-31
updated: 2026-08-01
tags: []
parent: PLAN-095
plan: PLAN-095
---
## Task

Covers AC-VS-6 and AC-VS-7. Rename ClaimedAcCoverage.claimed_acs to exercised_acs; add DeclaredScopeCoverage (declared_acs, unattested_acs, scope_undeclared, meets_coverage). When scope_undeclared the coverage conjunct returns notApplicable with reason 'scope-undeclared' — never ok. Demote attestationFloor condition 1 to a reported zero_attested_tasks fact, keeping its computation. No fallback substituting one fact for the other.
