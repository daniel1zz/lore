---
id: KN-403
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-083 governance prose runtime injection (2026-07-26)"
status: approved
priority: medium
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: PLAN-119
links:
  - {id: PLAN-119, type: informs}
---
# Assessment: met (85/100)

Scope: plan `01KYFAASTDD2XX8HASF7YH23EC`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-083-1 | 90 | Attested e2e run at repo root (ev 9) shows compiled dist/lore governance test passing with named HAPPY byte-identity, NEGATIVE exit-2 flag, and BOUNDARY cases in the output tail. Matches the AC's verify command exactly. Source of the printed prose itself unverifiable (no diff). | 01KYFAB6X6XNVDMMXF61H9YX7E (evidence [1], [9] attested) |
| AC-083-2 | 89 | Attested vitest run (ev 10) at repo root: setup-governance-retirement.test.ts, 13/13 pass. Test file was authored by the same implementer, so the strength of the install-set and hook-source assertions cannot be inspected without the diff. | 01KYFAB6X6XNVDMMXF61H9YX7E (evidence [2], [7], [10] attested) |
| AC-083-3 | 90 | Attested tsc run (ev 11) at repo root shows the full typecheck chain (core, lore, lore-tests, scripts, dashboard) executing; tail is truncated mid-command but result recorded pass with per-project invocations visible. | 01KYFAB6X6XNVDMMXF61H9YX7E (evidence [3], [8], [11] attested) |
| AC-083-4 | 90 | Attested vitest run (ev 12) at repo root: assets-ssot.test.ts 220/220 pass, covering embedded-manifest freshness and hook spawn invariants after the manifest regeneration. Pre-existing suite, so less self-authored-test risk than AC-083-2. | 01KYFAB6X6XNVDMMXF61H9YX7E (evidence [4], [12] attested) |

## Gaps

- diff_available=false. The plan's five deliverables (new governance.ts command, index.ts lazy registration, hook Phase C spawnSync rewrite, install-set removal, manifest regeneration) are attested only indirectly via test outcomes. Nothing rules out extra unrelated edits or a hook rewrite that silently weakens the fail-open contract while still satisfying the assertions.
- The AC-083-2 oracle is a test file authored inside the same task it validates. Without the diff, the assertions (zero corpus-workflow occurrences in hook source; governance verb present as spawn arg) cannot be confirmed to bind against the real hook file rather than a fixture.
- Evidence [5]-[8] originate from a '/lore-wt-spec083-fix' worktree and include setup-check and setup-freshness-cycle e2e suites absent from the task's declared oracle scope. No note explains what failed and was repaired between the two worktrees.
- The tsc evidence tail is clipped mid-invocation ('$ tsc --n'), so the dashboard project's exit status is asserted by the recorder rather than shown.

## Recommendations

- Require the diff in the audit bundle whenever a task edits a fail-open runtime hook, so reviewers can check contract preservation directly instead of relying on self-authored assertions.
- Attach a short repair note to evidence recorded from a '-fix' worktree, naming the failure it addressed and any oracles added beyond the plan's declared scope.
- Add a knowledge-capture deliverable for the installed-asset -> spawned-verb migration pattern (asset stays SSOT in assets/, is dropped from the install set, and is emitted at runtime by a bootstrap-stage verb).

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 47809ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.75 | evidence | All 4 ACs have attested passes at repo root with matching commands; compiled-binary byte-parity and 220-test assets-ssot suite are meaningful signals. Implementation quality itself unseen. |
| evidence_integrity | 78 | 0.7 | evidence | Every AC has an attested run with output tail from main-orchestrator post-merge. Weakened by 0.33 attestation ratio and one truncated tsc tail; extra -fix worktree runs are unexplained. |
| scope_fidelity | 76 | low | absence | Commands map cleanly to the plan's single-slice scope, but with no diff, file-level drift is unverifiable, and the '-fix' worktree adds two oracles outside the declared scope. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | diff_available=false. The plan's five deliverables (new governance.ts command, index.ts lazy registration, hook Phase C spawnSync rewrite, install-set removal, manifest regeneration) are attested only indirectly via test outcomes. Nothing rules out extra unrelated edits or a hook rewrite that silently weakens the fail-open contract while still satisfying the assertions. |
| evidence_integrity | minor | AC-083-2 | The AC-083-2 oracle is a test file authored inside the same task it validates. Without the diff, the assertions (zero corpus-workflow occurrences in hook source; governance verb present as spawn arg) cannot be confirmed to bind against the real hook file rather than a fixture. |
| evidence_integrity | minor | — | Evidence [5]-[8] originate from a '/lore-wt-spec083-fix' worktree and include setup-check and setup-freshness-cycle e2e suites absent from the task's declared oracle scope. No note explains what failed and was repaired between the two worktrees. |
| outcome | minor | AC-083-3 | The tsc evidence tail is clipped mid-invocation ('$ tsc --n'), so the dashboard project's exit status is asserted by the recorder rather than shown. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require the diff in the audit bundle whenever a task edits a fail-open runtime hook, so reviewers can check contract preservation directly instead of relying on self-authored assertions. | Green tests on implementer-written assertions cannot distinguish a correct hook rewrite from one that passes the letter of the check. |
| process | Attach a short repair note to evidence recorded from a '-fix' worktree, naming the failure it addressed and any oracles added beyond the plan's declared scope. | Four unexplained out-of-scope oracle runs read as undeclared drift in an otherwise clean single-slice execution. |
| plan | Add a knowledge-capture deliverable for the installed-asset -> spawned-verb migration pattern (asset stays SSOT in assets/, is dropped from the install set, and is emitted at runtime by a bootstrap-stage verb). | Zero knowledge docs linked; this pattern will recur for other retired installed assets. |

## Unverifiable Materials

- Implementation diff (governance.ts, src/index.ts, session-start-resume.mjs, install asset set, generated/assets-manifest.ts): diff_available=false in the bundle; no file contents provided.
- Hook Phase C fail-open contract and fence format after the spawnSync rewrite: Plan asserts both are unchanged; no diff or dedicated fail-open oracle shown to confirm behavior when the spawned binary is missing or errors.
- Assertion strength of tests/unit/setup-governance-retirement.test.ts: Only the 13-pass count is visible; the assertions themselves were authored in the same task and not shown.
- Explanation for the '/lore-wt-spec083-fix' worktree runs: Evidence [5]-[8] imply a repair cycle with no accompanying narrative or defect record.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 4 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.33
