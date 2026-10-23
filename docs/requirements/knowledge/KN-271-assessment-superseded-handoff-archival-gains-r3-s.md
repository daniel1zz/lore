---
id: KN-271
type: knowledge
role: knowledge
title: "Assessment: Superseded-handoff archival gains R3's recency guard (2026-07-31)"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-10-23
tags: []
parent: PLAN-093
links:
  - {id: PLAN-093, type: informs}
---
# Assessment: partially_met (79/100)

Scope: plan `01KYW74K7HGG32HBMGR7TA3AJS`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-R2-1 | 78 | Attested pass with output tail (Tests 2 passed \| 9 skipped), so the -t filter matched non-zero tests. But the plan makes this AC load-bearing via RED-first: no failing run against unmodified code is recorded, and no diff/test source is shown, so the negative half cannot be confirmed as discriminati… | task-t1-r2-superseded-handoff-recency-guard-ac-r2-1-4 (evidence [1] self-reported, [7] attested with output tail) |
| AC-R2-2 | 82 | Attested pass with tail (Tests 1 passed \| 10 skipped) for the superseded-doc-age title. Guards the D2 inversion risk. Unverifiable that the test actually pairs an OLD superseded doc with a FRESH superseding one, since neither diff nor test body is provided. | task-t1-r2-superseded-handoff-recency-guard-ac-r2-1-4 (evidence [2], [8]) |
| AC-R2-3 | 82 | Attested pass with tail (1 passed \| 10 skipped) for 'R2 stays distinct from R3'. Covers the collapse risk. The AC's specific assertions (rule superseded_handoff, reason naming supersession, R2 precedence) are opaque from a green tally alone. | task-t1-r2-superseded-handoff-recency-guard-ac-r2-1-4 (evidence [3], [9]) |
| AC-R2-4 | 88 | Strongest AC: attested full-suite run shows 22 passed / 22, no filter, no hardcoded total — pre-existing expired_handoff and done_plan_straggler rules demonstrably intact. Supported by attested typecheck and test:changed at [5],[6] (self-reported). | task-t1-r2-superseded-handoff-recency-guard-ac-r2-1-4 (evidence [4], [10]) |

## Gaps

- No diff in the bundle. The guard in packages/core/src/archive-candidates.ts is unreviewable, so the D2 inversion risk the plan itself flags as silent is checked only by a test whose body is also unavailable.
- The plan binds AC-R2-1 to RED-first (must fail against unmodified code, since today R2 flags regardless of age), but the evidence trail contains only passes. Without a recorded failure the negative assertion is not shown to be load-bearing.
- Every recency-file run shows 9-10 of 11 tests skipped and the file is never run unfiltered, so it is unknown whether any test is skipped by mistake rather than by -t filtering.
- AC-R2-3 demands specific attribution (rule=superseded_handoff, reason naming supersession, R2 precedence over R3). A green tally cannot show which assertions the test makes.
- Regression signals report tests_touched=false although the plan adds packages/core/tests/unit/archive-candidates-recency.test.ts; the discrepancy is unresolvable without the diff.

## Recommendations

