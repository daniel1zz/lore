---
id: KN-025
type: knowledge
role: knowledge
title: "Assessment: SPEC-035 Implementation — audit trail + calibration (2026-07-06)"
status: draft
priority: medium
created: 2026-07-06
updated: 2026-07-06
tags: []
parent: PLAN-014
links:
  - {id: PLAN-014, type: informs}
---
# Assessment: partially_met (63/100)

Scope: plan `01KWVDGK9S0SZMAM9PNAYRGT4W`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-AUDIT-COVERAGE | 38 | Spec §2 requires TaskWorkflowService claim/release/evidence + JudgmentService.record 'judge' to append audit entries. NONE of these writer changes appear in the diff — only ReviewService is touched. Action vocabulary shows in a CLI arg string, but the coverage fix itself is unverifiable. | task-d-audit-surface-lore-audit-cli-verify-twf-coverage-details (TWF/judge writers not in diff) |
| AC-AUDIT-ACTOR | 90 | audit-actor.ts fully present: formatJudgeActor + parseAuditActor with 4-segment cap, never-throws malformed degradation, round-trip invariants documented. Consumed by audit.ts formatActor. Complete and self-contained. | task-d-audit-surface-lore-audit-cli-verify-twf-coverage-details (audit-actor.ts new) |
| AC-AUDIT-CLI | 68 | commands/audit.ts complete: per-doc trail, --actor/--action/--since/--limit/--json, filters map 1:1 to AuditFilters, AI actor decoding. But it pipes to app.auditService.query, and audit-service.ts (the service anchor) is absent from the diff — read impl unverifiable. | task-d-audit-surface-lore-audit-cli-verify-twf-coverage-details (cli present, service absent) |
| AC-AUDIT-VERIFY | 44 | CLI --verify branch (exit 0/4, itemized misses, --since override) and config watermark resolveAuditVerifySince present. But audit-service.verify() unshown, and details.version added ONLY to ReviewService — create/update/restore writers absent, so the exact (doc_id,action,version) join would miss th… | task-d-audit-surface-lore-audit-cli-verify-twf-coverage-details (details.version incomplete across writers) |
| AC-CALIB-TABLE | 45 | Spec §3 defines calibration_records DDL (FKs, CHECK, two indexes). Diff has core calibrationRecordSchema (labeled SPEC-034) but NO migration/SQL creating the table — comments cite migration-003.ts which is not in the diff. Storage layer unverifiable. | task-e-calibration-capture-stats-cli (no migration file in diff) |
| AC-CALIB-TRIGGER | 74 | calibration-hook.ts complete: version-pin (actedOnVersion), correct approve=v-1/reject=v pairing, confirmed/overridden table, wired into approve.ts/reject.ts. Silent skip on stale/no-judgment. Depends on JudgmentService.recordCalibration/latestFor which are not in the diff. | task-e-calibration-capture-stats-cli (hook present, service absent) |
| AC-CALIB-FAILURE | 85 | Partial-failure contract fully implemented: warnCalibrationFailure writes 'warning: <verb>, but calibration record failed' to stderr, records a telemetry event, leaves exit code untouched (still 0). Both failure branches route through it. Matches spec fail-loud/no-invert priorities. | task-e-calibration-capture-stats-cli (stderr+telemetry, exit 0) |
| AC-CALIB-NOTE | 52 | --calibration-note flag present on approve/reject, feeds deltaReasons[0]. But spec's escalation seeding of delta_reasons from answered blocking_questions is NOT implemented — hook only passes the manual note. Escalation-specific best-effort seeding absent. | task-e-calibration-capture-stats-cli (note flag yes, escalation seeding no) |
| AC-STATS | 64 | commands/calibration.ts complete: --stats required (exit 2 otherwise), --doc-type/--prompt-version filters, renders n/agreement_rate/wilson_lower_bound/window_limit table + --json. Aggregation piped to JudgmentService.computeCalibrationStats, which is not in the diff (bounded-window scan unverifiab… | task-e-calibration-capture-stats-cli (cli present, service method absent) |
| AC-WILSON | 90 | wilsonLowerBound pure fn in @lore/core: n=0→0, [0,1] clamp, z default 1.96, closed-form Wilson. Importable per spec (PRD 14.3 gate math not reimplemented). Spec calls for direct unit tests; fn is self-contained and testable. | task-e-calibration-capture-stats-cli (calibration.ts wilsonLowerBound) |

## Gaps

- audit-service.ts (query + verify reconcile walk) — the core §5 service anchor — is entirely absent from the diff; only its CLI consumer is shown.
- JudgmentService (record/recordCalibration/latestFor/computeCalibrationStats) not in diff; calibration hook and stats/pending commands depend on it.
- No migration/SQL creating calibration_records; comments reference migration-003.ts but no such file is in the diff.
- details.version added only to ReviewService approve/reject — CorpusService create/update/delete and VersionService restore writers are not upgraded, breaking the verify oracle's exact join for those actions.
- TaskWorkflowService claim/release/evidence audit coverage (the primary §2 coverage gap) is not shown implemented.
- MCP lore_audit tool registration (tools.ts) and app wiring for auditService/judgmentService not present; only CLAUDE.md docs updated.
- Escalation delta_reasons seeding from answered blocking_questions (§3) not implemented.
- store-interface insertCalibrationRecord/insertJudgment/queryAudit-window methods (seeding path, §4) not shown.

## Recommendations

- Include service/audit-service.ts and service/judgment-service.ts plus the migration in the reviewed diff so the storage + reconcile logic is auditable, not just inferred from CLI callers.
- Add details.version to CorpusService (create/update) and VersionService (restore) audit writers, or the exact (doc_id,action,version) join will flag every post-watermark create/update/restore as a miss.
- Show TaskWorkflowService claim/release/evidence audit entries — this is the named coverage GAP the spec set out to close.
- Implement escalation delta_reasons seeding from blocking_questions to fully satisfy §3.
- Provide unit-test artifacts for wilsonLowerBound and the verify join-key regression rather than a self-reported suite count.

## Judgment

- Provider: claude-cli
- Prompt version: 2
- Duration: 81955ms
- Retried: false
- Truncated sections: spec, diff:CLAUDE.md, diff:packages/core/src/audit-actor.test.ts, diff:packages/core/src/calibration.test.ts, diff:packages/core/src/review-checks.test.ts, diff:packages/core/src/review-judgment.test.ts, diff:packages/lore/src/adapters/cli/commands/review.ts, diff:packages/lore/src/adapters/mcp/tools.ts, diff:packages/lore/src/ai/CLAUDE.md, diff:packages/lore/src/ai/review-template.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/CLAUDE.md, diff:packages/lore/src/service/ai-provider-service.ts, diff:packages/lore/src/service/audit-service.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/judgment-service.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/src/service/version-service.ts, diff:packages/lore/src/store/CLAUDE.md, diff:packages/lore/src/store/in-memory-store.ts, diff:packages/lore/src/store/migrations/migration-003.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/src/store/store-interface.ts, diff:packages/lore/src/store/store-shared.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/tests/e2e/calibration-cli.bun.test.ts, diff:packages/lore/tests/helpers/stub-claude.ts, diff:packages/lore/tests/integration/cli/assess.test.ts, diff:packages/lore/tests/integration/cli/audit.test.ts, diff:packages/lore/tests/integration/cli/pending-judgment-badges.bun.test.ts, diff:packages/lore/tests/integration/cli/review.test.ts, diff:packages/lore/tests/unit/adapters/cli/calibration-hook.test.ts, diff:packages/lore/tests/unit/adapters/cli/utils-judgment-badge.test.ts, diff:packages/lore/tests/unit/adapters/http/auth-routes.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/cors.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/dashboard-routes.test.ts, diff:packages/lore/tests/unit/adapters/http/routes-resolve-mdx.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/routes.test.ts, diff:packages/lore/tests/unit/adapters/mcp-tools-assess.test.ts, diff:packages/lore/tests/unit/adapters/mcp-tools-lore-create-ai.test.ts, diff:packages/lore/tests/unit/adapters/mcp-tools-review.test.ts, diff:packages/lore/tests/unit/adapters/mcp-tools-task-workflow.test.ts, diff:packages/lore/tests/unit/adapters/mcp-tools.test.ts, diff:packages/lore/tests/unit/eval/fts-recall.test.ts, diff:packages/lore/tests/unit/eval/link-integrity.test.ts, diff:packages/lore/tests/unit/eval/migration-coverage.test.ts, diff:packages/lore/tests/unit/eval/placeholder-parse.test.ts, diff:packages/lore/tests/unit/eval/tree-consistency.test.ts, diff:packages/lore/tests/unit/eval/type-distribution.test.ts, diff:packages/lore/tests/unit/service/ai-provider-service-review.test.ts, diff:packages/lore/tests/unit/service/audit-service.test.ts, diff:packages/lore/tests/unit/service/corpus-service-get-review-bundle.test.ts, diff:packages/lore/tests/unit/service/judgment-service.test.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/service/task-workflow-audit.test.ts, diff:packages/lore/tests/unit/store/in-memory-store.test.ts, diff:packages/lore/tests/unit/store/migration-003.bun.test.ts, diff:packages/lore/tests/unit/store/sqlite-store.bun.test.ts
- Reasoning clipped for: AC-AUDIT-VERIFY, AC-STATS
