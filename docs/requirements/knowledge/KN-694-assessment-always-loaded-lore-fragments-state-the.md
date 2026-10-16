---
id: KN-694
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
# Assessment: partially_met (70/100)

Scope: plan `01M4ZZ4TBZK3AHVXM4MH45ZZSY`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-RW-1 | 85 | On the restore task, an earlier run failed with rules_drift on lore-evidence-attestation.md. A later attested run passed: fragments check ok and Tests 246 passed. The red-then-green order is plausible after `lore context refresh`. | 01M4ZZRYGRJ4VCMT7WW0F0RNVJ (evidence [2] fail, [8] pass), 01M4ZZ4V6BH9BJN2BDC26BFB0M (evidence [15] pass) |
| AC-RW-2 | 88 | Attested pass at 9994 B against a 10000 B ceiling, down from 14328. The restore work used almost all the slack: 6 bytes of margin left, so any future restored rule will break this AC. | 01M4ZZRYGRJ4VCMT7WW0F0RNVJ (evidence [3],[9]: 9994 B) |
| AC-RW-4 | 92 | Went red first (dated measurement in feed, '726 lines of tests' in worktree-dispatch). Attested passes on both tasks afterwards. The diff confirms those spans were removed. | 01M4ZZ4V6BH9BJN2BDC26BFB0M (evidence [3] expected-fail, [6] pass), 01M4ZZRYGRJ4VCMT7WW0F0RNVJ (evidence [4],[10] pass) |
| AC-RW-5 | 50 | The only pass is the reword task's self-reported manual review, which the later assessment refuted (score 65). The six spans were restored, but no fresh rubric pass was recorded after that. The restore commit also cut more text: the latest_handoffs line and the legacy gate-config clause. | 01M4ZZ4V6BH9BJN2BDC26BFB0M (evidence [19] manual pass, refuted later), 01M4ZZRYGRJ4VCMT7WW0F0RNVJ (evidence [1] expected-fail; no post-restore pass) |
| AC-RW-3 | 92 | Went red first (`lore assess` missing from corpus-workflow-4-close). Attested 'no lore command lost' passes on both tasks afterwards. | 01M4ZZ4V6BH9BJN2BDC26BFB0M (evidence [1] expected-fail, [7] pass), 01M4ZZRYGRJ4VCMT7WW0F0RNVJ (evidence [5],[11] pass) |

## Gaps

- AC-RW-5's only pass is the reword task's manual review, which the assessment refuted. After the restore task changed the fragments, no rubric evaluation was recorded.
- The restore task removed text instead of only restoring it. It deleted '`latest_handoffs` is a neutral directory, not a pointer' from assets/context/corpus-workflow-1-feed.md and the legacy workflow.gates task-claim/phase-claim config clause from assets/context/corpus-workflow-2-produce.md. Both may be rules, and neither cut is explained.
- Qualifiers dropped since b049f0ab were never restored. 'in terminal order' (an ordering) is gone from assets/context/evidence-attestation.md. 'native plan mode + task tracking' is gone from assets/context/corpus-workflow-0-overview.md. '(no session marker)' and the fail-safe 'the floor arms' wording are gone from assets/context/corpus-workflow-1-feed.md.
- Several RE-BASELINE comments in packages/lore/tests/unit/assets-ssot.test.ts are inaccurate. The reword comments still say 'no rule moved or dropped', which the assessment disproved. The produce comment says 'restores how-to-act instructions' although that commit removed text.

## Recommendations

- Before archiving, run a fresh AC-RW-5 rubric evaluation against HEAD and the b049f0ab verbatim source, done by a reviewer other than the main agent, and record it as evidence.
- Limit restore tasks to additions. Any further cut needs its own classification note against the instruction-vs-explanation test.
- Revisit the 10000 B ceiling in AC-RW-2, or note that only 6 B of headroom remain.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 46740ms
- Retried: false
- Truncated sections: diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-overview.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-evidence-attestation.md, diff:.claude/rules/lore-project-scoped-oracles-in-worktrees.md, diff:.claude/rules/lore-worktree-dispatch.md, diff:.lore/context/scoped-oracles-in-worktrees.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-0-overview.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/evidence-attestation.md, diff:assets/context/worktree-dispatch.md

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 70 | 0.6 | evidence | Script ACs pass and the six named spans are restored. AC-RW-5 is still doubtful: the restore commit cut more text and several earlier qualifiers are still missing. |
| evidence_integrity | 65 | 0.65 | evidence | Script ACs are attested and went red first. AC-RW-5 rests on one self-reported manual pass that was later refuted, with no re-evaluation. The test comments claim no rule was dropped, which is false. |
| scope_fidelity | 72 | 0.6 | evidence | The changes stay inside the ten fragments, the manifest, the fixtures and the SSOT test. But the restore task also deleted text (feed latest_handoffs, produce legacy clause) without explaining why. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-RW-5 | AC-RW-5's only pass is the reword task's manual review, which the assessment refuted. After the restore task changed the fragments, no rubric evaluation was recorded. |
| scope_fidelity | major | AC-RW-5 | The restore task removed text instead of only restoring it. It deleted '`latest_handoffs` is a neutral directory, not a pointer' from assets/context/corpus-workflow-1-feed.md and the legacy workflow.gates task-claim/phase-claim config clause from assets/context/corpus-workflow-2-produce.md. Both may be rules, and neither cut is explained. |
| outcome | minor | AC-RW-5 | Qualifiers dropped since b049f0ab were never restored. 'in terminal order' (an ordering) is gone from assets/context/evidence-attestation.md. 'native plan mode + task tracking' is gone from assets/context/corpus-workflow-0-overview.md. '(no session marker)' and the fail-safe 'the floor arms' wording are gone from assets/context/corpus-workflow-1-feed.md. |
| evidence_integrity | minor | — | Several RE-BASELINE comments in packages/lore/tests/unit/assets-ssot.test.ts are inaccurate. The reword comments still say 'no rule moved or dropped', which the assessment disproved. The produce comment says 'restores how-to-act instructions' although that commit removed text. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Before archiving, run a fresh AC-RW-5 rubric evaluation against HEAD and the b049f0ab verbatim source, done by a reviewer other than the main agent, and record it as evidence. | The only AC-RW-5 pass was refuted, and the fragments changed after it. |
| plan | Limit restore tasks to additions. Any further cut needs its own classification note against the instruction-vs-explanation test. | The restore commit made unexplained deletions. |
| spec | Revisit the 10000 B ceiling in AC-RW-2, or note that only 6 B of headroom remain. | Restoring any further rule will break AC-RW-2. |

## Unverifiable Materials

- Diffs for .lore/context/scoped-oracles-in-worktrees.md, dispatch-bundle.md and the current worktree-dispatch.md body: Omitted from the diff or never shown, so rule survival in these fragments could not be checked directly.
- knowledge-always-loaded-lore-fragments-verbatim-source-before: The b049f0ab verbatim source was not provided. Before-text was reconstructed only from the fixture diffs.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 6
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.94
