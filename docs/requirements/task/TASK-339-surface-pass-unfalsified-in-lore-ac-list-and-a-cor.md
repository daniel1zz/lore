---
id: TASK-339
type: task
role: plan
title: "Surface pass_unfalsified in lore ac list and a corpus-wide count in lore status, and wire the unclaimed-oracle check"
status: archived
priority: high
phase: "surfacing"
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PLAN-081
plan: PLAN-081
---
Per the governing spec M1-surfacing + M3-wiring. BLOCKED on both mechanisms tasks — do not start until their branches are merged to main.

Three surfaces:
1. `lore ac list --json` emits the integer `falsified` field and the coverage state string per criterion.
2. `lore ac list` human table carries a marker for a `pass_unfalsified` criterion, absent for a falsified one.
3. `lore status --json` reports a corpus-wide count of `pass_unfalsified` criteria, and invokes the unclaimed-oracle check from the mechanisms phase.

⛔ Consume `deriveAcCoverageState` — do NOT re-derive the state or re-count `falsified` adapter-side. That derivation is the ONE precedence site both `task-feed-wiring.ts` and `commands/ac.ts`'s badge already share; a second copy is the SSOT fork this codebase has been bitten by before.
⛔ Report-only. `lore status`'s exit code MUST stay unchanged by a nonzero `pass_unfalsified` count — 574 of 700 existing criteria are in that state and are grandfathered by the spec's written exemption. An AC asserting the count without asserting the exit code is unchanged would pass against a gating implementation.
⛔ The back-catalogue is NOT to be cleaned up by authoring red runs.
