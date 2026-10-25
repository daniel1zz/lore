---
id: KN-585
type: knowledge
role: knowledge
title: "Assessment: Run identity slice 1 — harness-attested runs (2026-10-11)"
status: archived
priority: medium
created: 2026-10-11
updated: 2026-10-23
tags: []
parent: PLAN-162
links:
  - {id: PLAN-162, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01M4N0MXP29AQ5ZTW9WM4ZSZXZ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-RID-1 | 90 | The verify task re-ran the run-register suite and it passed, including the echo line. The implement task also had 8/8 passing. Earlier RED runs failed as expected, so the tests do discriminate. | task-skill-verify-verify-every-ac-close-the-baseline-loop, task-skill-implement-runservice-lore-run-register-show-attest |
| AC-RID-2 | 87 | Composition test passes after an expected RED failure. ExplainRow.path is hashed from the fragment file. The 'edit one fragment changes only that hash' case passes, but its full output was cut off. | task-skill-test-red-lore-run-register-show-composition-record |
| AC-RID-3 | 88 | The run-register hook suite has 18 tests, failed RED first, then passed. The paired pre-tool hook test passed too. The hook source itself was not shown. | task-skill-implement-hooks-run-register-mjs-and-pre-tool |
| AC-RID-4 | 92 | Migration-016 has 44 passing tests, including a negative control on the v15 fixture. The diff shows a crash-safe two-phase migration in both SQLite and Turso and an InMemory mirror. The existing store suite also passed. | task-skill-implement-store-migration-016-run-store-methods |
| AC-RID-5 | 75 | Final runs pass, but there were 4 earlier failures. Turso is never exercised. The store notes say rule-registry leaf patches are not stamped. The MCP lore_batch result was not visible in the output tail. | task-skill-verify-verify-every-ac-close-the-baseline-loop, task-skill-implement-cli-entry-resolves-identity-once-and-wraps |
| AC-RID-6 | 92 | 10 attested passes. resolveInvocationIdentity takes harnessRun only from the flag and uses a once-per-process latch for the warning. The CLI deprecation test passes. | task-skill-implement-core-node-resolveinvocationidentity-with |
| AC-RID-7 | 82 | The MCP test runs against the real server (tools/list + tools/call). RED failed first, then it passed. The overhead benchmark is manual evidence and its p95 value is not shown. | task-skill-implement-mcp-harness-run-argument-optional-by-per |
| AC-RID-8 | 80 | Passes now. Two earlier failures, one of them caused by merge-conflict markers committed into the test file and later fixed. Some passes depended on clearing session env vars, which makes the tests sensitive to the environment. | task-skill-implement-cli-entry-resolves-identity-once-and-wraps |
| AC-RID-9 | 80 | Final run is 14/14. Three earlier failures on the pre-016 'unattested' label were fixed in the render task. Removal of the 'system' literal was shown by the RED test. | task-skill-implement-get-log-attested-claimed-rendering |
| AC-RID-10 | 90 | RED failed, then 7/7 passed, including the unknown-id exit 3 path that is visible in run.ts. | task-skill-implement-runservice-lore-run-register-show-attest |
| AC-RID-11 | 88 | The exact 20/19/0.95 fixture passes for both JSON and text. The inclusive window is implemented in all three stores. Timestamps are compared as strings, which assumes uniform ISO format. | task-skill-implement-get-log-attested-claimed-rendering |
| AC-RID-12 | 85 | 24 tests across the task and phase paths after RED. The core predicate in the diff is correct. The I2 grep check has no recorded evidence. The claim-path RED output tails show citty help text, so the failure reason is unclear. | task-skill-implement-claim-and-release-by-run-in |
| AC-RID-13 | 87 | 16 tests pass. In the predicate, a legacy holder is compared by name and a stale one is taken over. | task-skill-implement-claim-and-release-by-run-in |
| AC-RID-14 | 86 | 20 tests pass, including refusals for an unattested caller and a different run with the same name. The release code itself was not shown. | task-skill-implement-claim-and-release-by-run-in |
| AC-RID-15 | 88 | 40-row table passes. The rewrite skips quotes, heredocs and comments. Known limit: `lore` behind sudo, env or a path is not stripped, so a caller-written --harness-run on such a command reaches the CLI. | task-skill-implement-core-run-identity-module-types-harness |
| AC-RID-16 | 85 | The probe's PASS first-write-attested line is grepped, and RED failed before the distribution task. The probe script itself was not shown. | task-skill-implement-distribute-the-hooks-hook-registrations |
| AC-RID-17 | 88 | The command's negative controls tripped and the positive needles were found. The asset-parity test passed. No evidence that BR-135 was deprecated. | task-skill-implement-remove-shipped-instructions-that-tell |
| AC-RID-18 | 82 | e2e is 15/15. One failure came from the stale-binary guard, then passed after a rebuild. The branch B2 input is recorded (1 unattested write from the never-registered agent, as designed). | task-skill-test-end-to-end-real-hooks-to-built-cli-to-stamped |

## Gaps

- The verify/close task is still draft. No evidence of lore verify 18/18, status --check-drift exit 0, BR-1040/BR-1045 established, BR-125/BR-135 deprecated, or the day-0 attribution baseline.
- Store notes say rule-registry leaf patches build version rows inside the store and are not stamped by withWriteContext, so those writes stay unattested.
- TursoStore migration-016 and harness_run inserts have no executed test. The matrix covers only SQLiteStore and InMemoryStore.
- attest-input rewrites MCP input only when tool_name starts with 'mcp__lore__'. The hook matcher mcp__.*lore_.* also matches other prefixes, which would pass through unattested.
- A caller-written --harness-run on a lore command the scan misses (sudo/env/path/backticks) is not stripped. The CLI accepts it, so another registered run can be impersonated, which weakens claim-by-run.
- Regression-fix evidence records 1–10 call a scratchpad one.sh that is not in the repo, so the commands cannot be reproduced. Only record 12 is explicit.

## Recommendations

- Execute and evidence the verify task's steps 2–6, including the day-0 harness_run_attribution baseline, before the plan is closed.
- Add a Turso parity case to AC-RID-4/5 and either cover the rule-leaf patch paths or declare them out of scope.
- Forbid opaque temp-script evidence commands. Require the literal command in the evidence record.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 59018ms
- Retried: false
- Truncated sections: plan, spec, diff:packages/core/tests/run-claim-conflict.test.ts, diff:packages/core/tests/run-identity-rewrite.test.ts, diff:packages/core/tests/run-identity-node.test.ts, diff:packages/lore/tests/unit/store/migration-016.bun.test.ts, diff:packages/lore/tests/integration/cli/run-composition.bun.test.ts, diff:packages/lore/tests/integration/cli/run-register.bun.test.ts, diff:packages/lore/tests/integration/cli/run-show.bun.test.ts, diff:packages/lore/tests/integration/mcp/mcp-harness-run.bun.test.ts, diff:packages/lore/tests/integration/cli/claim-conflict-by-run.bun.test.ts, diff:packages/lore/tests/integration/cli/claim-legacy-transition.bun.test.ts, diff:packages/lore/tests/integration/cli/claim-release-by-run.bun.test.ts, diff:packages/lore/tests/integration/cli/support/claim-run-fixture.ts, diff:packages/lore/tests/integration/cli/support/claim-run-fixture.ts, diff:packages/lore/tests/unit/hooks/pre-tool-harness-run-hook.test.ts, diff:packages/lore/tests/unit/hooks/run-register-hook.test.ts, diff:packages/lore/tests/integration/cli/lore-actor-deprecation.bun.test.ts, diff:packages/lore/tests/integration/cli/write-attribution-matrix.bun.test.ts, diff:packages/lore/tests/integration/cli/write-unattested.bun.test.ts, diff:scripts/fresh-install-probe.ts, diff:packages/lore/tests/integration/cli/attribution-render.bun.test.ts, diff:packages/lore/tests/integration/cli/fixtures/frozen-clock.preload.ts, diff:packages/lore/tests/integration/cli/fixtures/run-seeder.ts, diff:packages/lore/tests/integration/cli/status-attribution-share.bun.test.ts, diff:packages/lore/tests/integration/cli/fixtures/frozen-clock.preload.ts, diff:packages/lore/tests/unit/hooks/pre-tool-harness-run-hook.test.ts, diff:packages/lore/tests/unit/hooks/run-register-hook.test.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/store/audit-chain.bun.test.ts, diff:packages/lore/tests/unit/store/migration-001-idempotent.bun.test.ts, diff:packages/lore/tests/unit/store/migration-003.bun.test.ts, diff:packages/lore/tests/unit/store/migration-004.bun.test.ts, diff:packages/lore/tests/unit/store/migration-006-fk-restore.bun.test.ts, diff:packages/lore/tests/unit/store/migration-008-cjk-fts.bun.test.ts, diff:packages/lore/tests/unit/store/migration-012.bun.test.ts, diff:packages/lore/tests/unit/store/migration-013.bun.test.ts, diff:packages/lore/tests/unit/store/migration-014.bun.test.ts, diff:packages/lore/tests/unit/store/trace-events.bun.test.ts, diff:packages/lore/tests/unit/store/version-slug-migration.bun.test.ts, diff:packages/lore/src/service/run-service.ts, diff:packages/lore/tests/integration/cli/run-attest-input.bun.test.ts, diff:assets/hooks/pre-tool-harness-run.mjs, diff:assets/hooks/run-register.mjs, diff:packages/lore/src/adapters/cli/invocation-identity.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/index.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/store/CLAUDE.md, diff:packages/lore/src/store/in-memory-store.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/src/store/store-interface.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/src/store/write-context-store.ts, diff:packages/lore/tests/unit/adapters/ac-demotion-notice.test.ts, diff:packages/lore/tests/unit/adapters/http/routes.test.ts, diff:packages/lore/tests/unit/cli/approve-advisory-render.test.ts, diff:packages/lore/tests/unit/service/audit-actor-fidelity.test.ts, diff:packages/lore/src/store/CLAUDE.md, diff:packages/lore/tests/integration/cli/lore-actor-deprecation.bun.test.ts, diff:packages/lore/tests/integration/cli/write-attribution-matrix.bun.test.ts, diff:packages/lore/tests/integration/cli/write-unattested.bun.test.ts, diff:packages/lore/src/adapters/cli/gate-bypass-audit.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/ac-service.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/gate-enforcer.ts, diff:packages/lore/src/service/rule-service.ts, diff:packages/lore/src/service/tree-check-service.ts, diff:packages/lore/src/store/write-context-store.ts, diff:packages/lore/tests/integration/cli/write-unattested.bun.test.ts, diff:packages/core/src/distribution-hooks.ts, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/lore/tests/unit/adapters/real-setup-ports.test.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/tests/unit/core/distribution-hooks.test.ts, diff:packages/lore/tests/unit/service/setup-service.test.ts, diff:scripts/fresh-install-probe.ts, diff:packages/lore/src/adapters/cli/commands/get.ts, diff:packages/lore/src/adapters/cli/commands/log.ts, diff:packages/lore/src/adapters/cli/commands/status.ts, diff:packages/lore/src/service/attribution-report.ts, diff:packages/core/src/errors.ts, diff:packages/core/src/task-workflow.ts, diff:packages/lore/src/adapters/cli/commands/claim.ts, diff:packages/lore/src/adapters/cli/commands/release.ts, diff:packages/lore/src/adapters/cli/utils.ts, diff:packages/lore/src/service/phase-workflow-service.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/tests/unit/service/claim-session-fields.test.ts, diff:packages/lore/tests/e2e/run-identity-e2e.bun.test.ts, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:assets/agents/lore-implementer.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/governance/seat-briefing.md, diff:assets/skills/lore-autopilot/SKILL.md, diff:assets/skills/lore-doctor/SKILL.md, diff:assets/skills/lore-plan/SKILL.md, diff:assets/skills/lore-plan/references/mode-resume.md, diff:assets/skills/lore-plan/references/mode-update.md, diff:assets/skills/lore-plan/references/phase-decomposition.md, diff:assets/skills/lore-plan/references/workflow-examples.md, diff:assets/skills/lore-session-capture/SKILL.md, diff:assets/skills/lore-session-capture/references/knowledge-types.md, diff:assets/skills/lore-session-review/references/invariants.md, diff:assets/skills/lore/SKILL.md, diff:assets/skills/shared/lore-cli-map.md, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/tests/unit/setup-governance-retirement.test.ts, diff:packages/lore/src/adapters/cli/commands/claim.ts, diff:packages/lore/src/adapters/cli/commands/release.ts, diff:packages/lore/src/adapters/cli/invocation-identity.ts, diff:packages/lore/src/adapters/cli/loader.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/run-identity-verify.ts, diff:packages/lore/src/store/write-context-store.ts, diff:packages/lore/tests/integration/cli/write-unattested.bun.test.ts, diff:packages/lore/src/adapters/mcp/CLAUDE.md, diff:packages/lore/src/adapters/mcp/call-scope.ts, diff:packages/lore/src/adapters/mcp/tools.ts, diff:packages/lore/src/app.ts, diff:packages/lore/tests/unit/adapters/mcp-invalidate.test.ts, diff:packages/lore/tests/unit/adapters/mcp-session-tools.test.ts, diff:packages/lore/tests/unit/adapters/mcp-staleness.test.ts, diff:packages/lore/tests/unit/adapters/mcp-tools-verify.test.ts, diff:scripts/bench/mcp-call-overhead.ts, diff:packages/lore/src/adapters/cli/loader.ts, diff:packages/lore/src/app.ts, diff:packages/lore/tests/e2e/baseline-rollback.bun.test.ts, diff:packages/lore/tests/e2e/baseline-slice2-rollback.bun.test.ts, diff:packages/lore/tests/unit/adapters/cli-plan-promote-advisory.bun.test.ts, diff:packages/lore/tests/unit/adapters/report-issue-hint.bun.test.ts, diff:packages/lore/tests/unit/adapters/report-issue-single-remedy.bun.test.ts, diff:packages/lore/tests/unit/adapters/sync-push.bun.test.ts, diff:packages/lore/tests/unit/core/issue-report.test.ts, diff:packages/lore/src/store/CLAUDE.md

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 82 | 0.75 | evidence | All 18 ACs have a final attested pass. Verify-task close-out (rules, drift, baseline) not done. Turso untested. |
| evidence_integrity | 74 | 0.7 | evidence | RED→GREEN trail is strong. Some intermediate fails (conflict markers, stale binary, env-dependent). Regression evidence relies on opaque scratchpad script. |
| scope_fidelity | 85 | 0.7 | evidence | Changes follow the plan's anchors. The extra regression-fix task is justified and scoped. Verify tasks left incomplete. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | — | The verify/close task is still draft. No evidence of lore verify 18/18, status --check-drift exit 0, BR-1040/BR-1045 established, BR-125/BR-135 deprecated, or the day-0 attribution baseline. |
| outcome | minor | AC-RID-5 | Store notes say rule-registry leaf patches build version rows inside the store and are not stamped by withWriteContext, so those writes stay unattested. |
| evidence_integrity | minor | AC-RID-5 | TursoStore migration-016 and harness_run inserts have no executed test. The matrix covers only SQLiteStore and InMemoryStore. |
| outcome | minor | AC-RID-7 | attest-input rewrites MCP input only when tool_name starts with 'mcp__lore__'. The hook matcher mcp__.*lore_.* also matches other prefixes, which would pass through unattested. |
| outcome | minor | AC-RID-15 | A caller-written --harness-run on a lore command the scan misses (sudo/env/path/backticks) is not stripped. The CLI accepts it, so another registered run can be impersonated, which weakens claim-by-run. |
| evidence_integrity | minor | — | Regression-fix evidence records 1–10 call a scratchpad one.sh that is not in the repo, so the commands cannot be reproduced. Only record 12 is explicit. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Execute and evidence the verify task's steps 2–6, including the day-0 harness_run_attribution baseline, before the plan is closed. | Plan exit criteria and BR lifecycle changes are unproven. |
| spec | Add a Turso parity case to AC-RID-4/5 and either cover the rule-leaf patch paths or declare them out of scope. | R2 was mitigated only by shared SQL, with no executed check. |
| process | Forbid opaque temp-script evidence commands. Require the literal command in the evidence record. | Reproducibility of the regression evidence. |

## Unverifiable Materials

- packages/lore/src/service/task-workflow-service.ts / phase-workflow-service.ts: Omitted from the diff, so invariant I2 (hasClaimConflict in both services) cannot be inspected.
- scripts/bench/mcp-call-overhead.ts output: The manual evidence tail is not shown, so the R6 <20 ms p95 claim is unverified.
- scratchpad one.sh: The regression-fix evidence commands depend on a temp script whose contents are not recorded.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 5
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 18 declared criteria
- Task evidence: 24 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.84
