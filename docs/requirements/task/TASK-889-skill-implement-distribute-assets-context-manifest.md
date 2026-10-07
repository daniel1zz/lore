---
id: TASK-889
type: task
role: plan
title: "[Skill:implement] distribute assets/context — manifest kind, asset source, npm assembly"
status: archived
priority: high
phase: "Phase 3: Surfaces & wiring"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
links:
  - {id: TASK-907, type: blocks}
  - {id: TASK-902, type: blocks}
---
Estimate: M
Approach: follow the post-SPEC-083 `governance/` precedent — `assets/context/` is read binary-side via resolveAssetsRoot (never installed into ~/.claude). Add a `context` kind to TOP_LEVEL_KIND_MAP in scripts/embed-assets-manifest.mjs (ownership like governance), teach RealAssetSource / AssetEntryKind about it (excluded from install paths exactly like governance), make distribution/assemble.ts and scripts/publish-npm.ts ship assets/context/** in the npm tarball, and update comments in these files that describe the governance-only binary-read set (real-asset-source.ts lines ~40/100/105/124 mention corpus-workflow.md — rewrite them to name assets/context as the binary-read fragment SSOT, grep-checkable by file:symbol, never "fixed").
Source: spec D9 + reviewer finding (TOP_LEVEL_KIND_MAP lacks context); scripts/embed-assets-manifest.mjs:5,80; packages/lore/src/adapters/real-asset-source.ts
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: (distribution prerequisite for AC-CF-4, AC-CF-8, AC-CF-17)

AC:
- Given a fixture file assets/context/zz-probe.md, When `bun scripts/embed-assets-manifest.mjs`, Then the generated manifest contains an entry with path 'context/zz-probe.md' and kind 'context' (unit test in assets-ssot.test.ts, describe 'assets/context manifest'); remove the fixture after.
- assemble.test.ts asserts an assets/context/*.md file appears in the assembled npm file list.
- `bun scripts/embed-assets-manifest.mjs --check` exit 0; `bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts packages/lore/tests/unit/distribution/assemble.test.ts` Tests N passed.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
