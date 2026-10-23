---
id: KN-693
type: knowledge
role: knowledge
title: "Assessment: Always-loaded lore fragments state the rule only (2026-10-16)"
status: archived
priority: medium
created: 2026-10-16
updated: 2026-10-23
tags: []
parent: PLAN-187
links:
  - {id: PLAN-187, type: informs}
---
# Assessment: partially_met (77/100)

Scope: plan `01M4ZZ4TBZK3AHVXM4MH45ZZSY`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-RW-1 | 88 | The final attested runs pass: fragments check ok and 246/246 assets-ssot tests. Earlier runs failed with rules_drift in every worktree, because the rendered rules were not refreshed on the first try. Those failures were fixed before the final runs. | task-restore-the-remaining-clauses-the-assessment-named-and (evidence [7],[12] pass), task-reword-the-ten-always-loaded-fragments-to-the-rule-only ([4],[10] fail; [15] pass) |
| AC-RW-2 | 78 | Measured 10319 B against a ceiling of 10400 B, down from 14328 B. The ceiling was raised from 10000 after measuring, with user consent, but the audited `ac set --correction` record is not shown. Only one run [20] used the corrected ceiling. | task-reword-the-ten-always-loaded-fragments-to-the-rule-only (evidence [20] 10319 B; red [2] 14328 B) |
| AC-RW-3 | 93 | Attested passes in all three tasks. A falsifier went red as expected ([1]: lore assess removed). The final state reports 'no lore command lost'. | task-restore-the-remaining-clauses-the-assessment-named-and ([9],[14]), task-reword-the-ten-always-loaded-fragments-to-the-rule-only ([1] expected-fail) |
| AC-RW-4 | 93 | A red run [3] matched the dated and narrative lines. Later attested passes are consistent. The diff confirms the narrative was removed, for example '726 lines of tests' and 'measured 2026-07-30'. | task-reword-the-ten-always-loaded-fragments-to-the-rule-only ([3] red, [6],[17] pass) |
| AC-RW-5 | 62 | The only pass is a self-reported manual review [19], which two assessments later disproved, and it was never redone after the restores. In the final diff the close fragment still drops 'Never let CLAUDE.md carry state narrative'. The feed fragment drops 'where configured', and the --allow-missing-p… | task-reword-the-ten-always-loaded-fragments-to-the-rule-only ([19] manual pass, later disproved), task-restore-the-instruction-parts-the-rule-only-reword-dropped ([1] assessment scored 65) |

## Gaps

- AC-RW-5's only pass row is the main agent's manual review, which two later assessments disproved (scores 65 and 50). No rubric evaluation was recorded after the final restore commit.
- assets/context/corpus-workflow-4-close.md drops the prohibition 'Never let CLAUDE.md carry state narrative that will go stale'. That is a never-do instruction, not explanation.
- assets/context/corpus-workflow-1-feed.md drops 'where configured' from the session-start injection sentence. assets/context/ac-design.md now reads as if --allow-missing-path is always needed, not only when a statement-only edit re-validates paths.
- The AC-RW-2 ceiling went from 10000 to 10400 after the measured total was 10319 B. The user authorized it, but the audited correction record is not shown. The earlier restore measured 9994 B because it cut restored clauses to fit.
- The RE-BASELINE comment in packages/lore/tests/unit/assets-ssot.test.ts says the first restore 'cut two clauses'. The diff shows three removals in feed and produce.

## Recommendations

- Before close, require a fresh rubric evaluation recorded as evidence for every ai-mode AC after the last content-changing commit. Have a reviewer other than the agent that ran the work produce it.
- When a no-loss AC and a byte-ceiling AC conflict, state the priority in the spec up front. Do not let an implementer trade clauses against bytes.
- Tell implementers to run `lore context refresh` before running AC-RW-1-style checks in a worktree.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 79086ms
- Retried: false
- Truncated sections: diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-evidence-attestation.md, diff:.claude/rules/lore-project-scoped-oracles-in-worktrees.md, diff:.claude/rules/lore-worktree-dispatch.md, diff:.lore/context/scoped-oracles-in-worktrees.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-0-overview.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/evidence-attestation.md, diff:assets/context/worktree-dispatch.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-overview.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-evidence-attestation.md, diff:assets/context/corpus-workflow-0-overview.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/evidence-attestation.md, diff:.claude/rules/lore-ac-design.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-evidence-attestation.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/evidence-attestation.md
- Reasoning clipped for: AC-RW-5

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 76 | 0.65 | evidence | Size cut about 28% and all script ACs green. Two restore rounds recovered most rules, but a few prohibitions and qualifiers are still missing or distorted. |
| evidence_integrity | 58 | 0.65 | evidence | Script ACs are attested with red runs. The rubric AC rests on one disproved self-reported pass. The ceiling was relaxed after measuring, and one restore cut clauses to fit bytes. |
| scope_fidelity | 85 | 0.6 | evidence | Changes are limited to the fragments, rendered rules, manifest, fixtures and test comments. dispatch-bundle is unchanged. The pre-change-rules fixtures were rewritten without the plan mentioning them. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-RW-5 | AC-RW-5's only pass row is the main agent's manual review, which two later assessments disproved (scores 65 and 50). No rubric evaluation was recorded after the final restore commit. |
| outcome | minor | AC-RW-5 | assets/context/corpus-workflow-4-close.md drops the prohibition 'Never let CLAUDE.md carry state narrative that will go stale'. That is a never-do instruction, not explanation. |
| outcome | minor | AC-RW-5 | assets/context/corpus-workflow-1-feed.md drops 'where configured' from the session-start injection sentence. assets/context/ac-design.md now reads as if --allow-missing-path is always needed, not only when a statement-only edit re-validates paths. |
| evidence_integrity | minor | AC-RW-2 | The AC-RW-2 ceiling went from 10000 to 10400 after the measured total was 10319 B. The user authorized it, but the audited correction record is not shown. The earlier restore measured 9994 B because it cut restored clauses to fit. |
| evidence_integrity | minor | — | The RE-BASELINE comment in packages/lore/tests/unit/assets-ssot.test.ts says the first restore 'cut two clauses'. The diff shows three removals in feed and produce. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Before close, require a fresh rubric evaluation recorded as evidence for every ai-mode AC after the last content-changing commit. Have a reviewer other than the agent that ran the work produce it. | AC-RW-5 was closed on a stale, disproved self-review. |
| spec | When a no-loss AC and a byte-ceiling AC conflict, state the priority in the spec up front. Do not let an implementer trade clauses against bytes. | The first restore cut clauses to stay under 10000 B. |
| prompt | Tell implementers to run `lore context refresh` before running AC-RW-1-style checks in a worktree. | rules_drift failed on the first try in all three tasks. |

## Unverifiable Materials

- .lore/context/scoped-oracles-in-worktrees.md and its rendered rule: The file is in the truncated set, so its rule preservation could not be compared with b049f0ab.
- Audited lore ac set --correction record for AC-RW-2: The ceiling change to 10400 is asserted but its audit trail is not in the materials.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 4
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 2 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.96
