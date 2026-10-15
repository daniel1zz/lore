---
id: PLAN-150
type: plan
role: plan
title: "Context fragments: config-driven layered rule injection"
status: deprecated
priority: medium
created: 2026-10-07
updated: 2026-10-10
tags: []
parent: SPEC-155
phases:
  - {name: "Phase 1: Foundation", description: "core types, Zod schema, resolveContextConfig, WHEN_MATCHERS, caps, config keys (global+project)"}
  - {name: "Phase 2: Pure services", description: "discover / select / render+section / CAS refresh — parallel behind Phase 1 types"}
  - {name: "Phase 3: Surfaces & wiring", description: "lore fragments CLI, hooks (session-start-fragments, subagent-context, resume Phase C removal), SPEC-083 amendment + assets/context, setup language projection, shipped agents omitClaudeMd"}
  - {name: "Phase 4: Dogfood & verify", description: "this repo .lore/context + root CLAUDE.md refresh, owner user-layer migration, lore verify, full suite on main, assess"}
links:
  - {id: SPEC-155, type: implements}
---
# Plan: Context fragments — config-driven layered rule injection

## Overview

Implements `spec-context-fragments-config-driven-layered-rule-injection` (21 script ACs AC-CF-1..21, PRD R-18; resolves GH #20). Interface-first: core types/config first, then pure services in parallel behind them, then surfaces (CLI, hooks, setup, SPEC-083 amendment, shipped agents), then dogfood + verify.

## Governance Mode

unattended — owner instruction 2026-10-07 "继续把，你全自动". Phase gates auto-proceed; Invariant violations hard-block.

## Invariants

1. Every hook-emitted string ≤ 10,000 chars — enforced by `lore fragments check` (AC-CF-4) and AC-CF-3/8/12.
2. No test, smoke run or hook writes the repo's own `.lore/` or the real `$HOME` — every e2e uses mkdtemp `HOME`/`XDG_CONFIG_HOME` + a `lore init` throwaway corpus (grep the e2e file for `mkdtemp` at phase gate).
3. `@lore/core` default barrel stays browser-safe: `packages/core/src/context-fragments.ts` imports no Node builtin (`bun run typecheck` + existing barrel oracle).
4. Hooks never write files (D7/D8); only `lore context refresh` and `lore setup` write CLAUDE.md / settings, via CAS.
5. `packages/lore/src/generated/assets-manifest.ts` is regenerated (`bun scripts/embed-assets-manifest.mjs`) by any task that touches `assets/`; it is deliberately NOT a declared anchor (generated, deterministic) — on merge conflict the orchestrator regenerates it on main and `--check` must exit 0.
6. Every red test is recorded `lore evidence --result expected-fail` by the agent that ran it, at the moment it went red.

## Risk Register

| Risk | Impact | Trigger | Mitigation | Contingency |
|---|---|---|---|---|
| Concurrent session (plan-claude-md-root-section-structure-check-and-adoption-mode) still editing root CLAUDE.md | M | its `dogfood-evict` task not archived | dogfood task blocked by that task (cross-plan blocks link) | wait; re-check `lore ready` per dispatch |
| Migrated user-layer `subagent:lore-implementer` set exceeds 9,400 chars | M | `lore fragments check` BUDGET_EXCEEDED during dogfood | split the EXECUTE fragment by audience | move content to a preloaded skill |
| Compiled-binary e2e slow / flaky under concurrent suites | M | AC-CF e2e timeouts | single e2e file, scoped `-t` runs in worktrees; full run only on main | serialize e2e runs |
| SPEC-083 byte-parity tests break when corpus-workflow topic retires | M | AC-083 tests red | T-governance task owns re-baseline with original command + failure + why recorded | — |
| Assets manifest merge conflicts across parallel asset tasks | L | conflict in generated file | Invariant 5 | regenerate on main |

## Strategy (Decisions Log)

- Considered: (A) Interface-First / Dependency-Ordered — core types → parallel pure services → surfaces → dogfood; (B) Vertical slices — one end-to-end outlet at a time (subagent first, then session-start, then CLAUDE.md). Chose A: the three outlets share discover/select/render, so B would rebuild the same core three times and serialize on it; A gives critical-path depth 5 instead of ~9. Owner delegated the choice ("全自动").
- Clarification sprint: dimensions already answered by the owner during design (language SSOT option A; static→CLAUDE.md / dynamic→hooks; all subagents omitClaudeMd; partial-audience via injection; flexible via dynamic). Remaining HOW choices made autonomously and recorded here.
- Cross-plan sequencing: dogfood blocked by `task-skill-implement-dogfood-evict-three-architecture` (root CLAUDE.md anchor).

## Phases

- Phase 1: Foundation — core types/schema/config resolver.
- Phase 2: Pure services — discover, select, render+section, CAS refresh (parallel after Phase 1).
- Phase 3: Surfaces & wiring — `lore fragments` CLI, hooks, SPEC-083 amendment, setup language projection, shipped agents.
- Phase 4: Dogfood & verify — migrate this repo + owner user layer, `lore verify`, full suite on main, assess.

## Exit Criteria

All tasks archived; `lore verify <plan>` attested pass for AC-CF-1..21; full `bun run test:vitest` + `bun run test:bun` + `bun run typecheck` green on main; `lore assess` reviewed; spec anchors declared post-landing.
