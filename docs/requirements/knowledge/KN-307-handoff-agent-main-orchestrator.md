---
id: KN-307
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 4 decisions + 6 next steps = 10 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | main fast-forwarded to 8227dd1 (60 commits) after a clean-worktree verdict: typecheck 0, vitest 6816 pass/0 fail, bun 1600/1. That one failure is a load-induced 5000ms timeout on a test unchanged by the range that passes 3/3 isolated — not a regression@high | — |
| KD2 | retro finding 1 FALSIFIED: --ac works (single/repeated/unknown-id + control, via the attested ac_ref multiset). Real defect is the plan-wide DEFAULT write scope over an evidence-derived claimed set; correction doc knowledge-re-measuring-finding-1-falsified-its-cause-lore@high | — |
| KD3 | Four-perspective review corrected three of my draft claims: assertScopeFreeze has ZERO production call sites (tested but unwired = false assurance), planBundleSchema has no phases (phase-scope reuse rejected), plan vs phase ac_scope differ on min(1)@high | — |
| KD4 | finding 2's gap is narrower: lore invalidate already writes deprecated/superseded (validity-service.ts:307/310), so only proposed-to-accepted is missing; the right precedent is --kind (set.ts:472 already writes extra via read-merge-write), not --slug@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: Approve specs before planning: lore review <spec> then lore approve <spec> — plan-promote demands an approved ancestor spec with at least one structured AC. Main line: spec-declared-scope-attestation-contract-task-owned-ac-scope (9 ACs)
- NS2: Same review+approve for the other three: spec-adr-decision-status-has-a-create-surface-and-no-cli-update (7 ACs), spec-a-test-case-s-timeout-budget-must-be-declared-when-its (5), spec-report-issue-has-no-specified-concurrency-contract-ac-072 (5)
- NS3: Then one plan per spec, phases, tasks with --anchor; dispatch lore-implementer per task in its own worktree with a distinct LORE_ACTOR. ADR adr-lore-verify-s-attested-evidence-scope-belongs-to-the-task carries D1-D8 and must not be re-litigated in planning
- NS4: report-issue spec D1: no implementation commit before an evidence task records WHICH layer refuses the second concurrent writer and with what error class; the loud-boundary vs declared-bound-serialization choice depends on that fact
- NS5: Two package.json scripts are implied by ACs and must be authored: check:test-budgets (AC-TB-1/3/5) and check:no-timer-retry (AC-IC-3)
- NS6: ADR is decision_status accepted but doc status draft (adr approve needs a SPEC-103 M2 judgment). Residue kept on purpose: branch worktree-agent-ada3640f23484b4b5 (superseded content; -d refuses, -D only on request)