- Require the implementation diff in the audit bundle whenever a spec's stated risk is a silent inversion; a green filtered test cannot distinguish the correct comparison from the inverted one.
- Make RED-first auditable: record the pre-fix failing run as an evidence entry (result=fail) instead of only stating the discipline in the task doc.
- Add an unfiltered run of the new recency test file as an extra oracle command alongside the three -t filtered runs.
- Attest the typecheck and test:changed runs, raising attested_evidence_ratio above 0.40.
- Capture a knowledge doc recording the R2/R3 asymmetry and the superseded-vs-superseding age rule.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 52722ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-R2-1

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.7 | evidence | All four ACs have attested passes with output tails and non-zero test counts; full pre-existing suite green at 22/22. Guard behaviour itself inferred from titles, not inspected. |
| evidence_integrity | 71 | low | absence | 4 attested oracle runs with tails are credible, but no diff, no RED record, 9-10 skipped tests never explained, and 2 of 6 orchestrator-relevant runs self-reported only. |
| scope_fidelity | 80 | low | absence | Single-phase, single-task plan; commands touch only the two declared anchors. Cannot confirm no drift (e.g. the forbidden assets-manifest.ts) without a diff. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | No diff in the bundle. The guard in packages/core/src/archive-candidates.ts is unreviewable, so the D2 inversion risk the plan itself flags as silent is checked only by a test whose body is also unavailable. |
| evidence_integrity | major | AC-R2-1 | The plan binds AC-R2-1 to RED-first (must fail against unmodified code, since today R2 flags regardless of age), but the evidence trail contains only passes. Without a recorded failure the negative assertion is not shown to be load-bearing. |
| evidence_integrity | minor | — | Every recency-file run shows 9-10 of 11 tests skipped and the file is never run unfiltered, so it is unknown whether any test is skipped by mistake rather than by -t filtering. |
| outcome | minor | AC-R2-3 | AC-R2-3 demands specific attribution (rule=superseded_handoff, reason naming supersession, R2 precedence over R3). A green tally cannot show which assertions the test makes. |
| scope_fidelity | minor | — | Regression signals report tests_touched=false although the plan adds packages/core/tests/unit/archive-candidates-recency.test.ts; the discrepancy is unresolvable without the diff. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require the implementation diff in the audit bundle whenever a spec's stated risk is a silent inversion; a green filtered test cannot distinguish the correct comparison from the inverted one. | Plan names comparison inversion as the primary risk yet supplies no material that would reveal it. |
| process | Make RED-first auditable: record the pre-fix failing run as an evidence entry (result=fail) instead of only stating the discipline in the task doc. | AC-R2-1 is declared the whole measurement; its discriminating power is currently unverifiable. |
| plan | Add an unfiltered run of the new recency test file as an extra oracle command alongside the three -t filtered runs. | Closes the 9-10 skipped-test blind spot and guards against a mis-titled or accidentally skipped case. |
| process | Attest the typecheck and test:changed runs, raising attested_evidence_ratio above 0.40. | Cross-cutting oracles currently rest on the implementing agent's own report. |
| plan | Capture a knowledge doc recording the R2/R3 asymmetry and the superseded-vs-superseding age rule. | 0 linked knowledge docs; both traps are non-obvious and recurrence-prone. |

## Unverifiable Materials

- Implementation diff for packages/core/src/archive-candidates.ts: diff_available=false; no diff section in the bundle, so the guard's comparison direction and placement relative to R3 cannot be inspected.
- Source of packages/core/tests/unit/archive-candidates-recency.test.ts: Not provided; assertions behind the three passing titles, and the reason for 9-10 skipped tests, are unknown.
- RED-first failing run for AC-R2-1 against unmodified code: No evidence record with result=fail exists anywhere in the trail.
- Output tails for evidence [5] test:changed and [6] typecheck: Self-reported by the implementing agent with no attested re-run or captured output.

## Rubric Warnings

- Dimension "evidence_integrity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.
- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 4 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.40

## Orchestrator correction (post-hoc, measured 2026-07-31 · agent:main-orchestrator)

Appended after the judgment was saved. The judge reports `diff_available=false`; all
three `evidence_integrity` findings follow from that blind spot. The judgment is left
intact above; each finding is dispositioned below against a measurement, with the two
that are NOT independent re-measurements labelled as such.

**`evidence_integrity: major` — "the guard is unreviewable, so the D2 inversion risk is
checked only by a test whose body is also unavailable." REFUTED by direct inspection of
the merged source** (`packages/core/src/archive-candidates.ts`):

- `:210` — `const ageMinutes = getAgeMinutes(nowIso, info.doc.created_at)`. It reads
  `info`, the **superseded** doc. `newest` appears only at `:199`, where it is used to
  pick the group's newest member. The D2 inversion is absent.
