---
id: KN-342
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
# Assessment: partially_met (62/100)

Scope: plan `01KYPM8VH2DRCK43R6TW3TF84H`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-F5A-9 | 87 | 2 pass / 0 fail, 1 attested. Attested tail shows the oracle intercepts the opener (0 invocations with --no-open, exactly 1 in the control run), proving the shim live. RED-then-GREEN trail present. No diff, so the code shape and the required // reason: comment are unverified. | task-green-honour-no-open-serve-human-readable-nonce-failure (evidence [5] attested, output_tail shows 1 pass / 3 filtered / 0 fail), task-red-failing-tests-for-no-open-suppression-nonce-failure (evidence [1] RED fail, self-reported) |
| AC-F5A-10 | 78 | 2 pass / 0 fail, 1 attested. But the attested output_tail is truncated before any test-name or pass/fail summary line — it shows only server startup noise, so matched-test count is not visible despite the task explicitly requiring count assertion on -t runs. | task-green-honour-no-open-serve-human-readable-nonce-failure (evidence [6] attested but tail clipped mid-output), task-red-failing-tests-for-no-open-suppression-nonce-failure (evidence [2] RED fail, self-reported) |
| AC-F5A-1 | 30 | 0 pass / 0 fail. The plan itself declares this AC's oracle was a LIVE FALSE ORACLE (it ran dist/lore dashboard --no-open while a browser always spawned). After changing --no-open semantics, the AC was not re-run, so its status is now unknown rather than merely uncovered. | — |
| AC-F5A-2 | 38 | 0 pass / 0 fail. Directly touched surface: the nonce replay path changed from JSON to HTML 410. Task lists non-regression intent, but no e2e run for this AC is recorded in the bundle. | — |
| AC-F5A-7 | 40 | 0 pass / 0 fail. The 503 machine-auth shape is adjacent to the edited handleNonceBootstrap and was explicitly called out as must-not-regress; RED task claims coverage but no passing run for this AC is recorded. | — |
| AC-F5A-3 | 42 | 0 pass / 0 fail in the bundle. Out of the plan's stated acceptance (9/10) and unlikely to be affected by these edits; self-reported test:changed and typecheck passes give weak indirect assurance only. | task-green-honour-no-open-serve-human-readable-nonce-failure (evidence [3] test:changed, self-reported) |
| AC-F5A-4 | 42 | 0 pass / 0 fail. Route-priority/dispatch order was declared must-not-regress in the same edited module (static-serving.ts), but only the self-reported test:changed run covers it indirectly. | task-green-honour-no-open-serve-human-readable-nonce-failure (evidence [3], self-reported) |
| AC-F5A-5 | 42 | 0 pass / 0 fail. Lives in the same test file edited for AC-F5A-9 (dashboard-command.bun.test.ts); only the -t "no-open" slice was run, so the rest of that file's ACs are unverified here. | — |
| AC-F5A-6 | 55 | 0 pass / 0 fail against this AC, but `bun run typecheck` is recorded pass in both tasks (evidence [4] GREEN, [3] RED). The fresh-clone / dashboard-never-built precondition is not demonstrated, so the AC's distinguishing condition is unproven. | task-green-honour-no-open-serve-human-readable-nonce-failure (evidence [4] typecheck pass, self-reported) |
| AC-F5A-8 | 40 | 0 pass / 0 fail. Its e2e harness invokes --no-open (per the plan), so the semantics change touches this AC's runner too, yet no run is recorded post-fix. | — |

## Gaps

- The plan documents that AC-F5A-1's e2e oracle ran `dist/lore dashboard --no-open` while a browser was in fact always spawned — a live false oracle. Fixing --no-open changes the topology that oracle actually exercises, yet AC-F5A-1 records 0 pass / 0 fail. The AC that motivated the fix is now in an unknown state; it may newly fail (e.g. startup timing, port binding) or may still be passing for the wrong reason.
- The only attested record for AC-F5A-10 (evidence [6]) has an output_tail truncated mid-line after six server-startup banners, before any test name or `N pass / 0 fail` summary. The GREEN task explicitly required asserting matched test count on every -t-filtered run because a filter matching nothing still exits 0. That assertion is therefore not demonstrated for this AC.
- Attested evidence ratio is 0.22 (2 of 9 records). The RED task's three records — including the two claimed RED failures that establish the tests fail for the right reason — are entirely self-reported, as are test:changed and typecheck on the GREEN side.
- AC-F5A-2 asserts the nonce replay answers 410. The change alters that response body from JSON to HTML. No post-change run of AC-F5A-2 is recorded, so whether its assertions inspect only status (safe) or also body shape (potentially broken) is undetermined from this bundle.
- The plan's Acceptance names only AC-F5A-9 and AC-F5A-10, but no extra.ac_scope is declared, so all 10 spec ACs are formally in scope. This is a metadata gap rather than behavioural drift, but it makes the coverage table read as a much larger shortfall than the plan intended.

## Recommendations

