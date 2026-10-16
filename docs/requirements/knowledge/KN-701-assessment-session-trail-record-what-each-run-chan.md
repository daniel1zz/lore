---
id: KN-701
type: knowledge
role: knowledge
title: "Assessment: Session trail: record what each run changed, judge it at turn end, carry it in the handoff (2026-10-16)"
status: approved
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-188
links:
  - {id: PLAN-188, type: informs}
---
# Assessment: partially_met (77/100)

Scope: plan `01M51H5ND6AZ3ASWZ5KQ1DX3VK`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-ST-1 | 88 | Attested passes of session-trail-runs.test.ts (14 tests >= 7). Red-first includes two mutation runs (hook field rename and core schema field rename) that show the parity test going red, as the AC asks. Core reader and node-only export via node.ts are visible in the diff. | 01M51H5PY3H485NCPQJ09AJC41 (evidence 3,4 mutation reds; 8,10 attested pass) |
| AC-ST-2 | 85 | Attested passes, 8 tests >= 6, including a REGRESSION case for base reuse after merge. Red evidence is from the right file. subagent-trail.mjs is omitted from the diff, so the measurement logic was not seen; the schema adds the stored base field. | 01M51H5QEDAM6Y2HHEZ9F05R3D |
| AC-ST-3 | 85 | 29 attested tests (>= 19) and a red-first run from the right file. attributeTurn lives in the omitted session-trail.mjs, so I could not inspect the fixture cases for rebase, patch-id and conflicts directly. | 01M51H5QYHZ9T7A7YDAC4KE1NN |
| AC-ST-4 | 82 | 12 attested tests (>= 7), re-run after the regression fix. The systemMessage probe used claude -p stream-json, which shows the message is emitted, not that it is displayed to the user as D13 required. stop-turn-review.mjs is unseen, so its 400-line limit is unverified. | 01M51H5QYHZ9T7A7YDAC4KE1NN (evidence 6 manual probe), 01M51SDA5PWCB0XVEPHGTW7ZB9 |
| AC-ST-5 | 78 | Attested passes, 10 tests >= 8. But its expected-fail record has the same tail_bytes and output as AC-ST-1's red run (session-trail-runs output), so no red run of the retention test itself is shown. session-trail-start.mjs is unseen. | 01M51H5PY3H485NCPQJ09AJC41 (evidence 2 mirrors evidence 1) |
| AC-ST-6 | 87 | Attested passes, 10 tests >= 6, with a genuine red (module missing). The diff shows the verified-run session resolution, the exit-4 refusal naming BR-1143, --turn/--run narrowing, and unmeasured turns rendered as unmeasured. | 01M51H5REHTNZNGDFHZ0C00P9B |
| AC-ST-7 | 82 | 13 attested tests (>= 9). The diff shows the strict schema, the loader naming the key path ([0].require), and per-run plus unknown-group judgment. The .lore/config.yaml declaration of assets-manifest is unseen. | 01M51H5SFGYP65HK2YP3D21PKW |
| AC-ST-8 | 78 | 10 attested tests (>= 9). Claim rows come from the audit log and anchorsOverlap is reused. The AC-ST-8 expected-fail record is byte-identical to AC-ST-9's cursor-test output, so it is not a red run of this AC's own test. claimedTasks scans every claim audit row. | 01M51H5RYYDQ34FS1KZ3E37YGZ (evidence 1-3 identical tails) |
| AC-ST-9 | 82 | 9 attested tests (>= 6) with a genuine red. The cursor write lives in the omitted stop-turn-review.mjs. The CLI side visibly never marks a helper judged. | 01M51H5RYYDQ34FS1KZ3E37YGZ |
| AC-ST-10 | 78 | 4 attested tests (>= 3). The expected-fail record is a copy of the cursor-test output, so there is no real red run of the spawn-gating test. The gating code is unseen. | 01M51H5RYYDQ34FS1KZ3E37YGZ |
| AC-ST-11 | 87 | 6 attested tests (>= 5) with a genuine red. The diff shows the merged changed_files view, author files marked, 'not measured' with no run, removed and unmeasured gaps rendered, and MCP and CLI both passing the verified run. | 01M51H5T1MJHX8RQMC2Z3ZZPRG |
| AC-ST-12 | 80 | 20 attested tests (>= 7) with a genuine red, and the roster registrations are in the diff. subagent-trail uses RUN_END_HOOK_TIMEOUT_SECONDS; nothing shown proves it equals 10. The AC statement is truncated in the materials. | 01M51H5THW5Z4ZAZW5D390N3C5 |

## Gaps

- The landing task has no evidence for lore verify, lore rule apply, full suite on main, or bun run build, all of which the Exit Criteria require.
- subagent-trail.mjs is registered with RUN_END_HOOK_TIMEOUT_SECONDS in packages/core/src/distribution-hooks.ts; nothing shown confirms that value is 10.
- The Stop latency target (150 ms, trigger 300 ms) has no recorded figures, so R2 compliance cannot be judged.

