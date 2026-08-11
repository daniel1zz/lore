---
id: KN-290
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-095
---
# Handoff — agent:main-orchestrator

SCOPE: 4 decisions + 5 next steps = 9 items to account for

## Plan

plan-implementation-declared-scope-attestation-contract

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | All four specs approved (VS v51, DS v11, TB v7, IC v22). The judge earned its keep over 4-5 rounds: a universal-negative AC with no oracle, assertions bound to prose not literals, a self-contradictory fixture, and a control that would prove nothing under Option 2@high | — |
| KD2 | spec-promote's ORACLE_COVERAGE_INSUFFICIENT (needs >=1 script AC on oracle 'test') forced both small specs to grow a PURE unit-testable core instead of staying e2e-only: decision-status-validation.ts and a concurrency outcome classifier@high | — |
| KD3 | Undeclared scope resolves to the APPLICABILITY verdict (notApplicable, reason scope-undeclared) — not pass, not block — reusing what the predecessor ADR shipped for no-evidence, so a legacy plan is visible AS undeclared@high | — |
| KD4 | lore ready --json puts records at data.ready.records, NOT data.records; my first assertion read 0 tasks across all four plans and was wrong. The record.ready===true filter rule still holds@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: Dispatch is next: git pull --rebase origin main FIRST, then one lore-implementer per ready task in its own worktree with a distinct LORE_ACTOR; the implementer claims from inside its own worktree, never the orchestrator for it
- NS2: 6 ready: main-line T1 (schema + scope writer + freeze wiring), T3 (facts + gate), T4 (known_false_pass); DS T1 (pure validation module); TB T1 (structural oracle); IC T1 (evidence). Four more unblock as their T1 lands
- NS3: IC T1 is an EVIDENCE task: record which layer refuses the second concurrent writer, then write the literal exit code and stderr template into the spec Contract Details before IC T2 commits anything
- NS4: Check anchor_conflicts in lore ready --json before parallel dispatch. Main-line T3 (evidence-panel.ts, gate-predicates.ts) and T4 (predicate-contracts.ts) are disjoint and can run concurrently
- NS5: After each agent returns: verify git log on the branch, merge --no-ff, then lore done from the main checkout (implementers stop at lore release). Full suite only after merge, on main, clean tree
