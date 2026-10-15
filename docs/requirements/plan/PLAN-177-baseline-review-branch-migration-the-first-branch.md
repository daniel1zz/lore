---
id: PLAN-177
type: plan
role: plan
title: "Baseline review-branch migration — the first branch eligible to arm the citation gate"
status: archived
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: SPEC-157
phases:
  - {name: "P0-Freeze", description: "Blind probe frozen before any review-branch document"}
  - {name: "P1-Build", description: "Excavate, apply, census coverage to 0 gaps, rule-side citations"}
  - {name: "P2-Cite", description: "Place and cite (or exempt) every criterion of specs in the review branch"}
  - {name: "P3-Measure", description: "Blind reader + separate grader; fidelity judge"}
  - {name: "P4-Assess", description: "Assessment against AC-BLS2-16"}
  - {name: "P5-Remediate", description: "Owner choice A: re-probe frozen first, remediation by method step 6, re-measure, re-assess"}
---
# Plan: Baseline review-branch migration — the first branch eligible to arm the citation gate

Parent: spec-baseline-slice-2-completeness-census-per-branch-citation (SPEC-157). Exit criterion: AC-BLS2-16 (registered before this plan and before any measurement). Authorised by the project owner choosing option B on 2026-10-09: AC-BLS2-13 keeps "probe frozen before the branch's first document", so the already-populated specification and execution branches stay in report mode and a NEW branch, migrated probe-first, becomes the first armable one.

## Goal
Migrate the `review` branch (owner-approved branch list, PRD line "Lore's own baseline branches") with migration method v2 including the mechanized completeness step, and measure every AC-BLS2-16 bar. Arming the branch is NOT in this plan: it is a separate owner-visible config change taken only after this plan's assessment passes.

