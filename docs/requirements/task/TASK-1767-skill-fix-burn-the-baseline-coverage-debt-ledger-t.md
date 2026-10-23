---
id: TASK-1767
type: task
role: plan
title: "[Skill:fix] Burn the baseline-coverage debt ledger to zero (170 sites revealed by the honest census)"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Problem: DC2-19 made the site census honest (depth cut recorded as not_measured `depth-bound`, deep-first visits no longer hide shallow ones, assignment/spread bindings recorded as dynamic). It revealed 170 unique sites never mapped — 59 gap, 61 dynamic, 50 depth-bound — 3267 (leaf, site) pairs. Per the user's decision (2026-10-19) and adr-a-newly-armed-structural-oracle-enforces-from-a-baseline they were recorded as debt in scripts/baseline-coverage-debt.json so DC2-19 could land; the ledger only shrinks (a mapped or vanished row fails as stale).
Approach: burn the ledger to zero. (1) depth-bound: measure the call depth real chains need and raise MAX_CALL_DEPTH to cover them, or map each depth-bound site as owned by the leaf that reaches the cut function's sites; (2) gap/dynamic: map each site on its owning leaf to a live rule (adding a rule where behaviour has none), then owned-by rows on every other leaf that reaches it (one sites-file per leaf; the owned-by authority task removes the per-branch re-claims); (3) remove each mapped row from the ledger in the same commit; the ledger file is deleted when empty.
AC: `bun scripts/check-baseline-coverage.ts` prints `0 ledgered (debt), 0 unaccounted, 0 stale` and scripts/baseline-coverage-debt.json no longer exists; `lore baseline coverage baseline-root` exits 0.
