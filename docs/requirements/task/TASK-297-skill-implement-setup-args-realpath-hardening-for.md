---
id: TASK-297
type: task
role: plan
title: "[Skill:implement] setup-args realpath hardening for npm symlink layout"
status: archived
priority: high
phase: "Phase 1: Core modules"
created: 2026-07-17
updated: 2026-07-17
tags: []
parent: PLAN-034
plan: PLAN-034
links:
  - {id: TASK-292, type: blocks}
---
Estimate: S
Approach: Harden `packages/lore/src/adapters/cli/setup-args.ts`: `realpathSync` the compiled
binary path before deriving `assetsRoot` (and binPath), so an npm `.bin/lore` SYMLINK resolves
to the real package dir instead of `node_modules/.bin/../assets` (nonexistent). Add the npm-layout
assumption to the module-doc invariant list (and note that a binary copied AWAY from its package
dir stays unsupported until P3 embed). Update packages/lore/tests/unit/adapters/setup-args.test.ts
to cover the symlink case. This is the ONLY production-code diff in the spec (INV-6).
Source: SPEC-048 Scope IN #6, Design D8; existing setup-args.ts resolveAssetsRoot/resolveBinPath (lines ~200-217) + module doc (~20-56).
Dimensions: D-FUNC, D-CODE
Scope-Alt: none — realpath is the load-bearing fix R2 depends on.
Covers: AC-048-A (unit), enables AC-048-C
Blocks: none upstream; consumed by T6 (real npm i proves the fix)

AC:
- D-FUNC: Given a `SetupPathContext` whose `execPath` is a SYMLINK pointing at a real binary
  in a sibling package dir (npm `.bin` layout), with `isCompiled:true`,
  When `resolveAssetsRoot(ctx)` / `resolveBinPath(ctx)` run,
  Then the derived `assetsRoot` resolves through the symlink to `<realpkgdir>/assets`
  (i.e. dirname(realpath(execPath))/../assets), NOT `<.bin>/../assets`.
- D-FUNC (REGRESSION): Given the pre-existing dev-mode and non-symlink compiled cases,
  When resolveAssetsRoot/resolveBinPath run,
  Then results are byte-identical to pre-change behavior (no regression to existing tests).
- Integration (module doc): Given setup-args.ts after the change,
  When its module-doc invariant list is read,
  Then it explicitly names the npm bin-symlink layout assumption and the copied-away-binary
  unsupported-until-P3 caveat.
- Oracle: `bunx vitest run packages/lore/tests/unit/adapters/setup-args.test.ts` GREEN incl.
  the new symlink case; `bun run typecheck` clean.
