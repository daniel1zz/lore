---
id: TASK-506
type: task
role: plan
title: "T4 governance rule + manifest regeneration + fresh-install e2e"
status: archived
priority: medium
phase: "ship"
created: 2026-07-30
updated: 2026-07-31
tags: []
parent: PLAN-100
plan: PLAN-100
---
## Objective

Ship the mechanism to consumers and prove distribution end-to-end against the compiled binary.

## Deliverables

- `assets/governance/corpus-workflow.md` §FEED gains the per-item disposition obligation.
- Regenerate the assets manifest (`bun scripts/embed-assets-manifest.mjs`) so the new hook and the edited governance asset ship with current digests.
- `packages/lore/tests/e2e/resume-coverage-compiled.bun.test.ts` (new, owns the whole file).

## ACs

- AC-RC-4 — compiled-binary CLI stdout AND the MCP `lore_feed` session-resume response each carry the ordinal tags, the cardinality line, and `RESUME_COVERAGE_FLOOR`, asserted PER SURFACE. SPEC-CP D3 measured that a CLI-only assertion leaves every MCP consumer on the old behaviour.
- AC-RC-8 — after `lore setup` against a throwaway `--claude-dir`, the installed hook is byte-identical to its `assets/` SSOT, and the manifest sha256 entries for both changed assets equal the on-disk digests.

## Constraints

Depends on T2 (render must exist for the e2e to observe) and T3 (the hook file must exist before it can be embedded). Run `bun run build` before the compiled e2e — a stale `dist/lore` is a measured false-oracle vector in this repo. Use a throwaway `mkdtemp` corpus, NEVER this repo `.lore/`.
