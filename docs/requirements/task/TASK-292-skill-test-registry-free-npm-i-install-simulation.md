---
id: TASK-292
type: task
role: plan
title: "[Skill:test] registry-free npm i install simulation"
status: archived
priority: critical
phase: "Phase 2: Publish pipeline + install simulation"
created: 2026-07-17
updated: 2026-07-17
tags: []
parent: PLAN-034
plan: PLAN-034
links:
  - {id: TASK-290, type: blocks}
---
Estimate: M
Approach: New integration test `packages/lore/tests/integration/npm-install-simulation.test.ts`
(vitest, node:child_process — NOT bun:sqlite, follows the CLI-integration-under-vitest precedent).
Registry-FREE: run `scripts/publish-npm.ts --pack-only` (or `npm pack` on the staged dir) to
produce the `.tgz`, then `npm i <.tgz>` into a THROWAWAY prefix (mkdtemp), and assert the real
npm layout: `node_modules/.bin/lore --version` works THROUGH the symlink (proves T4 realpath fix),
`lore setup --dry-run --claude-dir <tmp>` finds assets from the installed location, the postinstall
ran and emitted the one-line nudge (non-TTY branch, captured from install output), and the install
exit code is 0. Uses a throwaway corpus/tmp only — never the repo's own ~/.claude or .lore.
Source: SPEC-048 AC-048-C, Design D2/D8, Risk R1/R2.
Dimensions: D-FUNC, D-UX (install experience)
Scope-Alt: if `npm i` global-prefix isolation is flaky, fall back to `--prefix <tmp>` install; the symlink `.bin/lore --version` assertion is not negotiable.
Covers: AC-048-C
Blocked by: T5 (needs the pack pipeline — direct link), T4 (realpath fix under test — direct link); T3 (postinstall nudge) is covered transitively via T5 (T3 blocks T5), no separate link.

AC:
- Integration (R2): Given a fresh `npm i <packed .tgz>` into a throwaway prefix,
  When `node_modules/.bin/lore --version` is executed THROUGH the created symlink,
  Then it prints a version and exits 0 (realpath fix proven — assets resolve from the real pkg dir).
- Integration (assets): Given the installed package,
  When `lore setup --dry-run --claude-dir <tmp>` runs from the installed location,
  Then it resolves the shipped `<pkg>/assets/` tree (exit 0, dry-run plan references staged assets).
- Integration (R1 + postinstall): Given the install output,
  When the test inspects it,
  Then the postinstall one-line nudge (non-TTY branch, mentions `lore setup`) is present AND the
  overall `npm i` exit code is 0; `tar`/mode check confirms `dist/lore` stayed executable.
- Oracle: `bunx vitest run packages/lore/tests/integration/npm-install-simulation.test.ts` GREEN
  (attested via `lore verify`).
