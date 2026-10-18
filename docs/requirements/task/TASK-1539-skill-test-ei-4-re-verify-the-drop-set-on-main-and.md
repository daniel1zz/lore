---
id: TASK-1539
type: task
role: plan
title: "[Skill:test] EI-4 re-verify the drop set on main and triage every remaining red"
status: draft
priority: high
phase: "Phase 1: rule and re-verification"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-203
plan: PLAN-203
---
Estimate: L
Approach: Orchestrator-run on main, no merges in flight. Before EI-1 merges: dump `lore ac list --json` for every live spec (before). After EI-1 and EI-2 merge + build: dump again (after), generate scripts/evidence-identity-drop-set.json with EI-3's generator, commit it. First measure the mechanism on 3 dropped ACs from different (incl. archived) plans: can `lore verify <plan> --task <t> --ac <id> --yes` target them? If not, STOP and report the gap (no bypass). Then re-verify per spec, serially. Each remaining red: fix now if simple (≤2 files, existing oracle), else lore ac set --correction with the original command and failure recorded, else a task in the owning plan (slug written into the drop-set row). bun run test once at the end; lore verify AC-EI-3.
Source: spec-evidence-identity-an-attested-row-counts-only-for-the AC-EI-3
AC: bun scripts/check-evidence-identity-drop-set.ts exits 0; bun run test exits 0.
