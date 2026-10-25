---
id: KN-036
type: knowledge
role: knowledge
title: "Assessment: SPEC-035 Implementation — audit trail + calibration (2026-07-08)"
status: archived
priority: medium
created: 2026-07-08
updated: 2026-10-23
tags: []
parent: PLAN-014
links:
  - {id: PLAN-014, type: informs}
---
# Assessment: met (83/100)

Scope: plan `01KWVDGK9S0SZMAM9PNAYRGT4W`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| D3-AUDIT-COVERAGE | 76 | TWF claim/release/evidence now append audit entries with correct actions; corpus/review/version writers stamp details.version. But JudgmentService.record writing action=judge is not visible in the diff (judgment-service.ts changes only touch stats), so the 'judge' vocabulary member is unverified. | task-d-audit-surface-lore-audit-cli-verify-twf-coverage-details (TWF writeTaskExtra + details.version writers) |
| D3-AUDIT-CLI | 92 | audit.ts implements per-doc trail, --actor/--action/--since/--limit/--json filters mapping 1:1 to AuditFilters, doc resolution, judgment_ref summary, and exit codes. Complete. | task-d-audit-surface-lore-audit-cli-verify-twf-coverage-details |
| D3-VERIFY-ORACLE | 89 | verify() does exact (doc_id, details.version) join, no timestamp fuzz, watermark bounds both sides, exit 0/4 itemized. Uses action-FAMILY not exact action-string (deliberate, documented tolerance for TWF update/claim divergence), a reasonable reinterpretation of the spec's exact triple join. 'judge… | task-d-audit-surface-lore-audit-cli-verify-twf-coverage-details (verify join-key regression covered) |
| D4-ACTOR-ENCODING | 84 | parseAuditActor used in CLI/HTTP to decode ai:{provider}:{model}:{prompt_version}; formatJudgeActor referenced. Codec itself lives in @lore/core (not in diff) but is consumed correctly; details.judgment_ref surfaced in summary. | task-d-audit-surface-lore-audit-cli-verify-twf-coverage-details |
| D4-CALIBRATION-TABLE | 62 | Store methods (insert/queryCalibrationWindow) and denormalized doc_type projection are present, but the CREATE TABLE calibration_records + indexes migration is NOT in the diff (likely SPEC-034 B). Table existence only inferred from passing suites; scored conservatively for unverifiable schema. | task-e-calibration-capture-stats-cli (table per spec claimed; migration not in diff) |
| D4-CALIBRATION-TRIGGER | 79 | calibration-hook.ts implicit capture wired into CLI approve/reject, HTTP dashboard, MCP; version-pin (actedOnVersion vs judgment.doc_version) and pairing table correct. Escalation delta_reasons seeded from blocking_questions NOT implemented (only note→delta_reasons[0]); spec allows empty, so non-bl… | task-e-calibration-capture-stats-cli (hook pairings covered) |
| D4-PARTIAL-FAILURE | 92 | warnCalibrationFailure prints 'approved/rejected, but calibration record failed' to stderr, records telemetry, invokes onWarning for HTTP/MCP, exit 0 preserved. Never un-approves. Matches contract exactly. | task-e-calibration-capture-stats-cli (partial-failure covered) |
| D4-STATS | 81 | calibration.ts --stats + computeCalibrationStats give per (doc_type × prompt_version) n/agreement/wilson_lower_bound via pure wilsonLowerBound. Disaggregation improved beyond spec's '*' sentinel. Window comment says 'last 200' vs spec §4 'last 50' — minor deviation from stated bound. | task-e-calibration-capture-stats-cli |
| SERVICE-SPLIT | 89 | AuditService is new, store-only, stateless, separate from JudgmentService which owns judgment/calibration rows. Adapter-sequenced calibration write via flows/calibration-hook (no cross-service call). Matches §5 split. | task-d-audit-surface-lore-audit-cli-verify-twf-coverage-details |
| MCP-SURFACE | 87 | lore_audit MCP tool (query+verify) and lore_approve calibration_note plumbing implemented; HTTP read routes for audit/verify/calibration/judgments added. app wiring (auditService/judgmentService destructure) present; app.ts construction not shown but referenced. | task-d-audit-surface-lore-audit-cli-verify-twf-coverage-details |

## Gaps

- JudgmentService.record appending an action=judge audit entry is not visible in the diff — the 'judge' action vocabulary member is unverified.
- CREATE TABLE calibration_records + its indexes (idx_calibration_window, idx_calibration_judgment) are absent from the diff; table existence is only inferred from passing tests.
- Escalation delta_reasons seeding from answered blocking_questions (§3) is not implemented — only --calibration-note feeds delta_reasons[0]. Spec permits empty, so non-blocking.
- Stats window bound diverges from spec: calibration.ts docstring cites 'last 200' whereas §3/§4 specify a last-50 window.
- app.ts composition-root wiring of AuditService (with resolveAuditVerifySince) is referenced but not shown in the diff.

## Recommendations

- Include or cite the judgment-service.record change that writes the 'judge' audit entry (with details.version) to close the coverage vocabulary claim.
- Surface the calibration_records migration in the change set (or explicitly attribute it to SPEC-034 B) so the schema is auditable here.
- Implement escalation delta_reasons seeding from answered blocking_questions, or update the spec to record it as accepted debt.
- Reconcile the calibration window limit (50 vs 200) between spec and code and align the docstring.

## Judgment

- Provider: claude-cli
- Prompt version: 5
- Duration: 79240ms
- Retried: false
- Truncated sections: spec
- Reasoning clipped for: D3-VERIFY-ORACLE, D4-CALIBRATION-TRIGGER
