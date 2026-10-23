---
id: KN-608
type: knowledge
role: knowledge
title: "Assessment: Fix #104: the site census follows dependency-injected functions (2026-10-10)"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-23
tags: []
parent: PLAN-169
links:
  - {id: PLAN-169, type: informs}
---
# Assessment: partially_met (62/100)

Scope: plan `01M4HVAAKGW9TBKT3HMRPNH5T4`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLS2-20 | 74 | RED (expected-fail) then pass on the 10-test oracle; diff implements static DI resolution. Insertion oracle loosened post-RED by orchestrator, documented, independently reviewed, and backstopped by a SQLiteStore.insertDocSync pin. Single-binding soundness concern filed as #118. | task-red-for-104-ac-bls2-20 (expected-fail then pass), task-implement-104-make-ac-bls2-20-green (10/10 pass) |
| AC-BLS2-12 | 68 | 2 attested passes. Evidence [2] is a scratchpad all12.sh whose output says 'after the #94 census fix', not #104, which suggests a stale or reused message. Evidence [1] covers only 2 branches and its tail shows bootstrap lines, not the exit codes. | task-map-104-s-newly-found-census-sites-on-main-and-restore-0 |
| AC-BLS2-5 | 35 | The risk register promised a regression re-run after merge, but no evidence is recorded (0 pass). The census code changed, so the regression is unproven. | — |
| AC-BLS2-15 | 35 | The risk register promised a regression re-run (key determinism and layout independence) after the census change. No evidence is recorded. | — |
| AC-BLS2-18 | 30 | Named in the risk register as possibly shifted by new sites. The all-12 coverage pass partly mitigates this. No direct evidence. | — |
| AC-BLS2-1 | 20 | Outside this plan's declared acceptance (AC-BLS2-20 only). No evidence. Mitigation: not targeted by this plan. | — |
| AC-BLS2-2 | 20 | Out of plan acceptance. No evidence. Mitigation: not targeted. | — |
| AC-BLS2-3 | 20 | Out of plan acceptance. No evidence. Mitigation: not targeted. | — |
| AC-BLS2-4 | 20 | Out of plan acceptance. No evidence. Mitigation: not targeted. | — |
| AC-BLS2-6 | 20 | Out of plan acceptance. No evidence. Mitigation: not targeted. | — |
| AC-BLS2-7 | 20 | Out of plan acceptance. No evidence. Mitigation: not targeted. | — |
| AC-BLS2-8 | 20 | Out of plan acceptance. No evidence. Mitigation: not targeted. | — |
| AC-BLS2-9 | 20 | Out of plan acceptance. No evidence. Mitigation: not targeted. | — |
| AC-BLS2-10 | 20 | Out of plan acceptance. No evidence. Mitigation: not targeted. | — |
| AC-BLS2-11 | 20 | Out of plan acceptance. No evidence. Mitigation: not targeted. | — |
| AC-BLS2-13 | 25 | Item (1), all-12 coverage exit 0, has partial support from task 3. The other items are out of scope and unevidenced here. | task-map-104-s-newly-found-census-sites-on-main-and-restore-0 |
| AC-BLS2-14 | 20 | Out of plan acceptance. No evidence. Mitigation: not targeted. | — |
| AC-BLS2-16 | 20 | Out of plan acceptance. No evidence. Mitigation: not targeted. | — |
| AC-BLS2-17 | 20 | Out of plan acceptance. No evidence. Mitigation: not targeted. | — |
| AC-BLS2-19 | 20 | Out of plan acceptance. Statement not visible in the materials. No evidence. | — |
| AC-BLS2-21 | 20 | Out of plan acceptance. Statement not visible in the materials. No evidence. | — |
| AC-BLS2-22 | 20 | Out of plan acceptance. Statement not visible in the materials. No evidence. | — |
| AC-BLS2-23 | 20 | Out of plan acceptance. Statement not visible in the materials. No evidence. | — |

## Gaps

- The all-12 coverage evidence runs a scratchpad script under /private/tmp, not a committed command, and its output says 'after the #94 census fix'. That suggests reused output from an earlier plan, not a run made after #104.
- The census change in packages/lore/src/service/site-census.ts was not regression-tested against AC-BLS2-5/15 in recorded evidence, despite the risk register mitigation.
- The oracle regex in packages/lore/tests/unit/service/site-census-injection.test.ts was loosened after RED to accept dynamic: keys. This is mitigated by an independent review and an added SQLiteStore.insertDocSync pin.
- Exactly one visible binding is followed as the sole implementation with no dynamic site. Bindings outside the analysed program would be missed silently (#118).

## Recommendations

- Declare extra.ac_scope listing only the targeted AC plus any regression ACs, and attach regression evidence for each.
- Require coverage evidence commands to be committed scripts or CLI invocations, not scratchpad paths.
- Treat post-RED oracle edits as requiring a fresh RED check of the new assertion, so it is shown to fail on pre-fix main.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 41074ms
- Retried: false
- Truncated sections: spec

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 70 | 0.6 | evidence | AC-BLS2-20 is green with an RED→pass trail. The diff implements static DI following. Regression on AC-5/15 is unevidenced, and the soundness concern (#118) is open. |
| evidence_integrity | 55 | 0.6 | evidence | Post-RED oracle edit was disclosed and reviewed. The all-12 proof is a non-repo scratchpad script with a #94 message. Promised regression runs are missing. |
| scope_fidelity | 82 | 0.65 | evidence | Changes are confined to site-census.ts and its new test. The small SourceFile-climb fix is incidental and commented. The oracle change is recorded. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-BLS2-12 | The all-12 coverage evidence runs a scratchpad script under /private/tmp, not a committed command, and its output says 'after the #94 census fix'. That suggests reused output from an earlier plan, not a run made after #104. |
| outcome | major | AC-BLS2-5 | The census change in packages/lore/src/service/site-census.ts was not regression-tested against AC-BLS2-5/15 in recorded evidence, despite the risk register mitigation. |
| evidence_integrity | minor | AC-BLS2-20 | The oracle regex in packages/lore/tests/unit/service/site-census-injection.test.ts was loosened after RED to accept dynamic: keys. This is mitigated by an independent review and an added SQLiteStore.insertDocSync pin. |
| outcome | minor | AC-BLS2-20 | Exactly one visible binding is followed as the sole implementation with no dynamic site. Bindings outside the analysed program would be missed silently (#118). |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Declare extra.ac_scope listing only the targeted AC plus any regression ACs, and attach regression evidence for each. | Unscoped plans pull in 22 unrelated ACs and hide the missing regression proof. |
| process | Require coverage evidence commands to be committed scripts or CLI invocations, not scratchpad paths. | Scratchpad scripts are not reproducible, and their output can be stale. |
| process | Treat post-RED oracle edits as requiring a fresh RED check of the new assertion, so it is shown to fail on pre-fix main. | Shows the loosened assertion still discriminates the defect. |

## Unverifiable Materials

- all12.sh scratchpad script contents: Not in the materials. Cannot confirm it checks all 12 branches or that it ran after #104.
- Mapping commits for newly found sites (lore baseline map): No diff or list of the mapped sites is provided.
- AC-BLS2-19/21/22/23 statements: Truncated in the materials.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 2
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 23 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 3 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.67
