---
id: KN-536
type: knowledge
role: knowledge
title: "lore release erases all three ownership signals at once, so a live peer's unmerged work renders as unowned — the bucket the merge protocol authorises acting on"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: [concurrency, session, territory, ownership, spec-l0]
parent: PRD-001
links:
  - {id: SPEC-142, type: relates-to}
---
Measured 2026-08-23/24 across two independent live cases, both while a peer
orchestrator session was actively writing `main`.

## The claim

`lore release` is not one state change, it is the SIMULTANEOUS ERASURE OF EVERY
OWNERSHIP SIGNAL, while the released work is still sitting on an unmerged branch.
Nothing distinguishes "released but not yet merged" from "nobody ever touched this".

## The three signals it clears at once

| Signal | What release does | Reader that goes blind |
|---|---|---|
| `task.extra.claim` | set to `null` | `bootstrap.active_sessions` → `[]`; `ready.sessions[]` → `null` |
| `$(git rev-parse --git-dir)/LORE_SESSION_ID` marker | deleted | `hooks/commit-msg` stops writing the `Lore-Session` trailer — the git side goes dark from that commit ON |
| readiness | task returns to `ready: true`, `unmet_blockers: []` | a peer may legitimately re-claim and REDO work that already exists on the orphan branch |

## Marker → trailer, measured as a controlled pair

`hooks/commit-msg` writes the trailer iff the marker file exists. Same hook, same
repo, opposite outcomes:

- main checkout: marker present (`f4497ce9`) → its commits carry the trailer.
- `agent-af7de6ae5e5b85699` after release: marker absent → `9fc80132` (2026-08-24
  18:25) carries NO trailer.
- `5b22a056` (2026-08-23, committed DURING the claim) carries `Lore-Session: 7a5cb259`.

So the trailer is not a durable record of who produced a commit — it is a live
lease indicator that stops mid-branch the moment release runs.

## Consequence: five reading surfaces all fail PERMISSIVE

Case 1 (2026-08-23 13:12–13:23) — session `7a5cb259` delivered 973 + 1374 lines of
RED tests on two worktrees, recorded evidence, released. Its orchestrator `f4497ce9`
was still live (wrote main 3 minutes before the measurement). At that moment:

- `bootstrap.active_sessions` → `[]`
- `lore territory` → both worktrees `unowned`, `foreign: 0`, `mine: 0`
- `lore ready <plan>` → both tasks `ready: true`, `unmet_blockers: []`
- `ready.sessions[]` / `anchor_conflicts` → `null`
- `lore session list` → `(none)`

Case 2 (2026-08-24 18:25) — `agent-af7de6ae5e5b85699`, one unmerged commit one
minute old, task released. `lore territory` → `unowned`, holder `None`.

⛔ `unowned` is precisely the bucket the spec's own merge protocol authorises action
on ("partition with `lore territory`, act only on `mine` and `unowned`"). So the
rendering does not merely lose information — it ISSUES A LICENCE to delete or merge
another live session's in-flight work. Every one of the five surfaces errs toward
permit; not one reports "uncertain".

## Why the shipped ACs do not catch it

AC-OWN-4 proves the trailer is written and readable via `git log`. AC-OWN-1 proves
territory's four buckets are disjoint and sum to the total. Both are green.
NEITHER asserts that territory's ownership decision CONSUMES the trailer — and it
does not: `territory-partition.ts:178` is `if (relevant.length === 0) return
{ bucket: "unowned" }`, where `relevant` is derived from claims alone. With every
target falling into `unowned`, AC-OWN-1's "union equals total" passes VACUOUSLY.

Textbook instance of the standing lesson: capability implemented is not capability
wired, and the two must be one acceptance unit.

That file's own comment (lines 87-92) defends filing an unclaimed target as
`unowned` rather than `unmeasured`, reasoning that "nobody claims this at all" is a
more decisive fact than "someone claims this but we cannot tell who". That reasoning
is FALSE whenever a trailer, an unmerged commit, or a live branch exists: those are
ownership evidence the partition never looked at.

## Fourth defect, same root: the marker is per-checkout, not per-session

The marker lives at `$(git-dir)/LORE_SESSION_ID` — ONE slot per checkout. Two
sessions sharing the main checkout cannot both hold it. Measured now: the slot holds
`f4497ce9`, so a commit made from the main checkout by ANY OTHER session is stamped
with `f4497ce9`'s id. The trailer is therefore not merely erasable, it is
MISATTRIBUTABLE — and a wrong attribution is worse than an absent one, because
`foreign` would name the wrong holder with full confidence.

## What is actually missing

Not a reader fix in isolation. Three candidates, none built:

1. Territory must consult evidence OUTSIDE the claim — an unmerged commit on a
   branch is itself an ownership fact, and its absence of a claim should yield
   `unmeasured` (refuse), never `unowned` (permit).
2. Release must be able to say "released, NOT merged" — the state exists in reality
   and has no representation in the corpus, which is why readiness immediately
   re-offers the task.
3. The trailer must record authorship durably rather than track a live lease, and
   must key on the session rather than on a single per-checkout slot.

Until then: ⛔ `lore territory`'s `unowned` is NOT evidence that a worktree is
abandoned, and `active_sessions: []` is NOT evidence that no peer session is live.
Both mean only "no fresh claim exists".
