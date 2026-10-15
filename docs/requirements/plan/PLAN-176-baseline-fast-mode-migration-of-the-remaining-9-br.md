---
id: PLAN-176
type: plan
role: plan
title: "Baseline fast-mode migration of the remaining 9 branches, then one cross-branch probe"
status: archived
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: SPEC-157
phases:
  - {name: "P0-Freeze", description: "Cross-branch probe frozen first"}
  - {name: "P1-Excavate", description: "Nine branches excavated in parallel, applied sequentially, coverage 0 gaps"}
  - {name: "P2-Measure", description: "Sampled fidelity; cross-branch probe vs corpus-only control"}
  - {name: "P3-Assess", description: "Assess against AC-BLS2-13/17/18"}
  - {name: "P4-Remediate", description: "Owner choice A: full fidelity pass, census fix #94, one re-probe"}
---
# Plan: Baseline fast-mode migration of the remaining 9 branches, then one cross-branch probe

Parent: SPEC-157. Exit criteria: AC-BLS2-18 (each branch migrated at 0 coverage gaps), AC-BLS2-13 (arming exit: cross-branch probe vs corpus-only control, sampled fidelity), AC-BLS2-17 (review confirmation inside the cross-branch probe). Authorised by the owner on 2026-10-09 ("migrate quickly; historical data need not be this strict", fast mode option A).

## Branches and their commands (input to excavators; boundaries finalised by each branch body and the placement ADR)
| Branch | Commands |
|---|---|
| corpus | create, get, set (generic edits), delete, list, search, tree, link, unlink, log, diff, restore, invalidate, export-docs, sync-docs, migrate |
| product-baseline | baseline, rule (not citing), requirement, outline |
| session | bootstrap, handoff, feed session-resume, seat, session, territory |
| hygiene | status checks, archive, review --staleness, audit, trace |
| autonomy | assess, eval, calibration, uat, gate, feed (checkpoints), ledger fast-track |
| issue-loop | report-issue, issue, issues |
| distribution | init, setup, governance, dashboard packaging |
| sync | sync, serve, agent |
| context | context, fragments |

## Method (fast mode)
Kept: every rule checked against code (file:line); `lore baseline coverage` exit 0 per branch, re-run by the orchestrator on main; established/observed only with a live script-mode citing criterion whose test fails if the rule is false, else unconfirmed/undecided with an open question; method step (6) (caller-visible outcome: exit code class, version/audit row). Dropped: per-branch probes; 100% citation of legacy criteria; fidelity over every pair (sampled, <= 20 per branch).