## Recommendations

- Require attested oracle records for every Exit Criteria item on the landing task before lore done accepts it.
- Reject an expected-fail record whose command names one test file while its output tail comes from another.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 48881ms
- Retried: false
- Truncated sections: spec, diff:.lore/export-index.json, diff:packages/lore/tests/unit/core/distribution-hooks.test.ts, diff:packages/lore/tests/unit/hooks/session-trail-roster.test.ts, diff:assets/hooks/lib/session-trail.mjs, diff:assets/hooks/stop-turn-review.mjs, diff:assets/hooks/user-prompt-turn-start.mjs, diff:packages/lore/tests/integration/hooks/session-trail-attribution.test.ts, diff:packages/lore/tests/integration/hooks/stop-turn-review-trail-source-edits.test.ts, diff:packages/lore/tests/fixtures/context-variables/pre-change-settings.json, diff:packages/lore/tests/integration/hooks/stop-turn-review-trail-source-edits.test.ts, diff:scripts/check-shipped-defaults.ts, diff:packages/lore/tests/integration/cli/handoff-trail-files.test.ts, diff:packages/lore/tests/unit/adapters/mcp-session-tools.test.ts, diff:.lore/config.yaml, diff:packages/lore/tests/integration/cli/session-trail-review-co-change.test.ts, diff:assets/hooks/lib/session-trail.mjs, diff:assets/hooks/stop-turn-review.mjs, diff:packages/lore/tests/integration/cli/session-trail-review-helper-scope.test.ts, diff:packages/lore/tests/integration/hooks/stop-turn-review-cursor.test.ts, diff:packages/lore/tests/integration/hooks/stop-turn-review-spawn-gating.test.ts, diff:packages/lore/tests/integration/hooks/trail-review-stub.ts, diff:packages/lore/tests/integration/cli/session-trail.test.ts, diff:assets/hooks/lib/session-trail.mjs, diff:assets/hooks/subagent-trail.mjs, diff:packages/lore/tests/integration/hooks/subagent-trail.test.ts, diff:assets/hooks/lib/session-trail.mjs, diff:assets/hooks/session-trail-start.mjs, diff:packages/core/src/session-trail.ts, diff:packages/lore/tests/integration/hooks/session-trail-retention.test.ts, diff:packages/lore/tests/integration/hooks/session-trail-runs.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.6 | evidence | All 12 AC oracles pass, attested, above their thresholds. Landing steps (rule apply, prose, build, full suite) are not shown as done. |
| evidence_integrity | 65 | 0.65 | evidence | Red records for three ACs are copied from other test files. Latency and UI evidence are manual and thin. The full-suite and build evidence is missing. |
| scope_fidelity | 85 | 0.6 | evidence | Changes map to the planned tasks. The regression-fix task is explained. Extra main-run co-change group is a small addition. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | The landing task has no evidence for lore verify, lore rule apply, full suite on main, or bun run build, all of which the Exit Criteria require. |
| outcome | minor | AC-ST-12 | subagent-trail.mjs is registered with RUN_END_HOOK_TIMEOUT_SECONDS in packages/core/src/distribution-hooks.ts; nothing shown confirms that value is 10. |
| outcome | minor | — | The Stop latency target (150 ms, trigger 300 ms) has no recorded figures, so R2 compliance cannot be judged. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require attested oracle records for every Exit Criteria item on the landing task before lore done accepts it. | Exit criteria were claimed without evidence. |
| process | Reject an expected-fail record whose command names one test file while its output tail comes from another. | Copied red runs defeat I3. |

## Unverifiable Materials

- assets/hooks/lib/session-trail.mjs, assets/hooks/stop-turn-review.mjs, assets/hooks/subagent-trail.mjs, assets/hooks/session-trail-start.mjs: Omitted from the diff; core hook logic not inspected.
- .lore/config.yaml: Omitted; the assets-manifest declaration is unseen.
- Landing latency output: Manual evidence has no visible output tail.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 1
- Unverifiable (confirmed absent — finding withdrawn): 0
- Not shown to the judge (omitted from the diff by truncation — finding withdrawn, NOT judged): 1
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

1 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [major] The expected-fail records for AC-ST-8 and AC-ST-10 carry the identical output of packages/lore/tests/integration/hooks/stop-turn-review-cursor.test.ts, and AC-ST-5's red copies AC-ST-1's output. No red run of their own test files is shown. — "packages/lore/tests/integration/hooks/stop-turn-review-cursor.test.ts" was never shown to the judge (omitted from the truncated diff)

## Facts Summary

- AC coverage: 12 declared criteria
- Task evidence: 10 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.78
