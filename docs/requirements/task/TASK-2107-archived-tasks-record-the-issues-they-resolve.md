---
id: TASK-2107
type: task
role: plan
title: "Archived tasks record the issues they resolve"
status: draft
priority: medium
phase: "Recorders"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-255
plan: PLAN-255
links:
  - {id: TASK-2106, type: blocks}
---
## Objective
When a task is archived as completed (lore done, and the bulk done path), append one `task-resolves` audit row through CorpusService.appendAudit naming the task and the issues in its `extra.issues` (repo_id, number), an empty list included; a repeated archive appends nothing; an archive by deletion appends none. This is the recorder rework_rate reads (BR-1446); without it rework stays no_data source_absent (BR-1445).

Spec: spec-delivery-concurrency-and-autonomy-metrics-fed-by-live (BR-1446).

Covers: AC-DC-9

Red first: record the AC-DC-9 red run (expected-fail) before the change; keep the falsifier literal "task-resolves" in packages/lore/src/service/task-resolves.ts, and have the test assert that literal string, not the exported constant.
