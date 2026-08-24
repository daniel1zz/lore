---
id: KN-549
type: knowledge
role: knowledge
title: "A worktree with no node_modules resolves workspace imports to the MAIN checkout, silently"
status: approved
priority: critical
created: 2026-08-24
updated: 2026-08-24
tags: [worktree, dispatch, false-green, monorepo, oracle-design]
parent: PRD-001
links:
  - {id: KN-494, type: relates-to}
---
## The measurement

Two-sided probe, run 2026-08-24 from the main checkout at `92fd1f39`. A throwaway worktree was created specifically to construct the RED end, because both pre-existing worktrees already had `node_modules` and therefore could only produce the green half — a one-sided probe here proves nothing.

| Condition | `import.meta.resolve("@lore/core")` |
|---|---|
| fresh worktree, **no** `node_modules` (RED) | `file:///Users/apple/Projects/zz/lore/packages/core/src/index.ts` — the **MAIN CHECKOUT's** copy |
| worktree with `node_modules` (GREEN control) | `file:///Users/apple/Projects/zz/lore/.claude/worktrees/agent-a42afccae66550a7d/packages/core/src/index.ts` — its own |

The green end resolves through `node_modules/@lore/core -> ../../packages/core`, a relative symlink `bun install` creates inside the worktree.

## Why it happens

`git worktree add` populates only tracked files, and `node_modules/` is ignored — so a new worktree has none. Worktrees in this repo are created **nested inside the main checkout** (`/Users/apple/Projects/zz/lore/.claude/worktrees/<name>`), so Node's and Bun's upward `node_modules` walk does not stop at the worktree root: it keeps climbing into the main repository and finds the main checkout's workspace links there.

Nesting is what makes this silent. A worktree created OUTSIDE the repo tree would fail to resolve `@lore/core` at all — a loud error. Nested, it resolves successfully to the wrong file.

## Why it is a false-GREEN generator, not merely a nuisance

An agent editing `packages/core/src/**` in a worktree without `node_modules` runs `bun run typecheck` and its test files against the **main checkout's unmodified `packages/core`**. Consequences, in order of how badly they mislead:

1. A test asserting NEW behaviour fails, and the failure looks like a genuine red in the agent's own code — it will "fix" code that was never being executed.
2. A test asserting behaviour that main ALREADY has passes, and the pass says nothing about the agent's edit.
3. `tsc` reports no error about a missing export, because it is reading a `packages/core` that legitimately lacks it — and reports no error about the edit either, because the edited file is not in the graph.

Every one of those verdicts is about code the agent did not write. This is the same class as `knowledge-a-symlinked-node-modules-makes-the-green-control-pass` (harness-sees-its-own-copy) but a distinct SHAPE: there the link pointed at the wrong copy, here there is no link at all and the resolver escapes the boundary upward.

⛔ Measured incidentally: the agent that hit this was on a task touching `packages/core/src/schemas.ts`. It noticed only because it checked `import.meta.resolve` on its own initiative. Nothing in the dispatch path would have told it.

## What refuses it — NOT BUILT

⛔ Named as an unenforced gap rather than a fixed one. `bun install` in a dispatch bundle is PROSE, which means NOT ENFORCED — the next bundle author can omit it and nothing notices.

The mechanism this needs is an assertion available to every worktree run, sibling to the existing `packages/lore/tests/integration/helpers/assert-fresh-binary.ts` (which already refuses a stale `dist/lore` for exactly this "verdict about code not under test" reason): a helper that resolves each `@lore/*` workspace specifier and REFUSES when the resolved path is not under the current repository root (`git rev-parse --show-toplevel`). Cheap, total, and it fails loud at the top of any suite rather than producing a wrong verdict deep inside one.

Until that exists, the compensating control is that a worktree bundle touching a workspace package must run `bun install` first AND print the resolved path — printing it is what makes the check auditable rather than a claim.
