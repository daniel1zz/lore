---
id: TASK-1666
type: task
role: plan
title: "lb-definition-of-done writes config.yaml by append, red on main after init seeds the template"
status: draft
priority: high
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
Red on main 2026-10-20: since DC2-5, lore init seeds the full config template, and the test appends a duplicate key at line 71 ('Map keys must be unique at line 25'). It also reads assets/project/lore-config-template.yaml without declaring it. The BR-926 scan (test-config-writers-scan.test.ts) lists it. Fix: patchLoreConfig plus an @reads declaration.
