---
id: PLAN-129
type: plan
role: plan
title: "Land multi-session concurrency P1: queryable ownership of worktrees, branches and sessions"
status: active
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: SPEC-142
phases:
  - {name: "binding", description: "Write-side ownership facts: claim.branch, Lore-Session commit trailer, populated active_sessions[].branches"}
  - {name: "surface", description: "Read surfaces: lore territory --json and lore session list|show with probed liveness"}
  - {name: "replay", description: "Replay oracle proving the 2026-08-11 diagnosis is reproducible through lore alone, plus the merge-protocol doc change"}
---
## Goal

Deliver P1 of the multi-session concurrency spec: make ownership queryable from
both truth sources, so that "which branch, worktree and lock belongs to which
session" is answered by a lore command instead of inferred from git topology.

P1 is deliberately additive and read-only at the surface. It blocks nothing and
refuses nothing. It exists because P2 (the checkout lease) and P3 (per-resource
locks) cannot map a lock holder back to the git side without it.

## Why the tasks are serial

The three tasks form a dependency chain, not a parallel fan-out, and the plan
says so rather than pretending otherwise:

- `binding` writes the ownership facts.
- `surface` reads them; it has nothing to read until `binding` lands.
- `replay` proves the facts are sufficient to reproduce a real diagnosis; it
  needs both.

The two read surfaces (`lore territory`, `lore session`) are one task rather than
two because both must register in `adapters/cli/index.ts`, and a task pair whose
anchors collide on the registry would be refused by the anchor mutex anyway.

## Phases

### Phase `binding`

Write-side ownership. `TaskClaim` gains `branch`, captured from the caller's
worktree at claim time; commits made under a claim carry the `Lore-Session`
trailer; `active_sessions[].branches` is populated instead of always empty.

Covers AC-OWN-2, AC-OWN-3, AC-OWN-4.

The capability and its production wiring are the same acceptance unit: it is not
enough for a `branch` field to exist on the schema — `lore claim` must write it
and `lore bootstrap` must surface it, and the ACs assert the live call sites.

### Phase `surface`

Read-side. `lore territory --json` partitions every worktree and branch
corpus-wide into mine / foreign / unowned / unmeasured, naming each foreign
holder. `lore session list|show` joins corpus claims with process liveness probed
from pid plus process start time.

Covers AC-OWN-1, AC-OWN-5.

Registration in the CLI registry is part of the same task, because the module
contract states the registry is the only true command count — a command file
without a registry entry is not a command.

### Phase `replay`

Proof of sufficiency. An integration oracle reconstructs the four facts the
2026-08-11 diagnosis required, using lore invocations only, and the merge
protocol documentation moves from "scan `git branch -a` unconditionally" to
"partition with `lore territory`, act on mine and unowned".

Covers AC-REPLAY-1.

This phase is where the plan can fail honestly: if the replay cannot reach a fact
without falling back to raw git, P1 is incomplete regardless of how many unit
tests are green.

## Out of scope

P2 (checkout lease), P3 (per-resource locks, binary content addressing) and P4
(mailbox) are declared in the spec's migration plan and are not in this plan.
Their acceptance criteria are intentionally not yet declared as structured ACs:
pinning an oracle to a file path that does not exist and whose shape is being
guessed is how an AC ends up with no runnable oracle at all. They are declared
once P1 establishes the real file layout.
