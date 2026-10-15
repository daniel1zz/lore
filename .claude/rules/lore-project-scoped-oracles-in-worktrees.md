<!-- lore:managed fragment=project-scoped-oracles-in-worktrees hash=7022de6c -->
## Scoped oracles in worktrees

- In a worktree run only scoped oracles: prefer `bun run test:changed <base>` (`--list` previews); otherwise your AC test files with `-t` plus `vitest --changed <base>`, the `.bun.test.ts` files matching your anchors, and `bun run typecheck`.
- The full suite (`bun run test`) runs once on main by the orchestrator after merge.
- `test:changed` UNDER-selects (tree-scanning tests naming no literal path; dynamic `await import()` consumers; `.bun.test.ts` via `vitest --changed`); hand-pick direct consumers and run the blind ones by hand.
- Build a monorepo package (`packages/*`) with new or changed exports before verifying its dependents.
