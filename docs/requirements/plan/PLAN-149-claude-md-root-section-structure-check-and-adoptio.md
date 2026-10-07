---
id: PLAN-149
type: plan
role: plan
title: "CLAUDE.md root section-structure check and adoption mode"
status: approved
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: [claude-md, memory-files, governance, adoption]
parent: SPEC-154
phases:
  - {name: "Phase 1: Foundation", description: "core sections constant + memory_files.adoption config (absent->warn) + pure claude-md-structure.ts (mdast-util-from-markdown) + runMemoryFileChecks adoption application + status --check-claude-md JSON adoption block and WARN line. Covers AC-STR-1, AC-STR-2."}
  - {name: "Phase 2: Surfaces", description: "Parallel consumers of the Phase 1 result: lore context write gate (AC-STR-6), bootstrap memory_file_health (AC-STR-5), setup skeleton/template/adoption write + init-context skill (AC-STR-4), contract prose + pre-push pair (AC-STR-3, AC-STR-7). RED test tasks run in parallel with Phase 1. Implementers never commit regenerated assets-manifest.ts; orchestrator regenerates after each merge."}
  - {name: "Phase 3: Dogfood & verify", description: "After rebuilt binary on merged main: evict three Architecture subsections of root CLAUDE.md to knowledge-reference docs, set .lore/config.yaml adoption: enforce (AC-STR-8); then lore verify AC-STR-1..8, full suite, assess, code anchors."}
links:
  - {id: SPEC-154, type: implements}
---
## Overview

Implements `spec-claude-md-root-section-structure-check-and-adoption-mode` (AC-STR-1..8) under `adr-claude-md-root-h2-structure-is-deterministic-with-one`: a deterministic root-CLAUDE.md H2 structure check, an advisory module check, and one `context.memory_files.adoption: enforce|warn` switch that lets an existing project adopt lore without going red on day one and without going silent.

Strategy: **Interface-first, then parallel surfaces** (user-selected 2026-10-07 over "vertical slices serial", whose slice 1 would have shipped enforce-only with no adoption path).

## Governance Mode

attended

## Invariants

- I1 `lore status --check-claude-md` never loads the corpus (SPEC-095 D9): `status.ts` check branch has no `loadLoreApp` call on its path.
- I2 `runMemoryFileChecks` is the SOLE composition entry: `grep -rn "checkRootStructure\|checkModuleStructure" packages/lore/src --include=*.ts` hits only `claude-md-structure.ts` and `claude-md-admission.ts`.
- I3 Structure checks are mode-free: their signatures take no config/mode parameter.
- I4 `@lore/core` default barrel imports no Node builtin and no markdown parser (`mdast-*` only under `packages/lore`).
- I5 `hooks/pre-push` and `assets/project/pre-push` stay byte-identical; `node scripts/embed-assets-manifest.mjs --check` exits 0 on main after every merge.
- I6 Every enforce-side oracle asserts `adoption.mode === "enforce"` explicitly (absent key resolves to warn).
- I7 No test or smoke run writes to this repo's `.lore/` — throwaway corpora only.

## Risk Register

