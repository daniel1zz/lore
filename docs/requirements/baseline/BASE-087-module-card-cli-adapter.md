---
id: BASE-087
type: baseline
role: intent
title: "Module card: cli adapter"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-079
---
# Module card: cli adapter

Source: `packages/lore/src/adapters/cli/CLAUDE.md`.

- **Responsibility**: the citty CLI — the default entry. Each subcommand is `commands/<name>.ts`, lazily imported by `index.ts` (that registry is the only true command count).
- **Public surface**: the `lore` command line; exit codes centralised in `utils.ts::exitCode` (1 store, 2 usage, 3 not found, 4 validation/lifecycle, 5 contention, 6 AI, 7 needs approval, 8 auth, 9 transport, 10 rate limited).
- **Dependencies**: `@lore/core`, services through the App built by `loader.ts::loadLoreApp`; mounts http (`lore serve`), mcp (`lore agent`) and eval.
- **Invariants**:
  - No business logic: resolve args -> call a service -> render -> map error.
  - `loader.ts` is bun-only; vitest-testable logic goes in sibling `*-render.ts`/`*-input.ts` modules.
  - Unknown flags are refused at one seam (`strict-flags.ts`).
  - Dedicated writers own structured `extra` fields (anchors, ac_scope, validity, handoff, phases, claim, evidence); `lore set` never edits them.
  - Actor resolution: `--by` > `$LORE_ACTOR` > session > worktree branch > OS user.
