---
id: PLAN-172
type: plan
role: plan
title: "Baseline slice 1: rules, citations, rule state, specification-branch pilot"
status: deprecated
priority: critical
created: 2026-10-07
updated: 2026-10-10
tags: [baseline, slice-1]
parent: SPEC-156
phases:
  - {name: "Phase A: core contracts", description: "baseline DocType, schemas, rule types, lint, dedicated-key guard table, AC cites field, attestation head_sha fields (spec C1, C3 lint/guard table, C4 field, C5 field). packages/core/src."}
  - {name: "Phase B: store", description: "rule_registry migration + transactional allocate/move in SQLite, Turso, InMemory (spec C2)."}
  - {name: "Phase C: services and surfaces", description: "RuleService + replace guard + CLI/MCP verbs, ac cite, head_sha capture, RuleStateService, views, status fields, --check-baseline, rollback e2e (spec C3–C7)."}
  - {name: "Phase D: specification-branch pilot", description: "freeze probes, build lore's own baseline root/branch/leaves, map + adjudicate + cite ACs, measure kill lines (spec C8, AC-BLS1-11)."}
  - {name: "Phase E: verification", description: "attested verify of AC-BLS1-1..9 on main, full suite, assess, code anchors, drift/baseline checks, handoff."}
---
# Plan: Baseline slice 1 — rules, citations, rule state, specification-branch pilot

## Overview

Implements `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (10 ACs: AC-BLS1-1…9, AC-BLS1-11) — slice 1 of PRD `spec-product-baseline-architecture-trees-the-product-s-current` under ADR `adr-the-product-is-a-baseline-tree-specs-are-implementations`. Five phases follow the spec's Migration Plan: A core contracts → B store → C services and surfaces → D pilot → E verification.

## Governance Mode

`unattended` — the owner delegated all approvals ("后面全自动", session 6b85319e, 2026-10-07). Phase gates auto-proceed; an Invariant violation or a fired kill line hard-blocks regardless.

## Invariants (checked at every phase gate)

1. No rule id is ever issued twice — `rule-registry.bun.test.ts` green on main (AC-BLS1-1).
2. A corpus without baseline docs and without citations prints exactly what it printed before slice 1 — rollback e2e green (AC-BLS1-8).
3. No computed rule state is `verified` without a runner-attested pass; missing inputs yield `unknown(reason)` (AC-BLS1-4).
4. Every write path for baseline keys goes through the service layer; wholesale `set` of a guarded key is refused (AC-BLS1-2).
5. Tests and smoke runs never write to this repo's `.lore/` — only Phase D (the pilot) writes to the live corpus, by design, through the shipped CLI.
6. Both runners green and `bun run typecheck` exit 0 on main after every merge.

## Risk Register

| # | Risk | Impact | Trigger | Mitigation (in task tree) | Contingency |
|---|---|---|---|---|---|
| R1 | Pilot fails a kill line (adjudication > 30% or probe < 9/10 / any confident-wrong) | H | D4 measurement | D1 freezes probes first; D3 two mappers + adjudicator; D4 measures | stop before slice 2; replan the migration method; record in the Ledger |
| R2 | Registry and leaf content diverge | H | `--check-baseline` exit 3 / `registry_mismatch` > 0 | single-transaction store writes (B2); check in C7 | fix the writer, never hand-edit the table |
| R3 | Turso client transaction semantics differ from SQLite | M | B1 Turso-variant test red | B2 implements both behind StoreInterface with the same bun test | constrain Turso path to `client.transaction("write")`; document |
| R4 | `head_sha` capture wrong inside linked worktrees | M | C5t red on a worktree fixture | C5 reads HEAD from the execution root, not the main checkout | report `unknown(no-commit-recorded)` rather than guess |
| R5 | Anchor contention on shared files (`mcp/tools.ts`, CLI registry, `corpus-service.ts`) | M | task-claim anchor-overlap refusal | blocks edges serialize C2 → C7 | — |
| R6 | Fresh-only probe result overstated | M | — | the 4-week re-probe is a slice-2 entry criterion, recorded in D4 | — |

**[RISK_REGISTER]** 6 risks: 2H / 4M / 0L

## Decisions Log

- 2026-10-07 Strategy: Interface-First / dependency-ordered (core contracts → store → services → pilot → verify), chosen over vertical capability slices because id allocation, citation and state computation all consume the same core types; vertical slices would each touch the same core files. Decided by the orchestrator under owner delegation.
- 2026-10-07 Clarifications (decided under delegation, sourced from the approved spec): data model per spec C1–C2 (extra arrays + `rule_registry` table); no new third-party dependencies (Zod + existing store clients); errors as `Result<T, LoreError>`, loud CONFLICT after ≤ 3 immediate re-applies; testing = vitest for pure/service, bun test for store/e2e; migration via schema migration following migration-010; performance budgets per QA-3/QA-4; security per the spec's STRIDE-lite (attestation-only `head_sha`, replace guard); backward compatibility per Invariant 2.
- 2026-10-07 TDD: every implement task is preceded by a RED test task that blocks it.
- 2026-10-07 TDD edges removed (known deadlock TASK-879: `lore done` cannot archive a RED task before its impl passes, so test→impl `blocks` edges never clear). The 7 RED→impl edges (A1→A2a, A1→A2b, B1→B2, C1→C2, C3→C4, C5t→C5, C6→C7) were unlinked; ordering is enforced by the orchestrator instead — an impl task is dispatched only after its RED task's branch is merged to main; each RED task is archived after its paired impl turns its tests green and `lore verify --task <red>` attests the pass. Same workaround as plan-claude-md-root-section-structure-check-and-adoption-mode D5.

## Exit Criteria

All tasks archived; AC-BLS1-1…9 attested via `lore verify`; AC-BLS1-11 judged from the pilot assessment; `lore assess` reviewed; spec code anchors declared after landing; `lore status --check-drift` and `--check-baseline` exit 0; handoff written with the slice-2 entry criteria (incl. the 4-week re-probe).

## Critical Path

A1 → A2a → B1 → B2 → C2 → C7 → D2 → D3 → D4 → E1 = 20 session-units (S=1, M=2, L=3). Slack: A2b, C1, C3, C4, C5t, C5, C6, C8, D1 (D1 is a root and runs in parallel with Phase A).

**[CRITICAL_PATH]** duration: 20 | slack tasks: 9

## Estimation Summary

**[ESTIMATION]** Total: 31 session-units | Phase A: 4 | Phase B: 4 | Phase C: 15 | Phase D: 6 | Phase E: 2 | Critical path: 20. Large plan (> 10) and long critical path (> 6): accepted because Phase C fans out into 4 independent branches (guard/verbs, cite, head_sha, state) that run in parallel worktrees; splitting into sub-plans would sever the pilot from the code it measures.

**[COVERAGE]** spec ACs covered: 10/10 | orphan tasks: 0 (D1, D2 support AC-BLS1-11; E1 attests all)

**[TDD_INJECTION]** impl tasks: 7 (A2a, A2b, B2, C2, C4, C5, C7) | test tasks: 6 RED (A1 pairs A2a+A2b, B1, C1, C3, C5t, C6) + 1 e2e (C8)

Operational note: Phase D runs the shipped CLI against the live corpus, so `bun run build` must produce a `dist/lore` containing Phases A–C before D2 starts (the orchestrator rebuilds after merging C7).
