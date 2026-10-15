---
id: KN-574
type: knowledge
role: knowledge
title: "Assessment: A criterion of a locked specification can be fixed as an audited correction (2026-10-12)"
status: approved
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-158
links:
  - {id: PLAN-158, type: informs}
---
# Assessment: met (89/100)

Scope: plan `01M4Q9V848RX13Q46XV1JW1GNQ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-CC-1 | 92 | There is an attested red run [1] and two attested passes ([3] worktree, [7] main): 9/9 tests. The diff's tests cover (a)-(h), including write-spy counts, the change_summary prefix and audit details.correction. One deviation: the empty-reason check runs after the spec read, not before any read. | 01M4Q9VJTDBRBYRZ7NP81ATXSD (evidence [1] expected-fail, [3],[7] pass) |
| AC-CC-2 | 88 | Red run [2] shows the old refusal text without 'lore ac set'. Passes [6] and [8] are attested, but their tails are truncated in the build log, so per-test bun output is not visible. The new e2e file covers (a)-(e) on mkdtemp + lore init against the compiled binary. | 01M4Q9VJTDBRBYRZ7NP81ATXSD (evidence [2] expected-fail, [6],[8] pass, [11] self-reported) |
| AC-CC-3 | 95 | Typecheck passes in attested runs [4] and [9]; the dashboard step exited 0. SetCriterionOpts is threaded through AcService and ac.ts. | 01M4Q9VJTDBRBYRZ7NP81ATXSD (evidence [4],[9]) |
| AC-CC-4 | 93 | The grep loop passes in attested runs [5] and [10]. The diff shows the asset, the installed rule and root CLAUDE.md each naming 'lore ac set ... --correction' in one sentence. The manifest hash and the installed-rule fragment hash were regenerated. | 01M4Q9VJTDBRBYRZ7NP81ATXSD (evidence [5],[10]) |

## Gaps

- Plan invariant I3 is unevidenced: no `lore status --check-claude-md` run was recorded after CLAUDE.md grew.
- In packages/lore/src/service/ac-service.ts the empty correction.reason refusal comes after the spec lookup, not before any read as the task describes. Write count is still 0.
- The e2e pass evidence tail shows only build output, not the bun test summary for packages/lore/tests/e2e/ac-set-correction-compiled.bun.test.ts.

## Recommendations

- When a plan invariant has a command check (e.g. I3 `lore status --check-claude-md`), record evidence for it alongside the AC evidence.
- For e2e evidence, capture the test-runner summary in the tail rather than the build preamble.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 30170ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 91 | 0.8 | evidence | All four ACs pass in attested runs. The service, CLI, refusal text and prose changes match D1-D5. Only a minor ordering deviation for the empty-reason check. |
| evidence_integrity | 85 | 0.75 | evidence | Red-first runs exist for AC-CC-1 and AC-CC-2, and 82% of evidence is attested. The e2e pass tails are truncated build logs. No evidence for I3 or I4. |
| scope_fidelity | 92 | 0.8 | evidence | Changes stay within the single task: service, CLI, gate feed text, prose, manifest and two new tests. No unrelated drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | — | Plan invariant I3 is unevidenced: no `lore status --check-claude-md` run was recorded after CLAUDE.md grew. |
| outcome | minor | AC-CC-1 | In packages/lore/src/service/ac-service.ts the empty correction.reason refusal comes after the spec lookup, not before any read as the task describes. Write count is still 0. |
| evidence_integrity | minor | AC-CC-2 | The e2e pass evidence tail shows only build output, not the bun test summary for packages/lore/tests/e2e/ac-set-correction-compiled.bun.test.ts. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | When a plan invariant has a command check (e.g. I3 `lore status --check-claude-md`), record evidence for it alongside the AC evidence. | Invariants listed in the plan were not evidenced. |
| prompt | For e2e evidence, capture the test-runner summary in the tail rather than the build preamble. | Truncated tails hide the pass counts. |

## Unverifiable Materials

- lore status --check-claude-md result: No evidence record for invariant I3.
- Post-merge changed-scope test run on main (I4): Only the new test files were re-run. The existing record-lock suites were not shown.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 4 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.82
