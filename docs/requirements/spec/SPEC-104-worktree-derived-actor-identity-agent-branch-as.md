---
id: SPEC-104
type: spec
role: spec
title: "Worktree-derived actor identity — agent:<branch> as deterministic default"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PRD-001
links:
  - {id: SPEC-90, type: relates-to}
  - {id: SPEC-093, type: implements}
---
## Overview/Goal

The anchor-overlap gate (SPEC-042 noAnchorOverlap) is only as strong as actor discipline: when every dispatch forgets `LORE_ACTOR`, all claims fall to the same OS username and the gate can never fire — today that failure earns one stderr warning (resolveActor os-fallback advisory, SPEC-035 hotfix). Cross-corpus evidence (retro 2026-07-28): babyai runs 50+ agent worktrees with ZERO lore claims; guyin holds discipline only through per-dispatch vigilance. Upstream: `knowledge-grill-review-2026-07-28-seven-product-direction` decision 5.

Goal: convert the "everyone falls to the same OS username" failure class from a discipline problem into an impossible event — when no explicit identity is given and the process runs inside a linked git worktree, the actor derives deterministically as `agent:<branch>`.

## Scope

IN: a new resolution tier in `resolveActorWithSource` (packages/lore/src/adapters/cli/utils.ts): explicit `--by` > `$LORE_ACTOR` > **worktree-derived `agent:<branch>`** > OS username. Worktree detection without spawning git: cwd-upward search for a `.git` regular FILE (linked worktrees have `gitdir: <path>` files; the main checkout has a `.git` DIRECTORY), then read the worktree's HEAD via the gitdir pointer; `refs/heads/<branch>` → `agent:<branch>`. New `identitySource` value `worktree-derived` threaded through the claim-time actor-identity guard (spec-claim-time-actor-identity-guard). MCP surface unaffected (MCP tools require explicit `by` already).

OUT: refusing os-fallback claims (adds friction without fixing attribution — a forced invented identity is worse than a derived one); deriving from worktree directory names (branch matches the existing `agent:<branch-or-slug>` convention and git forbids the same branch checked out twice, giving collision-freedom for free); any change to MCP/HTTP actor rules; auto-claiming (claim remains an explicit act).

## Behavior

| Situation | Resolved actor | source |
|---|---|---|
| `--by X` anywhere | X | explicit |
| `$LORE_ACTOR=Y` anywhere | Y | env |
| no identity, cwd in linked worktree on branch `trace-layer` | `agent:trace-layer` | worktree-derived (no stderr warning) |
| no identity, main checkout (`.git` directory) | OS username | os-fallback (warning, unchanged) |
| no identity, worktree with detached HEAD or unreadable gitdir/HEAD | OS username | os-fallback (fail-open to legacy, never crash) |

Known limitation (documented, accepted): a HUMAN working in a linked worktree without an explicit identity is attributed `agent:<branch>` — precedence keeps every explicit path unchanged, the `source` field makes the derivation visible in the claim guard, and humans in linked worktrees without identity are the rarer case than agents there (measured: that combination is currently the failure mode itself).

## Design Decisions

| ID | Decision | Rationale | Alternative rejected |
|---|---|---|---|
| D1 | derive from BRANCH, not worktree path | matches existing `agent:<branch-or-slug>` convention; git forbids one branch in two worktrees → collision-free | path-derived names drift from branch names and collide across repos |
| D2 | filesystem detection, no `git` subprocess | deterministic, fast, works when git absent from PATH; `.git`-file `gitdir:` format is a stable documented git contract | spawning `git rev-parse` per CLI invocation |
| D3 | fail-open to os-fallback on any read anomaly | actor resolution must never crash a lore command; the legacy path already exists and warns | fail-loud would break commands in exotic git states |
| D4 | no refusal tier | grill Q&A: forced-invented identities are less traceable than derived ones | os-fallback claim refusal |

## Acceptance Criteria

Structured ACs via `lore ac add` (script:test):

- AC-ACTOR-1: in a linked worktree on branch B with no `--by`/`$LORE_ACTOR`, resolveActorWithSource returns `{actor: "agent:B", source: "worktree-derived"}` and prints no os-fallback warning.
- AC-ACTOR-2: `--by` and `$LORE_ACTOR` each take precedence over worktree derivation inside a linked worktree.
- AC-ACTOR-3: in the main checkout (`.git` directory) with no identity, resolution is OS username with source os-fallback and the warning — byte-identical to today.
- AC-ACTOR-4: detached HEAD and unreadable/missing gitdir each fall back to os-fallback without throwing.
- AC-ACTOR-5: `lore claim` from a linked worktree with no identity records the claim under `agent:<branch>` with identitySource worktree-derived (claim guard integration).


## Acceptance Criteria (structured)

- [✔] [script] AC-ACTOR-1: In a linked worktree on branch B with no --by or LORE_ACTOR, resolveActorWithSource returns actor agent:B with source worktree-derived and prints no os-fallback warning
  script: test — cd packages/lore && bun test tests/unit/cli/actor-worktree-derivation.bun.test.ts -t AC-ACTOR-1
- [✔] [script] AC-ACTOR-3: In the main checkout with no identity, resolution is OS username with source os-fallback and the warning, byte-identical to today
  script: test — cd packages/lore && bun test tests/unit/cli/actor-worktree-derivation.bun.test.ts -t AC-ACTOR-3
- [✔] [script] AC-ACTOR-4: Detached HEAD and unreadable or missing gitdir each fall back to os-fallback without throwing
  script: test — cd packages/lore && bun test tests/unit/cli/actor-worktree-derivation.bun.test.ts -t AC-ACTOR-4
- [✔] [script] AC-ACTOR-5: lore claim from a linked worktree with no identity records the claim under agent:<branch> with identitySource worktree-derived
  script: test — cd packages/lore && bun test tests/unit/cli/actor-worktree-derivation.bun.test.ts -t AC-ACTOR-5
- [✔] [script] AC-ACTOR-2: Explicit flag --by and env LORE_ACTOR each take precedence over worktree derivation inside a linked worktree
  script: test — cd packages/lore && bun test tests/unit/cli/actor-worktree-derivation.bun.test.ts -t AC-ACTOR-2

## Code anchors

- packages/lore/src/adapters/cli/utils.ts#detectWorktreeDerivedActor
