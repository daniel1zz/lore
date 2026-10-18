---
id: TASK-1582
type: task
role: plan
title: "[Skill:refactor] IV-8a remaining CLI command and helper ambient reads; delete the invocation-scope bridge"
status: draft
priority: medium
phase: "P4 migration"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-208
plan: PLAN-208
links:
  - {id: TASK-1560, type: blocks}
---
Per spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D5, split from IV-8 on 2026-10-18 (78 sites / 42 files was too large for one run). Scope: every ledgered file under packages/lore/src/adapters/cli/ (fragments 7, baseline 5, utils 4 incl. resolveActor() and currentRetryCommandLine()/formatError, evidence 3, worktree 3, editor 3, ac 2, bootstrap 2, governance 2, review 2, corpus-resolution 2, and the 1-site commands/helpers) to 0 and out of the ledger. Delete packages/lore/src/adapters/cli/invocation-scope.ts (the IV-5 AsyncLocalStorage bridge): every reader takes ctx.inv explicitly; grep invocationInScope returns nothing. resolveActor gets env/cwd from callers (ctx.inv); formatError gets argv/execPath passed in or the retry line is computed at the entry. Ratchet: total falls, no file rises.
