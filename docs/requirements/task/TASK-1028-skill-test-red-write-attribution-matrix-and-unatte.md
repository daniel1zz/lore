---
id: TASK-1028
type: task
role: plan
title: "[Skill:test] RED — write attribution matrix and unattested writes"
status: archived
priority: critical
phase: "P3 Write surfaces"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1026, type: blocks}
---
Estimate: M
Source: AC-RID-5, AC-RID-8; BR-1032, BR-1035, BR-1036
TDD-Role: red | Paired-Impl: `task-skill-implement-cli-entry-resolves-identity-once-and-wraps`
Covers: AC-RID-5, AC-RID-8, AC-RID-6 (CLI half)

Scenarios:
- Given a registered run R and `--harness-run R --by N`, When each write kind runs (create, set, link, unlink, claim, release, evidence, ac add, rule add, handoff, done), Then its audit row has harness_run R and author N, and each version row it writes has harness_run R — on SQLiteStore and on InMemoryStore.
- Given one MCP lore_batch call with three operations and harness_run R, Then all three audit rows carry R.
- Given `--harness-run` naming an unregistered id, Then the write succeeds, harness_run is NULL, and stderr has one line naming the id; Given no flag, Then the write succeeds unattested and no row contains the OS user name as author.
- Given LORE_ACTOR set, When one lore process performs three writes, Then stderr contains exactly one deprecation line (file lore-actor-deprecation.bun.test.ts).

AC:
- Given the two files, When each runs before `task-skill-implement-cli-entry-resolves-identity-once-and-wraps`, Then they fail on missing stamping, recorded with `lore evidence --result expected-fail --output-tail-file`.
