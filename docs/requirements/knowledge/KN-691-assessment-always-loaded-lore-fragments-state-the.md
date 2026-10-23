---
id: KN-691
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
# Assessment: partially_met (73/100)

Scope: plan `01M4ZZ4TBZK3AHVXM4MH45ZZSY`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-RW-1 | 86 | Final attested runs pass: fragments check ok, assets-ssot 246 passed. All 7 fails are rules_drift in worktrees, fixed once rules were refreshed. Every task hit the same failure first, which points to a missing step in the workflow. | 01M517T9GXYTWDRM69FJ1GG88S (evidence [6],[9] pass; [2],[5] rules_drift fail), 01M515YRDSZNXYBPPH8GEANGV5 (evidence [7],[12] pass) |
| AC-RW-2 | 72 | Measured 12347 B, under 14328, and attested. The ceiling moved 10000 → 10400 (an ad-hoc value) → 14328. The user approved letting the ceiling yield, but the AC now only forbids growth, which is weaker than the reduction the spec aimed for. | 01M517T9GXYTWDRM69FJ1GG88S (evidence [3],[10]: 12347 B), 01M4ZZ4V6BH9BJN2BDC26BFB0M (evidence [20] uses an undeclared 10400 ceiling) |
| AC-RW-4 | 90 | Attested red first (measured 2026-07-30 and the 726-lines narrative were found), then green on every later task. The regex only catches the named patterns; other restored explanation would pass it. | 01M4ZZ4V6BH9BJN2BDC26BFB0M (evidence [3] expected-fail, [6] pass), 01M517T9GXYTWDRM69FJ1GG88S (evidence [4],[11] pass) |
| AC-RW-3 | 82 | Attested: 166 items, 10 files, ok. Red first (0 items). The same editor wrote the table and the fragments, so the KEPT/MERGED phrase check only confirms the table matches itself. The lore-command check is objective. | 01M517T9GXYTWDRM69FJ1GG88S (evidence [1] red, [12] pass) |
| AC-RW-5 | 60 | Only self-reported manual evidence. An earlier main-agent PASS was disproved twice (scored 65, then 50). The final grader is a separate opus run, not a different model as preferred, and its verdict was transcribed by the main agent. Only 11 of 166 items are DROPPED. | 01M517T9GXYTWDRM69FJ1GG88S (evidence [13] lore-reader opus grader), 01M4ZZ4V6BH9BJN2BDC26BFB0M (evidence [19] wrong earlier PASS) |

## Gaps

- The traceability pass restored explanation as well as instructions: the 'An AC proves only what it asserts' framing, '(weaken the rule, build a tie); a green-only run is not verification', 'The pattern itself lowers the assess evidence_integrity score' in packages/lore/tests/fixtures/context-variables/pre-change-rules/ac-design.md, and the done/assess mechanism and turbo/nx reasons in packages/lore/tests/fixtures/context-variables/pre-change-rules/worktree-dispatch.md. That goes beyond one shor…
- AC-RW-5 has 0 attested passes. The main agent's earlier manual PASS was disproved by two assessments. The final grader is an opus run whose verdict the main agent transcribed, so it is not the different model the spec prefers.
- AC-RW-2 evidence ran against three ceilings (10000, 10400, 14328). The 10400 ceiling has no recorded correction in the materials.
- The plan declared one task, but four ran. The extra tasks are justified by the assessments, but the plan's phase table was never updated.

## Recommendations

- Grade rubric ACs with a different model family and record the grader's output directly, not transcribed by the main agent.
- Add a check, script or rubric, that each kept bullet carries at most one short reason. This is the counterpart to AC-RW-5's check on dropped items.
- Add `lore context refresh` to the implementer steps before running AC-RW-1-type checks.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 53829ms
- Retried: false
- Truncated sections: diff:.claude/rules/lore-ac-design.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-project-scoped-oracles-in-worktrees.md, diff:.claude/rules/lore-worktree-dispatch.md, diff:.lore/context/scoped-oracles-in-worktrees.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-0-overview.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/worktree-dispatch.md, diff:.claude/rules/lore-ac-design.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-overview.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-evidence-attestation.md, diff:.claude/rules/lore-project-scoped-oracles-in-worktrees.md, diff:.claude/rules/lore-worktree-dispatch.md, diff:.lore/context/scoped-oracles-in-worktrees.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-0-overview.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/evidence-attestation.md, diff:assets/context/worktree-dispatch.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-overview.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-evidence-attestation.md, diff:assets/context/corpus-workflow-0-overview.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/evidence-attestation.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/evidence-attestation.md, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:.claude/rules/lore-ac-design.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-evidence-attestation.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/evidence-attestation.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/ac-design.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-close.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-execute.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-feed.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-produce.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/evidence-attestation.md, diff:packages/lore/tests/unit/assets-ssot.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 68 | 0.6 | evidence | Rules are preserved and size is under baseline. But the final pass put back a lot of explanation, so the fragments now state only part of the 'rule only' goal. |
| evidence_integrity | 66 | 0.6 | evidence | Script ACs are attested with red-first runs. AC-RW-2 thresholds moved, including an ad-hoc 10400. The rubric AC rests on self-reported evidence, with one pass already disproved. |
| scope_fidelity | 74 | 0.6 | evidence | Edits stay within the ten fragments, the manifest, fixtures and test comments. The three extra restore tasks are explained by the assessments, not unplanned scope creep. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-RW-5 | The traceability pass restored explanation as well as instructions: the 'An AC proves only what it asserts' framing, '(weaken the rule, build a tie); a green-only run is not verification', 'The pattern itself lowers the assess evidence_integrity score' in packages/lore/tests/fixtures/context-variables/pre-change-rules/ac-design.md, and the done/assess mechanism and turbo/nx reasons in packages/lore/tests/fixtures/context-variables/pre-change-rules/worktree-dispatch.md. That goes beyond one shor… |
| evidence_integrity | major | AC-RW-5 | AC-RW-5 has 0 attested passes. The main agent's earlier manual PASS was disproved by two assessments. The final grader is an opus run whose verdict the main agent transcribed, so it is not the different model the spec prefers. |
| evidence_integrity | minor | AC-RW-2 | AC-RW-2 evidence ran against three ceilings (10000, 10400, 14328). The 10400 ceiling has no recorded correction in the materials. |
| scope_fidelity | minor | — | The plan declared one task, but four ran. The extra tasks are justified by the assessments, but the plan's phase table was never updated. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Grade rubric ACs with a different model family and record the grader's output directly, not transcribed by the main agent. | A main-agent manual PASS was already shown to be wrong once. |
| spec | Add a check, script or rubric, that each kept bullet carries at most one short reason. This is the counterpart to AC-RW-5's check on dropped items. | Today nothing stops explanation from coming back through KEPT items. |
| skill | Add `lore context refresh` to the implementer steps before running AC-RW-1-type checks. | rules_drift failed the first run in every task. |

## Unverifiable Materials

- knowledge-traceability-table-always-loaded-lore-fragments contents: The table itself is not in the materials, so the 11 DROPPED items cannot be checked independently.
- assets/context/*.md final contents: Omitted from the diff. Judged from fixture mirrors only.
- lore ac set --correction audit records for AC-RW-2: Not shown, so the ceiling changes cannot be confirmed as audited.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 2
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 3 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.95