- `:212` — `if (ageMinutes <= ttl.handoffTtlMinutes) continue;` — strict `>` semantics,
  the same threshold R3 uses at `:235-236`, via one shared `getAgeMinutes` helper
  (`:106`). No second knob was introduced (D1).
- `:218` — `supersededIds.add` sits AFTER the guard's `continue`, so the set keeps
  meaning "already reported" and R3's skip list stays correct (D3).
- The module header carries the invariant explicitly (`:34-36`): both handoff rules gate
  on the same `handoffTtlMinutes` against the CANDIDATE doc's own `created_at`, one
  derivation site.

**`evidence_integrity: minor` — "9-10 of 11 tests skipped, file never run unfiltered."
REFUTED by re-running it unfiltered here:** `bunx vitest run
packages/core/tests/unit/archive-candidates-recency.test.ts` → exit 0,
`Test Files 1 passed (1)`, `Tests 11 passed (11)`, zero skipped. The skipped counts in
the AC evidence were purely `-t` filtering; no case is skipped by mistake.

**`evidence_integrity: major` on AC-R2-1 — "RED-first is bound by the plan but the
evidence trail contains only passes." STANDS as a record-keeping gap; the underlying
claim is sound but this is NOT an independent re-measurement.** Two grounds, labelled:

1. *Logical certainty from code read first-hand.* The pre-fix R2 loop was read and
   quoted into the governing spec before any change: it grouped by
   `[parent_id, by]` and flagged every non-newest member with **no age condition and no
   plan condition of any kind**. A test asserting "a young superseded handoff yields
   ZERO candidates" cannot pass against a rule that has no age condition.
2. *Implementer measurement, self-reported:* exit 1, `Tests 2 failed | 9 skipped (11)`,
   `AssertionError: expected [ { …(4) } ] to deeply equal []`.

The real defect the finding names is that `lore evidence` recorded only passing runs, so
the red is not in the corpus. That is a general gap in how RED-first is captured, not
specific to this task — the same gap the SL assessment raised about AC-SL-7's negative
control. Worth mechanizing (an evidence row whose expected result is `fail`), and out of
scope for a closed plan.

## End-to-end confirmation on the motivating scenario (not in the judged bundle)

The bundle contained no runtime check against the situation that prompted the fix.
Measured after the merge, on a freshly rebuilt binary (`dist/lore`, which `which lore`
resolves to via symlink — so the running command carries the change):

`lore archive --sweep` → **"No archive candidates."**

Before the fix, the same command proposed archiving
`knowledge-handoff-agent-main-orchestrator-50` — a concurrently-running session's live
ticket, 232 minutes old against a 10080-minute TTL. Both that handoff and this session's
own are now protected by the age guard, which is exactly the intended behaviour.

**CORRECTION (same session, after a verification pass): the capability was NOT missing —
the discipline was.** The paragraph above proposed mechanizing "an evidence row whose
expected result is fail". Before building it, this repo's own standing rule was applied —
*a twice-recommended mechanization triggers a VERIFICATION pass first, not a build pass* —
and it refuted the proposal:

`lore evidence --result` already accepts **`pass | fail | expected-fail`**, with
`expected-fail` purpose-built for exactly the RED-first case (governing work:
`task-m1-evidence-result-vocabulary-expected-fail-ac-wh-1`, "evidence RED vocabulary";
the CLI even renders a distinct `⚑R` marker for it). The corpus already holds 146
`result=fail` rows out of 3067.

So the real root cause is upstream of lore: **the dispatch bundles said "RED FIRST … capture
that output" and never told the implementer to record it with `--result expected-fail`.**
Every bundle in this session omitted that instruction, so every red landed in a subagent
transcript that is discarded instead of in the corpus. The fix belongs in the dispatch
template, not in the tool.

Left in place rather than deleted so the near-miss is legible: without the verification
pass, this session would have recorded a corpus claim that lore lacks a capability it
shipped.
