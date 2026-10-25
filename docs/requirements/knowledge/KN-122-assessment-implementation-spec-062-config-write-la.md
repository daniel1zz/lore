---
id: KN-122
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-062 config write layer (2026-07-21)"
status: archived
priority: medium
created: 2026-07-21
updated: 2026-10-23
tags: []
parent: PLAN-062
links:
  - {id: PLAN-062, type: informs}
  - {id: KN-106, type: supersedes}
---
# Assessment: partially_met (78/100)

Scope: plan `01KY1NPC95MRTX6FC0XWA4WA9C`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-062-1 | 82 | 2 passing runs (1 attested) of the 'deny keys' filter. Deny check verifiably runs before any disk access (config-service.ts step 2), so 'sha256 identical' holds by construction. Gap: oracle is service-level, not the PATCH route the AC names. | 01KY1T0GKTMQ0XRY73MVRQHN8B (attested pass, 4 tests matched) |
| AC-062-2 | 78 | Attested pass on 'redaction' (1 test matched). redactConfigValues + CONFIG_REDACT_KEYS visible in diff and applied in read(). Gap: AC names GET /api/config response body; the oracle exercises ConfigService.read, one layer below the serialized response. | 01KY1T0GKTMQ0XRY73MVRQHN8B (1 passed | 16 skipped) |
| AC-062-3 | 62 | Attested run FAILED: 'No test files found' — declared path packages/lore/tests/unit/http/ does not exist. Mitigated by AC-062-9, which restates the same behavior at the real path and is attested green. Credited as superseded, not satisfied as written. | 01KY1T0GKTMQ0XRY73MVRQHN8B (evidence [6] fail; superseded by AC-062-9) |
| AC-062-4 | 88 | 2 passes (1 attested, 2 tests matched). classifyConfigEffect table in diff puts sync.* under RESTART_REQUIRED_KEY_PREFIXES and workflow.* outside it, matching the exactly-1 / exactly-0 requirement. | 01KY1T0GKTMQ0XRY73MVRQHN8B (restart_required attested) |
| AC-062-5 | 62 | Attested run FAILED with 'No test files found' at the declared nonexistent path. Superseded by AC-062-10 (attested pass, named test visible in output_tail). Cookie-only guard is inherited from handleDashboardRoute, consistent with the claim. | 01KY1T0GKTMQ0XRY73MVRQHN8B (evidence [8] fail; superseded by AC-062-10) |
| AC-062-6 | 88 | 2 passes (1 attested, 2 tests). Diff shows LoreConfigSchema.safeParse on the merged candidate strictly before saveConfig, so validate-then-write with zero partial application is structurally supported, not just asserted. | 01KY1T0GKTMQ0XRY73MVRQHN8B (schema rejection attested) |
| AC-062-7 | 90 | Attested pass with the named test echoed in output_tail ('accepted PATCH writes exactly 1 audit row; a rejected PATCH writes 0'). Diff confirms the single appendAuditEntry call sits after saveConfig, past every rejection return. | 01KY1T0GKTMQ0XRY73MVRQHN8B (named test visible in output) |
| AC-062-8 | 90 | Attested pass, 3 tests. The scan file itself is in the diff and includes a NEGATIVE self-check proving the detector can fire on config-node.ts, plus a closure-size floor guarding against a vacuously green walk. | 01KY1T0GKTMQ0XRY73MVRQHN8B (browser-safety.test.ts 3 passed) |
| AC-062-9 | 88 | Attested pass at the corrected adapters/http path, 1 matched case as the AC requires. Route returns 409 with current_hash before update() is ever called on the stale path, so byte-identity follows. | 01KY1T0GKTMQ0XRY73MVRQHN8B (evidence [12]) |
| AC-062-10 | 90 | Attested pass with the named test in output_tail. Bearer rejection is enforced by the dispatcher's assertCookieActor upstream of config-routes.ts, so no code path in the new file can weaken it. | 01KY1T0GKTMQ0XRY73MVRQHN8B (evidence [13]) |
| AC-062-11 | 88 | Attested pass, 4 tests matched (accept + reject cases visible). Diff shows expectedHash CAS inside update(), re-derived from a fresh redacted read before merge/save, and the route translating that error back to 409. | 01KY1T0GKTMQ0XRY73MVRQHN8B (expectedHash attested) |
| AC-062-12 | 90 | Attested pass, 39 tests in exactly 1 file. isProperAncestorOfPattern in the diff denies leaf-less subtree roots while segment-exact matching keeps ai.provider and workflow.* benign, matching both halves of the AC. | 01KY214MD7E6X5RFSYV12YTSH0 (39 passed, recorder=apple) |

## Gaps

- The attested oracle for AC-062-3 failed with 'No test files found, exiting with code 1' — the declared path packages/lore/tests/unit/http/config-routes.test.ts does not exist in the vitest include set. The behavior is covered by AC-062-9 at the real path, but the original AC remains red on the spec rather than corrected.
- Same failure mode as AC-062-3: the attested run found no test files at the declared path. Superseded by AC-062-10, which is attested green with the named test visible.
- T1 (9 runs) and T2 (5 runs) carry zero attested evidence — all self-reported by agent recorders. T3 re-ran and attested most of the same oracles, which substantially mitigates this, but the foundational tasks' own trails are unwitnessed.
- AC-062-2 asserts the GET /api/config serialized response body contains zero occurrences of the on-disk x-api-key value, but the oracle runs config-service.test.ts, testing ConfigService.read's return object. handleGetConfig does pass result.value.config through, so the gap is narrow, but the AC's literal claim about the response body is not directly exercised.
- The If-Match hash is derived from the redacted config, so any out-of-band change to an ai.http.headers.* value is invisible to the CAS. Bounded because every such key is on CONFIG_DENY_KEYS, and the module header states this explicitly rather than hiding it.
- The plan's Sequencing section declares only T1 and T2. T3 and T4 were added after the fact to close a TOCTOU and a deny-table ancestor hole introduced by T1/T2. Each carries its own AC (AC-062-11, AC-062-12) and clear rationale, so this is disclosed remediation rather than undeclared scope creep.

