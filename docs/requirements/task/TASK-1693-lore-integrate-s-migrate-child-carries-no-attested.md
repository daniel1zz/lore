---
id: TASK-1693
type: task
role: plan
title: "lore integrate's migrate child carries no attested run, so it is refused once writes require a known party"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"critical","category":"integrate","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"074c3b8b-bdc3-4468-9bd3-a2100b68b716"}
---

lore integrate runs workflow.integrate.migrate_command (e.g. 'bun run packages/lore/src/index.ts migrate schema --json') as a child process on the floor's corpus snapshot and, after landing, on the live corpus. The child gets the caller's environment but not the caller's --harness-run. Under spec-every-write-is-made-by-a-known-party-an-attested-agent-run every write must carry an attested run, so the child's migrate_schema write is refused and integrate stops with snapshot_migrate_failed. Because the binary that runs integrate is main's, the fix must land on main before the identity change can land.

**Expected:** integrate passes the caller's verified run to its migrate child; the migrate_schema audit row names that run; a caller with no attested run is refused before anything moves
**Actual:** integrate: migrating the floor's corpus snapshot ... failed (exit 4 ...): This process runs inside an agent harness but carries no attested run ...; the floor did not run and main is unchanged
**Repro command:** `lore integrate worktree-agent-a0dd74342106e7518 --session a979eecd-9de8-4e71-a037-a0da0d1857e0`

Reported by: agent:session-a979eecd
