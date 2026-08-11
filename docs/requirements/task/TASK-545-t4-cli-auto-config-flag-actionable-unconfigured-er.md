---
id: TASK-545
type: task
role: plan
title: "[T4] CLI: --auto-config flag + actionable unconfigured error"
status: archived
priority: medium
phase: "GREEN"
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-105
plan: PLAN-105
links:
  - {id: TASK-546, type: blocks}
---
Add the --auto-config flag to lore report-issue and wire it to T3's provisionFeedbackUpstream(). Replace the current unconfigured-error message (which instructs hand-editing YAML with a corpus_path the operator must discover) with one that names the literal --auto-config command; on a TTY it MAY additionally offer an interactive confirm, but the non-TTY path must never block. Depends on T3's exported signatures — do not re-implement resolution here. Satisfies AC-OOB-1 and the CLI half of AC-OOB-2.