## Recommendations

- Validate that an AC's declared oracle path resolves against the runner's include globs at AC-authoring time, before any task claims it. A path typo currently surfaces only as an attested failure that then needs a REPLACES amendment.
- Correct AC-062-3 and AC-062-5 in place rather than appending REPLACES successors, or mark the originals as retired so the coverage table does not carry attested failures indefinitely.
- State AC-062-1 and AC-062-2 at the layer their oracles actually test, or add route-level tests that assert on the HTTP status and serialized body.
- Update the plan's Sequencing and Exit Criteria when remediation tasks (T3, T4) are added, so the declared task set matches what shipped.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 77156ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/service/config-service.test.ts, diff:packages/lore/tests/unit/adapters/http/config-routes.test.ts, diff:packages/lore/tests/unit/service/config-service.test.ts, diff:packages/core/src/config-editability.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.75 | evidence | All 12 ACs have passing oracles once AC-9/10 supersede the mispathed 3/5. Diff corroborates deny-before-disk, validate-then-write, CAS, and ancestor denial. |
| evidence_integrity | 68 | 0.7 | evidence | Two attested FAILURES on record; attested ratio 0.38 with T1/T2 wholly self-reported. Attested runs that do pass carry real output tails with named tests. |
| scope_fidelity | 76 | 0.65 | evidence | Plan declared T1/T2 only; T3/T4 added mid-flight. Both are documented remediations of defects the earlier tasks shipped, not silent drift, but the plan was not updated. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-062-3 | The attested oracle for AC-062-3 failed with 'No test files found, exiting with code 1' — the declared path packages/lore/tests/unit/http/config-routes.test.ts does not exist in the vitest include set. The behavior is covered by AC-062-9 at the real path, but the original AC remains red on the spec rather than corrected. |
| evidence_integrity | major | AC-062-5 | Same failure mode as AC-062-3: the attested run found no test files at the declared path. Superseded by AC-062-10, which is attested green with the named test visible. |
| evidence_integrity | minor | — | T1 (9 runs) and T2 (5 runs) carry zero attested evidence — all self-reported by agent recorders. T3 re-ran and attested most of the same oracles, which substantially mitigates this, but the foundational tasks' own trails are unwitnessed. |
| outcome | minor | AC-062-2 | AC-062-2 asserts the GET /api/config serialized response body contains zero occurrences of the on-disk x-api-key value, but the oracle runs config-service.test.ts, testing ConfigService.read's return object. handleGetConfig does pass result.value.config through, so the gap is narrow, but the AC's literal claim about the response body is not directly exercised. |
| outcome | minor | — | The If-Match hash is derived from the redacted config, so any out-of-band change to an ai.http.headers.* value is invisible to the CAS. Bounded because every such key is on CONFIG_DENY_KEYS, and the module header states this explicitly rather than hiding it. |
| scope_fidelity | minor | — | The plan's Sequencing section declares only T1 and T2. T3 and T4 were added after the fact to close a TOCTOU and a deny-table ancestor hole introduced by T1/T2. Each carries its own AC (AC-062-11, AC-062-12) and clear rationale, so this is disclosed remediation rather than undeclared scope creep. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Validate that an AC's declared oracle path resolves against the runner's include globs at AC-authoring time, before any task claims it. A path typo currently surfaces only as an attested failure that then needs a REPLACES amendment. | Two of eight original ACs shipped with unresolvable paths, producing permanent red entries. |
| spec | Correct AC-062-3 and AC-062-5 in place rather than appending REPLACES successors, or mark the originals as retired so the coverage table does not carry attested failures indefinitely. | Coverage table currently shows attested_fail=1 for two ACs whose behavior is in fact verified. |
| spec | State AC-062-1 and AC-062-2 at the layer their oracles actually test, or add route-level tests that assert on the HTTP status and serialized body. | AC text names HTTP endpoints; oracles exercise the service beneath them. |
| plan | Update the plan's Sequencing and Exit Criteria when remediation tasks (T3, T4) are added, so the declared task set matches what shipped. | Plan still describes a two-task sequence; four tasks executed. |

## Unverifiable Materials

- packages/lore/tests/unit/service/config-service.test.ts, packages/lore/tests/unit/adapters/http/config-routes.test.ts, packages/core/src/config-editability.test.ts: Listed in the truncation manifest as present but unseen. Assertion strength (e.g. whether 'sha256 identical before and after' and 'writes 0 bytes' are actually measured) cannot be confirmed from the …
- Plan exit criterion 'No dashboard-reachable write path exists for any CONFIG_DENY_KEYS entry': No oracle attests this global claim directly; it is inferred from the deny check plus route dispatch visible in the diff.
- packages/core/src/config-node.ts and the LoreConfigSchema definition: Referenced by the browser-safety self-check and the schema-rejection path but not shown in the diff.

## Facts Summary

- AC coverage: 12 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 3 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.38
