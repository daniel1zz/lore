---
id: KN-281
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
> ⚠ INVALIDATED 2026-07-31T10:20:45.887Z — superseded by knowledge-handoff-agent-main-orchestrator-50; Written mid-close-out with AC-TB-1 still pending a user decision. That decision was made and landed as an approved ADR, and three mechanism tasks were filed afterwards, so #48 understates the ready set and misreports the open questions. #50 is the session's single accurate resume point.

# Handoff — agent:main-orchestrator

SCOPE: 4 decisions + 5 next steps = 9 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | All 10 tasks + 4 plans archived. All 21 script ACs re-run by the orchestrator on merged main and judged by MATCHED COUNT, never exit code — a zero-match vitest -t filter exits 0 with all tests skipped (knowledge-a-zero-match-vitest-t-title-filter-exits-0-the-sixth)@high | — |
| KD2 | All 5 remaining suite failures (3 vitest libsql-lazy-load, 2 bun libsql-store-selection) are FOREIGN red-first oracles from commit 333b556, landed on main by a co-resident session. Proven by rebuilding at 0878d93 (no IC T2) and reproducing them identically@high | — |
| KD3 | The declared-scope applicability verdict worked on first real use: all four plans closed with audited gate_not_applicable rows, visible AS scope-undeclared rather than silently passing@high | — |
| KD4 | attested_evidence_ratio is 0.00 on all 4 plans: the wave used lore evidence (self-reported) throughout, never lore verify (runner-attested). And lore verify now refuses a task with no ac_scope, so the wave's own new gate blocks its own attestation path@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: PENDING USER: AC-TB-1 retroactive policy. check:test-budgets exits 2 with 55 pre-existing violations across 28 files (spawn 3-9; 31 merely touch the 3 threshold). List delivered; user reviewing before exemption-vs-sweep. TB T2 closed 1 instance, so tree-wide exit 0 has no supporting run
- NS2: Attested re-verification: all 4 assessments cite attested ratio 0.00 + no diff. Route: lore verify <plan> --ac <id> (VS T2's absent-scope escape) or lore scope add on the archived tasks first. Highest value: AC-DS-1/5/6, AC-IC-6 harness-calls-classifier, AC-VS-5 cross-message distinctness
- NS3: IC assessment flags AC-IC-1's 50-run harness near-vacuous: 97/100 natural pairs both exit 0, and the dlopen crash class (~1.5%/invocation, reproduces on read-only lore list) may count as a conforming loud failure. Resolve AFTER the co-resident libsql fix lands, then re-run AC-IC-1/2
- NS4: Two adhoc tasks filed, unstarted, causal chains verified at source: task-meets-floor-renders-pass-while-the-declared-scope-conjunct (meets_floor now ratio-only; panel renders pass while the gate blocks) and task-archive-sweep-gate-disable-is-silently-inert-a-wholesale (filed as a CLASS)
- NS5: DS assessment wants a knowledge doc for the decision_status closed value set + lore invalidate hand-off. DS+IC both recommend folding observable values into -t names (e.g. 'non-adr target exits 4'). Also: root CLAUDE.md has 5 bytes headroom under its 24576 ceiling
