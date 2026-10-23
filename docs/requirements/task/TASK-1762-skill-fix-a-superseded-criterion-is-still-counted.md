---
id: TASK-1762
type: task
role: plan
title: "[Skill:fix] A superseded criterion is still counted by coverage and the done floor, and can be superseded only from the CLI"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Problem (found by DC2-15, landed 2026-10-19 as f34440c5): a superseded criterion is skipped by `lore verify`, but `computeAcCoverage` (packages/core/src/acceptance.ts) still counts it, so `lore ac list` coverage can show a superseded criterion as unverified, and the `lore done` declared-ac_scope floor may still demand evidence for it — the supersession is honoured by one reader and not the others. Also `lore ac supersede` exists only on the CLI (no MCP tool / HTTP route), unlike other AC verbs.
Approach: one predicate (`isAcSuperseded`) consumed by every coverage/floor reader: coverage reports a superseded criterion as `superseded` (its own state, never unverified and never pass); the done floor treats a superseded ac_scope id as satisfied-by-supersession and says so. Add the MCP tool (same service method) so all surfaces can supersede.
AC: throwaway corpus: after superseding AC-1, `lore ac list S --json` coverage for AC-1 reads `superseded`; a task whose ac_scope is [AC-1] with no evidence for it passes the done ac_scope floor with a line naming the supersession; the MCP `lore_ac_supersede` tool produces the same stored mark as the CLI. Runner-produced red.
