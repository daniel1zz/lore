---
id: project-test-runner-split
title: "Test runner: one vitest runner"
inject: [subagent-start]
agents: [lore-implementer, lore-reader]
---
## Test runner (this repo)

- **One runner, vitest**: every test file, `.bun.test.ts` included, runs under vitest. `bun run test:vitest` runs vitest on the Bun runtime (`bunx --bun vitest`), then on Node for the files listed in `vitest.node-files.ts`. `bun run test:bun` is retired (prints a notice, exits 1).
- Run specific files: `bun run test:file <path...> [-t <name>]` routes each file to the runner that collects it, e.g. `bun run test:file packages/lore/tests/unit/store/sqlite-store.bun.test.ts`.
- Run one file directly: `bunx --bun vitest run <file>` (a file listed in `vitest.node-files.ts` collects nothing there: use `test:file`).
- `.bun.test.ts` files (they use `bun:sqlite`) run under the Bun runtime; never `bun test <file>`.
