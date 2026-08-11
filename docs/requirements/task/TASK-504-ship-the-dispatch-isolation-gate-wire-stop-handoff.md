---
id: TASK-504
type: task
role: plan
title: "Ship the dispatch-isolation gate + wire stop-handoff-coverage in this repo"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
Implements spec-dispatch-isolation-must-be-enforced-by-a-gate-and, executed directly on main at the owner's instruction (no worktree, no subagent).

Payload contract measured first with a positive and a negative probe run: isolation is ABSENT from tool_input when unset, present as 'worktree' when passed. Gate denies lore-implementer/tester without it (exit 2), stays silent for read-only types and for the catch-all claude type, and reports the base diagnostic without ever blocking.

Verified LIVE end-to-end: a real lore-implementer dispatch without isolation was issued and the harness blocked it before the agent started. Unit tests prove the logic; only the live dispatch proves the hook is wired.

Also wires stop-handoff-coverage into this repo's own Stop hooks (dogfooding gap: consumers received it via lore setup, this repo did not) and declares the new asset in both enumeration rosters.
