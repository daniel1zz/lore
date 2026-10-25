---
id: KN-142
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
---
# Assessment: met (85/100)

Scope: plan `01KY1NPC95MRTX6FC0XWA4WA9C`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-062-1 | 90 | Attested pass (recorder=apple) of the 'deny keys' filter, 4 tests. Diff shows findDeniedConfigKeys runs before any disk access, so a denied patch cannot alter config.yaml. Deny table matches the 4 declared keys. | 01KY1T0GKTMQ0XRY73MVRQHN8B (evidence [4]) |
| AC-062-2 | 88 | Attested pass of 'redaction' (1 test). redactConfigValues substitutes a fixed marker for ai.http.headers.* leaves and read() applies it. Single matched test is thin for a 0-occurrences claim, but the code path is visible and pure. | 01KY1T0GKTMQ0XRY73MVRQHN8B (evidence [5]) |
| AC-062-3 | 62 | Attested FAIL: declared path packages/lore/tests/unit/http/ does not exist ('No test files found'). Mitigated — AC-062-9 explicitly REPLACES it and passes attested at the real path. Score reflects the stale AC text, not a behavioural gap. | 01KY1T0GKTMQ0XRY73MVRQHN8B (evidence [6] fail; superseded by [12]) |
| AC-062-4 | 92 | Attested pass of 'restart_required' (2 tests). classifyConfigEffect derives from a declared prefix table; sync.* is restart_required and workflow.* is live, matching the AC's exact 1-vs-0 expectation. | 01KY1T0GKTMQ0XRY73MVRQHN8B (evidence [7]) |
| AC-062-5 | 62 | Attested FAIL for the same non-existent path as AC-062-3. Mitigated by AC-062-10, which passes attested and names the bearer-rejected test explicitly in output. Behaviour is enforced upstream by handleDashboardRoute's cookie-only guard. | 01KY1T0GKTMQ0XRY73MVRQHN8B (evidence [8] fail; superseded by [13]) |
| AC-062-6 | 90 | Attested pass of 'schema rejection' (2 tests). update() merges into a candidate and runs LoreConfigSchema.safeParse before saveConfig, so rejection provably leaves the file untouched with zero partial application. | 01KY1T0GKTMQ0XRY73MVRQHN8B (evidence [9]) |
| AC-062-7 | 90 | Attested pass of 'audit' (2 tests), with the named test visible in output_tail: accepted PATCH writes exactly 1 row, rejected writes 0. Audit row carries changed_keys plus before/after sha256. | 01KY1T0GKTMQ0XRY73MVRQHN8B (evidence [10]) |
| AC-062-8 | 90 | Attested pass of browser-safety.test.ts (3 tests). The scan walks the barrel's transitive relative-import closure, includes a vacuity guard (closure.size>10) and a negative self-check against config-node.ts. Static scan cannot catch dynamic imports. | 01KY1T0GKTMQ0XRY73MVRQHN8B (evidence [11]) |
| AC-062-9 | 88 | Attested pass at the corrected adapters/http path, 1 matched test as the AC requires. Route returns 409 STALE_VERSION with current_hash and never calls update() on that branch. | 01KY1T0GKTMQ0XRY73MVRQHN8B (evidence [12]) |
| AC-062-10 | 90 | Attested pass with the matched test named in output_tail ('bearer rejected — returns 403 and writes 0 bytes'). Enforcement is structural: bearer actors are stopped by assertCookieActor before the handler is reached. | 01KY1T0GKTMQ0XRY73MVRQHN8B (evidence [13]) |
| AC-062-11 | 92 | Attested pass, 4 matched tests (happy/mismatch/omitted/TOCTOU state test) — exceeds the 2 the AC demands. Diff shows the CAS re-derives the hash from a fresh load inside update(), before merge/validate/save. | 01KY1T0GKTMQ0XRY73MVRQHN8B (evidence [1],[14]) |

## Gaps

- findDeniedConfigKeys uses exact-length wildcard matching, so a patch that replaces an ancestor of a denied key with an empty object or a non-object leaf ({ai:{http:{headers:{}}}}) produces the 3-segment path 'ai.http.headers', which does not match 'ai.http.headers.*' and is therefore not denied. That patch would delete the configured API-key headers through the dashboard surface. The deny table's own doc calls the arrays-as-leaves case out but not this one.
- AC-062-3 and AC-062-5 remain in the coverage table with attested failures ('No test files found'), because the fix was to add AC-062-9/AC-062-10 rather than correct the declared paths. Any future automated read of the coverage table sees 2 failing ACs on a passing spec.
- T1 (the ConfigService foundation carrying all deny/redact/audit enforcement) and T2 have no operator-attested evidence — 14 self-reported entries, 0 attested. Attestation exists only on T3's re-runs, which do re-cover the T1 ACs, so the gap is largely mitigated.
- The optimistic-concurrency hash is derived from the redacted config, so any change confined to a redacted value is invisible to If-Match. Documented in the route header as a known blind spot, but no test pins the behaviour, and the mitigation argument depends on the deny table — which the ancestor-patch gap above weakens.

