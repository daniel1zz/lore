---
id: KN-695
type: knowledge
role: knowledge
title: "Assessment: Always-loaded lore fragments state the rule only (2026-10-15)"
status: approved
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-187
links:
  - {id: PLAN-187, type: informs}
---
# Assessment: met (81/100)

Scope: plan `01M4ZZ4TBZK3AHVXM4MH45ZZSY`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-RW-1 | 85 | Two attested fails: rules_drift on lore-worktree-dispatch.md, and 5 failing tests. Final attested run [15] shows fragments check ok and 246/246 passing, which fixes both. The run location (worktree or main) is not stated, so the close-phase 'verify on main' step is unconfirmed. | task-reword-the-ten-always-loaded-fragments-to-the-rule-only (evidence [4],[10] fail; [14],[15] pass) |
| AC-RW-2 | 92 | Attested red at 14328 B [2], then three attested passes at 9784 B against the 10000 B ceiling. The cut is real and measured. The margin is only 216 B. | task-reword-the-ten-always-loaded-fragments-to-the-rule-only (evidence [2],[5],[11],[16]) |
| AC-RW-4 | 93 | Red run [3] matched the 'measured 2026-07-30' and orphan-branch narratives. Three attested passes followed. The diff confirms both narratives were removed from feed and worktree-dispatch. | task-reword-the-ten-always-loaded-fragments-to-the-rule-only (evidence [3],[6],[12],[17]) |
| AC-RW-5 | 65 | Only evidence is one self-reported manual review. My diff read: most cuts are explanation. Small instruction parts were dropped: 'record in place', '(grep its wording)', 'fix the declared command, not the recorder', the handoff floor-arming condition, edit→draft re-approve, and release not removing… | task-reword-the-ten-always-loaded-fragments-to-the-rule-only (evidence [19] manual, self-reported) |
| AC-RW-3 | 92 | A mutation falsifier went red first: removing 'lore assess' from close gave exit 1 [1]. Then three attested passes reported 'no lore command lost'. The diff agrees: every lore verb survives in its own fragment. | task-reword-the-ten-always-loaded-fragments-to-the-rule-only (evidence [1],[7],[13],[18]) |

## Gaps

- In assets/context/evidence-attestation.md, the instruction 'fix the declared command, not the recorder' was dropped. Only 'never declare a silent oracle' remains.
- In assets/context/ac-design.md, 'Record in place' lost 'in place', and the anchor rule lost '(grep its wording)'. Both describe how to act, not why.
- assets/context/corpus-workflow-3-execute.md dropped three points: that editing an approved doc demotes it to draft, that this freezes task-claim until you re-review and re-approve, and that release does not remove a task from the ready set. assets/context/corpus-workflow-1-feed.md dropped the condition for when the handoff floor arms (different actor or earlier session).
- The only AC-RW-5 evidence is one manual, self-reported classification by the main agent. It has no attestation.
- The fixtures under packages/lore/tests/fixtures/context-variables/pre-change-rules/ were rewritten to the new wording, which re-baselines the oracle used by the fragment-variables tests. No rationale is recorded with the fixture.

## Recommendations

- Make AC-RW-5 checkable: write a per-fragment checklist of the rule clauses from b049f0ab and grep that each one survives, so it doesn't rely on a manual rubric.
- Have a non-author judge evaluate the rubric AC, and record lore verify runs made from main before closing.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 50197ms
- Retried: false
- Truncated sections: diff:assets/context/worktree-dispatch.md
- Reasoning clipped for: AC-RW-5

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.7 | evidence | The byte target was met, the narratives are gone and the commands are kept. A few small instruction parts were dropped despite the no-rule-lost goal. |
| evidence_integrity | 80 | 0.7 | evidence | Script ACs were each attested red then green, with a mutation falsifier. The rubric AC is self-reported only, and the pre-change fixtures were re-baselined. |
| scope_fidelity | 88 | 0.75 | evidence | Changes are limited to the ten fragments, rendered rules, manifest, hash baselines and fixtures, all of which the task implies. dispatch-bundle is unchanged, which is plausible. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | AC-RW-5 | In assets/context/evidence-attestation.md, the instruction 'fix the declared command, not the recorder' was dropped. Only 'never declare a silent oracle' remains. |
| outcome | minor | AC-RW-5 | In assets/context/ac-design.md, 'Record in place' lost 'in place', and the anchor rule lost '(grep its wording)'. Both describe how to act, not why. |
| outcome | minor | AC-RW-5 | assets/context/corpus-workflow-3-execute.md dropped three points: that editing an approved doc demotes it to draft, that this freezes task-claim until you re-review and re-approve, and that release does not remove a task from the ready set. assets/context/corpus-workflow-1-feed.md dropped the condition for when the handoff floor arms (different actor or earlier session). |
| evidence_integrity | minor | AC-RW-5 | The only AC-RW-5 evidence is one manual, self-reported classification by the main agent. It has no attestation. |
| evidence_integrity | minor | — | The fixtures under packages/lore/tests/fixtures/context-variables/pre-change-rules/ were rewritten to the new wording, which re-baselines the oracle used by the fragment-variables tests. No rationale is recorded with the fixture. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Make AC-RW-5 checkable: write a per-fragment checklist of the rule clauses from b049f0ab and grep that each one survives, so it doesn't rely on a manual rubric. | Small instruction parts slipped past the self-reported rubric. |
| process | Have a non-author judge evaluate the rubric AC, and record lore verify runs made from main before closing. | This avoids self-grading and confirms the result after the merge. |

## Unverifiable Materials

- assets/context/worktree-dispatch.md source diff: Omitted for budget. I inferred its content from the rendered .claude/rules/lore-worktree-dispatch.md.
- knowledge-always-loaded-lore-fragments-verbatim-source-before: Not provided. I compared using the before-text shown in the diff.
- assets/context/dispatch-bundle.md: Not shown, and its manifest hash is unchanged. I couldn't confirm it needed no edits.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 5
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.95
