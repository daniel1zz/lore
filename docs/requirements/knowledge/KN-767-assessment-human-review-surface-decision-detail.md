---
id: KN-767
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
# Assessment: met (80/100)

Scope: plan `01M58N2K39AP9Z338HN8S98XG9`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-HR-1 | 84 | HR-T2 shows a red run that names the run-end-stale and process-reap classes, then 11/11 pass. The final verify run is attested pass, but its tail is cut off during the build, so no pass counts are visible. The producer code (worktree-removal, stash-prune, override etc.) is in the manifest but not s… | task-skill-implement-hr-t2-every-other-escalating-producer (expected-fail naming classes, then 11 pass), task-skill-implement-hr-t1-decision-detail-field-in-the-hash (governance-loosen before/after mutant red, then pass) |
| AC-HR-2 | 90 | A mutant that drops detail from the hash goes red, then 4/4 pass, and the final verify run passes. The CLI path uses renderDecisionDetailSummary for the honest label. The hash code in decision-log.ts is not shown in the diff. | task-skill-implement-hr-t1-decision-detail-field-in-the-hash (red-first mutant plus verify pass) |
| AC-HR-3 | 87 | A red mutant (readPending calling listPending) appended a row (15 vs 14), which proves the purity check bites. The final run that includes the autonomy-human-channel scan is attested pass, though its tail is truncated. routes.ts is not shown. | task-skill-implement-hr-t3-read-only-decision-and-audit-item (row-count mutant red, then pass) |
| AC-HR-4 | 88 | The diff shows the three sections, NEEDS_YOU_EMPTY_TEXT, the p.$name mirror and a detail page with factors, recommendation and answer commands. The empty-text mutant went red, then 10/10 pass. The Refresh button only refetches GETs. | task-skill-implement-hr-t6-dashboard-needs-you-page-decisions (red-first, then 10 pass) |
| AC-HR-5 | 88 | Two probes went red: skipping record removal, and a planted localhost:8787. Then 6/6 pass, including the final verify run. live-server-registry.ts is not shown. | task-skill-implement-hr-t4-running-dashboard-serve-registers (two falsifier probes, then pass) |
| AC-HR-6 | 90 | The diff shows decision-detail-lines.ts with the What/Before/After/accept/reject lines, a Details link built from the registry or the start-the-dashboard fallback, and no nonce. Pending renders a link per decision and per audit row. The path-prefix mutant went red, then 5/5 pass. | task-skill-implement-hr-t7-lore-decide-and-lore-pending-print (mutation red, then 5 pass) |
| AC-HR-7 | 86 | Removing the // check made the hostile-next tests fail, and the AC script then passes. The bootstrap handler code (static-serving.ts) is not shown, and the red run used plain bun test rather than test:file. | task-skill-implement-hr-t5-sign-in-link-keeps-a-same-origin (red mutation, then pass) |

## Gaps

- No HR task covers the changes in packages/core/src/actor-resolution-node.ts, packages/core/src/invocation.ts, packages/core/src/run-identity.ts and packages/lore/src/adapters/cli/cli-exit.ts, or the defineLoreCommand conversion across all CLI commands. This refactor of identity, exit codes and stdin lands without plan coverage or ACs.
- The final verify tail for AC-HR-1 stops during the dashboard rebuild, so no pass counts are visible. The pass relies on the attested record.

## Recommendations

