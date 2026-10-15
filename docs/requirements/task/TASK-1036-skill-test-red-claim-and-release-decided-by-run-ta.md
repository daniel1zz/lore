---
id: TASK-1036
type: task
role: plan
title: "[Skill:test] RED — claim and release decided by run, task AND phase paths"
status: archived
priority: critical
phase: "P2 Runs and claims"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1035, type: blocks}
---
Estimate: M
Source: AC-RID-12..14; BR-1040..BR-1043
TDD-Role: red | Paired-Impl: `task-skill-implement-claim-and-release-by-run-in`
Covers: AC-RID-12, AC-RID-13, AC-RID-14

Scenarios — each parameterised over the task claim path AND the phase claim path:
- Given run R1 holds a fresh claim with by `a`, When run R2 claims with by `a`, Then exit is the claim-conflict code and the message names R1; When an unattested caller claims, Then refused naming R1; When R1 claims again, Then the lease refreshes.
- Given R1 holds, When R2 claims with --steal, Then history names R1 previous and R2 new.
- Given a legacy fresh claim (no harness_run) by `a`, When a run claims with by `a`, Then it refreshes; with by `b`, Then refused; after the legacy lease is stale, Then run rules apply.
- Given R1 holds, When R2 releases without --force, Then refused naming R1; with --force, Then history names both; When R1 releases, Then success and its run is recorded.
- Falsifier check: replacing the run comparison with a by comparison in either service turns the R1/R2 case red.

AC:
- Given the three files, When each runs before `task-skill-implement-claim-and-release-by-run-in`, Then the run-based cases fail on current by-based behaviour (not on a test bug), recorded with `lore evidence --result expected-fail --output-tail-file`.
