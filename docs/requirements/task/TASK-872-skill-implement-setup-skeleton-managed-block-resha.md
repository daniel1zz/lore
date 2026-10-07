---
id: TASK-872
type: task
role: plan
title: "[Skill:implement] setup skeleton + managed-block reshape + adoption write + init-context skill"
status: archived
priority: high
phase: "Phase 2: Surfaces"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-149
plan: PLAN-149
links:
  - {id: TASK-880, type: blocks}
---
Estimate: L
Approach: per spec-claude-md-root-section-structure-check-and-adoption-mode D4. Managed block (CLAUDE.md.template) = '## Module Index' + '## Finding Live Project State' (the lore query pointers move under the latter). New asset CLAUDE.md.skeleton = '## What This Is' / '## Commands' / '## Architecture' with placeholder comments, written ONLY when CLAUDE.md is absent, before the managed block. New injected setup dep writeAdoptionMode(mode) implemented in adapters/cli/commands/setup.ts with `loadConfig`/`saveConfig` from @lore/core/node (read current value first; whole-config write) (flow never imports config-service/fs); called only when the key is absent, judged by runMemoryFileChecks on the POST-SPLICE content: zero would-be deterministic findings (all kinds) → enforce, else warn + migration checklist printed by setup-render. lore-init-context SKILL: fill the existing '## Module Index', never add one.
Source: spec-claude-md-root-section-structure-check-and-adoption-mode D4; flows/setup-project-flow.ts runClaudeMdStep/computeClaudeMdSplice; cohesion + testing reviews
Dimensions: D-FUNC, D-UX
Scope-Alt: checklist formatting.
Covers: AC-STR-4

Rules: update the pinned tests in this same task (anchored: claude-md-template-pointer, setup-project-claudemd, init-context-contract, assets-ssot, setup-user-once-marker, setup-project-gitignore, context-projection). Before starting, `grep -rln 'Module Index\|Lore-governed workflow\|CLAUDE.md.template' packages/lore/tests` — if a hit is outside your anchors, stop and report it rather than editing it. Do NOT commit regenerated packages/lore/src/generated/assets-manifest.ts (orchestrator regenerates after merge); you may regenerate locally to run tests.

AC:
- `cd packages/lore && bun test tests/integration/setup-claude-md-adoption.bun.test.ts` passes.
- Every anchored test file passes (run each by hand); `bun run typecheck` exit 0; `bun run test:changed main` green.
