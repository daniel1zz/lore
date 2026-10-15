---
id: KN-627
type: knowledge
role: knowledge
title: "Assessment: Baseline fast-mode migration of the remaining 9 branches, then one cross-branch probe (2026-10-09)"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PLAN-176
links:
  - {id: PLAN-176, type: informs}
---
# Assessment: partially_met (58/100)

Scope: plan `01M4FHE27FN8WJ4WBRT0F9W11X`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLS2-1 | 15 | No evidence in this bundle. This AC belongs to an earlier slice, not to this plan's exit criteria (13/17/18), so the low score is partly mitigated. | — |
| AC-BLS2-2 | 15 | No evidence in this bundle. Earlier-slice AC; this plan does not target it. | — |
| AC-BLS2-3 | 15 | No evidence in this bundle. Earlier-slice AC; this plan does not target it. | — |
| AC-BLS2-4 | 15 | No evidence in this bundle. Earlier-slice AC; this plan does not target it. | — |
| AC-BLS2-5 | 25 | There is no AC-BLS2-5 evidence record. R3b evidence shows site-census.test.ts passing on main (17 tests), which indirectly suggests the census fixture still holds, but the AC's own verify command was not attested. | 01M4FQ1PK2J9Z546HFYGJB0D24 (site-census.test.ts 17 pass on main) |
| AC-BLS2-6 | 15 | No evidence in this bundle. Earlier-slice AC; this plan does not target it. | — |
| AC-BLS2-7 | 15 | No evidence in this bundle. Earlier-slice AC; this plan does not target it. | — |
| AC-BLS2-8 | 15 | No evidence in this bundle. Earlier-slice AC; this plan does not target it. | — |
| AC-BLS2-9 | 15 | No evidence in this bundle. Earlier-slice AC; this plan does not target it. | — |
| AC-BLS2-10 | 15 | No evidence in this bundle. Earlier-slice AC; this plan does not target it. | — |
| AC-BLS2-11 | 15 | No evidence in this bundle. The diff changes the shape of the coverage CLI output (new unresolved_imports field and text). That could affect the byte-identity claims, and nothing was re-run to check. | — |
| AC-BLS2-12 | 45 | P3 says AC-12 is carried forward. R4 all12.sh reports coverage exit 0 for all 12 branches, which includes specification and execution, after the census fix. But it is not tagged AC-BLS2-12, and the AC's own verify command was not attested. | 01M4FNKHB71JC555ADJS8KPN2W (R4 all12 coverage exit 0) |
| AC-BLS2-13 | 70 | Attempt 1 failed (confident-wrong 1, fidelity 78.6%) and is kept on record. The re-probe was frozen at 11:14 before R1's writes and scored 16.5 vs 13 with confident-wrong 0. R4 shows coverage exit 0 for all 12 branches. The fidelity total is truncated (issue-loop 80%), and the assessment content wa… | 01M4FNKHP719YH64QM6TJ13TYZ (R5 freeze), 01M4FNK2529HSF1B9ENF0F9QQ4 (R5b re-probe + fidelity), 01M4FNK1FQWWW3Z5N9PXXA8PN1 (R6 PASS verdict) |
| AC-BLS2-14 | 10 | This applies only after all branches are armed. Arming is a separate owner decision that has not been taken, so no 100-pair sample exists. | — |
| AC-BLS2-15 | 82 | R2 RED was recorded as expected-fail, then R3 and R3b made it green. The fidelity, census and unresolved tests pass on main (R3b [5]). One concern: the implementer swapped the RED case 'sync status' for 'sync push' after RED. The stated reason is plausible, but it was not re-reviewed by the tester. | 01M4FNKH01ENJKCJ04WVWGWVE2 (R2 RED + main pass), 01M4FQ1PK2J9Z546HFYGJB0D24 (R3b RED/green on main) |
| AC-BLS2-16 | 20 | This is the earlier review-branch exit and has no record here. Its pass is provisional and is meant to be confirmed through AC-17. | — |
| AC-BLS2-17 | 65 | The re-probe has review questions 7 and 8 (count 2), with baseline confident-wrong 0, and item 3 passed. The facts table records no evidence tagged AC-BLS2-17. That the re-probe was frozen after the relative bar's registration is not separately evidenced. | 01M4FNK2529HSF1B9ENF0F9QQ4, 01M4FNK1FQWWW3Z5N9PXXA8PN1 |
| AC-BLS2-18 | 75 | All 9 W1 records show coverage_exit=0 and 0 uncited established/observed rules. R4 re-ran this for all 12 branches after the census fix. The per-branch counts were not re-captured after R1 removed 217 cites and downgraded rules, and the AC statement is truncated in the materials. | 01M4FNKHB71JC555ADJS8KPN2W (R4 all12), 01M4FHEFA2F16DZMEWSQXAHCZ8 |

