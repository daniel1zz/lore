---
id: KN-295
type: knowledge
role: knowledge
title: "Assessment: git-safety-gate argument-aware probes (2026-07-31)"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-10-23
tags: []
parent: PLAN-098
links:
  - {id: PLAN-098, type: informs}
---
# Assessment: inconclusive (N/A (fully truncated))

Scope: plan `01KYVEHPA6FVB5T8CFAZ2VTPTX`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-GS-1 | 80 | Filtered run 'names only the targeted stash entry' passes, dual-recorded, tail shows 2 matched cases (non-vacuous). Cannot inspect the assertions, so the load-bearing negative half (other entries absent) is asserted by the AC text only, not verified. | 01KYVEKR997MMHHMYG3EHVE9KX (evidence [1],[14],[21]) |
| AC-GS-2 | 82 | 'quoted revision reaches the probe' passes with 3 matched cases in attested tails, consistent with quoted+unquoted+SPEC-066 control triple. Paired-control content unverifiable without the test source. | 01KYVEKR997MMHHMYG3EHVE9KX (evidence [2],[10],[17]) |
| AC-GS-3 | 80 | 'verb dispatch' passes, 3 matched cases across two attested runs — matches clear/bare-drop/pop-exits-0 shape. Verb-set closure rests on an unseen assertion; no diff to confirm the rule pattern was not widened. | 01KYVEKR997MMHHMYG3EHVE9KX (evidence [3],[15],[22]) |
| AC-GS-4 | 80 | 'reports only the named path' passes, 3 matched cases, dual-attested. The distinguishing other-path-absent assertion cannot be inspected; accepted on evidence-record strength alone. | 01KYVEKR997MMHHMYG3EHVE9KX (evidence [4],[11],[18]) |
| AC-GS-5 | 78 | 'fallback widens' passes, 3 matched cases attested. The literal [ARG-FALLBACK] marker, the rev-parse control run, and the probeDirtyTree/reset --hard no-filter pin are all unverifiable without the diff or test body. | 01KYVEKR997MMHHMYG3EHVE9KX (evidence [5],[16],[23]) |
| AC-GS-6 | 86 | assets-ssot suite: 227/227 pass, attested twice with tails. This is the manifest-sha256 oracle, so regeneration reached the hook entry. Cannot confirm the commit carried only that manifest entry (concurrent-session drift risk named in the plan). | 01KYVEKR997MMHHMYG3EHVE9KX (evidence [6],[12],[19]) |
| AC-GS-7 | 90 | Full suite attested twice: 53 tests, 53 passed, 0 skipped, 0 failed — exactly the AC's zero-fail/zero-skip regression floor, with no hardcoded total. Strongest evidence in the bundle; typecheck and test:changed also pass. | 01KYVEKR997MMHHMYG3EHVE9KX (evidence [7],[13],[20],[9]) |
| AC-GS-8 | 72 | 'D1 REGRESSION' passes with 1 matched case (attested tail). Single evidence record, no independent second run, and the claimed pre-fix exit-0 measurement has no recorded failing run — the red half is narrative only. | 01KYVEKR997MMHHMYG3EHVE9KX (evidence [24]) |

## Gaps

- diff_available=false. The plan's explicit guardrails — do not touch probeDirtyTree (D2), leave probeClean/probeWorktreeForce/probeBranchForceDelete alone, edit only the SSOT asset (not dist-npm/ or .claude/worktrees/ copies), and commit only the hooks/pre-bash-git-safety-gate.mjs manifest entry — are all file-level claims no provided material can confirm or refute.
- The task declares red-first as binding test discipline ('a test that passes before the change is measuring nothing'), and AC-GS-8 cites a specific pre-fix measurement (exit 0, no Segment line). No evidence record shows any assertion failing against the pre-fix gate; every one of the 24 records is a pass. Test non-tautology therefore rests on narrative.
- AC-GS-5 requires a literal [ARG-FALLBACK] marker in output, a live control run of git rev-parse --verify --quiet on stash@{99}, and a reset --hard whole-tree pin. The filtered run shows 3 matched cases, consistent with that shape, but neither the marker string nor the control's presence is observable in the bundle.
- AC-GS-8 has 1 pass / 1 attested from a single run, while AC-GS-1..7 each carry a self-reported plus two orchestrator-attested runs. Less redundancy on the criterion whose pre-fix behaviour was a silent-success safety hole.

