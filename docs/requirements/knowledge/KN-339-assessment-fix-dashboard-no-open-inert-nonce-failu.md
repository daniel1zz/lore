---
id: KN-339
type: knowledge
role: knowledge
title: "Assessment: Fix — dashboard --no-open inert + nonce-failure page (F5a defects D1/D2) (2026-07-29)"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-104
links:
  - {id: PLAN-104, type: informs}
---
# Assessment: met (84/100)

Scope: plan `01KYPM8VH2DRCK43R6TW3TF84H`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-F5A-1 | 88 | Re-run under attestation after the false-oracle defect was fixed (evidence [7], playwright 'packaged serve', build log shows fresh manifest digest). Output tail truncated before the pass/fail summary, so the terminal verdict is not directly visible. | 01KYPMB5QT6DRP421PJ1ZG5S9A (evidence [7] e2e packaged serve) |
| AC-F5A-2 | 86 | Attested e2e run of the nonce flow (evidence [8]) after the 410 body changed shape, confirming 302/replay/API-read behaviour survived the D2 edit. Tail truncated at build output; summary line not shown. | 01KYPMB5QT6DRP421PJ1ZG5S9A (evidence [8] e2e nonce) |
| AC-F5A-3 | 92 | Attested run with full summary: 1 pass, 9 filtered out, 0 fail, 9 expect() calls. Matched-count is visible, so the filter is proven non-empty. | 01KYPMB5QT6DRP421PJ1ZG5S9A (evidence [10] secret-free) |
| AC-F5A-4 | 92 | Attested run, full summary visible: 1 pass, 0 fail, 13 expect() calls. Route-priority dispatch re-verified after static-serving.ts was edited — the correct regression guard for D2. | 01KYPMB5QT6DRP421PJ1ZG5S9A (evidence [11] route priority) |
| AC-F5A-6 | 90 | Attested typecheck (evidence [12]) shows all five tsc projects invoked, dashboard project exited 0. Tail clipped mid-command list but the failing-fast chain implies completion. | 01KYPMB5QT6DRP421PJ1ZG5S9A (evidence [12] bun run typecheck) |
| AC-F5A-7 | 92 | Attested run, full summary: 1 pass, 0 fail, 10 expect() calls; test name confirms 503 kept its JSON shape while static pages still serve — exactly the regression the plan forbade converting to HTML. | 01KYPMB5QT6DRP421PJ1ZG5S9A (evidence [13] auth-store degradation) |
| AC-F5A-8 | 85 | Attested e2e for allowlist\|freshness (evidence [9]); build log reports a verified-fresh 302-file manifest, supporting the freshness half. Tail truncated before test results, and the --dev port-threading half is not separately visible. | 01KYPMB5QT6DRP421PJ1ZG5S9A (evidence [9] e2e allowlist/freshness) |
| AC-F5A-5 | 92 | Attested run, full summary: 1 pass, 0 fail, 6 expect() calls; test name asserts non-zero exit naming both 'bun run build' and '--dev', no vite mention, no residual listener. | 01KYPMB5QT6DRP421PJ1ZG5S9A (evidence [14] source-run guard) |
| AC-F5A-9 | 74 | Strong oracle design (opener shim + live-control run: zero vs exactly one) and attested with full summary. But the run shows '1 pass, 3 filtered out' and the test names only packaged mode/compiled binary — the AC's '--dev startup path' half is unevidenced. | 01KYPMB5QT6DRP421PJ1ZG5S9A (evidence [5] attested; 1 pass, 3 filtered out, packaged mode only), 01KYPMADY00NKJNVZE4575EGBA (RED run recorded fail, self-reported only) |
| AC-F5A-10 | 76 | Attested run recorded pass and six server boots imply per-outcome coverage, but the output tail is clipped at 'packages/lore/tests/integra' — no test names, no pass/fail counts. The specific assertions (410, text/html, relaunch text, /api/auth/me probe, not-JSON) are not visible. | 01KYPMB5QT6DRP421PJ1ZG5S9A (evidence [6] attested, tail truncated before summary), 01KYPMADY00NKJNVZE4575EGBA (RED run recorded fail, self-reported only) |

## Gaps

- The AC requires both the packaged and --dev startup paths to read the negated form, but the attested run matched exactly one test, named '(AC-F5A-9, packaged mode, compiled binary)', with 3 filtered out. The dev read site (dashboard.ts:650, per the task brief) has no visible oracle. The fix may well cover it, but nothing in the materials demonstrates it.
- Evidence [6] is attested pass but its output tail is cut at 'packages/lore/tests/integra' — no test names, no 'N pass / 0 fail' summary. The task explicitly warned that a -t filter matching nothing still exits 0 on partial-match runners, so the matched count was the one thing that needed to be visible here and is not.
- The RED task (01KYPMADY00NKJNVZE4575EGBA) has 3 self-reported and 0 attested evidence records. Its 'done means' required showing the failure output to prove the tests failed on the new assertion rather than a spawn/setup error; no output was captured. The RED->GREEN transition is therefore asserted, not demonstrated.
- diff_available=false. The plan's hard constraints — keep lore_sid at Path=/api rather than widening it, collapse all three nonce outcomes into one response shape, leave a '// reason:' comment naming the mri negation behaviour, and do not edit the RED test files — are all unverifiable from the bundle. Only indirect support exists via AC-F5A-2/4/7 passing unchanged.

