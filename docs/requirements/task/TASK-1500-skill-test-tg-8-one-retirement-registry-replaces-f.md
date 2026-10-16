---
id: TASK-1500
type: task
role: plan
title: "[Skill:test] TG-8 one retirement registry replaces four tombstone test files"
status: draft
priority: medium
phase: "Phase 2: clear offenders"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1493, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: M
Approach: One registry RETIREMENTS {id, kind: install-asset|cli-command|outlet|settings-entry, target, replacement, spec_ref}; RETIRED_FROM_INSTALL_PATHS (packages/lore/src/adapters/real-asset-source.ts) derives from it. New retirement-registry.bun.test.ts checks each row by kind (install-asset: fresh install does not write it, converge removes a planted tracked copy, --dry-run lists it; cli-command: exit 4 with the replacement; outlet: exit 2). Merge and delete: setup-retires-session-start-fragments, init-context-skill-retirement, setup-retired-agent-types, and the retirement cases of setup-governance-retirement (119-195 deleted, :439 already asserts the file is gone; the 376-394 content cases are owned by T6). Keep claim-legacy-transition, feed-retired-oracle-visibility, fragments-session-start-retired, outline-retired, gate-hook-retirement-parity (199-250; move 252-263 into the registry), cite-retire-race, mirror-prune-retire-deleted-doc-mapping. Fix packages/lore/tests/integration/npm-install-simulation.test.ts:294, which asserts that no path contains corpus-workflow.md, a file deleted in f4bb2888: assert the real retired names from the registry.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared
AC: AC-TG-9 (part).
