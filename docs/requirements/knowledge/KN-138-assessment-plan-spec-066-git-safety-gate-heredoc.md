---
id: KN-138
type: knowledge
role: knowledge
title: "Assessment: Plan — SPEC-066 git-safety-gate heredoc awareness (2026-07-23)"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-07-24
tags: []
parent: PLAN-052
links:
  - {id: PLAN-052, type: informs}
  - {id: KN-105, type: supersedes}
---
# Assessment: partially_met (70/100)

Scope: plan `01KY6S09PPMD71F9H9J2DX8Q6B`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-066-1 | 90 | All four delimiter forms (unquoted, single/double-quoted, dash-trimmed) have explicit tests in git-safety-gate.test.ts asserting exit 0 + empty stderr. Orchestrator-attested run shows 4 passed, matching the 4 cases exactly. | 01KY6S1E204ZR4QB6N5MY48M1P (attested run [8]: 4 passed | 34 skipped) |
| AC-066-2 | 90 | Three tests cover direct execution plus &&-chained and ;-chained later segments, all asserting exit 2. Attested run shows 3 passed, matching the 3 tests in the diff. | 01KY6S1E204ZR4QB6N5MY48M1P (attested run [9]: 3 passed | 35 skipped) |
| AC-066-3 | 88 | Single test proves a heredoc body containing danger followed by a real `git push --force` still blocks (exit 2, force-push stderr message) — stripping does not eat trailing segments. Attested run shows 1 passed. Only one scenario (force-push) exercised, but it directly matches the AC. | 01KY6S1E204ZR4QB6N5MY48M1P (attested run [10]: 1 passed | 37 skipped) |
| AC-066-4 | 82 | One test (`notify-send git branch -D backup`) proves argument-position tokens don't fire. Attested pass. Coverage is thin — a single non-command-position shape; no coverage of e.g. echo/grep arguments — but the AC's stated behavior is evidenced. | 01KY6S1E204ZR4QB6N5MY48M1P (attested run [11]: 1 passed | 37 skipped) |
| AC-066-5 | 85 | Unterminated-heredoc test asserts exit 0 and empty stderr (no crash, no block on body content — strip-to-end). Attested run 1 passed. Single scenario but squarely matches the AC. | 01KY6S1E204ZR4QB6N5MY48M1P (attested run [12]: 1 passed | 37 skipped) |
| AC-066-6 | 88 | assets-ssot.test.ts full suite attested green (217/217), which per the AC includes the byte-parity check between SSOT hook and installed copy. The hook file itself is unseen (truncation manifest) so parity is trusted via the suite, not inspected. | 01KY6S1E204ZR4QB6N5MY48M1P (attested run [13]: 217 passed (217)) |

## Gaps

- Unexplained wholesale revert of SPEC-065 bundled into the SPEC-066 diff: resolve.ts prefix resolution, StoreInterface.findByIdPrefix (all 3 stores), PendingDoc.slug, pending-render.ts, create-task-validation.ts, the SPEC-065 CLAUDE.md documentation, and every SPEC-065 test suite are deleted. This silently removes shipped, previously-evidenced functionality and is nowhere in the plan's goal, tasks, or evidence.
- Command-position discipline is evidenced by exactly one argument-position scenario (notify-send prefix); other non-command positions (quoted args to echo/grep, subshell args) are untested.
- The typecheck oracle (bun run typecheck, evidence [7]) is self-reported only, with no orchestrator attestation or output tail — and typecheck passing is consistent with, and thus cannot detect, the coherent SPEC-065 revert.

## Recommendations

- Before accepting this diff, diff it against the intended base commit to determine whether the SPEC-065 deletions are an accidental stale-base artifact; if so, rebase/restore SPEC-065 and regenerate evidence. If intentional, split the revert into its own tracked task with its own oracle runs.
- Add an explicit out-of-scope/no-unrelated-changes assertion (or a diff-scope oracle that fails on files outside the declared touch-set) to plans like this one, so scope drift of this magnitude is caught mechanically.
- Extend AC-066-4's verify set with at least one more non-command-position shape (e.g. the trigger phrase as a quoted argument to echo or grep).

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 62319ms
- Retried: false
- Truncated sections: diff:assets/hooks/pre-bash-git-safety-gate.mjs

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.8 | evidence | All six ACs have attested green runs whose pass counts match the added tests exactly; SPEC-066's deliverable appears complete. Docked only for thin single-case coverage on AC-066-4/5. |
| evidence_integrity | 85 | 0.75 | evidence | Dual-recorder evidence (agent + orchestrator-attested) with output tails whose test counts match the diff's test additions. Attested ratio 0.46; tsc pass is self-reported only. |
| scope_fidelity | 25 | 0.85 | evidence | Diff visibly reverts SPEC-065 across service, store, CLI, docs, and 5+ test suites — a functional regression entirely outside the plan's declared SPEC-066 scope, with no explanation. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | blocker | — | Unexplained wholesale revert of SPEC-065 bundled into the SPEC-066 diff: resolve.ts prefix resolution, StoreInterface.findByIdPrefix (all 3 stores), PendingDoc.slug, pending-render.ts, create-task-validation.ts, the SPEC-065 CLAUDE.md documentation, and every SPEC-065 test suite are deleted. This silently removes shipped, previously-evidenced functionality and is nowhere in the plan's goal, tasks, or evidence. |
| outcome | minor | AC-066-4 | Command-position discipline is evidenced by exactly one argument-position scenario (notify-send prefix); other non-command positions (quoted args to echo/grep, subshell args) are untested. |
| evidence_integrity | minor | — | The typecheck oracle (bun run typecheck, evidence [7]) is self-reported only, with no orchestrator attestation or output tail — and typecheck passing is consistent with, and thus cannot detect, the coherent SPEC-065 revert. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Before accepting this diff, diff it against the intended base commit to determine whether the SPEC-065 deletions are an accidental stale-base artifact; if so, rebase/restore SPEC-065 and regenerate evidence. If intentional, split the revert into its own tracked task with its own oracle runs. | A shipped spec's implementation and tests vanish inside an unrelated feature diff with zero recorded rationale — the highest-risk finding in this audit. |
| plan | Add an explicit out-of-scope/no-unrelated-changes assertion (or a diff-scope oracle that fails on files outside the declared touch-set) to plans like this one, so scope drift of this magnitude is caught mechanically. | All declared ACs passed while a major regression rode along undetected; AC-level oracles alone cannot see out-of-scope deletions. |
| spec | Extend AC-066-4's verify set with at least one more non-command-position shape (e.g. the trigger phrase as a quoted argument to echo or grep). | One scenario is weak evidence for a general 'argument position never fires' claim. |

## Unverifiable Materials

- assets/hooks/pre-bash-git-safety-gate.mjs: Omitted from the diff per the truncation manifest; implementation quality of the heredoc stripper is inferred solely from black-box test evidence.
- bun run typecheck output (evidence [7]): Self-reported with no attested output tail.

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.46
