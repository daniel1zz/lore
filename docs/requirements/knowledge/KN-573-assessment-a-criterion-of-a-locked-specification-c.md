---
id: KN-573
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
| AC-CC-1 | 91 | New unit file covers (a)-(h) as the AC states, using write spies and checks on the audit row and change_summary. A red run failed as expected [1], then two attested 9/9 passes [3][7]. The diff matches: the correction skips only the gate and the demotion. Add/rm keep DeclarePathOpts. | 01M4Q9VJTDBRBYRZ7NP81ATXSD (evidence [1] expected-fail, [3] and [7] pass 9/9) |
| AC-CC-2 | 82 | The compiled-binary e2e covers (a)-(e) with exact exit codes. Red run [2] shows the old refusal did not mention ac set. checkpoint-registry now names it. But the output tails of passes [6] and [8] only show build output, not the bun test pass line. Only the self-reported [11] claims a pass. | 01M4Q9VJTDBRBYRZ7NP81ATXSD (evidence [2] expected-fail, [6] and [8] pass (tails truncated at build), [11] self-reported) |
| AC-CC-3 | 93 | Two attested typecheck passes [4][9] run the full typecheck chain. The new SetCriterionOpts type is threaded through the CLI's setOpts and the service. | 01M4Q9VJTDBRBYRZ7NP81ATXSD (evidence [4], [9]) |
| AC-CC-4 | 95 | The diff shows all three files gaining 'lore ac set ... --correction' in one sentence with no period between them. The grep loop passed and was attested twice [5][10]. The assets manifest hash was regenerated. | 01M4Q9VJTDBRBYRZ7NP81ATXSD (evidence [5], [10]) |

## Gaps

- The attested e2e passes for packages/lore/tests/e2e/ac-set-correction-compiled.bun.test.ts have output tails that stop inside the build log. The test pass count is not visible there; only the self-reported evidence [11] covers it.
- packages/lore/src/service/ac-service.ts checks for an empty correction reason after the spec has been fetched. The task says the check comes before any read or write. No write happens, but the order differs from the task text.

## Recommendations

- Require e2e evidence capture to keep the test runner's summary line (for example, by tailing only the test step) rather than build output.
- Record attested evidence for invariant I3: run lore status --check-claude-md, claude-md-eviction-floor.test.ts and phase-write-lifecycle-doc-parity.test.ts.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 31804ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 90 | 0.8 | evidence | The diff carries out D1-D5: the correction skips only the gate and demotion, the audit row matches CorpusService.set, the CLI refuses an empty reason with exit 2, add/rm refuse --correction, and the … |
| evidence_integrity | 82 | 0.7 | evidence | Red-first expected-fail runs exist for AC-CC-1 and AC-CC-2, and 85% of evidence is attested. The e2e pass tails are cut off before any test result, and I3 rests only on self-reported evidence. |
| scope_fidelity | 92 | 0.8 | evidence | Every changed file maps to the single task: the service, the CLI, the refusal text in checkpoint-registry, the prose files, the manifest and the two new tests. No drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-CC-2 | The attested e2e passes for packages/lore/tests/e2e/ac-set-correction-compiled.bun.test.ts have output tails that stop inside the build log. The test pass count is not visible there; only the self-reported evidence [11] covers it. |
| outcome | minor | AC-CC-1 | packages/lore/src/service/ac-service.ts checks for an empty correction reason after the spec has been fetched. The task says the check comes before any read or write. No write happens, but the order differs from the task text. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require e2e evidence capture to keep the test runner's summary line (for example, by tailing only the test step) rather than build output. | The attested tails for AC-CC-2 do not show the test result. |
| plan | Record attested evidence for invariant I3: run lore status --check-claude-md, claude-md-eviction-floor.test.ts and phase-write-lifecycle-doc-parity.test.ts. | CLAUDE.md has about 250 bytes of headroom, and I3 is currently only self-reported. |

## Unverifiable Materials

- bun test pass output for ac-set-correction-compiled.bun.test.ts: The tails of attested evidence [6] and [8] are cut off in the build log.
- Post-merge re-verification on main (I4): Not included in the materials.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 2
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 4 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.85
