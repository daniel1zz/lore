---
id: KN-781
type: knowledge
role: knowledge
title: "Assessment: Evidence identity: count only equal-command attested rows; re-verify the drop set (2026-10-18)"
status: archived
priority: medium
created: 2026-10-18
updated: 2026-10-23
tags: []
parent: PLAN-203
links:
  - {id: PLAN-203, type: informs}
---
# Assessment: met (80/100)

Scope: plan `01M56GH74M7XVH6M3A50RC5A2C`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-EI-1 | 87 | The comparison lives only in computeAcCoverage. other_command appears on ac list text and JSON, status, the outline mirror and the assess cell. 12-test suite red-first then attested pass under the declared command. Half 5 scans src/ai/assess-template.ts, not service/assess*.ts. falsified still coun… | 01M56GJ1Z9YFJF8ETS1W9HF1AK (EI-1: expected-fail [1], then attested passes [2] and [6]) |
| AC-EI-2 | 80 | The extractor now finds interpreter script paths and lists unchecked segments. TG-22's narrowing is gone from both the derive step and done. Attested pass under the declared command. But not_measured needs some pass on record: an AC with a missing path and no pass stays 'none', short of 'whenever'.… | 01M56GJ2S20KKX37VQV8HD6ZEG (EI-2: expected-fail [1]/[5]/[6], then pass [10] under the declared command) |
| AC-EI-3 | 78 | Checker attested pass: 292 rows, green=291, explained=1, unexplained=0. That matches the 292 baseline. Exits 2/1/0/3 are tested on fixtures, fail_superseded counts as green, and the checker is wired into run-chain. Checker source and the drop-set JSON are omitted. No full bun run test is recorded a… | 01M56GJ3K0Q0SCCCFYQD2DH0JZ (EI-4: [2] fail, [3] pass, [5] attested AC-EI-3 pass), 01M56GJ0ZJ00MKAZZV9S8TVRV3 (EI-3: red-first fixture tests) |

## Gaps

- The plan's exit criterion requires 'bun run test exits 0 after EI-4', and INV-2 says the full suite runs once after EI-4. EI-4's evidence holds only scoped vitest runs and the checker, so no full-suite run is recorded.
- deriveAcCoverageState in packages/core/src/acceptance.ts returns not_measured only when fact.pass > 0 or a pass ref exists. AC-EI-2 says 'whenever any extracted path is missing'. An AC with a missing script and no pass renders 'none'.
- packages/lore/src/service/task-workflow-service.ts changes lore done's missing-oracle refusal so that any pass counts. INV-4 says lore done's archival floor is unchanged. It is unclear whether this floor is BR-200.

## Recommendations

- Require an attested full 'bun run test' evidence row on the final task of any plan whose exit criterion names the full suite.
- In AC-EI-2, state whether a criterion with a missing oracle and no evidence renders none or not_measured.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 45964ms
- Retried: false
- Truncated sections: diff:scripts/ac-oracle-not-built-ledger.json, diff:scripts/check-evidence-identity-drop-set.ts, diff:scripts/evidence-identity-drop-set.json, diff:scripts/run-chain.ts, diff:scripts/check-evidence-identity-drop-set.ts, diff:scripts/generate-evidence-identity-drop-set.ts, diff:packages/lore/tests/unit/adapters/task-feed-wiring.test.ts, diff:packages/lore/tests/unit/service/ac-service.test.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/service/phase-workflow-plan-phase-status-declared.test.ts, diff:packages/lore/tests/unit/service/verification-projection-service.test.ts, diff:scripts/ac-oracle-not-built-ledger.json, diff:packages/core/src/acceptance.test.ts, diff:packages/core/tests/unit/oracle-interpreter-paths.test.ts, diff:packages/lore/tests/integration/cli/missing-oracle-any-path.test.ts, diff:packages/lore/tests/integration/cli/verify-missing-oracle-file.test.ts, diff:scripts/ac-oracle-not-built-ledger.json
- Reasoning clipped for: AC-EI-1, AC-EI-2, AC-EI-3

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 82 | 0.7 | evidence | All three ACs are implemented and attested under their declared commands. Small semantic gaps: no-pass missing oracle stays 'none'; falsified still counts other-command rows. |
| evidence_integrity | 76 | 0.65 | evidence | Red-first then attested pass for each AC, with the current commands. But the full-suite exit criterion is unevidenced, and the checker and drop-set files are not visible. |
| scope_fidelity | 80 | 0.6 | evidence | Changes stay on the rule and its surfaces. The lore done missing-oracle predicate changed (adjacent to INV-4). The status ac_oracle_file_missing additions follow from AC-EI-2. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | The plan's exit criterion requires 'bun run test exits 0 after EI-4', and INV-2 says the full suite runs once after EI-4. EI-4's evidence holds only scoped vitest runs and the checker, so no full-suite run is recorded. |
| outcome | minor | AC-EI-2 | deriveAcCoverageState in packages/core/src/acceptance.ts returns not_measured only when fact.pass > 0 or a pass ref exists. AC-EI-2 says 'whenever any extracted path is missing'. An AC with a missing script and no pass renders 'none'. |
| scope_fidelity | minor | — | packages/lore/src/service/task-workflow-service.ts changes lore done's missing-oracle refusal so that any pass counts. INV-4 says lore done's archival floor is unchanged. It is unclear whether this floor is BR-200. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require an attested full 'bun run test' evidence row on the final task of any plan whose exit criterion names the full suite. | The exit criterion was declared but never evidenced. |
| spec | In AC-EI-2, state whether a criterion with a missing oracle and no evidence renders none or not_measured. | The implementation and the spec text differ on this case. |

## Unverifiable Materials

- scripts/check-evidence-identity-drop-set.ts and scripts/evidence-identity-drop-set.json: Omitted from the diff. The checker's logic and the 292 rows (and which task explains the one explained row) cannot be inspected.
- packages/lore/tests/integration/cli/missing-oracle-any-path.test.ts: Omitted. Halves 4 and 5 and the lore verify naming are known only from output tails.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 1
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

1 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [minor] Half 5's grep scans packages/lore/src/ai/assess-template.ts in place of the spec's packages/lore/src/service/assess*.ts glob. The risk register names a dashboard surface that has no coverage here. — "packages/lore/src/service/assess*.ts" not found at commit a085d406c8a8d5ec6a6a49059deeb4015e770b8c

## Facts Summary

- AC coverage: 3 declared criteria
- Task evidence: 5 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.96
