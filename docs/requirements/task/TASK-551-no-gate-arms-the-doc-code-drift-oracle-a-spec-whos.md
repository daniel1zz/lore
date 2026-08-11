---
id: TASK-551
type: task
role: plan
title: "No gate arms the doc-code drift oracle: a spec whose implementation merged with zero code_anchors passes every existing gate"
status: draft
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PRD-001
---
spec-create / spec-promote / plan-promote / task-claim all have deterministic gates. The CLOSE-phase step that arms the drift oracle — lore anchor add <spec> <impl-path> — has none. It is prompt-only discipline, so it is silently skipped exactly when a session feels finished (code merged, tests green).
