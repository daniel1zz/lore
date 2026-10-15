---
id: project-test-runner-split
title: "Test runner split: bun test vs vitest"
audience: ["subagent:lore-implementer", "subagent:lore-reader"]
mode: static
---
## Test runner split (this repo)

- **Test file convention**: Files ending in `.bun.test.ts` run under `bun test` only (they use `bun:sqlite`). All other `.test.ts` files run under vitest. Do not mix runners.
- Run a single vitest test file: `bunx vitest run packages/lore/tests/unit/service/corpus-service.test.ts`
- Run a single bun test file: `cd packages/lore && bun test tests/unit/store/sqlite-store.bun.test.ts`
- Tests that touch `SQLiteStore` must use `bun test`, not vitest (`bun:sqlite` is external to vitest).
