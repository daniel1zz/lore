---
id: TASK-1949
type: task
role: plan
title: "Module docs and shipped guidance name start/finish/dispatch/land and drop close tasks and declare-no-new-tests"
status: deprecated
priority: medium
phase: "P4 Shipped text"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-247
plan: PLAN-247
---
Covers: none (documentation; no AC)
TDD-Role: none
Approach: update the two module docs: the cli adapter doc line for claim/release/evidence/done now also lists start, finish, dispatch, land and drops --declare-no-new-tests; the service doc names done-contract-service, land-service, dispatch-service and execution-log-service. Keep both within their size budget (the claude-md budget check is the oracle).
Done when: lore status --check-claude-md passes and a search of both files for declare-no-new-tests and close task returns nothing.
