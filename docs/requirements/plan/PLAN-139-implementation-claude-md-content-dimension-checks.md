---
id: PLAN-139
type: plan
role: plan
title: "Implementation — CLAUDE.md content-dimension checks (split first, then metrics)"
status: approved
priority: medium
created: 2026-08-23
updated: 2026-08-23
tags: [claude-md, governance, admission]
parent: SPEC-146
phases:
  - {name: "P1-split-and-wire", description: "Three-way split of claude-md-check.ts into budget/admission/findings, sole composition entry runMemoryFileChecks consumed by status.ts and context-flow.ts, renderer extracted to adapters/cli, reference_missing downgraded to advisory (N13). NO new metric. AC-WIRE-1, AC-WIRE-2, AC-COMPOSE-1, AC-PURE-1."}
  - {name: "P2-slug-and-emphasis", description: "Deterministic slug_pointer_missing (closes the includes('/') blindness) and emphasis_saturated with its own single threshold, NOT the three-band ceiling machinery. Both land non-tripping: slug debt measured at zero, emphasis default above the measured spread. Adds memory_files.emphasis config block. AC-SLUG-1, AC-SLUG-2, AC-EMPH-1, AC-EMPH-2."}
  - {name: "P3-grammar-rules-and-prose", description: "Reference-grammar repair for the five measured false-positive classes, .claude/rules/ discovery with a third 'rules' role while .claude/worktrees/ stays excluded, contract prose (rules section, reworded reflow clause, eviction-stub rule), template pointer. Regenerate the assets manifest in the same task. AC-GRAM-1, AC-RULES-1, AC-CONTRACT-1, AC-TEMPLATE-1."}
  - {name: "P4-always-on-advisories", description: "line_length and target_distance advisories, printed on every run, never exit-affecting. OFFICIAL_LINE_TARGET is a module constant, not config. AC-ADV-1."}
  - {name: "P5-service-doc-eviction", description: "Dogfood the contract's own Eviction Rule on packages/lore/src/service/CLAUDE.md, which sits 4 bytes under the 0.9 test threshold and blocks the next agent that needs to add a line to it."}
---
## Overview

Implementation plan for `spec-claude-md-governance-content-dimension-checks-wire-the`. Four phases, ordered so the structural split lands before any new metric — nothing outside `claude-md-check.ts` has ever called its admission half, which makes now the cheapest moment to separate capacity from content (N12).

Strategy: interface-first. Phase 1 establishes the sole composition entry and the three-way file split with **no new metric**, so every later phase adds a metric to a seam that already exists rather than to a 632-line file with two responsibilities.

## Phase order and why

| Phase | Lands | Why here |
|---|---|---|
| 1 | 3-way split, `runMemoryFileChecks`, both call sites wired, renderer extracted, `reference_missing` downgraded to advisory (N13) | The split must precede the metrics or they anchor to capacity machinery by proximity. Wiring the two dead functions is what makes the defect observable at all. |
| 2 | `slug_pointer_missing` + `emphasis_saturated`, both deterministic, plus their config blocks | Both are deterministic and both land non-tripping: slug debt is measured at zero, emphasis default is set above the measured spread. |
| 3 | Reference-grammar repair (5 exclusion classes), `.claude/rules/` discovery + `rules` role, contract prose, template pointer | Grammar repair is what makes `reference_missing` eventually armable; rules discovery and the prose that documents it must land together or "move it to rules/" hides bloat where nothing measures it. |
| 4 | `line_length` + `target_distance` advisories, always printed | Pure reporting layer; depends on the composition entry from Phase 1 and on the `rules` role from Phase 3 to report on every discovered file. |

## Concurrency and anchors

⛔ Phase 1 touches `claude-md-check.ts`, `status.ts` and `context-flow.ts` — the highest-fan-in files in this plan. It runs as a **single task**, not a fan-out: splitting it across agents would put three agents on the same three files and every anchor would collide.

Phases 2–4 fan out, but their anchors are disjoint by construction: Phase 2 owns `claude-md-admission.ts` + `config.ts`, Phase 3 owns `real-memory-file-probe.ts` + `assets/**`, Phase 4 owns the renderer. Where two tasks would touch `claude-md-admission.ts`, they are sequenced rather than parallelised.

## Verification

- Every wiring AC drives the CLI subprocess. ⛔ A unit-only assertion cannot distinguish "wired" from "implemented and dead" — that distinction IS this plan's subject.
- ⛔ `bun run test:changed` is structurally blind to `claude-md-admission.test.ts` (dynamic `import()` defeats static selection). Every dispatch bundle must mandate running the admission and wiring suites by hand.
- ⛔ Each new deterministic metric needs a measured RED run asserting the exit code is **exactly** the declared value and the output **names the kind** — never merely "non-zero". The declared `--falsifier-*` mutation on each AC is the authority for what that red run mutates.
- Phase 3 edits `assets/**`, so the assets manifest must be regenerated in the same task, and `assets/project/pre-push` stays byte-identical to `hooks/pre-push`.
- After the final merge of each phase: `bun run build` (pre-push provenance blocks on a `dist/lore` older than HEAD).

## Risks carried from the spec

- The split touches a pinned RED test whose unnarrowed field access depends on `MemoryFileFinding`'s flat shape — extract and re-export the shared type, ⛔ never fork it.
- `.claude/rules/` discovery runs adjacent to `.claude/worktrees/`; an imprecise glob double-counts every worktree's memory files.
- Emphasis ships deterministic to consumers via `lore setup`; a default below real-world density breaks install-to-first-write.
- New `.strict()` config keys mean an older binary rejects a newer config.yaml — document the version floor.