- Add AC-F5A-1, AC-F5A-2 and AC-F5A-8 to the oracle set for this fix and re-run + attest them. All three either invoke --no-open in their harness or assert on the nonce replay response whose body shape changed.
- Make the evidence recorder capture the tail from the END of the run (summary lines) rather than the head, or require the pass/fail count line to be present in an attested tail before the record is accepted.
- Declare extra.ac_scope = [AC-F5A-9, AC-F5A-10] on narrow fix plans so untouched spec ACs are excluded from coverage scoring.
- Capture a knowledge doc recording that citty@0.1.6's bundled mri rewrites every --no-X token into {X:false}, so no literal "no-*" key ever reaches args.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 74915ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 70 | 0.72 | evidence | Both targeted ACs (F5A-9/10) pass with RED→GREEN trail and one attested run each. But the plan's own false-oracle finding (AC-F5A-1) was never re-verified after the semantics change. |
| evidence_integrity | 55 | 0.8 | evidence | Attested ratio 0.22; RED task fully self-reported; AC-F5A-10's attested tail clipped before any pass/fail summary, so its matched-test count — explicitly required by the task — is invisible. |
| scope_fidelity | 72 | low | absence | Task text tracks the plan tightly (D1+D2, no cookie widening, no negation layer). With no diff, adherence to the rejected-alternative constraints and file boundaries cannot be checked. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-F5A-1 | The plan documents that AC-F5A-1's e2e oracle ran `dist/lore dashboard --no-open` while a browser was in fact always spawned — a live false oracle. Fixing --no-open changes the topology that oracle actually exercises, yet AC-F5A-1 records 0 pass / 0 fail. The AC that motivated the fix is now in an unknown state; it may newly fail (e.g. startup timing, port binding) or may still be passing for the wrong reason. |
| evidence_integrity | major | AC-F5A-10 | The only attested record for AC-F5A-10 (evidence [6]) has an output_tail truncated mid-line after six server-startup banners, before any test name or `N pass / 0 fail` summary. The GREEN task explicitly required asserting matched test count on every -t-filtered run because a filter matching nothing still exits 0. That assertion is therefore not demonstrated for this AC. |
| evidence_integrity | minor | — | Attested evidence ratio is 0.22 (2 of 9 records). The RED task's three records — including the two claimed RED failures that establish the tests fail for the right reason — are entirely self-reported, as are test:changed and typecheck on the GREEN side. |
| outcome | minor | AC-F5A-2 | AC-F5A-2 asserts the nonce replay answers 410. The change alters that response body from JSON to HTML. No post-change run of AC-F5A-2 is recorded, so whether its assertions inspect only status (safe) or also body shape (potentially broken) is undetermined from this bundle. |
| scope_fidelity | minor | — | The plan's Acceptance names only AC-F5A-9 and AC-F5A-10, but no extra.ac_scope is declared, so all 10 spec ACs are formally in scope. This is a metadata gap rather than behavioural drift, but it makes the coverage table read as a much larger shortfall than the plan intended. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add AC-F5A-1, AC-F5A-2 and AC-F5A-8 to the oracle set for this fix and re-run + attest them. All three either invoke --no-open in their harness or assert on the nonce replay response whose body shape changed. | The plan itself identifies AC-F5A-1 as a false oracle; leaving it un-rerun after changing the flag's semantics preserves the exact failure mode the plan set out to eliminate. |
| process | Make the evidence recorder capture the tail from the END of the run (summary lines) rather than the head, or require the pass/fail count line to be present in an attested tail before the record is accepted. | AC-F5A-10's attested tail is startup noise only; it cannot confirm the matched-test count the task required. |
| plan | Declare extra.ac_scope = [AC-F5A-9, AC-F5A-10] on narrow fix plans so untouched spec ACs are excluded from coverage scoring. | 8 of 10 ACs show 0/0 purely because scope was left implicit, depressing the assessed outcome. |
| process | Capture a knowledge doc recording that citty@0.1.6's bundled mri rewrites every --no-X token into {X:false}, so no literal "no-*" key ever reaches args. | 0 knowledge docs linked; the GREEN task anticipates a future reader 'restoring' args["no-open"], which a durable note would prevent. |

## Unverifiable Materials

- Implementation diff for commands/dashboard.ts and http/static-serving.ts: diff_available: false. Cannot confirm the D2 constraints (Path=/api cookie left unwidened, client-side /api/auth/me probe, single collapsed 410 shape, updated module header) or the required // reason…
- Test sources for dashboard-command.bun.test.ts and static-serving.bun.test.ts: tests_touched: false and no test bodies provided; the RED tests' assertion strength (e.g. that AC-F5A-10 truly checks Content-Type, relaunch text, the probe, and non-JSON) is taken on the task descri…
- Post-fix runs of AC-F5A-1, AC-F5A-2, AC-F5A-3, AC-F5A-4, AC-F5A-5, AC-F5A-6, AC-F5A-7, AC-F5A-8: All show 0 pass / 0 fail in the coverage table; no oracle output for them appears in the bundle.
- Matched-test count for the AC-F5A-10 oracle: The single attested tail is clipped before the summary line, and the -t filter would exit 0 even on zero matches.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 10 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.22
