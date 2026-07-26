---
id: KN-106
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-062 config write layer (2026-07-21)"
status: draft
priority: medium
created: 2026-07-21
updated: 2026-07-24
tags: []
parent: PLAN-062
links:
  - {id: PLAN-062, type: informs}
---
> ⚠ INVALIDATED 2026-07-21T14:28:32.266Z — superseded by knowledge-assessment-implementation-spec-062-config-write-laye-3; Orchestrator input error: --diff a2b697c..main bundled interleaved SPEC-061/063/046 commits, producing an artifact scope_fidelity 55 with major gaps naming files no SPEC-062 task touched. Re-run on a SPEC-062-only diff-file scored 76.

# Assessment: partially_met (82/100)

Scope: plan `01KY1NPC95MRTX6FC0XWA4WA9C`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-062-1 | 92 | 2 pass / 0 fail, 1 attested. Deny-key table visible in diff (4 keys, ACE/secret-bearing) and route delegates all writes to ConfigService. Oracle 'deny keys' passed with 4 matched tests under recorder=apple. | 01KY1T0GKTMQ0XRY73MVRQHN8B (T3 ev[4] deny keys pass) |
| AC-062-2 | 88 | 2 pass / 0 fail, 1 attested. redactConfigValues in diff replaces ai.http.headers.* leaves with a marker and GET /api/config serializes only result.value.config. Oracle matched exactly 1 test — thin but attested. | 01KY1T0GKTMQ0XRY73MVRQHN8B (T3 ev[5] redaction pass) |
| AC-062-3 | 35 | Declared oracle path packages/lore/tests/unit/http/ does not exist — attested run returned 'No test files found, exit 1' (attested_fail=1). Superseded by AC-062-9, but the AC as written remains contradicted on its own declared command. | 01KY1T0GKTMQ0XRY73MVRQHN8B (T3 ev[6] fail, no test files) |
| AC-062-4 | 90 | 2 pass / 0 fail, 1 attested; 2 matched tests. restart_required derives from classifyConfigEffect's prefix table (sync. → restart, workflow.* → live), consistent with the AC's exactly-1/exactly-0 claim. | 01KY1T0GKTMQ0XRY73MVRQHN8B (T3 ev[7]) |
| AC-062-5 | 35 | Same defect as AC-062-3: declared path packages/lore/tests/unit/http/ nonexistent; attested run exited 1 with no test files (attested_fail=1). Replaced by AC-062-10. | 01KY1T0GKTMQ0XRY73MVRQHN8B (T3 ev[8] fail) |
| AC-062-6 | 88 | 2 pass / 0 fail, 1 attested, 2 matched tests. Validate-then-write is asserted only via ConfigService (file omitted from diff), so byte-identity is trusted from the oracle rather than read. | 01KY1T0GKTMQ0XRY73MVRQHN8B (T3 ev[9]) |
| AC-062-7 | 92 | 2 pass / 0 fail, 1 attested; output_tail names the exact test 'accepted PATCH writes exactly 1 audit row; rejected writes 0'. App wiring shows the narrow appendAuditEntry port bound to the store. | 01KY1T0GKTMQ0XRY73MVRQHN8B (T3 ev[10]) |
| AC-062-8 | 93 | browser-safety scan passed (3 tests), attested. config-editability.ts is visibly zero-Node-builtin (pure data transforms) and is exported from the @lore/core barrel in the diff. | 01KY1T0GKTMQ0XRY73MVRQHN8B (T3 ev[11]) |
| AC-062-9 | 90 | 1 pass / 0 fail, attested at the corrected adapters/http path; 1 matched test. Route code shows precheck 409 with current_hash before update() is called, matching the statement. | 01KY1T0GKTMQ0XRY73MVRQHN8B (T3 ev[12]) |
| AC-062-10 | 92 | 1 pass / 0 fail, attested; output_tail names the 403/0-bytes test. Structurally supported: bearer actors are rejected by dashboard-routes' assertCookieActor before config-routes is entered. | 01KY1T0GKTMQ0XRY73MVRQHN8B (T3 ev[13]) |
| AC-062-11 | 88 | 2 pass / 0 fail, attested; 4 matched tests incl. named 'matching expectedHash accepted'. Route translates the service CAS rejection back to 409. Service-side fresh re-read is asserted only in the omitted config-service.ts. | 01KY1T0GKTMQ0XRY73MVRQHN8B (T3 ev[14]) |
| AC-062-12 | 94 | Attested pass, 39 tests, exactly 1 file. Diff shows isProperAncestorOfPattern plus the exact-match path, and the scope guard (ai.provider vs ai.providers segment distinction) holds by construction. | 01KY214MD7E6X5RFSYV12YTSH0 (T4 ev[4] 39/39 pass) |

## Gaps

- The declared oracle command targets packages/lore/tests/unit/http/config-routes.test.ts, a path that does not exist. The attested run exited 1 with 'No test files found'. The AC is contradicted on its own terms; only the replacement AC-062-9 passes.
- Identical nonexistent-path defect: attested run of the declared command exited 1 with no test files found. Coverage records attested_fail=1. Superseded by AC-062-10 but never retired.
- The diff includes a complete SPEC-063 feature (packages/core/src/verify-execution-root.ts, App.repoRoot exposure, --execution-root CLI flag, verify-render.ts extraction, execution_root/execution_mode attestation fields), a SPEC-046 hook registration (subagent-stop-commit-guard.mjs), and a SPEC-061 inconclusive badge in ac.ts. None appear in this plan's goal, sequencing, or exit criteria.
- attested_evidence_ratio 0.38; tasks T1 (9 entries) and T2 (5 entries) have zero attested evidence — all agent-self-reported. Attestation is concentrated in T3's later re-run sweep, which did not re-run T2's full-suite or bun-runner oracles.
- packages/lore/src/service/config-service.ts is omitted from the visible diff, so validate-then-write ordering, byte-identity on rejection, and the CAS re-read cannot be inspected — these ACs rest entirely on oracle exit codes.

