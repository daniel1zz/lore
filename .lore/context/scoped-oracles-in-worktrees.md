---
id: project-scoped-oracles-in-worktrees
title: "Scoped oracles in worktrees, full suite only on main"
audience: [main, "subagent:lore-implementer", "subagent:tester"]
mode: static
---
## Scoped oracles in worktrees

- In a worktree run only scoped oracles: prefer `bun run test:changed <base>` (deterministic cross-runner selection; `--list` previews); otherwise your AC test files with `-t` plus `vitest --changed <base>`, the `.bun.test.ts` files matching your anchors, and `bun run typecheck`.
- The full suite (`bun run test`) is run once on main by the orchestrator after merge — N concurrent full suites starve spawn-type tests into 30s timeouts that read as fake regressions.
- `test:changed` UNDER-selects (tree-scanning tests naming no literal path; consumers reached via dynamic `await import()`; `.bun.test.ts` via `vitest --changed`), so hand-pick direct consumers and run the blind ones by hand.
- A monorepo package (`packages/*`) with new or changed exports must be built before its dependents are verified, else tsc cannot see the new exports.