| # | Risk | Cat | Impact | Trigger | Mitigation | Contingency |
|---|---|---|---|---|---|---|
| R1 | `.lore/config.yaml` gains `adoption` while a binary that predates it is in use. MEASURED 2026-10-07 in a throwaway repo: the old binary does NOT fail — it refuses the whole `context` section and SUBSTITUTES schema-default budgets with a loud `SUBSTITUTED` warning (exit unchanged; `lore list` unaffected). Effect here: ceilings silently LOOSEN from this repo's 220L/24576B to defaults 300L/30720B for anyone on an old binary | Technical | M | `budget_source: substituted-defaults` in `--check-claude-md --json` | Dogfood task is LAST, runs only after `bun run build` on merged main (P3 task) | revert config line |
| R2 | Worktree agents built from origin/main while local main is ahead | Dependency | H | `git -C <wt> log -1` ≠ main HEAD | every bundle: `git rebase main` + base assertion before any measurement | discard worktree, redispatch |
| R3 | Template reshape breaks pinned tests (template-pointer, setup-project-claudemd, init-context-contract, assets-ssot, setup-user-once-marker) | Quality | M | red in those files | the setup task anchors and updates them in the same task | — |
| R4 | Generated `assets-manifest.ts` conflicts between parallel P2 merges | Technical | M | merge conflict on generated file | implementers do NOT commit the regenerated manifest; orchestrator regenerates + commits after each merge | regenerate |
| R5 | Markdown parser mis-handles setext/indented headings → false enforce block | Quality | M | unit case red | use mdast-util-from-markdown (CommonMark), unit cases for setext/indented/fenced | — |
| R7 | Between the core task's merge and the dogfood task, this repo itself runs memory-file checks in warn (no key yet) | Quality | M | pre-push passes an over-ceiling CLAUDE.md in that window | keep the window short: dogfood is the first task after Phase 2; orchestrator runs `lore status --check-claude-md` by hand at each merge | — |
| R6 | False oracle (exit masked, vacuous config-less fixture) | Quality | H | AC green while goal unmet | each RED task records an expected-fail run; issue #19 filed for pipe masking | — |

## Decisions Log

- D1 Strategy: interface-first + parallel surfaces (user choice).
- D2 Markdown parsing: USE `mdast-util-from-markdown@^2.1.0` + `mdast-util-to-string@^4.0.0` (syntax-tree org, CommonMark-correct incl. setext and fences) in `packages/lore` only. REJECT hand-rolled regex (misses setext H2 / indented code → false blocks under enforce).
- D4 Absent `adoption` downgrades ALL deterministic kinds, including pre-existing capacity checks (user re-confirmed 2026-10-07 after plan review surfaced that this weakens enforcement for installs that never re-run setup; alternative 'legacy kinds stay enforced' rejected by user). Consequence: the core task re-pins 15 existing enforce oracles with explicit `adoption: enforce`.
- D5 (2026-10-07, replan) Removed the five RED→implement `blocks` edges after all RED tests merged to main. Reason: `lore done` on a RED task requires an attested pass AND an unfiltered pass run per test-file anchor, which cannot exist before its paired implement task lands — so `test blocks impl` was an unsatisfiable cycle. The artifact the implement tasks consume (failing tests on main) already exists at merge e25b9a06. RED tasks close after their paired implement task merges, with a pass run of their own test files.
- D3 Dogfood edits (root CLAUDE.md eviction, `.lore/config.yaml`) are done by the orchestrator on main: they are config/.md + corpus writes, and must follow a rebuilt binary (R1).

## Phases

- Phase 1: Foundation — core constants/config/schema, pure structure module, composition + status surface.
- Phase 2: Surfaces — context gate, bootstrap health, setup+template+skill, contract+pre-push (parallel).
- Phase 3: Dogfood & verify — this repo under enforce; verify AC-STR-1..8; assess.

## Critical Path

`task-skill-test-structure-check-cli-adoption-surface-red` (S) → `task-skill-implement-core-adoption-config-pure-h2-structure` (L) → `task-skill-implement-setup-skeleton-managed-block-reshape` (L) → `task-skill-implement-dogfood-evict-three-architecture` (S) → `task-skill-review-verify-ac-str-1-8-on-main-full-suite-assess` (S) = 9 session-units. Slack: the other four RED tasks (run alongside Phase 1), context/bootstrap/contract implement tasks.

## Estimation Summary

Total 18 session-units | Phase 1: 4 | Phase 2: 12 | Phase 3: 2 | Critical path: 9. Above the 10/6 advisory lines because Phase 2 is four parallel RED+implement pairs; wall-clock is bounded by the critical path.

## Exit Criteria

- `lore verify` attested pass for AC-STR-1..8.
- Full suite (`bun run test:vitest`, `bun run test:bun`, `bun run typecheck`) green on main after the last merge.
- `lore assess` reviewed; spec code anchors declared after landing.