## Gaps

- The R5b fidelity output is truncated before the aggregate ratio and seed. Per-branch issue-loop is 80%, and whether the aggregate is >= 90% and the draw order is correct cannot be verified.
- Oracles are scratchpad scripts that print PASS strings. Their logic is not in the repo or in these materials.
- The implementer changed the RED case 'sync status' to 'sync push' in packages/lore/tests/unit/service/site-census-fidelity.test.ts after the tester's RED run.
- recordUnresolved in packages/lore/src/service/site-census.ts records every unresolved import in any loaded in-root file, not only walked ones. Type-only or unreached imports may force INCOMPLETE (a false positive).
- The per-branch records were captured before R1 removed 217 cites and downgraded rules. R4 shows only an aggregate pass.

## Recommendations

- Require oracle scripts to be committed, or quoted in evidence, and require untruncated output for multi-line metric evidence.
- Any edit to a tester-authored RED case must be re-confirmed by the tester before merge.
- List follow-up code fixes such as R3b explicitly in I2 via the amendment log.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 59537ms
- Retried: false
- Truncated sections: plan, spec
- Reasoning clipped for: AC-BLS2-13

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 68 | 0.6 | evidence | Attempt 1 failed, and the remediation plus re-probe passed AC-13/17/18 per R5b/R6. The census fix is tested. Fidelity is truncated and the other spec ACs are unevidenced here. |
| evidence_integrity | 58 | 0.6 | evidence | Every record is attested and the failures are kept on record. But the verdicts are echo strings from uninspectable scratchpad scripts, and the key fidelity output is truncated. |
| scope_fidelity | 72 | 0.6 | evidence | Code changes are confined to the #94 census work allowed by I2. R3b's follow-up and the edit to the tester's RED case go slightly beyond the declared R2/R3 scope. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-BLS2-13 | The R5b fidelity output is truncated before the aggregate ratio and seed. Per-branch issue-loop is 80%, and whether the aggregate is >= 90% and the draw order is correct cannot be verified. |
| evidence_integrity | major | — | Oracles are scratchpad scripts that print PASS strings. Their logic is not in the repo or in these materials. |
| scope_fidelity | minor | AC-BLS2-15 | The implementer changed the RED case 'sync status' to 'sync push' in packages/lore/tests/unit/service/site-census-fidelity.test.ts after the tester's RED run. |
| outcome | minor | AC-BLS2-15 | recordUnresolved in packages/lore/src/service/site-census.ts records every unresolved import in any loaded in-root file, not only walked ones. Type-only or unreached imports may force INCOMPLETE (a false positive). |
| outcome | minor | AC-BLS2-18 | The per-branch records were captured before R1 removed 217 cites and downgraded rules. R4 shows only an aggregate pass. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require oracle scripts to be committed, or quoted in evidence, and require untruncated output for multi-line metric evidence. | Without them, the PASS strings cannot be reproduced or audited. |
| process | Any edit to a tester-authored RED case must be re-confirmed by the tester before merge. | This preserves tester/implementer separation. |
| plan | List follow-up code fixes such as R3b explicitly in I2 via the amendment log. | I2 names only the #94 fix, R2 and R3. |

## Unverifiable Materials

- knowledge-fast-mode-re-assessment-after-remediation-ac-bls2-13 content: Only akcheck.sh's one-line summary is shown.
- scratchpad oracle scripts (bar3.sh, bar_fid.py, all12.sh, record.sh): Their logic is not provided.
- full R5b fidelity output (aggregate, seed): The output tail is truncated.
- AC-BLS2-18 full statement: It is truncated in the materials.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 2
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 18 declared criteria
- Task evidence: 21 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=1.00