## Recommendations

- Require the evidence recorder to capture the tail through the runner's summary line (pass/fail/filtered counts) rather than a fixed byte budget from the start of output. Four of the records here clip before the verdict.
- When an AC names two code paths ('the packaged and --dev startup paths both read the negated form'), require one oracle per path or an explicit note that a single test exercises both. Add a --dev-mode no-open test.
- Attest RED evidence too, or store the failure output on the record. A RED task whose whole deliverable is 'these fail for the right reason' cannot be audited from a bare result=fail flag.
- Include the diff in audit bundles for fix-type plans, especially when the plan lists explicit 'do not simplify past this' constraints (cookie scope, single response shape, reason comment).

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 66936ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.72 | evidence | All 10 ACs have attested passes, including the 8 pre-existing ones re-run as regression guards. Deduction: AC-F5A-9's --dev half unevidenced; AC-F5A-10 result detail truncated. |
| evidence_integrity | 80 | 0.75 | evidence | GREEN task has 10 attested runs across test/tsc/e2e with real output tails; the F5A-9 oracle even proves its own shim live. Weakened by 0 attested RED evidence and two clipped tails. |
| scope_fidelity | 88 | low | absence | No ac_scope declared; every AC in scope and evidenced. No diff to confirm edits stayed inside the two named files or that the cookie-path constraint was honoured. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-F5A-9 | The AC requires both the packaged and --dev startup paths to read the negated form, but the attested run matched exactly one test, named '(AC-F5A-9, packaged mode, compiled binary)', with 3 filtered out. The dev read site (dashboard.ts:650, per the task brief) has no visible oracle. The fix may well cover it, but nothing in the materials demonstrates it. |
| evidence_integrity | major | AC-F5A-10 | Evidence [6] is attested pass but its output tail is cut at 'packages/lore/tests/integra' — no test names, no 'N pass / 0 fail' summary. The task explicitly warned that a -t filter matching nothing still exits 0 on partial-match runners, so the matched count was the one thing that needed to be visible here and is not. |
| evidence_integrity | minor | — | The RED task (01KYPMADY00NKJNVZE4575EGBA) has 3 self-reported and 0 attested evidence records. Its 'done means' required showing the failure output to prove the tests failed on the new assertion rather than a spawn/setup error; no output was captured. The RED->GREEN transition is therefore asserted, not demonstrated. |
| scope_fidelity | minor | — | diff_available=false. The plan's hard constraints — keep lore_sid at Path=/api rather than widening it, collapse all three nonce outcomes into one response shape, leave a '// reason:' comment naming the mri negation behaviour, and do not edit the RED test files — are all unverifiable from the bundle. Only indirect support exists via AC-F5A-2/4/7 passing unchanged. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require the evidence recorder to capture the tail through the runner's summary line (pass/fail/filtered counts) rather than a fixed byte budget from the start of output. Four of the records here clip before the verdict. | A truncated tail makes an attested pass unverifiable, defeating the point of attestation. |
| plan | When an AC names two code paths ('the packaged and --dev startup paths both read the negated form'), require one oracle per path or an explicit note that a single test exercises both. Add a --dev-mode no-open test. | AC-F5A-9's stated scope is broader than its evidenced scope; the dev read site is where the original bug also lived. |
| process | Attest RED evidence too, or store the failure output on the record. A RED task whose whole deliverable is 'these fail for the right reason' cannot be audited from a bare result=fail flag. | Distinguishes a genuine assertion failure from a spawn/setup error that would produce the same fail flag. |
| process | Include the diff in audit bundles for fix-type plans, especially when the plan lists explicit 'do not simplify past this' constraints (cookie scope, single response shape, reason comment). | Those constraints are invisible to the test oracles and cannot be judged without source. |

## Unverifiable Materials

- Diff / source of packages/lore/src/adapters/cli/commands/dashboard.ts and adapters/http/static-serving.ts: diff_available=false; no source excerpts in the bundle, so the flag-negation shape, the // reason: comment, the HTML page body, and the cookie-path constraint cannot be inspected.
- Test bodies for the 'no-open' and 'nonce failure page' cases: tests_touched=false and no test source shown; assertion strength is inferred from test names and expect() counts only.
- AC-F5A-10 run summary (matched test count, per-test names): Evidence [6] output tail truncated mid-path before any results were printed.
- Playwright result summaries for AC-F5A-1, AC-F5A-2, AC-F5A-8: All three tails end inside the build log ('Build succeed'), before any test outcome lines.
- --dev startup path coverage for --no-open: The single attested test names packaged mode only; 3 tests were filtered out and their names are not shown.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 10 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 3 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.59
