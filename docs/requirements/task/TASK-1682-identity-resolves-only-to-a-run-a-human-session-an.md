---
id: TASK-1682
type: task
role: plan
title: "Identity resolves only to a run, a human session, an HTTP key or a dashboard login; a write with none is refused"
status: archived
priority: high
phase: "P1"
created: 2026-10-19
updated: 2026-10-20
tags: []
parent: PLAN-221
plan: PLAN-221
---
Implements end state items 1-3, 5, 6 of spec-every-write-is-made-by-a-known-party-an-attested-agent-run (BR-1055, BR-1032, BR-1350, BR-1351): resolver with only run/human/api-key/dashboard sources; lore session start --human / end / show with a token file in the user's lore state dir keyed by checkout path (only its hash in the registry; no host or user name read); every integration lore setup installs declares its harness marker (Claude Code: CLAUDECODE=1) and a process carrying it never uses a human session; refusal exit 4 naming lore session start --human and lore setup; unregistered harness run refused; MCP without harness_run refused; HTTP bearer key and dashboard login register reusable runs; status and attribution reports count by run, human, api-key, dashboard (no 'unattested'). Shared test fixtures must give every spawned lore a run or human session.
