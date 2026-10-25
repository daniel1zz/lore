---
id: KN-163
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-080 bootstrap injection projection (interface-first) (2026-07-26)"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-10-23
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
| AC-080-1 | 90 | Strict RED (T1: 13 failures, all missing-export, zero test bugs) then GREEN (T2: 13/13) plus an attested T7 sweep re-run of the same vitest file. Scenario list in T1 matches the AC's boundary/OCP/strip-hazard enumeration. Test file content itself unverifiable (no diff). | task-skill-test-t1-buildbootstrapinjection-red-unit-suite (RED verified, 13 failed), task-skill-implement-t2-core-projection-fn-injection-schema (13 passed), task-skill-verify-t7-attested-sweep-spec-anchors-live-smoke (attested re-run) |
| AC-080-2 | 74 | T5 shows 7→8 tests (frozen baseline green + one new fixture), attested again in T7 (8 passed). But T5's second AC — git diff --stat proving no hunks intersect SPEC-057 frozen ranges (Invariant 3) — has NO evidence record, and diff_available=false, so extend-only is asserted, not shown. | task-skill-test-t5-session-service-omitted-plan-fixture-extend (BEFORE 7 / AFTER 8), task-skill-verify-t7-attested-sweep-spec-anchors-live-smoke (attested 8 passed) |
| AC-080-4 | 84 | embed-assets-manifest --check exit 0 recorded three times incl. attested post-build run (292 files, tree_digest). Backstop smoke documented with concrete numbers (13033 chars vs 12000 cap). The grep oracle 'no projection field names in Phase E' is claimed but never evidenced. | task-skill-implement-t4-session-start-hook-blind-pipe-backstop (manifest OK + backstop smoke), task-skill-verify-t7-attested-sweep-spec-anchors-live-smoke (post-build --check attested) |
| AC-080-5 | 64 | Recorded fail at T2 (full typecheck red on outline-schemas TS2305/TS7006), attributed to a different plan's RED fixture — but the cited commit 944ee8b is itself labelled '(SPEC-080)', so the 'unrelated' attribution is self-asserted and contradicts its own commit message. Later T7 attested exit 0. | task-skill-implement-t2-core-projection-fn-injection-schema (typecheck fail + scoped pass), task-skill-implement-t3-cli-injection-flag-config-threading (scoped tsc only, full run red), task-skill-verify-t7-attested-sweep-spec-anchors-live-smoke (bun run typecheck exit 0) |
| AC-080-3 | 86 | T6 compiled e2e: 5 pass / 0 fail / 31 expects, twice; attested in T7. Visible output names the contract-key-order test and the 9-key --json regression pin. Output tails are clipped mid-line, so the literal key lists are not directly observable in evidence. | task-skill-test-t6-compiled-binary-e2e-injection-knobs-json-pin (5 pass, 31 expects), task-skill-verify-t7-attested-sweep-spec-anchors-live-smoke (attested e2e) |
| AC-080-6 | 78 | Same e2e file carries the knob scenario; suite green (5/5) and attested. But every visible output tail is truncated before the knob test line, so the four non-default values (1/1/1/2000) reaching the payload are inferred from the suite total, not read. T3 manual smoke corroborates partially. | task-skill-test-t6-compiled-binary-e2e-injection-knobs-json-pin (knob scenario declared, count 5), task-skill-implement-t3-cli-injection-flag-config-threading (max_active_plans=1 / char_budget=50 smoke) |

## Gaps

- Invariant 3 (SPEC-057 frozen describe blocks byte-untouched) is claimed extend-only but has no diff evidence: diff_available=false and T5 recorded no git-diff oracle, only the vitest run. The 7→8 test delta is consistent with an appended block but does not exclude edits inside frozen ranges.
- AC-080-5 has a recorded fail whose dismissal is internally inconsistent: T2 attributes the outline-schemas TS2305/TS7006 errors to 'a DIFFERENT task/plan's RED fixture' while quoting the commit message 'test(outline): T1r RED scenarios for core outline schemas (SPEC-080)'. T3 then downgraded to a scoped tsc for the same reason. The later green typecheck is credible but the intervening red period is unexplained.
- Every e2e output_tail in T6 and T7 is truncated before the knob (AC-080-6) and strict-flags typo scenarios; only the first two of five test names are observable. The knob assertions are inferred from '5 pass / 0 fail', not read.
- T3's two manual evidence records carry no output_tail at all — the command string doubles as the result claim. For the CLI surface (the hook's consumption seam) this is the weakest link in an otherwise instrumented chain.
- The hook grep oracle in T4's AC ('none of resume_hint/active_plans/omitted appear in Phase E code', Invariant 5) was never run as recorded evidence; only the manifest check and a backstop smoke are present.

## Recommendations

