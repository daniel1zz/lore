---
id: TASK-2109
type: task
role: plan
title: "Refuse current-values prose in baseline bodies"
status: draft
priority: medium
phase: "P3 Refusal, integrity, export and judge"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-261
plan: PLAN-261
links:
  - {id: TASK-2063, type: blocks}
---
Covers: AC-CV-3
Approach: on create and revision of a baseline node, the literal 'if (hasCurrentValuesHeading(nextContent)) return refuseCurrentValuesProse(' (falsifier) refuses with exit 4 naming lore baseline value add; other doc types untouched. Gates run in the service layer, so CLI, MCP and HTTP refuse identically (repo invariant). Note for the orchestrator: this lands together with the P4 import in the same release so the 91 bodies are migrated right after build.
