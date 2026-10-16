---
id: TASK-1476
type: task
role: plan
title: "[Skill:implement] R0-8 anchor or ledger every unanchored live spec (#32)"
status: archived
priority: medium
phase: "Phase 1: fixes"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-200
plan: PLAN-200
links:
  - {id: TASK-1477, type: blocks}
---
Estimate: M
Resolves: task-gh-1343388703-32
Approach: anchor-coverage-ratchet / stale-exemption fail because live specs have neither code anchors nor a row in scripts/anchor-coverage-ledger.json. For each spec the checker names: if it governs code, `lore anchor add <spec> <path[#Symbol]>` for its real implementation files (verify with lore status --check-drift); if it governs no code (backlog/process specs, e.g. the defect-backlog and upkeep specs), add a ledger row with a >=20-char reason. Specs created by another live session (session-trail): anchor only if their code is merged; otherwise ledger row.
Covers: AC-R0-1
AC:
- anchor-coverage-ratchet.test.ts and anchor-coverage-stale-exemption.test.ts pass on main; lore status --check-drift exits 0
