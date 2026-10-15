---
id: PLAN-168
type: plan
role: plan
title: "Baseline slice 2c: C7 fidelity sampling command and BL-15 resume rule diff"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: SPEC-157
phases:
  - {name: "2c", description: "fidelity + resume diff"}
---
# Baseline slice 2c: C7 fidelity sampling command and BL-15 resume rule diff

governance_mode: unattended (owner: "继续，快速全部做完")

SPEC-157 §C7 and goal 4 ("2c: C7 fidelity sampling and the BL-15 resume diff"). Replaces the ad-hoc scratchpad sampler/recount scripts used for AC-BLS2-13/14 (assess finding: evidence from an ephemeral script) with a shipped, deterministic command whose record lives in the corpus. Rules BR-963..966.

## Acceptance
AC-BLS2-21 (fidelity command), AC-BLS2-22 (resume diff). After landing, AC-BLS2-14 is re-measurable by `lore baseline fidelity --size 110 --seed <s> --judges 2 --ai`.

## Invariants
- Sampling is deterministic and read-only on rules, citations and confidence (verdicts flag, never certify).
- Rule/criterion text reaches the judge only inside a nonce delimiter as data.
- No silent fallback: unreadable judge reply -> exit 6, no record; AI off on agent surfaces unless --ai.
- Resume diff compares against the claim timestamp from the claim record; a missing claim time is reported, never assumed.
- All 12 branches stay at 0 coverage gaps at plan close; new census sites mapped by the orchestrator after merge (task 5).

## Tasks
1. RED fidelity (tester) — blocks 3
2. RED resume diff (tester) — blocks 4
3. Implement fidelity command (implementer)
4. Implement resume diff (implementer)
5. Orchestrator: declare `baseline fidelity` on baseline-sample-citation-fidelity, map new sites, all-12 coverage exit 0

## Risk register
| Risk | Impact | Mitigation |
|---|---|---|
| Prompt injection through rule text | M | nonce delimiter + strict verdict parsing (exit 6 on anything unparseable) |
| Judge variance near the bar | M | --judges 2 with adjudication; disagreements listed |
| Resume output grows noisy | L | only governing rules of the claimed task, only changes after claim |


## Answers to the plan review (2026-10-10)
- **Non-business exclusions** (SPEC-157 C2/C7): in scope — rule BR-967, AC-BLS2-23, same command with `--exclusions`, same test file (second describe), tasks 1 and 3 cover it.
- **Two-judge disagreement** (BR-965): each disagreement is listed; an adjudicating third verdict decides it; with no adjudicator the pair counts as NOT faithful and stays in the denominator. Never dropped from the denominator.