## Execution
Excavators are read-only and run in parallel (one per branch); each returns data.py + build.py rehearsed on a throwaway corpus (pattern of the review branch, since claim-scoped worktrees cannot create leaves, #72). The orchestrator reads each script, applies them one at a time from main, and re-runs coverage. Defects go to `lore report-issue`; no source code changes.

## Invariants
- I1 The cross-branch probe's created_at < the first document of any of the 9 branches (attempt 1); the P4 re-probe's created_at < R1's first corpus write (AC-BLS2-13 as re-baselined 2026-10-09, SPEC-157 amendment log).
- I2 No repo .lore/ writes from tests; no code changes EXCEPT the #94 census fix in P4 (R2 RED by a tester, R3 implementation by an implementer, each in its own worktree, merged with the task slug and verified on main), which is the only code this plan touches.
- I3 Every agent-reported verdict re-run by the orchestrator on main.
- I4 Bars as registered in SPEC-157; any change goes to its amendment log.

## Phases
- P0 Freeze: 20-question cross-branch probe (author code-only, never read any branch): >= 1 question per area for all 12 areas, >= 2 review questions (tagged `area: review`, reported separately for AC-BLS2-17), <= 3 per area, >= 6 prose-vs-code. Recorded as evidence: the author's never-read statement (verbatim), the probe doc's created_at, and the created_at of the first of the 9 branch docs (I1).
- P1 Excavate+apply: 9 branch tasks.
- P2 Measure: sampled fidelity; cross-branch probe with baseline reader (export of all 12 branches) + corpus-only control (live prd/spec/adr/knowledge, no baseline/probe/assessment/handoff docs, BR ids masked) + separate graders. Fixed scoring rules (identical to the review attempts): per question 1 = every sub-question answered and correct (exit codes count only when asked); 0.5 = >= 1 sub-question correct, none contradicted, some part missing or 'not stated'; 0 = any sub-part contradicts the key or nothing correct; confident-wrong = marked sure AND a sub-part contradicts the key; an exit code the reader says is not given counts as missing. Bar: baseline - control >= 2.0 of 20, baseline confident-wrong 0; review questions: baseline confident-wrong 0.
- P3 Assess against AC-BLS2-13/17/18; arming is a separate owner decision. The orchestrator re-runs on main, for ALL 12 branches (the 9 new ones plus specification, execution, review), `lore baseline coverage <branch>` (exit 0) and the established/observed-uncited count (0), and carries AC-BLS2-12/16 results forward.

## Per-branch record (AC-BLS2-18)
The orchestrator writes it when each W1 task closes, into that task's evidence (captured oracle output) and into the W4 assessment table: branch, leaf count, rule count by confidence, coverage exit code from the main re-run, established/observed rules without a live script-mode citation.

## Risk register
| Risk | Impact | Mitigation |
|---|---|---|
| Parallel excavators disagree on boundaries / duplicate rules | M | command table above is exclusive; orchestrator applies sequentially and checks duplicate statements |
| Census gaps in big branches (corpus) | M | coverage re-run on main; split the branch task if > 80 gaps |
| A weak branch hides inside one shared probe | M | accepted cost of fast mode (SPEC-157 amendment log) |

## Stop rule
If AC-BLS2-13 item 3 fails, stop and return to the owner.

## Exit criteria record (verbatim; issue #40)
```json
[
  {
    "id": "AC-BLS2-13",
    "statement": "Fast mode (owner choice A 2026-10-09): the gate is armed on a branch only after ALL 12 branches are migrated and (1) every branch's leaves report 0 coverage gaps; (2) 0 established or observed rules in any branch lack a citing live script-mode criterion; (3) one cross-branch blind probe of 20 questions, written from code only by an author who never read any baseline branch, frozen before the first document of the 9 fast-mode branches — or, after a recorded failed attempt, ONE re-probe per remediation revision frozen before that revision's first corpus write, earlier attempts kept on record — is answered by a reader holding all 12 branches at >= 2.0 points (of 20) above a corpus-only control reader on the same probe, with 0 confident-wrong for the baseline reader, separate graders, the same fixed scoring rules as the review attempts; (4) a sampled fidelity judge finds >= 90% faithful over up to 20 (criterion, rule) pairs per branch, drawn after the last citation addition or repointing (removals of cites judged unfaithful may follow the measurement and are recorded, since a removal cannot lower fidelity). Legacy criteria are NOT required to be cited or exempted: the gate refuses only added or revised criteria",
    "verify": {
      "mode": "ai",
      "rubric": "Pass only if the fast-mode assessment records: per-branch coverage exit 0 for all 12 branches; established|observed rules without a live script-mode citation == 0; the deciding probe's creation time < the first document of the 9 fast-mode branches (attempt 1) or < the remediation revision's first corpus write (re-probe), its author's never-read statement, 20 questions, every earlier attempt's scores; baseline score, control score, delta >= 2.0, baseline confident-wrong == 0; fidelity faithful/judged >= 0.9 with per-branch sample sizes and a seed drawn after the last citation addition or repointing (later removals of judged-unfaithful cites listed). Fail if any number is missing or two re-probes fall within one remediation revision"
    }
  },
  {
    "id": "AC-BLS2-17",
    "statement": "Review branch confirmation (fast mode, owner choice A 2026-10-09): the review branch's provisional pass under the post-hoc relative bar is confirmed only by the fast-mode cross-branch probe of AC-BLS2-13 (frozen after the relative bar's registration), whose review questions (>= 2 of 20) the baseline reader answers with 0 confident-wrong; no separate review-only probe is run",
    "verify": {
      "mode": "ai",
      "rubric": "Pass only if the fast-mode assessment reports the review questions of the cross-branch probe separately: count >= 2, baseline confident-wrong on them == 0; and the cross-branch probe passed AC-BLS2-13 item 3"
    }
  },
  {
    "id": "AC-BLS2-18",
    "statement": "Each of the 9 fast-mode branches (corpus, product-baseline, session, hygiene, autonomy, issue-loop, distribution, sync, context) exists as a branch with Boundary, glossary and leaves; every rule was checked against code (file:line recorded by its excavator); its leaves declare their commands and lore baseline coverage on the branch exits 0; established or observed rules each have a live script-mode citing criterion, all other rules are unconfirmed or undecided with an open question",
    "verify": {
      "mode": "ai",
      "rubric": "Pass only if, for each of the 9 branches, the fast-mode record lists: leaf count, rule count by confidence, coverage exit code 0 re-run on main by the orchestrator, and 0 established|observed rules without a live script-mode citation. Fail if any branch is missing or any number is absent"
    }
  }
]
```


## P4 Remediate (owner choice A after attempt 1, 2026-10-09)
Attempt 1 (`knowledge-fast-mode-migration-assessment-12-branches-populated`): not armable — baseline 17 vs control 13.5 but 1 confident-wrong (BR-704's example, a false belief also held by the corpus); sampled fidelity 176/224 = 78.6%; autonomy and sync blocked by #94. Remediation revision:
- R5 freeze a new 20-question cross-branch re-probe (author never read any branch, code only, never saw earlier probes) BEFORE R1's first corpus write — the one re-probe allowed for this remediation revision.
- R1 full fidelity pass: 401 cites outside the W2 sample judged by 6 independent judges; every unfaithful cite (incl. the 48 from W2) removed, repointed only to a judge-named rule in the same branch; rules left without a live script-mode citation downgraded to unconfirmed with an open question.
- R2 RED (tester, worktree) then R3 implement (implementer, worktree) for #94; merged with the task slug; scoped oracle in the worktree, full suite on main.
- R4 re-cover autonomy and sync; re-run coverage for all 12 branches.
- R5b measure: baseline reader and corpus-only control on the re-probe, separate graders, same fixed rules; a fresh fidelity sample with a new seed by new judges.
- R6 re-assess; stop rule unchanged.

## Decisions Log
- 2026-10-09 W1: autonomy and sync applied in full mode (no leaf skipped); their coverage failures recorded, not hidden. The sync AC-LL-9 rule and product-baseline BR-646/BR-650 held at unconfirmed (test does not pin the stated exit code; criterion at its 10-cite cap).
- 2026-10-09 W3: BR-704's false example corrected after measurement; item 3's result stays as measured.

- 2026-10-09 P4 done. R5 re-probe frozen before R1's first write; R1 removed 217 unfaithful cites (full pass 408/625 = 65.3% faithful), 114 rules downgraded; R2/R3/R3b fixed #94 in code (merged with task slugs; RED case corrected sync status -> sync push, assertion unchanged; asset allowlist replaced an exclusion rule that would have hidden dotted code names); R4 mapped autonomy's UAT/eval leaves (BR-958 added).
- 2026-10-09 Attempt 2 PASS (`knowledge-fast-mode-re-assessment-after-remediation-ac-bls2-13`): probe 16.5 vs control 13, baseline CW 0; fidelity 205/224 = 91.5% (seed 20261010); 12/12 branches coverage 0. After measurement, the 19 cites the fresh judges found unfaithful were removed (9 rules downgraded) and all 12 branches re-verified PASS; bars not moved.
- W2/W3 deprecated (fail evidence kept; superseded by R5b). Arming is outside this plan.
- 2026-10-09 Plan review escalated that the 19 post-measurement removals break item (4)'s 'drawn after the last citation change'. Owner choice A: AC-BLS2-13 item (4) re-baselined to 'after the last citation addition or repointing; later removals of judged-unfaithful cites are listed' (SPEC-157 amendment log v69). Removals after the seed-20261010 sample: the 19 pairs judged not_faithful in fp2/verdicts1-3 (9 rules downgraded: BR-11, BR-94, BR-363, BR-494, BR-532, BR-687, BR-703, BR-815, BR-816). No addition or repointing followed the sample.
