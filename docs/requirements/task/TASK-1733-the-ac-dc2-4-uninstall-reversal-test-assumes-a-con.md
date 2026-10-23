---
id: TASK-1733
type: task
role: plan
title: "The AC-DC2-4 uninstall-reversal test assumes a context block that init no longer writes"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Problem: packages/lore/tests/integration/dc2-setup-project-uninstall-reversal.bun.test.ts is red on main (measured on 79571711 and 49278da8): both AC-DC2-4 cases throw 'fixture assumption broken: config.yaml has no context: block' (line ~66) — a lore init/setup change removed the context: block the fixture edits. It blocks lore done of any task anchoring the file.

AC: bun run test:file packages/lore/tests/integration/dc2-setup-project-uninstall-reversal.bun.test.ts exits 0 (2 passed), still asserting that project uninstall reverses everything project setup wrote (spec-defect-clusters-round-2-part-a-sessions-seats-setup-init AC-DC2-4); the fixture derives its edit target from what init writes today instead of assuming a context: block.
