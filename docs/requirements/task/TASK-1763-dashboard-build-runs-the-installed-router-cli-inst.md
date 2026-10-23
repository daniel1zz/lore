---
id: TASK-1763
type: task
role: plan
title: "Dashboard build runs the installed router CLI instead of a shared bunx temp-cache fetch that concurrent floors corrupt"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Found 2026-10-19 landing worktree-agent-a06ab84dc76e86751: the integrate floor's `bun run build` failed in `@lore/dashboard prebuild` (exit 1, Node require stack inside `/private/var/folders/.../T/bunx-501-@tanstack/router-cli@latest/node_modules/@tanstack/router-cli/...`), and check:baseline-coverage failed with it (dashboard assets missing → unresolved import). packages/dashboard/package.json runs `bunx @tanstack/router-cli generate` in both `prebuild` and `typecheck`, although `@tanstack/router-cli` is already a devDependency (^1.121.2). bunx resolves through one machine-wide temp cache shared by every session; several floors and typechecks run concurrently on this machine, so concurrent installs into that cache race and leave it broken. The floor result then depends on another session's timing, not on the code.

End state: the dashboard scripts run the router CLI from the workspace's installed devDependency (the package's own bin, e.g. `tsr generate`, resolved from node_modules after the floor's `bun install --frozen-lockfile`), never a network/temp-cache fetch; no build or check step of this repo uses `bunx <pkg>` for a package that is a declared dependency (add a check, or extend an existing check:* script, that refuses `bunx` of a declared dependency in package.json scripts).

AC: red-first — the new check refuses today's dashboard scripts naming `@tanstack/router-cli`; after the change `bun run build` and `bun run typecheck` pass with no bunx temp-cache path in their output, and the check passes.
