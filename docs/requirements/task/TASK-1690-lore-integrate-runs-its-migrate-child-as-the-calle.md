---
id: TASK-1690
type: task
role: plan
title: "lore integrate runs its migrate child as the caller's attested run"
status: archived
priority: critical
created: 2026-10-20
updated: 2026-10-26
tags: []
parent: PRD-001
---
Prerequisite for landing spec-every-write-is-made-by-a-known-party-an-attested-agent-run: integrate runs workflow.integrate.migrate_command as a child on the floor snapshot and on the live corpus; once identity lands, a write with no attested run is refused, so a child without the caller's run fails (observed: snapshot_migrate_failed on worktree-agent-a0dd74342106e7518). The integrate that lands identity is main's binary, so this change must be on main first, built against main's current identity API (which already accepts --harness-run). End state: integrate appends --harness-run <the caller's verified run> to the migrate invocation in the snapshot step, the live step and the already-integrated path; a run id is validated as shell-safe; with no attested caller run and a migrate_command configured, integrate refuses before anything moves. AC: test that the live migrate_schema audit row names the caller's run; refusal with no run leaves main and corpus unchanged.