## Recommendations

- Require the implementation diff in the audit bundle whenever a task's ACs include negative assertions or do-not-touch guardrails; without it, scope and non-tautology are unscoreable.
- When a task declares red-first, record the failing run as a first-class evidence record (result=fail, pre-fix ref) so the red half is attestable rather than narrative.
- Add an oracle that diffs the regenerated assets manifest and asserts exactly one changed entry, so the 'no concurrent drift rides along' risk the plan itself names becomes measurable.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 61227ms
- Retried: false
- Truncated sections: task:task-t1-argument-aware-probes-in-git-safety-gate-d1-d5-ac-gs-1-7
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 83 | 0.72 | evidence | All 8 ACs have passing filtered oracles with non-zero matched-case counts; full suite 53/53, 0 skipped; typecheck green. Assertion content itself unseen. |
| evidence_integrity | 79 | 0.75 | evidence | Two recorders, real vitest tails with matched/skipped counts guarding vacuity. Weakened by 0.63 attested ratio, absent red-first records, and single-record AC-GS-8. |
| scope_fidelity | 66 | low | absence | No diff, so probeDirtyTree untouched, out-of-scope probes untouched, and manifest-only regen are unverified. No positive signal of drift either. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | diff_available=false. The plan's explicit guardrails — do not touch probeDirtyTree (D2), leave probeClean/probeWorktreeForce/probeBranchForceDelete alone, edit only the SSOT asset (not dist-npm/ or .claude/worktrees/ copies), and commit only the hooks/pre-bash-git-safety-gate.mjs manifest entry — are all file-level claims no provided material can confirm or refute. |
| evidence_integrity | major | — | The task declares red-first as binding test discipline ('a test that passes before the change is measuring nothing'), and AC-GS-8 cites a specific pre-fix measurement (exit 0, no Segment line). No evidence record shows any assertion failing against the pre-fix gate; every one of the 24 records is a pass. Test non-tautology therefore rests on narrative. |
| outcome | minor | AC-GS-5 | AC-GS-5 requires a literal [ARG-FALLBACK] marker in output, a live control run of git rev-parse --verify --quiet on stash@{99}, and a reset --hard whole-tree pin. The filtered run shows 3 matched cases, consistent with that shape, but neither the marker string nor the control's presence is observable in the bundle. |
| evidence_integrity | minor | AC-GS-8 | AC-GS-8 has 1 pass / 1 attested from a single run, while AC-GS-1..7 each carry a self-reported plus two orchestrator-attested runs. Less redundancy on the criterion whose pre-fix behaviour was a silent-success safety hole. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require the implementation diff in the audit bundle whenever a task's ACs include negative assertions or do-not-touch guardrails; without it, scope and non-tautology are unscoreable. | Six of eight ACs here hinge on absence assertions the auditor could not read. |
| process | When a task declares red-first, record the failing run as a first-class evidence record (result=fail, pre-fix ref) so the red half is attestable rather than narrative. | AC-GS-8 cites a pre-fix exit-0 measurement with no matching evidence record. |
| plan | Add an oracle that diffs the regenerated assets manifest and asserts exactly one changed entry, so the 'no concurrent drift rides along' risk the plan itself names becomes measurable. | The plan flags manifest drift as a live risk but supplies no oracle for it; assets-ssot only checks sha agreement. |

## Unverifiable Materials

- Diff of assets/hooks/pre-bash-git-safety-gate.mjs: No diff in bundle; cannot confirm probeStash/probePathArg read arguments, the raw-vs-sanitized consumer split at the dispatch loop, or the [ARG-FALLBACK] literal.
- packages/lore/tests/unit/hooks/git-safety-gate.test.ts source: Test bodies unseen, so the load-bearing negative halves and paired controls named in AC-GS-1..5 and AC-GS-8 cannot be checked for content.
- Diff of packages/lore/src/generated/assets-manifest.ts: Cannot confirm only the hooks/pre-bash-git-safety-gate.mjs entry changed, as the plan's risk section requires.
- Pre-fix (red) oracle runs: No failing evidence records exist for any new assertion; red-first compliance and AC-GS-8's pre-fix exit-0 claim are unverified.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.63
