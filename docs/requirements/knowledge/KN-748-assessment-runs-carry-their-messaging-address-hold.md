---
id: KN-748
type: knowledge
role: knowledge
title: "Assessment: Runs carry their messaging address; holder listings show it (2026-10-20)"
status: archived
priority: medium
created: 2026-10-20
updated: 2026-10-23
tags: []
parent: PLAN-213
links:
  - {id: PLAN-213, type: informs}
---
# Assessment: met (83/100)

Scope: plan `01M5C6Y2M1SZ68B37K351MQPPM`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-MA-1 | 85 | Attested pass: 6 'messaging socket' hook tests plus assets-ssot, after a captured red run. The manifest sha for run-register.mjs was regenerated. The hook source and its test file were omitted from the diff, so the D10 no-grammar invariant was not inspected directly. | task-runs-record-their-messaging-address-on-every-register-run (evidence [1] expected-fail, [3] pass) |
| AC-MA-2 | 84 | Attested 9/9 pass after red. recordRunAddress is called unconditionally outside the process branch. insertRun on the in-memory store forces null. Migration 030 is two-phase. run show text and JSON are asserted. Turso is implemented but has no test, and in-memory parity checks only the service, not … | task-runs-record-their-messaging-address-on-every-register-run (evidence [2] expected-fail, [4] pass, [6] tsc) |
| AC-MA-3 | 82 | Attested 8/8 pass after red. The join goes run → deriveRunId main run, never parentRunId. bootstrap, ready, territory and both text lines are asserted. Weak spots: the REGRESSION stripped-length check is tautological, the ERROR test asserts conditionally, and the phase-plan check only parses the sc… | task-holder-listings-show-the-holding-run-s-messaging-address (evidence [1] expected-fail, [3],[5] pass, [7] floor) |
| AC-MA-4 | 80 | Final attested 4/4 pass against the fresh dist/lore install. The intermediate NEGATIVE failure was fixed by changing session ids, not code: two sessions sharing an 8-char actor prefix had merged into one row. That shows deriveSessions' first-non-null address can mislabel a merged group. | task-holder-listings-show-the-holding-run-s-messaging-address (evidence [2] expected-fail, [4] fail, [6] pass) |

## Gaps

- The Turso store's migration-030 step and recordRunAddress in packages/lore/src/store/turso-store.ts have no test. The Turso migration step also lacks the ceiling guard the SQLite step has.

## Recommendations

- Add an invariant that one ReadySession row never mixes claims from different main runs. Otherwise, flag conflicting addresses instead of choosing the first non-null one.
- When an e2e fails, record whether the fix touched production code or only the fixture, and file a follow-up when a fixture change hides a product behavior.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 35379ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/hooks/run-register-hook.test.ts, diff:assets/hooks/run-register.mjs, diff:packages/lore/tests/integration/stash-prune-verified-run.test.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/store/migration-017.bun.test.ts, diff:packages/lore/tests/unit/store/run-agent-ref.bun.test.ts, diff:packages/lore/tests/unit/core/issue-report.test.ts, diff:packages/lore/tests/unit/store/autonomy-thresholds-store.bun.test.ts, diff:packages/lore/tests/unit/store/migration-014.bun.test.ts, diff:packages/lore/tests/unit/store/migration-016.bun.test.ts, diff:packages/lore/tests/unit/store/migration-017.bun.test.ts
- Reasoning clipped for: AC-MA-2, AC-MA-3

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 83 | 0.7 | evidence | All four ACs show attested passes, and the store, CLI, service and listing changes match the plan. There is a latent mis-attribution risk when sessions group by actor only. |
| evidence_integrity | 82 | 0.7 | evidence | Every task has red-first captures, attested passes and a tsc run. The AC-MA-4 fail→pass came from a test-only fixture change, and some assertions are weak or conditional. |
| scope_fidelity | 88 | 0.7 | evidence | Changes stay within the planned files. Migration 030 is the next free number, per the plan. Fixture updates across tests are mechanical consequences of the schema change. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-MA-2 | The Turso store's migration-030 step and recordRunAddress in packages/lore/src/store/turso-store.ts have no test. The Turso migration step also lacks the ceiling guard the SQLite step has. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add an invariant that one ReadySession row never mixes claims from different main runs. Otherwise, flag conflicting addresses instead of choosing the first non-null one. | Without it, a listing can point one holder at another session's socket. |
| process | When an e2e fails, record whether the fix touched production code or only the fixture, and file a follow-up when a fixture change hides a product behavior. | The AC-MA-4 fail→pass came from renaming fixture ids. |

## Unverifiable Materials

- assets/hooks/run-register.mjs and packages/lore/tests/unit/hooks/run-register-hook.test.ts: Omitted from the diff. The hook's raw-socket forwarding and SubagentStart exclusion are judged from attested tests only.
- packages/dashboard/src/lib/api.ts ReadySession type: Not shown in the diff. Whether the dashboard type carries message_address is inferred only from the passing typecheck and fixture.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 2
- Unverifiable (confirmed absent — finding withdrawn): 2
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

2 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [major] deriveSessions in packages/core/src/session.ts sets a group's message_address from the first claim with a non-null address. When two main runs share a grouping key (same 8-char actor prefix, session_id not measured), one row shows one session's address for both. The e2e failure was resolved by renaming session ids in packages/lore/tests/e2e/run-message-address-e2e.bun.test.ts, not by fixing the code. — "packages/lore/tests/e2e/run-message-address-e2e.bun.test.ts" not found at commit ecb7300df4749ff5c5e3b1233291673584661a70
- [minor] In packages/lore/tests/unit/service/holder-message-address.bun.test.ts, the REGRESSION check that compares stripped length to original length is tautological, and the ERROR case asserts conditionally on whether the claim was accepted. — "packages/lore/tests/unit/service/holder-message-address.bun.test.ts" not found at commit ecb7300df4749ff5c5e3b1233291673584661a70

## Facts Summary

- AC coverage: 4 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=1.00
