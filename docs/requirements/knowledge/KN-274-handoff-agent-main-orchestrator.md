---
id: KN-274
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
links:
  - {id: KN-281, type: supersedes}
---
> ⚠ INVALIDATED 2026-07-31T12:24:22.979Z — superseded by knowledge-handoff-agent-main-orchestrator-52; KD3 asserted the four plans closed 'visible AS scope-undeclared rather than silently passing'. Independent review measured the opposite: at base commit d373654 meets_floor included zeroAttestedTasks.length===0, so plan-close would have DENIED all four archivals. -52 carries the corrected judgment plus the review's findings and the two new CRITICAL/ESCALATED tasks.

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
| KD1 | AC-TB-1 policy DECIDED (user delegated judgment): baseline-scoped enforcement + auditable exemption ledger + ledger-completeness fail-loud, NOT declaring 55 unmeasured budgets. adr-a-newly-armed-structural-oracle-enforces-from-a-baseline, approved after two independent reviews@high | — |
| KD2 | Systemic finding: all 21 ACs were self-reported (attested ratio 0.00 on all 4 plans). Root cause is protocol — implementers use lore evidence, nobody ran lore verify — and the wave's own new ac_scope gate then blocks the attested path. Three mechanism tasks filed@high | — |
| KD3 | All 5 residual suite failures are FOREIGN red-first oracles from commit 333b556, not ours. Decisive method: build at the commit that has the red oracles but EXCLUDES our merge, and reproduce. Diff-plausibility reasoning was wrong here@high | — |
| KD4 | Session closed: 4 plans + 10 tasks archived, 82 specs no drift, tree clean at ea3c53d, all 10 agent worktrees removed. Full-suite green is NOT the close criterion in a shared checkout — 'no failure attributable to this wave' is@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: Ready set: 5 adhoc tasks. CRITICAL task-lore-evidence-must-refuse-a-t-filtered-pass-with-no closes the guard gap on the ONLY path subagents use to report results; land it before the next multi-agent wave, or that wave's evidence is unguarded too
- NS2: HIGH: task-land-the-baseline-ledger-policy-for-check-test-budgets-55 implements the ADR; task-spec-first-require-ac-scope-at-task-creation-so-the-runner is SPEC-FIRST, write the tech-spec before any code
- NS3: HIGH, both with causal chains already verified at source: task-meets-floor-renders-pass-while-the-declared-scope-conjunct and task-archive-sweep-gate-disable-is-silently-inert-a-wholesale (filed as a CLASS, gate-config-disable also anchored)
- NS4: IC AC-IC-1's 50-run harness may be near-vacuous (97/100 natural pairs both exit 0) and may count the dlopen crash class as a conforming loud failure. Re-run AC-IC-1/2 only AFTER the co-resident libsql lazy-load fix lands — that crash class is what 333b556 documents
- NS5: Root CLAUDE.md has ~5 bytes headroom under its 24576 ceiling; the next substantive addition must trim first. Two stale counts were removed this session (subcommands, LoreError codes) — prefer pointing at the definition site over restating any number there
- NS6: The 4 archived plans carry attested ratio 0.00. Retroactive escape: lore verify <plan> --ac <id> (absent scope + explicit --ac runs the named ids). Assessments name AC-DS-1/5/6 and AC-IC-6's harness-calls-classifier clause as highest value
