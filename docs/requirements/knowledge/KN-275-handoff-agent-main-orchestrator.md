---
id: KN-275
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-10-10
tags: []
parent: PRD-001
links:
  - {id: KN-274, type: supersedes}
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
| KD1 | CORRECTION to handoff -50: its claim that the four plans closed 'visible AS scope-undeclared rather than silently passing' is FALSE. Measured at base d373654, meets_floor included zeroAttestedTasks.length===0, so plan-close would have DENIED all four archivals@high | — |
| KD2 | The session merged VS T3, which removed that conjunct, then closed four plans through the resulting hole — 76 min after itself filing a HIGH task naming it. A co-resident session in the same window declared ac_scope and earned attestation, so the attested path was reachable@high | — |
| KD3 | Independent review (lore-reviewer): 6 PASS / 4 VIOLATION over 10 invariants, 7/7 deterministic checks clean, 10 findings of which 6 uncatalogued. A 7/7 artifact score coexisting with a dark gate is the review's headline@high | — |
| KD4 | ESCALATED: attestation_exempt is a gate-read field with NO writer verb — recommended 2026-07-24, verified still 0 hits in adapters/cli while sibling prd_sync_exempt has lore outline exempt. The missing auditable opt-out is what made the gate hole load-bearing@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: 7 adhoc tasks ready. CRITICAL: task-plan-close-must-block-when-the-coverage-conjunct-is-scope and task-lore-evidence-must-refuse-a-t-filtered-pass-with-no. Land the first BEFORE closing any further plan, or the next close is equally dark
- NS2: HIGH: task-escalated-recommended-2026-07-24-still-unbuilt-attestation (the twice-recommended writer verb), task-spec-first-require-ac-scope-at-task-creation-so-the-runner, task-land-the-baseline-ledger-policy-for-check-test-budgets-55
- NS3: HIGH: task-meets-floor-renders-pass-while-the-declared-scope-conjunct, task-archive-sweep-gate-disable-is-silently-inert-a-wholesale. All 10 findings with root causes + mechanizations: knowledge-session-process-review-2026-07-31-ten-agent-two-wave
- NS4: UNREMEDIATED from the review: V3 the IC spec was re-promoted via set --status approved, skipping the judgment gate — run lore review on its current version. V4 the VS spec still pins 'all three refusal paths' while four ship. V5 AC-TB-1 still asserts a false repo state
- NS5: Recovery for the 0.00 attestation is known-good (the 2026-07-28 review re-earned it against archived tasks): lore verify <plan> --ac <id> per evidence-bearing task. Do this before treating the four archived plans as verified
- NS6: Catalog gaps the review proposes adding: I7b vacuity accounting (denials vs notApplicable per gate), I12 self-weakening (merged a predicate change then transited that checkpoint), I13 orchestrator-tier identity. Surface is a personal skill file, so it is NOT distribution-first
