---
id: KN-496
type: knowledge
role: knowledge
title: "Assessment: Close the falsify green-control gap: an unrunnable scratch worktree must record inconclusive, never a machine-proven red (2026-08-21)"
status: approved
priority: medium
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: PLAN-136
links:
  - {id: PLAN-136, type: informs}
---
# Assessment: partially_met (70/100)

Scope: plan `01M0HGHQ23SN3P83DR79RJ8VZQ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-FR-11 | 91 | Green control implemented before mutation in _runFalsifier; oracle records 2 pass (1 attested), red-first row present. Fixture makes green-control exit code numerically COINCIDE with declared expected_exit_code, so a skipped/mis-compared control would mint expected-fail — genuine discriminating pow… | 01M0HGKJMF4J3W7QMJCE5622ZQ (red-first row [1] then attested pass [2]/[5]) |
| AC-FR-12 | 87 | Integration test drives the real CLI against a throwaway corpus, asserts exit 3 without a pipe, and reads the row back via a separate `lore get --json` (not a spy): result inconclusive, attestation undefined, capture_source runner. 1 attested pass + red-first row. File contents largely truncated. | 01M0HMWGQETR63CNE8Q9D9TJQW (expected-fail [1] then attested pass [2]) |
| AC-FR-2 | 84 | Regression duty discharged: attested pass re-run after the subject file (attested-red.test.ts) and the shared falsifier fixture changed. -t filter run shows 4 pass / 9 skipped, so the oracle is a narrow slice, but it is the AC's own declared command. | 01M0HMWGQETR63CNE8Q9D9TJQW (row [3] attested pass) |
| AC-FR-3 | 84 | Attested pass re-run post-change; the new green-control STATE test also extends the isolation proof (hash + git status baseline) to the earlier-exiting path, so the new branch does not weaken D3. | 01M0HMWGQETR63CNE8Q9D9TJQW (row [4] attested pass) |
| AC-FR-1 | 30 | 0 pass / 0 fail corpus-wide. Mitigation: outside this plan's stated objective (the falsify green-control gap), but the plan declares no ac_scope, so it nominally remains in scope and is unevidenced. | — |
| AC-FR-4 | 30 | 0 pass / 0 fail corpus-wide; no evidence in these materials. Mitigation: not this plan's target; plan declares no ac_scope. | — |
| AC-FR-5 | 30 | 0 pass / 0 fail corpus-wide; no evidence in these materials. Mitigation: not this plan's target; plan declares no ac_scope. | — |
| AC-FR-6 | 30 | 0 pass / 0 fail corpus-wide; no evidence in these materials. Mitigation: not this plan's target; plan declares no ac_scope. | — |
| AC-FR-7 | 30 | 0 pass / 0 fail corpus-wide; no evidence in these materials. Mitigation: not this plan's target; plan declares no ac_scope. | — |
| AC-FR-8 | 30 | 0 pass / 0 fail corpus-wide; no evidence in these materials. Mitigation: not this plan's target; plan declares no ac_scope. | — |
| AC-FR-9 | 30 | 0 pass / 0 fail corpus-wide; no evidence in these materials. Mitigation: not this plan's target; plan declares no ac_scope. | — |
| AC-FR-10 | 30 | 0 pass / 0 fail corpus-wide; no evidence in these materials. Mitigation: not this plan's target; plan declares no ac_scope. | — |

## Gaps

- The plan declares no extra.ac_scope, so all 12 spec ACs are nominally in scope, yet AC-FR-1 and AC-FR-4 through AC-FR-10 have 0 pass and 0 fail evidence corpus-wide. The plan's prose targets only the falsify green-control gap, so the mismatch is a scoping-declaration defect rather than abandoned work, but nothing in the materials records that exclusion.
- The MINOR fix — a green control that fails to LAUNCH now records inconclusive instead of err(STORE_ERROR) — has no visible oracle: packages/lore/tests/unit/service/attested-red.test.ts adds HAPPY/NEGATIVE/ERROR/STATE/BOUNDARY/REGRESSION cases but none where executor returns err(...), and the JSDoc's own instruction was to cover it in the new test. Whether the integration file covers it cannot be checked (contents omitted).
- packages/lore/tests/unit/service/falsifier-execution-root.bun.test.ts had its fixture command semantics changed (now exits 0 unmutated) to survive the new green control, but its only post-change oracle is a self-reported oracle=manual `bun run test:changed` row, not an attested per-file run.
- On the launch-failure path exit_code is -1, and packages/lore/src/adapters/cli/commands/verify.ts renders it verbatim as "the UNMUTATED command exited -1", which reads as a real exit status for a process that never started; the annotation text in the row says FAILED TO LAUNCH but the human-facing CLI line does not.

## Recommendations

- Set extra.ac_scope to AC-FR-2, AC-FR-3, AC-FR-11, AC-FR-12 on plans of this shape so assessment does not count the eight untouched sibling ACs as in-scope gaps.
- Extend AC-FR-11 (or add a criterion) to require the launch-failure shape — executor err(...) — to record inconclusive with exit_code -1, so the MINOR fix is pinned by an oracle rather than by JSDoc prose.
- When a shared fixture is edited to accommodate a new guard, require an attested per-AC re-run of every AC bound to that file, not just a scoped `test:changed` manual row.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 94115ms
- Retried: false
- Truncated sections: task:task-run-the-unmutated-green-control-before-the-mutation-and, diff:packages/lore/tests/integration/cli/verify-falsify-green-control.test.ts
- Reasoning clipped for: AC-FR-11
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.82 | evidence | Green control lands before mutation, records inconclusive with no attestation, surfaces exit 3 on the CLI; both AC-FR-11 and AC-FR-12 attested, with a coincidence fixture giving real discriminating p… |
| evidence_integrity | 80 | 0.75 | evidence | AC-bound rows come from lore verify with attestation; red-first recorded per constraint; AC-FR-12 reads the row back from a real corpus, not a spy. Dragged by 6 self-reported non-AC rows and an untes… |
| scope_fidelity | 92 | 0.85 | evidence | Diff touches only verify.ts, verify-runner-service.ts and the two related test files plus the new integration test; the collateral fixture change is explained and its regression duty was executed. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | The plan declares no extra.ac_scope, so all 12 spec ACs are nominally in scope, yet AC-FR-1 and AC-FR-4 through AC-FR-10 have 0 pass and 0 fail evidence corpus-wide. The plan's prose targets only the falsify green-control gap, so the mismatch is a scoping-declaration defect rather than abandoned work, but nothing in the materials records that exclusion. |
| evidence_integrity | minor | AC-FR-11 | The MINOR fix — a green control that fails to LAUNCH now records inconclusive instead of err(STORE_ERROR) — has no visible oracle: packages/lore/tests/unit/service/attested-red.test.ts adds HAPPY/NEGATIVE/ERROR/STATE/BOUNDARY/REGRESSION cases but none where executor returns err(...), and the JSDoc's own instruction was to cover it in the new test. Whether the integration file covers it cannot be checked (contents omitted). |
| evidence_integrity | minor | AC-FR-2 | packages/lore/tests/unit/service/falsifier-execution-root.bun.test.ts had its fixture command semantics changed (now exits 0 unmutated) to survive the new green control, but its only post-change oracle is a self-reported oracle=manual `bun run test:changed` row, not an attested per-file run. |
| outcome | minor | AC-FR-12 | On the launch-failure path exit_code is -1, and packages/lore/src/adapters/cli/commands/verify.ts renders it verbatim as "the UNMUTATED command exited -1", which reads as a real exit status for a process that never started; the annotation text in the row says FAILED TO LAUNCH but the human-facing CLI line does not. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Set extra.ac_scope to AC-FR-2, AC-FR-3, AC-FR-11, AC-FR-12 on plans of this shape so assessment does not count the eight untouched sibling ACs as in-scope gaps. | Eight declared ACs are unevidenced purely because no scope was declared, diluting an otherwise well-evidenced delivery. |
| spec | Extend AC-FR-11 (or add a criterion) to require the launch-failure shape — executor err(...) — to record inconclusive with exit_code -1, so the MINOR fix is pinned by an oracle rather than by JSDoc prose. | A behaviour-bearing branch added in the second commit currently has no visible test; unpinned branches are how the original false-match survived. |
| process | When a shared fixture is edited to accommodate a new guard, require an attested per-AC re-run of every AC bound to that file, not just a scoped `test:changed` manual row. | falsifier-execution-root.bun.test.ts's semantics changed with only self-reported coverage. |

## Unverifiable Materials

- packages/lore/tests/integration/cli/verify-falsify-green-control.test.ts (full contents omitted from the diff): Only the second commit's timeout-wrapper hunk is visible; the file's fixture helpers, RED-direction coverage, and any launch-failure case cannot be inspected.
- Actual green/red behaviour of AC-FR-1 and AC-FR-4..AC-FR-10 implementations: No evidence rows and no diff touching those surfaces; scored on absence of evidence, not on inspected code.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 12 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.36