## Recommendations

- Extend the deny check to reject any patch leaf that is a proper PREFIX of a CONFIG_DENY_KEYS pattern, not just an exact-length wildcard match, and add unit cases for empty-object and null ancestor patches over ai.http.headers and ai.providers.*.
- Validate that every AC's declared oracle path resolves before the AC is frozen, and amend the AC in place when it does not, rather than appending a REPLACES AC.
- Require operator attestation on the task that first introduces a security boundary, not only on the last task in the chain.
- Record a knowledge doc covering the deny/redact tables, the restart-vs-live prefix list, and the two-hash split (audit YAML hash vs CAS JSON hash) before SPEC-063 consumes them.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 82083ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/service/config-service.test.ts, diff:packages/lore/tests/unit/adapters/http/config-routes.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 87 | 0.75 | evidence | All 11 ACs have passing runs; the two attested fails are path errors superseded by passing replacements. Deny-table edge case (empty-object ancestor patch) is a real residual hole. |
| evidence_integrity | 78 | 0.7 | evidence | T3 evidence is operator-attested with output tails including named tests and vacuity-resistant counts. T1/T2 are wholly self-reported; attested ratio 0.39. |
| scope_fidelity | 90 | 0.75 | evidence | Diff matches T1/T2/T3 scope. The one extra move (extracting emitDashboardTelemetry to middleware) is justified in-comment to avoid a cycle. T3 closed a TOCTOU T2 explicitly flagged. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-062-1 | findDeniedConfigKeys uses exact-length wildcard matching, so a patch that replaces an ancestor of a denied key with an empty object or a non-object leaf ({ai:{http:{headers:{}}}}) produces the 3-segment path 'ai.http.headers', which does not match 'ai.http.headers.*' and is therefore not denied. That patch would delete the configured API-key headers through the dashboard surface. The deny table's own doc calls the arrays-as-leaves case out but not this one. |
| evidence_integrity | minor | AC-062-3 | AC-062-3 and AC-062-5 remain in the coverage table with attested failures ('No test files found'), because the fix was to add AC-062-9/AC-062-10 rather than correct the declared paths. Any future automated read of the coverage table sees 2 failing ACs on a passing spec. |
| evidence_integrity | minor | — | T1 (the ConfigService foundation carrying all deny/redact/audit enforcement) and T2 have no operator-attested evidence — 14 self-reported entries, 0 attested. Attestation exists only on T3's re-runs, which do re-cover the T1 ACs, so the gap is largely mitigated. |
| outcome | minor | — | The optimistic-concurrency hash is derived from the redacted config, so any change confined to a redacted value is invisible to If-Match. Documented in the route header as a known blind spot, but no test pins the behaviour, and the mitigation argument depends on the deny table — which the ancestor-patch gap above weakens. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Extend the deny check to reject any patch leaf that is a proper PREFIX of a CONFIG_DENY_KEYS pattern, not just an exact-length wildcard match, and add unit cases for empty-object and null ancestor patches over ai.http.headers and ai.providers.*. | Closes a reachable delete-path to denied keys that the current exact-length matcher misses. |
| process | Validate that every AC's declared oracle path resolves before the AC is frozen, and amend the AC in place when it does not, rather than appending a REPLACES AC. | Two ACs shipped pointing at a directory that never existed, leaving permanent attested failures. |
| process | Require operator attestation on the task that first introduces a security boundary, not only on the last task in the chain. | T1 owns deny/redact/audit enforcement and had 0 attested runs of its own. |
| spec | Record a knowledge doc covering the deny/redact tables, the restart-vs-live prefix list, and the two-hash split (audit YAML hash vs CAS JSON hash) before SPEC-063 consumes them. | 0 knowledge docs linked; the invariants live only in module headers. |

## Unverifiable Materials

- packages/lore/tests/unit/service/config-service.test.ts (pre-T3 portion) and packages/lore/tests/unit/adapters/http/config-routes.test.ts: Listed in the truncation manifest as present but omitted; assertion strength for the deny/redaction/403/409 cases could not be inspected directly, only inferred from run counts and test names in outp…
- LoreConfigSchema definition: Not in the diff, so it is unknown whether the schema independently rejects an emptied ai.http.headers map — which determines whether the ancestor-patch deny gap is exploitable in practice.

## Facts Summary

- AC coverage: 11 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.39
