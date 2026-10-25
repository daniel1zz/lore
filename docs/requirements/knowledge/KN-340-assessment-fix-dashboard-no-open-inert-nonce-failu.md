---
id: KN-340
type: knowledge
role: knowledge
title: "Assessment: Fix — dashboard --no-open inert + nonce-failure page (F5a defects D1/D2) (2026-07-29)"
status: archived
priority: medium
created: 2026-07-29
updated: 2026-10-23
tags: []
parent: PLAN-104
links:
  - {id: PLAN-104, type: informs}
---
# Assessment: partially_met (69/100)

Scope: plan `01KYPM8VH2DRCK43R6TW3TF84H`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-F5A-9 | 88 | 2 passes (1 attested). Attested output_tail shows the oracle intercepts the opener: --no-open spawns ZERO invocations while the control run spawns exactly ONE, proving the shim live. RED-then-GREEN pairing recorded. No diff to confirm the `// reason:` comment or both read sites. | task-green-honour-no-open-serve-human-readable-nonce-failure (evidence [5] attested, full pass tail), task-red-failing-tests-for-no-open-suppression-nonce-failure (RED fail recorded, self-reported) |
| AC-F5A-10 | 78 | 2 passes (1 attested) on the -t "nonce failure page" oracle. Attested output_tail is truncated mid-file and never shows the pass/fail summary line, so the count and per-dimension assertions (410, text/html, relaunch text, /api/auth/me probe) are unverified from the record. | task-green-honour-no-open-serve-human-readable-nonce-failure (evidence [6] attested but tail clipped before summary) |
| AC-F5A-1 | 85 | Attested e2e 'packaged serve' pass recorded post-fix; tail shows a real build with fresh 302-file manifest. This AC's oracle was the false one D1 exposed, and it now runs against the corrected --no-open path. Playwright pass line itself not in the tail. | task-green-honour-no-open-serve-human-readable-nonce-failure (evidence [7] attested) |
| AC-F5A-2 | 85 | Attested e2e -g "nonce" pass after static-serving.ts was modified, covering 302 + Set-Cookie and 410 replay. Tail shows build succeeded but is clipped before the Playwright result summary. | task-green-honour-no-open-serve-human-readable-nonce-failure (evidence [8] attested) |
| AC-F5A-8 | 83 | Attested e2e -g "allowlist\|freshness" pass with a freshness-verified manifest digest in the tail. Not touched by this plan; serves as regression confirmation. Result summary again clipped. | task-green-honour-no-open-serve-human-readable-nonce-failure (evidence [9] attested) |
| AC-F5A-6 | 55 | 0 recorded pass/fail against the AC, yet its exact oracle (`bun run typecheck`) passed twice as task evidence ([4] GREEN, [3] RED) — self-reported only, and neither run controls the AC's precondition (packages/dashboard never built). Credit is indirect. | task-green-honour-no-open-serve-human-readable-nonce-failure (evidence [4] tsc pass, not linked to AC) |
| AC-F5A-5 | 45 | No pass/fail recorded. Its oracle file dashboard-command.bun.test.ts was edited by this plan; the -t "no-open" run reports '3 filtered out', showing the source-run-guard tests exist but were never executed in this bundle. Only `test:changed` (self-reported) covers it. | task-green-honour-no-open-serve-human-readable-nonce-failure (evidence [3] test:changed, self-reported) |
| AC-F5A-7 | 42 | No pass/fail recorded, despite the GREEN task naming this AC's 503 JSON shape as an explicit do-not-regress on the very function it rewrote (handleNonceBootstrap). Only the self-reported `test:changed` run backstops it; the targeted `-t "auth-store degradation"` oracle was never run. | task-green-honour-no-open-serve-human-readable-nonce-failure (evidence [3] only) |
| AC-F5A-3 | 40 | No pass/fail recorded. Its oracle targets static-serving.bun.test.ts, the file whose subject module gained a new inline HTML body — a secret-free grep oracle is directly relevant to newly emitted markup. Not re-run. | task-green-honour-no-open-serve-human-readable-nonce-failure (no AC-linked evidence) |
| AC-F5A-4 | 40 | No pass/fail recorded. Route-priority dispatch lives in the modified static-serving.ts; the GREEN task lists dispatch order as do-not-regress but ran no `-t "route priority"` oracle to confirm it. | task-green-honour-no-open-serve-human-readable-nonce-failure (no AC-linked evidence) |

## Gaps

- handleNonceBootstrap was rewritten, and AC-F5A-7's 503 machine-auth-unavailable JSON shape is asserted on that same function, yet the `-t "auth-store degradation"` oracle was never run. The GREEN task listed it as do-not-regress but produced no direct evidence.
- Route-priority and SPA-fallback dispatch (AC-F5A-4) and the secret-free artifact grep (AC-F5A-3) both target static-serving.ts, which now emits a new inline HTML body. Neither oracle was re-run; both show 0 pass / 0 fail.
- The attested evidence for AC-F5A-10 is truncated mid-output and never reaches the pass/fail summary. The task itself mandated asserting the matched test count on every -t-filtered run because a zero-match filter still exits 0; that assertion is not observable in the record.
- The RED task's three evidence records (including the two RED failures underpinning the TDD claim) are entirely self-reported with no output, so the 'failed for the right reason, not a spawn error' requirement is unverified.
- No diff provided. The plan's explicit constraint — do not widen lore_sid beyond Path=/api, and implement the session check as a client-side /api/auth/me probe — cannot be confirmed, nor can confinement to commands/dashboard.ts and static-serving.ts.
- AC-F5A-6's exact oracle command (`bun run typecheck`) passed twice as task evidence but is not linked to the AC, so coverage mechanically reads 0. The runs also did not control the AC's stated precondition that packages/dashboard is never built.