## Why review
- Smallest remaining branch adjacent to two populated ones (the specification branch's Boundary sends "review judgment, approval and rejection mechanics, lifecycle transitions in general" to review), so cross-branch probe questions are possible with three populated branches.
- It was expected to carry a live defect (#64), exercising method step 3's suspected-defect path. #64 turned out to be accepted design (Decisions Log, W2), so that motivation lapsed for #64; the path is still exercised by the suspected-defect rules recorded for #65-#70 (unconfirmed, with open questions).

## Scope of the branch (input to every agent; boundaries finalised by the placement ADR)
Commands: `lore review` (AI judge, excluding `--staleness`, which is hygiene), `lore approve`, `lore reject`, `lore pending`; the generic status transitions of `VALID_TRANSITIONS` as they apply to review. Spec-specific admission conditions stay in the specification branch (leaf SPAP).

## Invariants
- I1 Probe precedes what it measures: attempt 1's probe created_at < the review branch doc's created_at; the re-probe's created_at < the first write of the remediation revision (W6). Measured per-doc with `lore get`, never `lore list`.
- I2 No repo `.lore/` writes from tests; no source code changes in this plan (defects found go to `lore report-issue`).
- I3 Every rule checked against code; a rule is established/observed only with a citing live script-mode AC whose named test fails if the rule is false, else unconfirmed with an open question.
- I4 Every agent-reported oracle verdict (coverage exit code, counts) is re-run by the orchestrator on main before it is accepted.
- I5 Bars are never moved after measurement; any oracle change is recorded as a re-baseline in the Decisions Log. Two owner-chosen re-baselines on 2026-10-09, both in the SPEC-157 amendment log: (a) WHICH probe may decide bar 1 (one re-probe per remediation revision by an author who never read the branch); (b) the bar-1 THRESHOLD, from absolute >= 9/10 to baseline >= corpus-only control + 1.0 with 0 confident-wrong. (b) WAS decided after both probes and both controls were scored, and its +1.0 equals the observed margin on the deciding probe: it is a post-hoc bar, not an independent oracle, and is recorded as such. All earlier scores stay on record and are never replaced.

## Execution constraint
Agents analyse read-only and return structured drafts; the orchestrator applies them from main as agent:main-orchestrator. `lore ac cite` never demotes an approved spec (its own help text), so citation writes do not freeze downstream claims.

## Phases
- P0 Freeze: blind probe set (independent agent: reads code only, never baseline/pilot/probe docs; 10 questions, >= 6 review, rest spec/execution, >= 4 prose-vs-code; answer key with code locations).
- P1 Build: excavate the review branch (leaves, rules, glossary, Boundary) with `lore baseline sites|map` per leaf; apply; `lore baseline coverage` to 0 gaps; rule-side citations and downgrades.
- P2 Cite: find every live spec with criteria about review outcomes; place each criterion per the placement ADR; cite, or exempt with reason; record the spec list and counts.
- P3 Measure: blind reader (questions + exported spec/execution/review baseline docs only) and a separate grader; an independent fidelity judge over every review (criterion, cited rule) pair.
- P4 Assess against AC-BLS2-16 (attempt 1: FAIL on bar 1).
- P5 Remediate (owner choice A): W5 freeze a re-probe (fresh author who never read the branch, code only, never sees attempt 1; questions checked disjoint from attempt 1 by the orchestrator) before W6's first write; W6 apply method step (6) to the branch (caller-visible outcomes on every outcome rule; edit-vs-approval boundary stated or cross-referenced), the W6 agent sees neither probe; re-run bars 2-4, and bar 5 if cites change; W7 blind reader + separate grader under the W3a scoring rules; W8 re-assessment with both attempts. Exit: all five AC-BLS2-16 bars, else stop and return to the owner.

## Risk register
| Risk | Impact | Mitigation |
|---|---|---|
| Census misses review refusal paths (as #59/#60 did) | H | coverage re-run on main; AC-BLS2-15 guard already on main |
| Binary cannot run the census (#58) | M | census run from source (`bun run packages/lore/src/index.ts`) |
| Placing specs is the large step; uncited legacy criteria in many specs | M | exemptions with recorded reasons, cap checked before each exempt |
| Probe author leaks branch wording | M | probe author forbidden from reading any baseline doc; questions may not quote rule text |

## Stop rule
If any AC-BLS2-16 bar fails, stop and return the direction to the owner; no re-run without an explicit owner choice.

## governance_mode: unattended

## Cap overflow
If placing the review branch's criteria would need exemptions beyond the corpus-wide 10% cap (the CAS in `lore ac exempt` refuses the write), that is a failure of AC-BLS2-16 bar 4: stop and return to the owner. No criterion is left uncited to fit under the cap.

## Placement ADR
Existing and accepted: `adr-an-acceptance-criterion-is-placed-by-the-business-outcome` (amended after pilot v2). This plan consumes it; it does not produce it.

## Exit criterion record (verbatim; structured ACs on the parent spec are the SSOT — issue #40: the plan judge sees only the plan body)
```json
{
  "id": "AC-BLS2-16",
  "statement": "Review branch migration exit (method v2, owner choice B 2026-10-09; re-probe and relative probe bar by owner choices A 2026-10-09): (1) on the deciding 10-question probe (every question assigned by the placement ADR to specification, execution or review, at least 6 to review) — either frozen before the first review-branch document (attempt 1) or a NEW set written from code only by an author who never read the branch and frozen before the remediation revision — a blind reader holding all three populated branches scores at least 1.0 point above a corpus-only control reader on the same probe, with 0 confident-wrong for the baseline reader, each graded by a separate agent under the same fixed rules, every attempt and its control kept on record; (2) lore baseline coverage on the review branch exits 0; (3) 0 established or observed review-branch rules lack a citing live script-mode AC whose named test fails if the rule is false; (4) every live spec placed in the review branch has 100% of its live criteria cited or exempted, with exemptions <= 10% of live criteria corpus-wide; (5) an independent judge finds >= 90% of the review branch's (criterion, cited rule) pairs faithful",
  "verify": {
    "mode": "ai",
    "rubric": "Pass only if the review-branch assessment records each number: the deciding probe's creation time precedes the first review-branch document (attempt 1) or the remediation revision's first write (re-probe, with the author's never-read statement); every attempt's baseline score and corpus-only control score kept on record; probe size 10 with >= 6 review questions; baseline minus control >= 1.0 on the deciding probe and baseline confident-wrong == 0, from graders separate from the readers; coverage exit code 0; established|observed review rules without a citing script-mode AC == 0; uncited-unexempted criteria in specs placed in review == 0 and corpus-wide exemptions <= 10% of live criteria; judged-faithful pairs / judged pairs >= 0.9, re-measured after remediation if rules or cites changed. Fail if any number is missing, any bar moved after its measurement without an amendment-log entry, or more than one re-probe was taken for one remediation revision"
  }
}
```


## Decisions Log
- 2026-10-09 W1a: claim-scoped worktree authoring could not create leaves or set the branch body (#72); the excavator returned a draft + build script, verified on a throwaway corpus; the orchestrator read the whole script and applied it from main.
- 2026-10-09 W2: BR-281 re-classified from suspected defect to established (accepted ADR `adr-an-escalate-gates-every-doc-type-a-reject-stays-scoped-to`); #64 closed as filed in error.
- 2026-10-09 W3b: AC-ESC-5 repointed BR-277 -> BR-278 after the fidelity judge; bar 5 stays 19/20 as measured; bars 2-4 re-run PASS.
- 2026-10-09 Attempt 1 FAIL (bar 1, 8.5/10, 0 confident-wrong): `knowledge-review-branch-migration-assessment-against-ac-bls2-16`. W3a deprecated (its fail evidence stays; superseded by W7); W4 archived (assessment recorded).
- 2026-10-09 Owner choice A: AC-BLS2-13/16 re-baselined (SPEC-157 amendment log) to allow one re-probe per remediation revision by an author who never read the branch; PRD BL-7 gains method step (6). Phase P5-Remediate added (W5-W8).
- 2026-10-09 W5: re-probe author's first set overlapped attempt 1 on 7 of 10 behaviours; the plan's disjointness check was enforced by sending the author a behaviour list (not attempt 1's questions or answers); 7 questions replaced before freezing.
- 2026-10-09 W6: 43 rule rewrites + BR-315..319 (method step 6), applied from main after a length/duplicate check; bars 2-4 re-run PASS.
- 2026-10-09 Attempt 2 (re-probe) 7.5/10, 0 CW — FAIL under the absolute bar (`knowledge-review-branch-migration-re-assessment-attempt-2`). Fidelity re-judged on rewritten rules: 19/20; AC-ESC-5's cite removed and exempted as no-rule after two judges rejected BR-277 and BR-278 respectively.
- 2026-10-09 Owner choice A (corpus-only control first): control 7.0 and 6.5 on the two probes (`knowledge-corpus-only-control-on-both-review-branch-probes`). Owner choice A again: bar 1 re-baselined to relative (baseline >= control + 1.0, 0 CW). Under it: PASS at exactly +1.0 on the deciding re-probe. W7/W8 archived with relative-bar evidence; W7's earlier fail row kept.
- Arming the review branch is outside this plan (owner decision on config).
- 2026-10-09 Bar 4 re-measured after AC-ESC-5's exemption: 26 criteria, 0 uncovered, 10 active exemptions of cap 102 (1.0%), rb-draft/bar4.py exit 0.
- 2026-10-09 Plan review escalated the post-hoc relative bar; owner choice A: the review result is a PROVISIONAL pass. Then FAST MODE (owner): the review confirmation is folded into the single cross-branch probe of AC-BLS2-13/17, run by the fast-mode plan after all 12 branches exist. This plan closes with AC-BLS2-16 as a provisional pass; AC-BLS2-17 belongs to the fast-mode plan.
