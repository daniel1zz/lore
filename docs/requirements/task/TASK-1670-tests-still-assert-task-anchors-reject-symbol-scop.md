---
id: TASK-1670
type: task
role: plan
title: "Tests still assert task anchors reject '#'; symbol-scoped task anchors are the approved grammar (BR-1358)"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-20
tags: []
parent: PRD-001
---
drift-check-service.test.ts 'TaskWorkflowService.addAnchors rejects an entry containing #' is red on main (1 failed, 26 passed, measured 2026-10-20). The symbol-scoped holds landed earlier (114cbd9a) and task file anchors now accept path#Symbol. SPEC-045 AC-DR-3 and AC-DR-5 were corrected the same day, and BR-1358 is proposed in spec-landing-does-the-bookkeeping-claims-start-from-main-parked. Update the test so addAnchors accepts src/a.ts#Foo and stores it normalized, while a folder anchor with a symbol (src/dir/#Foo) and a malformed name are still refused naming the anchor. Find and update any MCP lore_anchor_set test that asserts the old '#' rejection on a task.
