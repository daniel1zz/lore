---
id: PLAN-208
type: plan
role: plan
title: "Ambient state read once at the entry: owned-only prune, user-state guard, rooted writes, one Invocation"
status: approved
priority: high
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: SPEC-198
phases:
  - {name: "P1 stop the bleeding", description: "Owned-only prune + user-state guard: the destructive outcome becomes impossible"}
  - {name: "P2 contract", description: "Rooted write port + ambient-read check with ratchet ledger"}
  - {name: "P3 entry", description: "One resolved Invocation delivered to every command"}
  - {name: "P4 migration", description: "Every ambient read moved behind the entry; ledger to zero"}
  - {name: "P5 test runner", description: "In-process runner builds an Invocation; serial queue removed"}
---
## Overview

Implements spec-ambient-state-is-read-once-at-the-entry-owned-only-prune (decision: adr-ambient-process-state-is-read-once-at-the-entry-one). Trigger: on 2026-10-17 an in-process test deleted the developer's real `~/.claude/rules/lore-user-*.md`; reproduced 2026-10-18.

Order is by blast radius: first make the destructive outcome impossible (owned-only prune, user-state guard), then the contract (rooted writes, ambient-read check with a ratchet ledger), then the entry, then the migration to an empty ledger, and only then the test helper drops its serial queue.

| T | Phase | Task | ACs |
|---|---|---|---|
| IV-1 | P1 stop the bleeding | Owned-only rules prune with source identity + hash in the managed header; legacy adopt/keep; absorbs task-gh-1343388703-264 | AC-IV-1, AC-IV-2 |
| IV-2 | P1 stop the bleeding | User-level state guard (lore-owned paths of the starting HOME) in the vitest setup | AC-IV-3 |
| IV-3 | P2 contract | Rooted write port (core contract + real + in-memory), Result on write/delete, callers propagate | AC-IV-4 |
| IV-4 | P2 contract | `check:ambient-reads` script + ratchet ledger seeded from today's counts | AC-IV-6 |
| IV-5 | P3 entry | `Invocation` type (core) + resolver (core/node); `index.ts`/`runCli(inv)`; `wrapDefault` delivery; delete `invocation-identity.ts` | AC-IV-5 |
| IV-6 | P4 migration | Service, flow and core layer: remove ambient reads (setup-service, feed-flow, verify-runner-service, config-node, session-trail-node, …); lower the ledger | — |
| IV-7 | P4 migration | Adapter commands batch A (status, setup, gate, context, mcp/tools, loader, utils, dashboard); lower the ledger | — |
| IV-8 | P4 migration | Remaining adapter files; ledger empty; delete `currentHomeDir` | AC-IV-7, AC-IV-9 |
| IV-9 | P5 test runner | `runLoreInProcess` builds an Invocation; no process.env/chdir mutation; no serial queue | AC-IV-8 |

Dependencies: IV-1 and IV-2 independent. IV-3 and IV-4 independent of each other, after P1. IV-5 after IV-3 (Invocation carries the rooted fs factory). IV-6 → IV-7 → IV-8 serial (shared ledger file). IV-9 only after AC-IV-7 is green on main.

Spec amendments owned by the orchestrator (not implementers): spec-context-fragments-config-driven-layered-rule-injection D15(c) + AC-CF-6 after IV-1 merges; spec-context-verb-family-two-zone-claude-md-anatomy-lore D9 after IV-3 merges; plan-test-governance is told that TG-15 / AC-TG-11 wall time must be re-measured after IV-9.

## Invariants

- INV-1: no oracle is weakened to make a phase pass; every AC goes red once against the unfixed code (declared falsifier added after landing).
- INV-2: no test or smoke run writes the real HOME; until IV-2 lands, implementers run user-scope tests only with a scratch starting HOME (`HOME=<mkdtemp> bunx --bun vitest run …`).
- INV-3: the ambient-read ledger only goes down; raising an entry is refused by the check itself.
- INV-4: fail safe: when ownership, root or source cannot be proven, the code keeps the file and reports it; it never deletes on doubt.
- INV-5: shipped behaviour (binary output, assets/) is verified from a fresh consumer install path, per CLAUDE.md dogfooding.

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Serial queue removed while an ambient read survives → intermittent cross-test leaks | H | IV-9 gated on `check:ambient-reads --ledger-empty` exit 0 on main, not on a shrinking ledger |
| Legacy rules files never pruned after upgrade | M | D1 adopts selected byte-equal legacy files; others reported `legacy_skip` by name |
| Port contract change (Result on write) ripples through many callers | M | IV-3 owns all FsWritePort callers; typecheck is the oracle; no behaviour change besides the refusal |
| citty `run()` cannot take arguments | M | Delivery through the existing `wrapDefault` seam in adapters/cli/index.ts; AC-IV-5 enumerates the registry so a missed command fails |
| Concurrent sessions edit the same adapter files during P4 | M | `lore ready --json` anchor_conflicts checked before each dispatch; batches sized by file ownership |
| User-state guard false positives from live Claude Code sessions | M | Guard fingerprints only lore-owned paths (D2), never all of ~/.claude |
