---
id: KN-334
type: knowledge
role: knowledge
title: "Assessment: Implementation — issue closure loop (resolves edge, computed resolution, agent-reachable surfaces) (2026-07-29)"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-103
links:
  - {id: PLAN-103, type: informs}
---
# Assessment: met (84/100)

Scope: plan `01KYPTG5K2Y2XJN21TXHDX8Z5X`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-ICL-1 | 88 | Two passing runs of the named vitest oracle, one orchestrator-attested with output tail (6 passed/18 filtered-skipped). Schema + write-time VALIDATION_ERROR enforcement claimed in CorpusService; not independently viewable without a diff. | task-p1-resolves-link-type-computed-resolution-foundation (evidence [1],[4] attested) |
| AC-ICL-2 | 88 | Attested vitest run on issue-resolution.test.ts -t AC-ICL-2 passes. Open/resolving/fixed semantics later extended (closed, rejected) with the original cases re-run green under AC-ICL-10's task, showing no regression. | task-p1-resolves-link-type-computed-resolution-foundation (evidence [2],[5]) |
| AC-ICL-3 | 90 | Attested bun test tail names both HAPPY (exits non-zero, names lore link + resolves, writes nothing) and a NEGATIVE case proving the fixed-check fires before issue_report validation. Directly matches the AC statement. | task-p2-cli-verbs-lore-issue-resolve-lore-issues (evidence [1],[6] attested tail) |
| AC-ICL-4 | 88 | Attested tail shows wontfix and rejected both persisting state+reason under extra.issue_report.resolution with version bump. Precedence of the terminal state over edge computation is asserted in P1/P2 precedence cases rather than visible in this tail. | task-p2-cli-verbs-lore-issue-resolve-lore-issues (evidence [2],[7]) |
| AC-ICL-5 | 70 | Passes, but the attested tail labels both cases '[KNOWN-GAP workaround for resolving/fixed]' — the listing was proven against worked-around fixtures, not the real resolves-edge path (migration-012 landed later). Never re-run post-fix in the record. | task-p2-cli-verbs-lore-issue-resolve-lore-issues (evidence [8] tail: KNOWN-GAP workaround) |
| AC-ICL-6 | 82 | Attested tail shows HAPPY/HAPPY/ERROR cases covering both detector shapes' lifecycle. The AC's decisive 'byte-comparison of every issue doc before and after' half is not visible in the truncated tail; stale_after_days default is unverified here. | task-p2-lore-status-check-issues-detector-stale-after-days (evidence [1],[3]) |
| AC-ICL-7 | 90 | Attested tail names the decisive case explicitly: resolves edge to an ARCHIVED spec reports 'fixed', never the task's 'draft'; plus rejection-reason echo. Unreachable degradation preserved per AC-072-10, re-proven green under AC-ICL-11. | task-p2-consumer-report-issue-list-reports-computed-resolution (evidence [1],[4]) |
| AC-ICL-8 | 90 | Attested tail covers both halves: HAPPY (fixed, --open omits, --resolved includes) and STATE (flags unclosed escalation with executable remediation, quiets after archival). Live-corpus closure separately recorded as manual before/after detector output. | task-p3-e2e-closure-proof-live-backlog-closure (evidence [1],[5]; [3],[4] manual live) |
| AC-ICL-9 | 82 | Orchestrator-attested Playwright run passes 1 test asserting rows' computed resolution and computed-open nav badge, on 1 worker (serialized) against a seeded corpus. Single test carries the whole surface; IssueDetail rendering not separately evidenced. | task-p2-http-projection-dashboard-issues-page-render-computed (evidence [1],[5]) |
| AC-ICL-10 | 88 | Attested tail shows HAPPY (archived+no edge+no state → closed, excluded from --open, in --resolved/--all) and a NEGATIVE draft case. Precedence-step-by-step assertions claimed in the extended unit file, which re-ran green (evidence [3]). | task-p2-computed-closed-state-for-archived-issues-without-a (evidence [1],[3],[5]) |
| AC-ICL-11 | 88 | Attested tail shows AC-072-10 passing with the corrected semantics: rejected row computes 'rejected' via recorded review rejection and carries the reason, while unreachable degradation still holds (9 expects, 0 fail). | task-p2-computed-closed-state-for-archived-issues-without-a (evidence [2],[6] attested tail) |

## Gaps

- Both attested AC-ICL-5 cases are titled '[KNOWN-GAP workaround for resolving/fixed]', meaning the --open/--resolved/--all filtering was verified against substitute state rather than genuine resolves edges. migration-012 later removed that blocker, but no post-fix re-run of this oracle appears in the record, so the AC's core claim about computed resolution in the listing remains unproven on the real path.
- No diff or file list accompanies the bundle and tests_touched is false, so implementation quality, test authorship, and the claimed six-dimension coverage cannot be checked at all. Scoring is limited to oracle exit codes plus partial stdout.
- The AC explicitly demands a byte-comparison of every issue doc before/after to prove non-mutation. The attested tail shows only HAPPY/HAPPY/ERROR lifecycle case names; the byte-comparison assertion is asserted in prose but not surfaced in any evidence output.
- The plan's terminal proof — closing task-no-init-setup-path-provisions-feedback-upstream-lore on the live corpus — is evidenced by two 'manual' records recorded by agent:main-orchestrator, the same actor that performed the writes. No independent re-read of the corpus confirms the reported --open 9 / --resolved 2 / consistent end state.
- The plan's anchor discipline was breached twice by necessity: migration-012 (a store-layer fix outside any P2 task's declared deliverables) landed via the dashboard task, and P3's live-closure deliverable was executed by the orchestrator rather than the claiming implementer. Both are disclosed with rationale, so this is drift-with-explanation rather than silent drift.
- A single Playwright test carries the entire dashboard AC (list rows + detail view + nav badge). The tail confirms list rows and badge; IssueDetail's computed-resolution rendering, named in D8, is not separately evidenced.

