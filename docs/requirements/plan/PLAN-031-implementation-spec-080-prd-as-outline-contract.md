---
id: PLAN-031
type: plan
role: plan
title: "Implementation — SPEC-080 PRD-as-outline contract"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: SPEC-081
phases:
  - {name: "Phase 1: Core schemas & outline writer", description: "outlineEntry/outline_budget/prd_sync_exempt schemas + SPEC_KINDS domain-overview + verification profile; PrdOutlineService + set-guards + renderOutlineContent; CLI lore outline group"}
  - {name: "Phase 2: Oracles & gate predicate", description: "lore status --check-prd-budget (tiered budgets, content-flight, detail-link hop check, advisory knob); plan-close prdOutlineSynced predicate + exemption surfacing"}
  - {name: "Phase 3: Migration machinery", description: "OutlineMigrationService (dry-run set-equality invariants, idempotent markers) + lore migrate prd-to-outline + bootstrap payload pin"}
  - {name: "Phase 4: Corpus migration & close-out", description: "Staged live-corpus migration; authoring-surface sync (lore-product asset + CLAUDE.md); full-suite verify/assess close-out"}
links:
  - {id: SPEC-081, type: implements}
---
# Implementation — SPEC-080 PRD-as-outline contract

Governance Mode: unattended (owner delegated autonomous judgment 2026-07-26 — "你自己判断,要长期的最佳方案"; invariant violations still hard-block)

## Overview

Lands SPEC-080's four mechanisms (structured outline + dedicated verbs, domain-overview spec kind, --check-prd-budget oracle, plan-close prdOutlineSynced predicate), then executes the staged in-place migration of the live 104KB root PRD. Interface-first: core schemas land first, mechanisms parallelize behind them, migration machinery lands before any live-corpus write, corpus execution is dry-run-gated.

## Invariants

- I1: `bun run typecheck` exits 0 at every phase gate.
- I2: Both test runners green at every phase gate (scoped runs inside worktrees; full suites on main after merge only).
- I3: Root PRD doc identity is never replaced — id 01KVZ4C445EK479938W1TYT3AJ and slug survive every migration step.
- I4: No test or smoke check ever writes the repo's own .lore/ corpus (throwaway mkdtemp corpora only).
- I5: Every mechanism is regression-safe when disarmed: without --check-prd-budget flag, with the plan-close knob OFF, and on docs without extra.outline, all pre-existing suites pass byte-unchanged.
- I6: extra.outline and extra.prd_sync_exempt are writable ONLY via their dedicated verbs — any direct set patch returns VALIDATION_ERROR naming the verb.

## Risk Register

| ID | Risk | Impact | Trigger | Mitigation | Contingency |
|----|------|--------|---------|------------|-------------|
| R1 | Live-corpus migration loses content | H | dry-run invariant fails or post-step diff shows missing prose | T6 dry-run set-equality invariants + T7 staged per-section two-step order (create+link child FIRST) | `lore restore <prd> --version <pre-step>`; child docs are additive and harmless |
| R2 | status.ts write contention between T4 and T5 | M | merge conflict / clobbered flag wiring | serialized via blocks link (T4 → T5), anchors declared | re-dispatch T5 on fresh worktree after T4 merge |
| R3 | plan-close predicate false-positives on hotfix plans | M | legitimate plan denied at close | knob default-OFF; dedicated exemption verb + status surfacing land in the same task (T5); arming deferred to post-plan observation window | disable knob; record exemption |
| R4 | SPEC_KINDS extension ripples into existing spec_kind consumers | M | dashboard/judgment/profile code assumes 3-kind enum | T1 AC includes a grep sweep of all SPEC_KINDS consumers + regression suites | scope domain-overview handling per consumer before arming |
| R5 | Bootstrap payload pin flaky across fixture sizes | L | AC-080-8 test intermittent | fixed-size seeded fixture corpus | pin against ratio not absolute chars |

**[RISK_REGISTER]** 5 risks identified: 1H / 3M / 1L

## Estimation Summary

T-shirt units: S=1 M=2 L=3.

**[ESTIMATION]** Total: 28 session-units | Phase 1: 10 | Phase 2: 6 | Phase 3: 4 | Phase 4: 8 | Critical path: 15 session-units (post T7-split: T7a=L, T7b=M)
Warning acknowledged: total > 10 units — inherently staged initiative; phases are the session groupings, execution spans multiple sessions by design.

## Critical Path

**[CRITICAL_PATH]** duration: 15 session-units | path: T1r → T1 → T2 → T3 → T7a → T7b → T9 | slack tasks: 9
All critical-path tasks carry --priority critical.

## Exit Criteria

- All 16 tasks (15 original + T7b from the reviewer-mandated T7 split) archived (or deprecated with rationale in Decisions Log).
- All 10 spec ACs carry pass evidence; script ACs attested via `lore verify` where their commands exist.
- `lore assess <plan>` run; findings fixed or accepted with rationale.
- Root PRD raw body <= 24000 chars; `--check-prd-budget` exit 0 on the live corpus.
- Consumer regressions green: dashboard e2e, bootstrap, --check-requirements.
- Handoff written with arming decision (Phase 3 of SPEC-080 migration plan: advisory→exit-3 flip + predicate knob ON after 2 clean plan-closes) recorded as follow-up.

## Phase Descriptions

- Phase 1: Core schemas & outline writer — @lore/core schemas (outlineEntry, outline_budget, prd_sync_exempt, SPEC_KINDS+domain-overview, verification profile), PrdOutlineService + CorpusService.set guards + renderOutlineContent, CLI `lore outline` group.
- Phase 2: Oracles & gate predicate — `lore status --check-prd-budget` (tiered budgets, content-flight, detail-link hop check, exit precedence, advisory knob), plan-close prdOutlineSynced predicate + exemption surfacing.
- Phase 3: Migration machinery — OutlineMigrationService with dry-run set-equality invariants, idempotent markers, `lore migrate prd-to-outline`, bootstrap payload pin fixture.
- Phase 4: Corpus migration & close-out — staged live-corpus execution split per reviewer audit: T7a domain sections (§14-§22), T7b core condensation (§1-§13) + ADR extraction; authoring-surface sync (lore-product skill asset + CLAUDE.md), full-suite verification + verify/assess close-out.

## Decisions Log

- 2026-07-26 Reviewer audit (NEEDS_WORK) applied: T4→T7 edge graph-enforced; T7 split into T7a (domain §14-§22, L) + T7b (core §1-§13 + ADR extraction, M) — H-risk live-corpus mutation no longer a single M task; T8 anchors narrowed to assets/skills/lore-product/SKILL.md; T8 ACs pinned to literal grep + canonical freshness command; live-corpus bootstrap payload assertion added to T9.

- 2026-07-26 Strategy: "Dependency-ordered mechanism-first" chosen over "vertical per-mechanism slices". Rationale: all four mechanisms share the @lore/core schema foundation — interface-first converts them into parallel tracks (Layer 3); vertical slices would re-serialize on schemas 4 times. Owner delegated selection.
- 2026-07-26 Clarification dimensions resolved from approved SPEC-080 (owner delegated): tech stack = existing Bun/TS/Zod/citty stack (no new deps); data model = typed extra fields per C1/C3/C4; testing = two-runner convention + TDD pairs; migration/compat = spec Migration Plan §Phase 0-3 + I5 regression posture; security/gaming = C4 anti-gaming design; error handling = Result<T,LoreError> conventions.
- 2026-07-26 Corpus-execution task (T7) is main-agent executed (corpus operation, not code) with manual+e2e oracle evidence; code tasks dispatch to lore-implementer worktrees.
