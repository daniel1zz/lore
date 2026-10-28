---
id: TASK-1643
type: task
role: plan
title: "Local dashboard writes are made by the checkout's registered human session, never the literal admin"
status: archived
priority: high
created: 2026-10-20
updated: 2026-10-26
tags: []
parent: PRD-001
---
Resolves #324. ensureLocalApiKey (packages/lore/src/adapters/cli/local-key.ts) creates the dashboard-local key with owner 'admin', and a cookie session is named by its key owner (request-identity.ts partyOfActor), so every local dashboard write is recorded as 'admin'. Under the known-party rule (spec-every-write-is-made-by-a-known-party-an-attested-agent-run, BR-1055/BR-1350) a write is made by a known party. End state: the local dashboard writes as the person whose human session is open in this checkout (the same token lookup lore session uses); with no open human session, dashboard reads work and every write is refused with exit-equivalent 422/403 naming 'lore session start --human <name>'; no literal owner name remains. AC: multi-project-write-parity 'records the same person' passes with a human session opened in its fixture and asserts the actor is that person; a unit/integration test shows a write without a human session is refused naming the command; grep: no '"admin"' owner in local-key.ts.