## Recommendations

- Treat a KNOWN-GAP workaround marker in a test title as a blocking debt item: record the unblocking commit on the task and require a re-run of that oracle before the plan closes.
- Include the diff (or changed-file manifest) in closure bundles handed to auditors; without it every score is bounded by oracle-name plausibility.
- Where an AC names a proof technique (byte-comparison, twin corpora), require the oracle to emit that proof to stdout so the recorded tail carries it.
- When a live-corpus write is the plan's terminal proof, have a second actor re-run the read-only detector and record that as separate attestation.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 80872ms
- Retried: false
- Truncated sections: task:task-p2-computed-closed-state-for-archived-issues-without-a

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 86 | 0.7 | evidence | All 11 ACs have two passing runs each with attested tails matching the AC statements; AC-ICL-5 discounted for its self-declared KNOWN-GAP workaround fixtures. |
| evidence_integrity | 74 | low | absence | Oracle names and tails are consistent, but no diff, truncated tails hiding decisive assertions (AC-ICL-6), 0.31 attested ratio, and self-attested manual live-corpus evidence limit trust. |
| scope_fidelity | 84 | 0.75 | evidence | 3 added ACs each tied to a measured finding, and both deviations (migration-012 fixed in P2, live closure moved to orchestrator) are disclosed with reasons. Anchor discipline was breached but explain… |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-ICL-5 | Both attested AC-ICL-5 cases are titled '[KNOWN-GAP workaround for resolving/fixed]', meaning the --open/--resolved/--all filtering was verified against substitute state rather than genuine resolves edges. migration-012 later removed that blocker, but no post-fix re-run of this oracle appears in the record, so the AC's core claim about computed resolution in the listing remains unproven on the real path. |
| evidence_integrity | major | — | No diff or file list accompanies the bundle and tests_touched is false, so implementation quality, test authorship, and the claimed six-dimension coverage cannot be checked at all. Scoring is limited to oracle exit codes plus partial stdout. |
| evidence_integrity | minor | AC-ICL-6 | The AC explicitly demands a byte-comparison of every issue doc before/after to prove non-mutation. The attested tail shows only HAPPY/HAPPY/ERROR lifecycle case names; the byte-comparison assertion is asserted in prose but not surfaced in any evidence output. |
| evidence_integrity | minor | AC-ICL-8 | The plan's terminal proof — closing task-no-init-setup-path-provisions-feedback-upstream-lore on the live corpus — is evidenced by two 'manual' records recorded by agent:main-orchestrator, the same actor that performed the writes. No independent re-read of the corpus confirms the reported --open 9 / --resolved 2 / consistent end state. |
| scope_fidelity | minor | — | The plan's anchor discipline was breached twice by necessity: migration-012 (a store-layer fix outside any P2 task's declared deliverables) landed via the dashboard task, and P3's live-closure deliverable was executed by the orchestrator rather than the claiming implementer. Both are disclosed with rationale, so this is drift-with-explanation rather than silent drift. |
| outcome | minor | AC-ICL-9 | A single Playwright test carries the entire dashboard AC (list rows + detail view + nav badge). The tail confirms list rows and badge; IssueDetail's computed-resolution rendering, named in D8, is not separately evidenced. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Treat a KNOWN-GAP workaround marker in a test title as a blocking debt item: record the unblocking commit on the task and require a re-run of that oracle before the plan closes. | AC-ICL-5 closed green on fixtures that route around the exact mechanism it claims to verify. |
| process | Include the diff (or changed-file manifest) in closure bundles handed to auditors; without it every score is bounded by oracle-name plausibility. | diff_available=false and tests_touched=false left all 11 ACs unverifiable at the implementation level. |
| spec | Where an AC names a proof technique (byte-comparison, twin corpora), require the oracle to emit that proof to stdout so the recorded tail carries it. | AC-ICL-6's non-mutation claim is invisible in its evidence. |
| plan | When a live-corpus write is the plan's terminal proof, have a second actor re-run the read-only detector and record that as separate attestation. | AC-ICL-8's live half is currently self-attested by its own performer. |

## Unverifiable Materials

- Implementation diff / changed-file list: Bundle states 'no diff provided' and diff_available=false; no source was inspectable for any of the 11 ACs.
- Test bodies for all oracle files (issue-resolution.test.ts, issue-closure.bun.test.ts, issue-check.bun.test.ts, issue-consumer-list.bun.test.ts, issue-closure-e2e.bun.test.ts, issues-resolution.spec.ts): Only test titles and truncated stdout tails were provided; assertion strength and six-dimension coverage claims could not be checked.
- Live-corpus end state (--open 9, --resolved 2, --check-issues consistent): Reported via 'manual' oracle by the actor who performed the writes; no independent read-back in the materials.
- Nature and current status of the AC-ICL-5 KNOWN-GAP workaround: Referenced only in test titles; no record explains what was worked around or whether it was retired after migration-012.
- feedback.stale_after_days default value (14) in the config schema: Claimed in the task deliverable; not surfaced in any attested oracle output.

## Rubric Warnings

- Dimension "evidence_integrity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 11 declared criteria
- Task evidence: 7 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 3 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.31
