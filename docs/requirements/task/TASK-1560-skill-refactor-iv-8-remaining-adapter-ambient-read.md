---
id: TASK-1560
type: task
role: plan
title: "[Skill:refactor] IV-8b ports, store, app, ai and http ambient reads; ledger empty; delete currentHomeDir"
status: draft
priority: medium
phase: "P4 migration"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-208
plan: PLAN-208
links:
  - {id: TASK-1575, type: blocks}
---
> ⚠ INVALIDATED 2026-10-18T14:14:50.294Z — superseded by spec-process-state-end-state-one-invocation-per-entry-returned; Superseded by spec-process-state-end-state-one-invocation-per-entry-returned (user decision 2026-10-18: drop the scanner and build the end state directly; no ledger, no phase gate).

Per spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D5 (IV-8a covers adapters/cli and deletes the invocation-scope bridge). Scope: app.ts ambientFromProcess fallback (4) — production and scripts pass an ambient; home-dir-node.ts (delete it and its export; AC-IV-9); adapters/http/machine-auth.ts 3; real-fs-probe 2; real-human-channel-port 2; session-heartbeat-port 2; ai/claude-cli-provider 2; ai/registry 1; store/foreign-schema-guard 2; store/turso-store 1; store/write-context-store 1 (store layer must not read the process: take actor from the write context, fail loud when absent); process-table-port 1; real-mcp-registrar 1; real-process-scan-port 1; os-username.ts 1 (thread an OS username via the Invocation or the entry); service/worktree-cleanup.ts 1. Leaf IO ports receive values at construction from app composition, which takes them from the Invocation. End state: AC-IV-7 (check:ambient-reads --ledger-empty exits 0) and AC-IV-9 (no currentHomeDir reference) green.
