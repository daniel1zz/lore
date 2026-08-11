---
id: TASK-625
type: task
role: plan
title: "[Skill:design] author claude-md-contract.md prose asset (no numbers)"
status: archived
priority: medium
phase: "Phase 1: Contracts & Content"
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-116
plan: PLAN-116
links:
  - {id: TASK-619, type: blocks}
  - {id: TASK-617, type: blocks}
  - {id: TASK-611, type: blocks}
---
Estimate: S
Approach: author assets/governance/claude-md-contract.md per spec Overview two-level norm: target (official <200 lines/file, [S] code.claude.com/docs/en/memory.md), content in/out boundary table, root five-section + module-file taxonomy (aligned with lore-init-context), index-entry contract (one line per item). ZERO numeric ceiling values — prose cites `lore status --check-claude-md` for effective values (D1 anti-dual-write).
Source: spec §Overview/Goal, §D1/D5; design preview doc §4 rules
Dimensions: D-DOC
Scope-Alt: taxonomy examples can be trimmed to headings-only if the asset approaches its own target size
Covers: AC-CMC-2 (content half)

AC:
- Given the asset file, When grepped for any of 300/30720/200-as-ceiling/16384, Then zero matches (numbers live in config.ts only)
- Given the asset, When read, Then it contains: in/out boundary table, root+module taxonomy, index-entry contract, target-vs-ceiling distinction, and the literal command `lore status --check-claude-md`
- Integration: file lands under assets/governance/ so the topic registry (governance verb task) can resolve it by path
