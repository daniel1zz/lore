---
id: KN-760
type: knowledge
role: knowledge
title: "Assessment: Human review surface: decision detail, dashboard Needs-you, decide links (2026-10-19)"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-23
tags: []
parent: PLAN-237
links:
  - {id: PLAN-237, type: informs}
---
# Assessment: met (84/100)

Scope: plan `01M58N2K39AP9Z338HN8S98XG9`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-HR-1 | 82 | Attested pass (11 tests) plus red-first runs for the governance-loosen and run-reap mutants. Override and ac-exempt detail are visible. The other five producer diffs are omitted, and the final verify tail is cut off in build output before the result line. | 01M58N3MS2VKEFQ27X69SMA7QA (HR-T2 falsifier names classes), 01M58N3M6XN96V4QC5HHSBS3AM (HR-T1 loosen case) |
| AC-HR-2 | 78 | Attested pass and a red run with detail dropped from the hash. But the hash, migration, decisionDetailSchema and renderDecisionDetailSummary changes in decision-log.ts are not in the diff or in the truncation manifest, so the versioned payload cannot be checked here. | 01M58N3M6XN96V4QC5HHSBS3AM |
| AC-HR-3 | 88 | readPending skips closeStalePending, and the red run (listPending mutant: 15 vs 14 rows) proves the purity test can fail. 404 and 422 handling is visible and no path contains 'decide'. The auth gate placement is assumed from where the routes sit in routes.ts, not shown. | 01M58N3NB1Q2H62W43GD2YEVC8 |
| AC-HR-4 | 87 | NeedsYou and DecisionDetailPage use GET only, the empty text matches exactly, and the p.$name mirror routes exist. 10 tests pass, with a red run on blanked empty text. The test file is omitted, so the fetch-spy assertion itself cannot be inspected. | 01M58N3Q3N0CKZJNCCKX4GR515 |
| AC-HR-5 | 80 | The registry handles pid liveness, owner-only removal and atomic writes. Red runs cover a skipped removal and a planted port literal. Gaps: dev mode records the API port, not the Vite UI port. lore serve records host as given (e.g. 0.0.0.0) and may not serve the SPA page at all. | 01M58N3NXSGKVV358MF9RWW6K7 |
| AC-HR-6 | 90 | decide-flow and the pending renderers share decision-detail-lines.ts. The Details line holds no nonce and has a fallback form when no server is registered. 5 tests pass, with a red run on a mutated path prefix. | 01M58N3QNJDWZ98JNJNTM936TP |
| AC-HR-7 | 92 | resolveSameOriginNext rejects //, backslash, control characters and anything without a leading slash, checking both raw and percent-decoded values. Red run with the // check removed. Passes under test:file. | 01M58N3PGKCNJ72W1RE5P4PGNS |

## Gaps

- The versioned hash payload, detail migration and renderDecisionDetailSummary live in packages/lore/src/store/decision-log.ts, which is absent from both the diff and the truncation manifest. The 'old rows still verify' design cannot be checked.
- runDevMode in packages/lore/src/adapters/cli/commands/dashboard.ts registers the API server port, not the Vite UI origin. packages/lore/src/adapters/cli/commands/serve.ts registers the raw host (possibly 0.0.0.0) for a server that may not serve the SPA.

## Recommendations

- Finish HR-T8 (Added:/Removed: diff rendering, and a no-score sentence for human-always classes) with red-first CLI and component tests.
- Extend AC-HR-5 to assert that the registered URL serves /needs-you/decisions/<id> in packaged, dev and serve modes.
- Include store/decision-log.ts and the migration in assessment diffs when an AC depends on them.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 43821ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/integration/decide-detail-link.bun.test.ts, diff:packages/dashboard/tests/component/NeedsYou.test.tsx, diff:packages/lore/tests/integration/dashboard-bootstrap-next.bun.test.ts, diff:packages/lore/tests/integration/dashboard-bootstrap-next.bun.test.ts, diff:scripts/ac-oracle-not-built-ledger.json, diff:packages/lore/tests/integration/dashboard-server-registry.bun.test.ts, diff:packages/lore/tests/integration/dashboard-server-registry.bun.test.ts, diff:scripts/ac-oracle-not-built-ledger.json, diff:packages/lore/tests/integration/decision-read-routes.bun.test.ts, diff:packages/lore/tests/integration/decision-read-routes.bun.test.ts, diff:packages/lore/src/service/review-service.ts, diff:packages/lore/src/service/run-reap-service.ts, diff:packages/lore/src/service/stash-prune-service.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/src/service/verify-runner-service.ts, diff:packages/lore/src/service/worktree-removal-service.ts, diff:packages/lore/tests/integration/decision-detail-producers.bun.test.ts, diff:packages/lore/tests/integration/decision-detail-producers.bun.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.65 | evidence | All 7 ACs have attested passes and red-first runs. Weak points: registry URL correctness in dev and serve modes, and the HR-T8 UX shortfall seen in the smoke run. |
| evidence_integrity | 82 | 0.6 | evidence | Red-first runs for every AC and final verify-hr reruns. Attested ratio is 0.77, the AC-HR-1 final tail is cut off in build output, and the core chain code is unseen. |
| scope_fidelity | 88 | 0.65 | evidence | Changes map to HR-T1..T7 with CLAUDE.md docs updated. No unrelated drift. HR-T8 added as a later follow-up is not drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-HR-2 | The versioned hash payload, detail migration and renderDecisionDetailSummary live in packages/lore/src/store/decision-log.ts, which is absent from both the diff and the truncation manifest. The 'old rows still verify' design cannot be checked. |
| outcome | minor | AC-HR-5 | runDevMode in packages/lore/src/adapters/cli/commands/dashboard.ts registers the API server port, not the Vite UI origin. packages/lore/src/adapters/cli/commands/serve.ts registers the raw host (possibly 0.0.0.0) for a server that may not serve the SPA. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Finish HR-T8 (Added:/Removed: diff rendering, and a no-score sentence for human-always classes) with red-first CLI and component tests. | The smoke run showed the current detail is hard for a person to act on. |
| spec | Extend AC-HR-5 to assert that the registered URL serves /needs-you/decisions/<id> in packaged, dev and serve modes. | The current AC checks only that a record exists, not that the link it produces works. |
| process | Include store/decision-log.ts and the migration in assessment diffs when an AC depends on them. | The core of AC-HR-2 was unverifiable from the materials provided. |

## Unverifiable Materials

- packages/lore/src/store/decision-log.ts and the migration: Not in the diff or the truncation manifest; the hash versioning cannot be inspected.
- Omitted producer services (run-reap, stash-prune, worktree-removal, review, verify-runner, task-workflow): Listed in the truncation manifest; their per-class detail content is unseen.
- Omitted test files: Assertion strength (e.g. the fetch spy, the port-literal scan) cannot be inspected directly.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 2
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

1 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [minor] HR-T8 is in draft with no evidence. The detail page and CLI show full before/after lists and factor values for human-always classes, which the 2026-10-19 smoke run found hard to read. — "packages/dashboard/src/components/DecisionDetailPage.tsx" not found at commit 80a86f2c57576c98cf0a73585deefd4b8b465090

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 8 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.77
