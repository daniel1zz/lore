---
id: KN-086
type: knowledge
role: knowledge
title: "SPEC-058 execution learnings: init-seeding YAML trap + computed-import RED technique"
status: approved
priority: medium
created: 2026-07-19
updated: 2026-07-24
tags: []
parent: PLAN-070
links:
  - {id: PLAN-070, type: informs}
---
# SPEC-058 execution learnings — YAML seeding trap + computed-import RED technique

Two reusable learnings from the SPEC-058 autopilot run (2026-07-19), flagged by lore assess as uncaptured.

## 1. lore init config seeding trap (fixture-fragile surface)
`lore init`'s freshly-written config.yaml is a LOAD-BEARING "only `project:` key" contract: ~9 integration/e2e fixtures (check-tree, migrate-spec-kind, task-workflow, verify, get-mdx-render, sync-docs-cli, tree-consistency, cli-drift, e2e/cli) `appendFileSync` a second top-level `workflow:` block to disable gates — a raw append, not a YAML merge. Seeding ANY `workflow:` key at init time creates a duplicate top-level key; YAML first-key-wins silently discards the appended overrides. Consequence: template seeding is `lore setup --project`-ONLY (a newer surface with no such dependency). Any future feature wanting init-time config content must first migrate those fixtures off raw append.

## 2. Computed-specifier dynamic import — RED tests against not-yet-existing modules
TS skips static module resolution for computed (non-literal) `import()` specifiers: `const m = await import(["packages","core","src","verification-profile.js"].join("/"))`-style. tsc compiles clean while runtime throws `Cannot find module` — giving genuinely RED suites that need ZERO edits when the module lands with matching exports. Used by SPEC-058 V1 (three suites) and V3 (deferred schema-parse assertion that self-activated on V2's merge). Standard technique for TDD-RED tasks paired with concurrent implement tasks in separate worktrees.
