---
id: KN-351
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-080 bootstrap injection projection (interface-first) (2026-07-29)"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-032
links:
  - {id: PLAN-032, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01KYEGRSFZR1XTNV3ZFSB0392W`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-080-1 | 86 | 7 attested passes of the named vitest file, matched-count visible (Test Files 1 passed). Gap: run-to-run test counts differ (13 in T2/T7 tails vs 14 in orchestrator sweeps) with no explanation of the added test; per-scenario names not shown, so cap/boundary coverage is inferred. | 01KYEGRVHB2ZF0PXCBAPBGB1V5 (T1 RED then GREEN 14 tests), 01KYEGRW1JT0JH7AMA2ADN0FE9 (T2 GREEN 13 tests) |
| AC-080-2 | 76 | session-service suite green in 7 attested runs. T5 shows the intended 7→8 growth, but orchestrator sweeps report 14 tests in the same file — 6 unexplained tests. Extend-only/frozen-block claim rests on a git diff --stat assertion never shown; no diff in materials. | 01KYEGRXJSQ8AYSSDFBGHP9D1Q (T5 BEFORE 7 / AFTER 8), 01KYEGRY40MBBFG08EJMFX0QAA (sweep shows 14 tests) |
| AC-080-4 | 88 | embed-assets-manifest --check exits 0 in 7 attested runs including post-`bun run build` in T7. Minor gap: two divergent manifest states (292 files vs 302 files, different tree digests) across runs, unexplained; backstop branch verified only by ad-hoc /tmp smoke script. | 01KYEGRX29KJE94D5VJ68KTZ7K (T4 hook edit + --check OK 292 files), 01KYEGRYMF2DSECM56VKZH5BNF (T7 build then --check exit 0) |
| AC-080-5 | 80 | One recorded fail (T2: TS2305 outlineEntrySchema etc.), attributed to a different plan's RED fixture and backed only by a scoped core-only tsc. 7 later attested full `bun run typecheck` passes supersede it; tails are truncated mid-command so exit 0 is asserted, not shown. | 01KYEGRW1JT0JH7AMA2ADN0FE9 (fail + scoped pass), 01KYEGRYMF2DSECM56VKZH5BNF (T7 typecheck pass) |
| AC-080-3 | 62 | Contradiction in the regression pin: most attested tails name the test 'exactly the literal 10-key BootstrapReport set' while AC-080-3 and Invariant 1 pin a 9-key set; only T7's autopilot runs say 9-key. Unresolved key-count divergence on the byte-identical-shape invariant. | 01KYEGRY40MBBFG08EJMFX0QAA (T6 5 pass / 31 expects), 01KYEGRYMF2DSECM56VKZH5BNF (T7 tail says 9-key) |
| AC-080-6 | 78 | Same e2e file attested 7x; T6 reports 5 pass / 0 fail / 31 expect calls, satisfying the >0-matched requirement. Gap: every tail truncates after the first two test names, so the knob-threading assertions (1 plan/1 handoff/1 slug/2000 budget) are never directly visible. | 01KYEGRY40MBBFG08EJMFX0QAA (T6 5 pass, 31 expects), 01KYEGRWJ01HKJ9B9FY39JM72S (T3 manual knob smoke) |

## Gaps

- The plain `--json` regression pin is described as 'exactly the literal 10-key BootstrapReport set' in the T1-T6 attested tails and as a 9-key set in T7's autopilot tails. AC-080-3 and Invariant 1 both pin 9 keys (root, active_plans, pending_reviews, my_claims, armed_gates, latest_handoffs, resume_hint, corpus, active_sessions). Either the report shape gained a key (Invariant 1 violation) or the test title is stale; the materials never resolve which, and the shape-stability invariant is the spec…
- Attested runs reflect at least two different repo states: core unit suite reports 13 tests (T2, T7) and 14 tests (all orchestrator sweeps); session-service reports 8 tests (T5, T7) and 14 tests (sweeps); the assets manifest reports 292 files / digest b5a685… and 302 files / digest 080565…. Without an ordering or explanation it is unclear which state the final green sweep describes.
- No diff is available (diff_available: false, tests_touched: false), so Invariants 2-5 — trimming math confined to packages/core/src/session.ts, SPEC-057 frozen describe blocks byte-untouched, zero new runtime deps, hook free of projection field names — cannot be checked against anything but the ACs' own prose.
- T2 recorded a real `bun run typecheck` failure; the mitigation is a scoped `tsc -p packages/core` pass plus a self-reported attribution to a different plan's RED fixture (commit 944ee8b). Later full-monorepo passes are attested, so the AC is met, but the exculpation itself was never independently oracled.

## Recommendations

- Require evidence tails to include the assertion-bearing lines (full key list, knob values) rather than the first ~400 chars of runner output; truncation currently hides exactly the content the AC is about.
- Add the git-diff-based invariant oracles (frozen-block scope, grep for trimming math outside core/session.ts, dependency delta) as recorded evidence entries, not just as AC bullet text.
- When a suite's test count changes between attested runs, require a one-line note stating why (co-tenant plan, added fixture) in the evidence record.
- Restate the BootstrapReport key list in one canonical place referenced by both the test title and AC-080-3 so a count mismatch fails mechanically instead of surviving in a test name.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 77297ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.7 | evidence | All 6 ACs have 7 attested passes and the compiled-binary e2e ran with 5 executed tests, but the 9- vs 10-key regression pin contradicts Invariant 1 and stays unresolved. |
| evidence_integrity | 74 | 0.75 | evidence | 0.74 attested ratio, multi-oracle coverage per task; weakened by truncated tails, divergent suite/manifest states across runs, and key manual claims (backstop, strict-flags) self-reported only. |
| scope_fidelity | 72 | low | absence | No diff provided; extend-only, single-trim-site, no-new-dep and hook-blindness invariants are only asserted in AC text. Unexplained +6 tests in session-service.test.ts is an open drift signal. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-080-3 | The plain `--json` regression pin is described as 'exactly the literal 10-key BootstrapReport set' in the T1-T6 attested tails and as a 9-key set in T7's autopilot tails. AC-080-3 and Invariant 1 both pin 9 keys (root, active_plans, pending_reviews, my_claims, armed_gates, latest_handoffs, resume_hint, corpus, active_sessions). Either the report shape gained a key (Invariant 1 violation) or the test title is stale; the materials never resolve which, and the shape-stability invariant is the spec… |
| evidence_integrity | major | — | Attested runs reflect at least two different repo states: core unit suite reports 13 tests (T2, T7) and 14 tests (all orchestrator sweeps); session-service reports 8 tests (T5, T7) and 14 tests (sweeps); the assets manifest reports 292 files / digest b5a685… and 302 files / digest 080565…. Without an ordering or explanation it is unclear which state the final green sweep describes. |
| scope_fidelity | minor | — | No diff is available (diff_available: false, tests_touched: false), so Invariants 2-5 — trimming math confined to packages/core/src/session.ts, SPEC-057 frozen describe blocks byte-untouched, zero new runtime deps, hook free of projection field names — cannot be checked against anything but the ACs' own prose. |
| evidence_integrity | minor | AC-080-5 | T2 recorded a real `bun run typecheck` failure; the mitigation is a scoped `tsc -p packages/core` pass plus a self-reported attribution to a different plan's RED fixture (commit 944ee8b). Later full-monorepo passes are attested, so the AC is met, but the exculpation itself was never independently oracled. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require evidence tails to include the assertion-bearing lines (full key list, knob values) rather than the first ~400 chars of runner output; truncation currently hides exactly the content the AC is about. | AC-080-3 and AC-080-6 are both pinned in the same e2e file whose tails cut off before the relevant tests. |
| plan | Add the git-diff-based invariant oracles (frozen-block scope, grep for trimming math outside core/session.ts, dependency delta) as recorded evidence entries, not just as AC bullet text. | Four of five invariants are currently unverifiable from the bundle. |
| process | When a suite's test count changes between attested runs, require a one-line note stating why (co-tenant plan, added fixture) in the evidence record. | 13-vs-14 and 8-vs-14 deltas are indistinguishable from scope drift here. |
| spec | Restate the BootstrapReport key list in one canonical place referenced by both the test title and AC-080-3 so a count mismatch fails mechanically instead of surviving in a test name. | The 9/10-key divergence survived seven attested runs undetected. |

## Unverifiable Materials

- Implementation diff (packages/core/src/session.ts, config.ts, CLI bootstrap.ts, assets/hooks/session-start-resume.mjs): diff_available: false — no source shown, so invariants 2-5 and the actual key list are judged only from evidence tails.
- git diff --stat for session-service.test.ts (extend-only proof for Invariant 3 / T5 AC): Asserted in the AC but never recorded as evidence; frozen SPEC-057 blocks cannot be confirmed byte-untouched.
- Full e2e output for AC-080-6 knob assertions: All tails truncate after the first two test names; only aggregate 5 pass / 31 expect calls is visible.
- T4 backstop smoke script (/tmp/backstop-smoke.mjs) and T3 strict-flags exit-2 smoke: Self-reported manual oracles on throwaway artifacts; not reproducible from the bundle.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 7 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.74
