---
id: TASK-550
type: task
role: plan
title: "Task-scoped oracles cannot verify integration reachability: an AC passes green while its deliverable is dead code"
status: draft
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PRD-001
---
A task's oracle is naturally bounded by its declared file_anchors — it verifies 'my file behaves correctly', never 'my deliverable is referenced anywhere'. When the anchor-mutex protocol additionally forbids an agent from touching the sole registration point (to avoid overlap with a concurrent task), the wiring step ends up owned by no task at all. The mutex mechanism itself manufactures the gap.
