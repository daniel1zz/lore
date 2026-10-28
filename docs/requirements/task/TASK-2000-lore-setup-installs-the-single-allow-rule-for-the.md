---
id: TASK-2000
type: task
role: plan
title: "lore setup installs the single allow rule for the export line; uninstall removes it"
status: approved
priority: high
phase: "P4 End to end and distribution"
created: 2026-10-26
updated: 2026-10-27
tags: []
parent: PLAN-253
plan: PLAN-253
links:
  - {id: TASK-1996, type: blocks}
---
Covers: AC-RV-8 (permission half; the e2e task covers the hook half)
Approach: mergeSettings adds exactly one permissions.allow entry matching the export line and nothing else; it is recorded in the setup manifest so uninstall removes it (manifest-authoritative installer). The exact rule syntax Claude Code matches for an 'export NAME=value' line is not documented: try the candidate forms in a live session first (AC-RV-12). If no form matches, stop and report to the user; never fall back to a hook allow decision (BR-1218).
