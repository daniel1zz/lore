---
id: KN-208
type: knowledge
role: knowledge
title: "The global lore is a symlink into the main checkout's dist: rebuilding hot-swaps the CLI under live agents, and not rebuilding leaves every CLI fix inert"
status: approved
priority: medium
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
---
# The global `lore` is a symlink into the MAIN CHECKOUT's dist — both directions of that fact are hazards

Measured 2026-08-03, mid-dispatch, with two implementer worktrees still live:

    which lore                → /Users/apple/.local/bin/lore
    readlink -f $(which lore) → /Users/apple/Projects/zz/lore/dist/lore

So the binary every session, every subagent, and every hook invokes as `lore` IS one
mutable file inside the orchestrator's own working checkout. Two consequences, opposite in
direction, both live:

## Direction 1 — the orchestrator's `bun run build` hot-swaps the CLI under every running agent

`bun run build` overwrites `dist/lore`. Any concurrently-dispatched agent running
`lore claim` / `lore evidence` / `lore release` at that moment is executing that path. A
mid-flight rebuild therefore either changes CLI behaviour under a running agent, or catches
it against a partially-written 73MB binary.

This is NOT covered by any existing worktree-concurrency discipline. The documented hazards
are all *repository* state — anchor overlap, actor collapse, merge ordering, stale
`bun install`. This one is the *tool* itself, and no anchor can express it: `dist/` is a
build artifact nobody declares.

⛔ **Standing rule this yields:** while ANY dispatched agent is live, the orchestrator must
not `bun run build` in the main checkout. Post-merge verification that needs a fresh
compiled binary (any `*-compiled.bun.test.ts`) is therefore gated on the LAST agent
finishing — it cannot be interleaved per-merge. Verification that needs no binary (vitest
unit layers) can proceed per-merge.

Discovered by checking `which lore` before rebuilding, specifically because a merge had just
landed a CLI fix and the reflex was to rebuild and re-verify immediately. That reflex is the
hazard.

## Direction 2 — an agent that FIXES the CLI cannot use its own fix, and neither can anyone else until release

Observed independently by `agent:fix-evidence-precheck-cd` on
`task-evidence-precheck-only-sees-a-cd-in-the-first-segment-of-a`: it fixed a false refusal
in `lore evidence`'s oracle-file precheck, then hit that very false refusal while recording
its own evidence row, because `lore` on PATH was still the pre-fix binary. It worked around
it by invoking its worktree's own `dist/lore`.

The general shape: **a fix to the CLI does not exist for anyone — including its author, and
including every hook and gate — until `dist/lore` in the main checkout is rebuilt.** Merging
is not releasing. Every CLI-surface fix carries an unstated release step, and until it runs,
the repo's own agents keep hitting the bug that is already fixed on main.

This is the distribution-first lesson (`adr-distribution-first-every-improvement-names-its-consumer`)
appearing INSIDE this repo rather than at a consumer: the delivery surface for a
`packages/lore/**` fix is not the merge commit, it is `dist/lore`.

## Why these two are one finding, not two

Both follow from a single fact — one mutable binary, shared by everything, living in the
orchestrator's checkout. Direction 1 says *do not rebuild while agents are live*. Direction 2
says *the fix is inert until you rebuild*. Together they define the only correct window:
**rebuild exactly once, after the last agent finishes, before the authoritative full-suite
run** — which is also when a clean tree at a named commit is achievable
(the full-suite-verdict precondition already in root CLAUDE.md).

## Not mechanized

No detector exists for either direction. Candidates, unbuilt and unjudged:

- a `lore` preflight that warns when `dist/lore` is older than the merge-base of the current
  `main` (Direction 2 — staleness is computable)
- a build-time refusal when a live `.claude/worktrees/*` lock exists (Direction 1 — but
  `bun run build` is a bun script, not a lore surface, so the check has no natural home and
  a wrapper is easy to bypass)

Both are proxies over state neither tool owns. The Proxy question
(`adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`) is unanswered for both,
so this is recorded as a discipline with its measurement, not filed as a build task.
