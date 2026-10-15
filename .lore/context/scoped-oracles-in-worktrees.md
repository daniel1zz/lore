---
id: project-scoped-oracles-in-worktrees
title: "Scoped oracles in worktrees, full suite only on main"
audience: [main, "subagent:lore-implementer"]
mode: static
---
## Scoped oracles in worktrees

- In a worktree run only scoped oracles: prefer `bun run test:changed <base>` (`--list` previews); otherwise your AC test files with `-t` plus `vitest --changed <base>`, the `.bun.test.ts` files matching your anchors, and `bun run typecheck`.
- The full suite (`bun run test`) runs once on main by the orchestrator after merge.
- `test:changed` UNDER-selects (tree-scanning tests naming no literal path; dynamic `await import()` consumers; `.bun.test.ts` via `vitest --changed`); hand-pick direct consumers and run the blind ones by hand.
- Build a monorepo package (`packages/*`) with new or changed exports before verifying its dependents.