- Keep unrelated refactors (OsUser identity, defineLoreCommand, Invocation stdin) on a separate branch and plan from feature work.
- Store the last N lines of each test run's output, not the first N bytes, so the pass/fail summary is always captured.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 33421ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/integration/decide-detail-link.bun.test.ts, diff:packages/core/tests/es-invocation-user.test.ts, diff:packages/core/tests/run-identity-node.test.ts, diff:packages/dashboard/tests/component/NeedsYou.test.tsx, diff:packages/lore/src/adapters/cli/commands/anchor.ts, diff:packages/lore/src/adapters/cli/commands/assess.ts, diff:packages/lore/src/adapters/cli/commands/audit.ts, diff:packages/lore/src/adapters/cli/commands/autonomy.ts, diff:packages/lore/src/adapters/cli/commands/baseline-adopt.ts, diff:packages/lore/src/adapters/cli/commands/baseline.ts, diff:packages/lore/src/adapters/cli/commands/bootstrap.ts, diff:packages/lore/src/adapters/cli/commands/calibration.ts, diff:packages/lore/src/adapters/cli/commands/claim.ts, diff:packages/lore/src/adapters/cli/commands/context.ts, diff:packages/lore/src/adapters/cli/commands/create.ts, diff:packages/lore/src/adapters/cli/commands/dashboard.ts, diff:packages/lore/src/adapters/cli/commands/decide.ts, diff:packages/lore/src/adapters/cli/commands/delete.ts, diff:packages/lore/src/adapters/cli/commands/diff.ts, diff:packages/lore/src/adapters/cli/commands/done.ts, diff:packages/lore/src/adapters/cli/commands/eval.ts, diff:packages/lore/src/adapters/cli/commands/evidence.ts, diff:packages/lore/src/adapters/cli/commands/export-docs.ts, diff:packages/lore/src/adapters/cli/commands/feed.ts, diff:packages/lore/src/adapters/cli/commands/fragments.ts, diff:packages/lore/src/adapters/cli/commands/gate.ts, diff:packages/lore/src/adapters/cli/commands/get.ts, diff:packages/lore/src/adapters/cli/commands/governance.ts, diff:packages/lore/src/adapters/cli/commands/handoff.ts, diff:packages/lore/src/adapters/cli/commands/init.ts, diff:packages/lore/src/adapters/cli/commands/integrate.ts, diff:packages/lore/src/adapters/cli/commands/invalidate.ts, diff:packages/lore/src/adapters/cli/commands/issue.ts, diff:packages/lore/src/adapters/cli/commands/issues.ts, diff:packages/lore/src/adapters/cli/commands/link.ts, diff:packages/lore/src/adapters/cli/commands/list.ts, diff:packages/lore/src/adapters/cli/commands/log.ts, diff:packages/lore/src/adapters/cli/commands/migrate.ts, diff:packages/lore/src/adapters/cli/commands/outline.ts, diff:packages/lore/src/adapters/cli/commands/pending.ts, diff:packages/lore/src/adapters/cli/commands/phase.ts, diff:packages/lore/src/adapters/cli/commands/plan.ts, diff:packages/lore/src/adapters/cli/commands/ready.ts, diff:packages/lore/src/adapters/cli/commands/red-first.ts, diff:packages/lore/src/adapters/cli/commands/reject.ts, diff:packages/lore/src/adapters/cli/commands/release.ts, diff:packages/lore/src/adapters/cli/commands/reopen.ts, diff:packages/lore/src/adapters/cli/commands/report-issue.ts, diff:packages/lore/src/adapters/cli/commands/requirement.ts, diff:packages/lore/src/adapters/cli/commands/restore.ts, diff:packages/lore/src/adapters/cli/commands/review.ts, diff:packages/lore/src/adapters/cli/commands/rule.ts, diff:packages/lore/src/adapters/cli/commands/run.ts, diff:packages/lore/src/adapters/cli/commands/scope.ts, diff:packages/lore/src/adapters/cli/commands/search.ts, diff:packages/lore/src/adapters/cli/commands/seat.ts, diff:packages/lore/src/adapters/cli/commands/serve.ts, diff:packages/lore/src/adapters/cli/commands/session.ts, diff:packages/lore/src/adapters/cli/commands/set.ts, diff:packages/lore/src/adapters/cli/commands/setup.ts, diff:packages/lore/src/adapters/cli/commands/stash.ts, diff:packages/lore/src/adapters/cli/commands/status.ts, diff:packages/lore/src/adapters/cli/commands/sync-docs.ts, diff:packages/lore/src/adapters/cli/commands/sync.ts, diff:packages/lore/src/adapters/cli/commands/territory.ts, diff:packages/lore/src/adapters/cli/commands/trace.ts, diff:packages/lore/src/adapters/cli/commands/tree.ts, diff:packages/lore/src/adapters/cli/commands/uat.ts, diff:packages/lore/src/adapters/cli/commands/unlink.ts, diff:packages/lore/src/adapters/cli/commands/verify.ts, diff:packages/lore/src/adapters/cli/commands/worktree.ts, diff:packages/lore/src/adapters/cli/editor.ts, diff:packages/lore/src/adapters/cli/gate-bypass-audit.ts, diff:packages/lore/src/adapters/cli/index.ts, diff:packages/lore/src/adapters/cli/output.ts, diff:packages/lore/src/adapters/cli/prompt.ts, diff:packages/lore/src/adapters/cli/run-cli.ts, diff:packages/lore/src/adapters/cli/stdio-sync.ts, diff:packages/lore/src/adapters/cli/utils.ts, diff:packages/lore/src/adapters/mcp/call-scope.ts, diff:packages/lore/src/adapters/mcp/tools.ts, diff:packages/lore/src/flows/feed-flow.ts, diff:packages/lore/src/service/gate-enforcer.ts, diff:packages/lore/src/service/helper-scope-review.ts, diff:packages/lore/src/store/write-context-store.ts, diff:packages/lore/tests/helpers/es-run-lore-in-process.test.ts, diff:packages/lore/tests/helpers/run-lore-in-process.ts, diff:packages/lore/tests/helpers/test-invocation.ts, diff:packages/lore/tests/live-invocation.ts, diff:packages/lore/tests/unit/adapters/cli/editor.test.ts, diff:packages/lore/tests/unit/adapters/mcp-unnamed-invocation.test.ts, diff:packages/lore/tests/unit/cli/es-exit-code-required.test.ts, diff:packages/lore/tests/unit/cli/es-os-user-unresolved.test.ts, diff:packages/lore/tests/unit/cli/es-run-cli-exit-code.test.ts, diff:packages/lore/tests/unit/cli/es-stdin-from-invocation.test.ts, diff:packages/lore/tests/unit/cli/iv-invocation-delivery.test.ts, diff:packages/lore/tests/unit/core/actor-resolution-ignores-lore-actor.test.ts, diff:packages/lore/tests/unit/feed-resume-same-session.test.ts, diff:packages/lore/tests/unit/service/audit-service.test.ts, diff:packages/lore/tests/unit/service/helper-scope-review.test.ts, diff:packages/lore/tests/unit/service/resume-rule-diff-wiring.test.ts, diff:packages/lore/src/adapters/http/CLAUDE.md, diff:packages/lore/src/adapters/http/static-serving.ts, diff:packages/lore/tests/integration/dashboard-bootstrap-next.bun.test.ts, diff:scripts/ac-oracle-not-built-ledger.json, diff:packages/lore/src/adapters/cli/commands/dashboard.ts, diff:packages/lore/src/adapters/cli/commands/serve.ts, diff:packages/lore/src/adapters/cli/live-server-registry.ts, diff:packages/lore/tests/integration/dashboard-server-registry.bun.test.ts, diff:scripts/ac-oracle-not-built-ledger.json, diff:packages/lore/src/adapters/cli/commands/pending.ts, diff:packages/lore/src/adapters/cli/commands/session.ts, diff:packages/lore/src/adapters/cli/decide-flow.ts, diff:packages/lore/src/adapters/cli/decision-detail-lines.ts, diff:packages/lore/src/adapters/cli/pending-decisions-render.ts, diff:packages/lore/src/adapters/http/CLAUDE.md, diff:packages/lore/src/adapters/http/routes.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/autonomy-calibration-service.ts, diff:packages/lore/src/service/decision-service.ts, diff:packages/lore/src/service/helper-scope-review.ts, diff:packages/lore/src/service/pending-decisions.ts, diff:packages/lore/tests/integration/decide-detail-link.bun.test.ts, diff:packages/lore/tests/integration/decision-read-routes.bun.test.ts, diff:packages/lore/tests/unit/service/helper-scope-review.test.ts, diff:packages/lore/src/adapters/cli/commands/pending.ts, diff:packages/lore/src/adapters/cli/commands/session.ts, diff:packages/lore/src/adapters/cli/decide-flow.ts, diff:packages/lore/src/adapters/cli/decision-detail-lines.ts, diff:packages/lore/src/adapters/cli/pending-decisions-render.ts, diff:packages/lore/src/adapters/http/CLAUDE.md, diff:packages/lore/src/adapters/http/routes.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/ac-exemption-service.ts, diff:packages/lore/src/service/autonomy-calibration-service.ts, diff:packages/lore/src/service/decision-service.ts, diff:packages/lore/src/service/helper-scope-review.ts, diff:packages/lore/src/service/override-decision.ts, diff:packages/lore/src/service/pending-decisions.ts, diff:packages/lore/src/service/review-service.ts, diff:packages/lore/src/service/run-reap-service.ts, diff:packages/lore/src/service/stash-prune-service.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/src/service/verify-runner-service.ts, diff:packages/lore/src/service/worktree-removal-service.ts, diff:packages/lore/tests/integration/decide-detail-link.bun.test.ts, diff:packages/lore/tests/integration/decision-detail-producers.bun.test.ts, diff:packages/lore/tests/integration/decision-read-routes.bun.test.ts, diff:packages/lore/tests/unit/service/helper-scope-review.test.ts
- Reasoning clipped for: AC-HR-1

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 87 | 0.7 | evidence | All 7 ACs have an attested pass and red-first falsifiers. The CLI and dashboard surfaces visible in the diff match the spec wording. |
| evidence_integrity | 82 | 0.65 | evidence | Every AC has a red-first run before its pass, and the final runs come from the verify-hr worktree. Some tails are truncated, and the attested ratio is 0.77. |
| scope_fidelity | 55 | 0.75 | evidence | The diff carries a broad refactor outside the plan (actor OsUser, defineLoreCommand on every command, stdin in Invocation) that no HR task covers. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | No HR task covers the changes in packages/core/src/actor-resolution-node.ts, packages/core/src/invocation.ts, packages/core/src/run-identity.ts and packages/lore/src/adapters/cli/cli-exit.ts, or the defineLoreCommand conversion across all CLI commands. This refactor of identity, exit codes and stdin lands without plan coverage or ACs. |
| evidence_integrity | minor | AC-HR-1 | The final verify tail for AC-HR-1 stops during the dashboard rebuild, so no pass counts are visible. The pass relies on the attested record. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Keep unrelated refactors (OsUser identity, defineLoreCommand, Invocation stdin) on a separate branch and plan from feature work. | Bundling them hides behaviour changes that no AC covers inside a feature diff. |
| process | Store the last N lines of each test run's output, not the first N bytes, so the pass/fail summary is always captured. | Several tails end mid-build. |

## Unverifiable Materials

- packages/lore/src/adapters/http/routes.ts: Omitted from the diff, so the read routes' auth and purity can only be judged from the tests.
- packages/lore/src/adapters/cli/live-server-registry.ts: Omitted from the diff, so the dead-pid handling cannot be inspected.
- decision_log hash/migration code: Not shown, so the versioned payload can only be judged from the tests.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 4
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 7 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.77
