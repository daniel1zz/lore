---
id: KN-512
type: knowledge
role: knowledge
title: "A worktree without its own bun install silently tests against the main checkout's @lore/core — a false-oracle in both directions"
status: approved
priority: critical
created: 2026-08-23
updated: 2026-08-23
tags: [worktree, false-oracle, node-modules, dispatch]
parent: PRD-001
---
# A worktree without its own `bun install` silently tests against the MAIN checkout's `@lore/core`

Measured 2026-08-23 by the cap-removal implementer while landing `task-skill-implement-delete-the-six-cap-symbols-and-retire-the`.

## The mechanism

Harness worktrees live at `.claude/worktrees/agent-<id>/` — **nested inside the main repo path**. A fresh worktree starts with an EMPTY `node_modules`. Bun/Node then resolve a workspace import like `@lore/core` by walking UP the directory tree, and the first `node_modules` they find is the MAIN CHECKOUT's.

So an agent editing `packages/core/src/**` inside its worktree runs its tests against the main checkout's copy of that package — not the copy it just edited.

## What it produced, concretely

`feedback-config-compat.test.ts` failed inside the worktree even after the implementer had correctly changed `packages/core/src/config.ts`, because the test was reading the unedited main-checkout `config.ts`. The implementer diagnosed it and fixed it with `bun install` inside the worktree (no `bun.lock` diff), then the test behaved as expected.

## Why this is a false-oracle class, not a one-off annoyance

It breaks the oracle in BOTH directions, silently:

- **False red** — the case above. An agent's correct edit looks broken, and the natural next move is to "fix" working code.
- **False green** — the more dangerous half. An agent that DELETES or WEAKENS something in `packages/core/src/**` can see its tests pass, because the assertions are still reading the main checkout's intact copy. Nothing in the output says which copy was loaded.

This is the same shape as the already-recorded lesson that a symlinked `node_modules` makes a green control pass (`knowledge-a-symlinked-node-modules-makes-the-green-control-pass`): the harness resolved a dependency to a location the test author did not intend, and the runner reported success for a run that measured the wrong tree.

## Blast radius in this session

Every worktree agent dispatched before this was diagnosed. In practice the ones that only ADDED new files under `packages/core/src/**` (the front-matter codec) were unaffected in outcome — a new file has no stale twin to shadow it, and the main-checkout re-verification after merge was green independently. But that is luck about what those tasks happened to do, not a property of the setup.

## Fix

⛔ Any worktree task that edits an existing file under `packages/core/src/**` MUST run `bun install` in the worktree before trusting a single test result. Better: the dispatch harness should do it at worktree creation, so correctness does not depend on an implementer remembering.

A cheap detector for a bundle to carry: assert the loaded module's path is inside the worktree, e.g. resolve the package entry and compare its realpath against `process.cwd()` before running the suite. A test that cannot say WHICH copy it loaded cannot be trusted to say whether that copy is correct.
