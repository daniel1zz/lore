---
id: TASK-1560
type: task
role: plan
title: "[Skill:refactor] IV-8 remaining adapter ambient reads; ledger empty; delete currentHomeDir"
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
Per spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D5: every remaining ledger entry to zero, then delete the ledger entries, home-dir-node.ts and its export. AC-IV-7 and AC-IV-9 green. Also delete the IV-5 transitional bridge packages/lore/src/adapters/cli/invocation-scope.ts (AsyncLocalStorage read by loadLoreApp, gate bypass audit, stash, human-channel port): every reader takes ctx.inv explicitly, so grep invocationInScope returns nothing. Includes the 6 sites ledgered after the ratchet (commands/run.ts, process-table-port.ts, real-human-channel-port.ts; status.ts is IV-7).
