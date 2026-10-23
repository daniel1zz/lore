---
id: PLAN-240
type: plan
role: plan
title: "Process state end state"
status: approved
priority: high
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: SPEC-204
phases:
  - {name: "P1", description: "one property per task"}
---
## Overview

Implements spec-process-state-end-state-one-invocation-per-entry-returned. Each task lands one finished property of the end state; none introduces an intermediate state, ledger or temporary seam. Tasks are split by concern so they can run in parallel where files do not overlap.

| T | Task | Properties | ACs |
|---|---|---|---|
| ES-A | Ownership by intact fingerprint: header `fragment+hash` only, outcomes created/updated/unchanged/diverged_skip/pruned, user = project scope; remove source identity, foreign_skip, legacy_skip | Goal 3 | AC-ES-3 |
| ES-B | Invocation at every entry (CLI, MCP, HTTP start, scripts), `user` in Invocation, no fallback anywhere (app, store actor, ports, os-username, loadLoreApp without inv), `currentHomeDir` gone, retry line from inv.argv; delete check:ambient-reads, its ledger and tests, the invocation-node export guard test | Goal 1, D5 | AC-ES-4 (unchanged port) |
| ES-C | runCli returns the exit code and only the entry calls process.exit; runLoreInProcess builds an Invocation, assigns no global, no queue; test process runs with a throwaway HOME; delete the user-state snapshot guard | Goals 2 and 5 | AC-ES-1, AC-ES-2 |

ES-A and ES-B run in parallel (disjoint files). ES-C starts after ES-B merges because its isolation test is only meaningful once no code below an entry reads process state.

After merge the orchestrator lands the BR-1176 change, rewrites AS-26/AS-27 target parts to the end state, retires AD-14/AD-15, deprecates spec-ambient-state-is-read-once-at-the-entry-owned-only-prune and its plan.

## Invariants

- INV-1: no new check script, scanner, ledger, allowlist or fallback.
- INV-2: behaviour visible to users is unchanged except where the spec says so (hand-edited rules files kept; interim `source=` files kept and reported).

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| A process read survives below an entry | M | AC-ES-1 overlapping runs with different homes; reviewers grep the diff for process.* below entries |
| ES-C touches every command's exit path | M | exit mapping stays in exitCode(); AC-ES-2 covers success, refusal and usage error |
| Throwaway HOME breaks tools needing the real home (bun cache, git config) | M | ES-C measures and sets only what the test process needs (e.g. BUN_INSTALL_CACHE_DIR, GIT_CONFIG_GLOBAL) explicitly, and reports each |