## Recommendations

- Add a pre-flight that executes each newly declared script-mode AC command once (expecting 'no test files' to be an authoring error) before the AC is accepted onto a spec.
- Mark AC-062-3 and AC-062-5 as superseded (or remove them) now that AC-062-9 and AC-062-10 cover the same statements at real paths.
- Keep one spec per plan diff. Move SPEC-063 execution-root, SPEC-046 hook registration, and SPEC-061 badge work into their own plans with their own ACs.
- Require human/tool attestation on the originating task's oracle runs, not only on a later consolidating task's re-run sweep.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 69929ms
- Retried: false
- Truncated sections: diff:CLAUDE.md, diff:assets/hooks/subagent-stop-commit-guard.mjs, diff:packages/core/src/config-editability.test.ts, diff:packages/core/src/task-workflow.test.ts, diff:packages/core/src/verify-execution-root.test.ts, diff:packages/core/tests/browser-safety.test.ts, diff:packages/lore/src/service/config-service.ts, diff:packages/lore/src/service/phase-workflow-service.ts, diff:packages/lore/src/service/verify-runner-service.ts, diff:packages/lore/tests/unit/adapters/cli-ac-coverage-badge.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/config-routes.test.ts, diff:packages/lore/tests/unit/adapters/verify-render-execution-root.test.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/tests/unit/core/distribution-hooks.test.ts, diff:packages/lore/tests/unit/service/config-service.test.ts, diff:packages/lore/tests/unit/service/phase-workflow-inconclusive-guard.test.ts, diff:packages/lore/tests/unit/service/setup-service.test.ts, diff:packages/lore/tests/unit/service/verify-execution-root.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 86 | 0.75 | evidence | 10 of 12 ACs attested-pass with visible supporting code; the 2 failures are path-authoring defects superseded by AC-062-9/10, which do pass at the corrected paths. |
| evidence_integrity | 72 | 0.7 | evidence | Every AC has an attested run and two attested failures were honestly recorded, but ratio is 0.38 and T1/T2 are wholly self-reported by agents. |
| scope_fidelity | 55 | 0.8 | evidence | Diff carries a full SPEC-063 execution-root feature (core module, CLI flag, render split, schema fields) plus SPEC-046 and SPEC-061 changes not in this plan's goal or sequencing. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-062-3 | The declared oracle command targets packages/lore/tests/unit/http/config-routes.test.ts, a path that does not exist. The attested run exited 1 with 'No test files found'. The AC is contradicted on its own terms; only the replacement AC-062-9 passes. |
| evidence_integrity | major | AC-062-5 | Identical nonexistent-path defect: attested run of the declared command exited 1 with no test files found. Coverage records attested_fail=1. Superseded by AC-062-10 but never retired. |
| scope_fidelity | major | — | The diff includes a complete SPEC-063 feature (packages/core/src/verify-execution-root.ts, App.repoRoot exposure, --execution-root CLI flag, verify-render.ts extraction, execution_root/execution_mode attestation fields), a SPEC-046 hook registration (subagent-stop-commit-guard.mjs), and a SPEC-061 inconclusive badge in ac.ts. None appear in this plan's goal, sequencing, or exit criteria. |
| evidence_integrity | minor | — | attested_evidence_ratio 0.38; tasks T1 (9 entries) and T2 (5 entries) have zero attested evidence — all agent-self-reported. Attestation is concentrated in T3's later re-run sweep, which did not re-run T2's full-suite or bun-runner oracles. |
| outcome | minor | AC-062-6 | packages/lore/src/service/config-service.ts is omitted from the visible diff, so validate-then-write ordering, byte-identity on rejection, and the CAS re-read cannot be inspected — these ACs rest entirely on oracle exit codes. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Add a pre-flight that executes each newly declared script-mode AC command once (expecting 'no test files' to be an authoring error) before the AC is accepted onto a spec. | Two ACs shipped with nonexistent oracle paths and were only detected after implementation, forcing replacement ACs and permanent attested failures. |
| spec | Mark AC-062-3 and AC-062-5 as superseded (or remove them) now that AC-062-9 and AC-062-10 cover the same statements at real paths. | Leaving both live means the spec permanently reports attested failures for behavior that is actually verified. |
| plan | Keep one spec per plan diff. Move SPEC-063 execution-root, SPEC-046 hook registration, and SPEC-061 badge work into their own plans with their own ACs. | Unscoped changes in a plan's diff cannot be audited against that plan's exit criteria and dilute the review signal. |
| process | Require human/tool attestation on the originating task's oracle runs, not only on a later consolidating task's re-run sweep. | T1 and T2 delivered the bulk of the implementation with zero attested evidence. |

## Unverifiable Materials

- packages/lore/src/service/config-service.ts: Omitted from the diff per the truncation manifest; validate-then-write, audit-row emission, and expectedHash CAS semantics judged only from oracle results.
- packages/lore/tests/unit/service/config-service.test.ts and adapters/http/config-routes.test.ts: Test bodies omitted; assertion strength (e.g. whether byte-identity and 0-bytes-written are actually asserted) could not be inspected.
- packages/core/src/config-editability.test.ts: 39 tests reported passing but content omitted; six-dimension coverage claimed by T4 could not be confirmed.

## Facts Summary

- AC coverage: 12 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 2 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.38
