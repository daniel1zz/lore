---
id: KN-547
type: knowledge
role: knowledge
title: "Assessment: Land the ADR's phase-write decision: a red-first parity suite, then version-logging in all three PhaseService writers (2026-08-24)"
status: archived
priority: medium
created: 2026-08-24
updated: 2026-10-23
tags: []
parent: PLAN-142
links:
  - {id: PLAN-142, type: informs}
---
# Assessment: met (89/100)

Scope: plan `01M0SQM65Z6VKM385V1JFR2EEA`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-PHASEVER-1 | 92 | Whole-file run attested pass twice (worktree + repo root, 41/41 tests). Diff shows CLAUDE.md line 120 replaced with the normative literal verbatim and the forbidden clause removed; suite measures phase add via mkdtemp corpus, data.total delta, status halves, and a same-run set --content demoting co… | 01M0SQNSDG03DHD5GHHY6JVYH7 (evidence [1] and [5], both attested pass), 01M0SQN6WHZH6VEGSV1M4P8AM9 (expected-fail red baseline recorded by the authoring agent) |
| AC-PHASEVER-2 | 87 | -t filter run attested pass twice with 18 passed / 23 skipped, so the block genuinely executed (no select-nothing false green). rename and rm each assert +1 row and status approved, with an in-run control. (b) is measured against the SHARED live corpus, not the diff, so its truth can change with no… | 01M0SQNSDG03DHD5GHHY6JVYH7 (evidence [2] and [6]; 18 passed proves non-vacuous selection) |
| AC-PHASEVER-3 | 90 | 9 passed / 32 skipped under the -t filter. Diff confirms the residual manual read: phase-service.ts header states the ADR write contract, ac-service.ts no longer names PhaseService as the contrast, neither uses fresh wording of the overturned claim, each cites the slug once; resolveStatusAfterContr… | 01M0SQNSDG03DHD5GHHY6JVYH7 (evidence [3] and [7]; header rewrites reviewed in the diff) |

## Gaps

- The red-first authoring task records evidence [4] as oracle=test result=pass running the whole suite, after three expected-fail rows for the same file. That task's charter states a green run at the introducing commit means the suite is DEFECTIVE. The 326-byte tail is not shown, so whether this was a post-merge re-verification or a green-on-arrival oracle cannot be determined from the materials.
- packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts measures AC-PHASEVER-2(b) against the shared live corpus (findLoreDbPath walks out of the worktree), so the criterion's verdict depends on mutable state outside the reviewed diff: an unlink or decision_status edit in the corpus flips it with no code change.
- packages/lore/src/service/phase-service.ts documents a MEASURED hole in its own oracle: omitting the audit entry while keeping the version row makes lore audit --verify report a miss per phase write and exit 4, yet the parity suite stays green. The correct pairing is implemented but unguarded, so a later refactor can regress it silently.
- Zero knowledge docs were linked, although execution produced two reusable measurements not derivable from the code: lore get appends a trace_events row (so read-only oracles must use audit/list), and details.version is the join key AuditService.verify reconciles version rows against.

## Recommendations

- Add a fourth conjunct asserting lore audit --verify returns clean after a phase write in the throwaway corpus, so the version-row/audit-entry pairing is oracle-enforced instead of comment-enforced.
- Require that a red-first task's evidence rows carry no post-hoc result=pass row for the same command, or that such a row state explicitly which commit it was run at.
- Add a knowledge-capture step recording the trace_events read-mutation finding and the audit/version join-key finding.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 79980ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-PHASEVER-1, AC-PHASEVER-2, AC-PHASEVER-3

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 91 | 0.82 | evidence | All three writers routed through one CAS-guarded writePhases; status passed through unchanged; demotion helper absent; docs and both headers swept. Diff matches the ADR decision, not the ac-set trap. |
| evidence_integrity | 86 | 0.75 | evidence | Red baselines recorded by the authoring agent, greens re-run at repo root, filtered runs show non-zero executed tests. Deduction: unexplained trailing pass on the red-first task. |
| scope_fidelity | 94 | 0.85 | evidence | Diff touches only the declared anchors: the new suite, CLAUDE.md, phase-service.ts, ac-service.ts. No suite edits by phase 2, no back-catalogue migration. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | — | The red-first authoring task records evidence [4] as oracle=test result=pass running the whole suite, after three expected-fail rows for the same file. That task's charter states a green run at the introducing commit means the suite is DEFECTIVE. The 326-byte tail is not shown, so whether this was a post-merge re-verification or a green-on-arrival oracle cannot be determined from the materials. |
| outcome | minor | AC-PHASEVER-2 | packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts measures AC-PHASEVER-2(b) against the shared live corpus (findLoreDbPath walks out of the worktree), so the criterion's verdict depends on mutable state outside the reviewed diff: an unlink or decision_status edit in the corpus flips it with no code change. |
| outcome | minor | — | packages/lore/src/service/phase-service.ts documents a MEASURED hole in its own oracle: omitting the audit entry while keeping the version row makes lore audit --verify report a miss per phase write and exit 4, yet the parity suite stays green. The correct pairing is implemented but unguarded, so a later refactor can regress it silently. |
| scope_fidelity | minor | — | Zero knowledge docs were linked, although execution produced two reusable measurements not derivable from the code: lore get appends a trace_events row (so read-only oracles must use audit/list), and details.version is the join key AuditService.verify reconciles version rows against. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Add a fourth conjunct asserting lore audit --verify returns clean after a phase write in the throwaway corpus, so the version-row/audit-entry pairing is oracle-enforced instead of comment-enforced. | phase-service.ts states the current suite stays green while lore audit --verify exits 4 if the audit half is dropped. |
| process | Require that a red-first task's evidence rows carry no post-hoc result=pass row for the same command, or that such a row state explicitly which commit it was run at. | A trailing green on a suite whose charter says green means defective is indistinguishable from a false oracle. |
| plan | Add a knowledge-capture step recording the trace_events read-mutation finding and the audit/version join-key finding. | Both were measured during execution, generalize beyond this spec, and are currently only in code comments. |

## Unverifiable Materials

- Output tail of the red-first task's evidence [4] (326 bytes, not shown): Cannot determine whether that pass predates or postdates the implementation commit.
- Live corpus state backing AC-PHASEVER-2(b) (ADR link edge and decision_status): Asserted by the suite against a shared corpus not present in the diff; only the passing run is visible.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 3 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=1.00
