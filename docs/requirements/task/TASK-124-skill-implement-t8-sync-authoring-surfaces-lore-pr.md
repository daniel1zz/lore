---
id: TASK-124
type: task
role: plan
title: "[Skill:implement] T8 Sync authoring surfaces: lore-product skill asset + root CLAUDE.md"
status: archived
priority: medium
phase: "Phase 4: Corpus migration & close-out"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-031
plan: PLAN-031
links:
  - {id: TASK-123, type: blocks}
---
Estimate: S
Approach: update the vendored lore-product skill asset's PRD-update step to the SPEC-080 authoring flow (domain doc first, then `lore outline set`; never wholesale body edit) + root CLAUDE.md governance note; keep assets-SSOT conformance (repo assets/ tree is the SSOT; embedded-manifest freshness oracle must stay green).
Source: SPEC-080 Data Flow (authoring); SPEC-076 assets conformance
Dimensions: D-FUNC
Scope-Alt: user-global ~/.claude skill copies converge via `lore setup` on next run — not edited directly here.
Covers: (supporting task — enables G3 discipline; no direct spec AC)

AC:
- Given the updated skill asset, When `node scripts/embed-assets-manifest.mjs --check`, Then exit 0 (canonical freshness oracle, exit 3 = stale).
- Given the skill text, When `grep -q 'lore outline set' assets/skills/lore-product/SKILL.md && grep -q 'lore create spec --kind domain-overview' assets/skills/lore-product/SKILL.md; echo $?`, Then 0; and the wholesale root-PRD `lore set` content-edit ban is present (grep 'wholesale' hits >= 1).
- Root CLAUDE.md carries a one-line SPEC-080 entry per repo convention (implementation-status list).