## Recommendations

- Add an explicit regression-oracle list to plans that edit a file already covered by other ACs: here, re-run and attest `-t "secret-free"`, `-t "route priority"`, `-t "auth-store degradation"`, and `-t "source-run guard"` before release.
- Require evidence output tails to include the terminating pass/fail summary line (N pass / N fail), truncating from the head rather than the tail when clipping is needed.
- Attach the implementation diff to audit bundles, or require an attested grep oracle for named negative constraints (e.g. lore_sid Path=/api unchanged, `// reason:` mri comment present).
- Declare ac_scope on fix plans of this shape so AC-F5A-3/-4/-5/-6/-7 are either explicitly in scope with regression oracles, or explicitly out of scope with a stated rationale.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 76010ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 82 | 0.75 | evidence | Both targeted defects (D1, D2) carry attested passing oracles, and D1's fix is proven by a control-run opener interception. Untargeted ACs on the same edited files lack re-run proof. |
| evidence_integrity | 66 | 0.8 | evidence | Attested ratio 0.42; RED task wholly self-reported; three e2e and one test tail clipped before their result summaries. Attested D1 record is strong and self-proving. |
| scope_fidelity | 78 | low | absence | Task text matches plan scope with no observed drift, but with diff_available=false the cookie-scope constraint and confinement to the two named files cannot be confirmed. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-F5A-7 | handleNonceBootstrap was rewritten, and AC-F5A-7's 503 machine-auth-unavailable JSON shape is asserted on that same function, yet the `-t "auth-store degradation"` oracle was never run. The GREEN task listed it as do-not-regress but produced no direct evidence. |
| outcome | major | AC-F5A-4 | Route-priority and SPA-fallback dispatch (AC-F5A-4) and the secret-free artifact grep (AC-F5A-3) both target static-serving.ts, which now emits a new inline HTML body. Neither oracle was re-run; both show 0 pass / 0 fail. |
| evidence_integrity | major | AC-F5A-10 | The attested evidence for AC-F5A-10 is truncated mid-output and never reaches the pass/fail summary. The task itself mandated asserting the matched test count on every -t-filtered run because a zero-match filter still exits 0; that assertion is not observable in the record. |
| evidence_integrity | minor | — | The RED task's three evidence records (including the two RED failures underpinning the TDD claim) are entirely self-reported with no output, so the 'failed for the right reason, not a spawn error' requirement is unverified. |
| scope_fidelity | minor | — | No diff provided. The plan's explicit constraint — do not widen lore_sid beyond Path=/api, and implement the session check as a client-side /api/auth/me probe — cannot be confirmed, nor can confinement to commands/dashboard.ts and static-serving.ts. |
| evidence_integrity | minor | AC-F5A-6 | AC-F5A-6's exact oracle command (`bun run typecheck`) passed twice as task evidence but is not linked to the AC, so coverage mechanically reads 0. The runs also did not control the AC's stated precondition that packages/dashboard is never built. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add an explicit regression-oracle list to plans that edit a file already covered by other ACs: here, re-run and attest `-t "secret-free"`, `-t "route priority"`, `-t "auth-store degradation"`, and `-t "source-run guard"` before release. | Both edited files are the oracle targets of four ACs that ended with zero recorded runs; test:changed alone was self-reported. |
| process | Require evidence output tails to include the terminating pass/fail summary line (N pass / N fail), truncating from the head rather than the tail when clipping is needed. | Three e2e records and the AC-F5A-10 test record clip before their results, defeating the plan's own matched-count assertion rule. |
| process | Attach the implementation diff to audit bundles, or require an attested grep oracle for named negative constraints (e.g. lore_sid Path=/api unchanged, `// reason:` mri comment present). | diff_available=false makes the plan's central D2 design constraint unverifiable by the auditor. |
| spec | Declare ac_scope on fix plans of this shape so AC-F5A-3/-4/-5/-6/-7 are either explicitly in scope with regression oracles, or explicitly out of scope with a stated rationale. | The plan declares no ac_scope, so five untouched ACs are audited as in-scope with no evidence, depressing the verdict. |

## Unverifiable Materials

- Implementation diff for commands/dashboard.ts and static-serving.ts: diff_available=false; cannot confirm both read sites plus the flag definition were fixed, the `// reason:` mri comment exists, or the HTML page's actual content.
- lore_sid cookie scope (auth.ts:187) after the change: No diff or grep oracle; the plan's explicit do-not-widen constraint cannot be checked from the bundle.
- Full output of the AC-F5A-10 oracle and the three e2e oracles: All four attested tails are clipped before their pass/fail summary lines, so matched test counts are not observable.
- RED-phase failure output: RED task evidence is self-reported with 0 attestations and no output tails; the 'failed on the new assertion, not on setup' claim is unconfirmed.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 10 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 2 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.42