- Make diff attachment mandatory for assessment bundles whose plan declares diff-scope invariants (extend-only fixtures, single-site logic constraints). Without it, those invariants are unscorable and default to conservative marks.
- Promote grep/diff invariant oracles (Invariant 2's charBudget grep, Invariant 3's git diff --stat, Invariant 5's Phase E field-name grep) from AC prose bullets into recorded evidence entries with captured output.
- Reject manual-oracle evidence with an empty output_tail; require the observed stdout/exit code verbatim, especially for CLI smoke on throwaway corpora.
- When a task records a fail attributed to unrelated work, require the attribution to be corroborated (commit spec tag, plan id, or file-anchor set) rather than narrated in output_tail.
- Have the verify skill store full runner output (or at minimum every test-name line) for e2e files whose ACs map to individual scenarios, instead of a fixed-length tail clip.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 74320ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.72 | evidence | All 6 script ACs have attested passes from the T7 sweep; RED→GREEN discipline visible on the core fn. Knob and hook-grep specifics rest on aggregate counts rather than shown output. |
| evidence_integrity | 68 | 0.75 | evidence | Rich oracle mix but 0.29 attested ratio, all attestation from one orchestrator; clipped tails, empty output_tail on T3 manual records, and a self-contradictory explanation for the typecheck fail. |
| scope_fidelity | 72 | low | absence | No diff, so extend-only and single-trimming-site invariants are unverifiable; a SPEC-080-tagged commit disowned as another plan's work is an unexplained boundary blur. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | AC-080-2 | Invariant 3 (SPEC-057 frozen describe blocks byte-untouched) is claimed extend-only but has no diff evidence: diff_available=false and T5 recorded no git-diff oracle, only the vitest run. The 7→8 test delta is consistent with an appended block but does not exclude edits inside frozen ranges. |
| evidence_integrity | major | AC-080-5 | AC-080-5 has a recorded fail whose dismissal is internally inconsistent: T2 attributes the outline-schemas TS2305/TS7006 errors to 'a DIFFERENT task/plan's RED fixture' while quoting the commit message 'test(outline): T1r RED scenarios for core outline schemas (SPEC-080)'. T3 then downgraded to a scoped tsc for the same reason. The later green typecheck is credible but the intervening red period is unexplained. |
| evidence_integrity | minor | AC-080-6 | Every e2e output_tail in T6 and T7 is truncated before the knob (AC-080-6) and strict-flags typo scenarios; only the first two of five test names are observable. The knob assertions are inferred from '5 pass / 0 fail', not read. |
| evidence_integrity | minor | AC-080-3 | T3's two manual evidence records carry no output_tail at all — the command string doubles as the result claim. For the CLI surface (the hook's consumption seam) this is the weakest link in an otherwise instrumented chain. |
| outcome | minor | AC-080-4 | The hook grep oracle in T4's AC ('none of resume_hint/active_plans/omitted appear in Phase E code', Invariant 5) was never run as recorded evidence; only the manifest check and a backstop smoke are present. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Make diff attachment mandatory for assessment bundles whose plan declares diff-scope invariants (extend-only fixtures, single-site logic constraints). Without it, those invariants are unscorable and default to conservative marks. | Four of five SPEC-080 invariants were unverifiable purely because diff_available=false. |
| plan | Promote grep/diff invariant oracles (Invariant 2's charBudget grep, Invariant 3's git diff --stat, Invariant 5's Phase E field-name grep) from AC prose bullets into recorded evidence entries with captured output. | All three were written as ACs but none produced an evidence record. |
| process | Reject manual-oracle evidence with an empty output_tail; require the observed stdout/exit code verbatim, especially for CLI smoke on throwaway corpora. | T3's two manual records assert their own outcome with nothing observable. |
| process | When a task records a fail attributed to unrelated work, require the attribution to be corroborated (commit spec tag, plan id, or file-anchor set) rather than narrated in output_tail. | The 944ee8b explanation contradicts its own SPEC-080 commit tag. |
| skill | Have the verify skill store full runner output (or at minimum every test-name line) for e2e files whose ACs map to individual scenarios, instead of a fixed-length tail clip. | AC-080-6's knob assertions were clipped out of all three e2e evidence records. |

## Unverifiable Materials

- Implementation diff (packages/core/src/session.ts, config.ts, CLI bootstrap.ts, assets/hooks/session-start-resume.mjs): diff_available=false; no source shown, so Invariants 2, 4 and 5 and the byte-untouched bootstrapReportSchema claim cannot be checked.
- git diff --stat for packages/lore/tests/unit/service/session-service.test.ts: T5's extend-only AC produced no evidence record; frozen SPEC-057 describe-block integrity is asserted only.
- Full bun test output for tests/e2e/bootstrap-injection-compiled.bun.test.ts: All tails clipped after two of five test names; knob (AC-080-6) and strict-flags typo scenarios not observable.
- Commit 944ee8b and its owning plan: Cited to excuse the AC-080-5 typecheck fail but tagged (SPEC-080) in its own message; no independent confirmation it belongs to another plan.
- Full `bun run test` transcript on main: Summarized in one output_tail including 4 timeouts and unshown serial reruns; the green claim rests on the orchestrator's narration.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 7 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.29
