---
id: KN-252
type: knowledge
role: knowledge
title: "Assessment: Implementation — resume-ticket coverage floor: blocking channel, arming provenance, cross-turn idempotence (2026-08-01)"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-086
links:
  - {id: PLAN-086, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01KYXK8227XPEKC4CKMPTEJDPG`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-RCH-1 | 88 | Filtered vitest run attested by main-orchestrator on the main checkout (cwd /Users/apple/Projects/zz/lore), 4 passed / 36 skipped, 'Test Files 1 passed (1)' present as the AC requires. Assertion bodies (SET-EQUALity, single JSON object) unverifiable — no diff or test source in bundle. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [1] worktree, [10] main-attested) |
| AC-RCH-2 | 88 | Attested main-checkout run passes; tail names the round-trip test 'the reason carries exactly one marker line per missing id, each dispositioning THAT id and no other', and matched file count is 1. Identity-vs-literal assertion and the zero-hit source search cannot be inspected. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [2], [11]) |
| AC-RCH-3 | 86 | Attested run passes with 2 tests (block relay + no-grammar control) and 'Test Files 1 passed (1)'. That the hook asset is genuinely unmodified is asserted only by the plan/task prose; no diff to confirm assets/hooks/stop-handoff-coverage.mjs was untouched. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [3], [12]) |
| AC-RCH-4 | 88 | Attested main-checkout filtered run passes, 4 tests, exactly 1 matched file. Positive control (tool_use_id-paired feed call → block) presence is claimed by the task doc and consistent with the 4-test count, but not directly readable. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [4], [13]) |
| AC-RCH-5 | 88 | Attested run passes 12 tests / 1 matched file, consistent with the enumerated fixture array (5 arming shapes, cat/grep negatives, D10 exemption guard). Per-fixture outcomes not visible in the tail. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [5], [14]) |
| AC-RCH-6 | 88 | Attested main-checkout run passes, 4 tests, 1 matched file. Positive+control halves implied by count; SET-EQUALity of the remainder id set not observable from the tail. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [6], [15]) |
| AC-RCH-7 | 55 | Attested command matches the AC, but the recorded output_tail shows tests named 'AC-RC-4: the coverage-floor grammar reaches BOTH shipping render surfaces (D8, D10)' — a different spec's criterion — and no matched-file count. Nothing in the captured output demonstrates hook exit 0 + block-decision … | task-t3-compiled-consumer-path-oracle (evidence [2] attested, tail content mismatched to AC-RCH-7) |
| AC-RCH-8 | 90 | Attested run passes and the tail explicitly names the criterion test: 'all five payload classes terminate with the IDENTICAL status, and only stdout tells them apart', with 'Test Files 1 passed (1)'. Strongest directly-readable evidence in the bundle. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [7], [16]) |

## Gaps

- The attested evidence for AC-RCH-7 records the correct command but an output_tail from unrelated tests ('AC-RC-4: the coverage-floor grammar reaches BOTH shipping render surfaces of the compiled binary (D8, D10)'). No line in the captured output shows hook exit 0 with a block-decision stdout, the empty-stdout complete-accounting half, or a matched-test-file count. The consumer-visible compiled path — the spec's actual delivery claim — is therefore not demonstrated by the recorded evidence.
- diff_available=false and tests_touched=false. The T1 implementation of all three behaviour changes is invisible to this audit; H3's 'no hand-typed marker literal', H4's tool_use_id pairing, and the preserved SPEC-112 D10 exemption are only asserted via test names, and the no-asset-edit / no-manifest-regeneration rollout claim is unverified.
- T1 carries 0 attested and 2 self-reported oracle records (typecheck, test:changed). The plan's own guidance treats self-report as insufficient for the implementer; the plan-mandated clean-tree full-suite run on main and the --force cache-bypassing re-run are both absent.
- No knowledge doc captured (0 linked) despite the plan explicitly carrying a deliberate residual risk — no CI oracle can prove the block channel produces compliance (n=1 control arm, session 2f45e6d9) — plus the stale-dist/lore false-oracle vector. The confirming observation on the first real consumed ticket has no recorded home.

## Recommendations

- Reject an evidence record whose output_tail test names do not mention the AC it claims to satisfy; require the attesting recorder to paste the tail containing the AC-named test plus the 'Test Files N' line.
- Require the implementation diff in the audit bundle whenever an AC asserts a source-level property (e.g. AC-RCH-2's zero-hit search for a hand-typed literal) or a not-edited property (unmodified hook asset).
- Make the plan's stated verification gates (clean-tree full suite on main, --force turbo re-run, verified fresh dist/lore build) recorded evidence records rather than prose notes.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 72023ms
- Retried: false
- Truncated sections: task:task-t1-coverage-check-verb-block-channel-verdict-arming
- Reasoning clipped for: AC-RCH-7
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.7 | evidence | 7 of 8 ACs have attested main-checkout passes with the required 1-matched-file line; the compiled consumer-path AC (RCH-7) is the delivery claim and its captured output does not show it. |
| evidence_integrity | 62 | 0.75 | evidence | Independent T2/T3 authorship and main-checkout re-runs are good, but the AC-RCH-7 tail names another spec's tests, T1 is 0/2 attested, ratio 0.40, and no diff exists to cross-check. |
| scope_fidelity | 80 | low | absence | Task anchors are disjoint as planned and no extra files are claimed, but with no diff the binary-only scope (no asset/manifest edit) rests on prose alone. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-RCH-7 | The attested evidence for AC-RCH-7 records the correct command but an output_tail from unrelated tests ('AC-RC-4: the coverage-floor grammar reaches BOTH shipping render surfaces of the compiled binary (D8, D10)'). No line in the captured output shows hook exit 0 with a block-decision stdout, the empty-stdout complete-accounting half, or a matched-test-file count. The consumer-visible compiled path — the spec's actual delivery claim — is therefore not demonstrated by the recorded evidence. |
| evidence_integrity | major | — | diff_available=false and tests_touched=false. The T1 implementation of all three behaviour changes is invisible to this audit; H3's 'no hand-typed marker literal', H4's tool_use_id pairing, and the preserved SPEC-112 D10 exemption are only asserted via test names, and the no-asset-edit / no-manifest-regeneration rollout claim is unverified. |
| evidence_integrity | minor | — | T1 carries 0 attested and 2 self-reported oracle records (typecheck, test:changed). The plan's own guidance treats self-report as insufficient for the implementer; the plan-mandated clean-tree full-suite run on main and the --force cache-bypassing re-run are both absent. |
| outcome | minor | — | No knowledge doc captured (0 linked) despite the plan explicitly carrying a deliberate residual risk — no CI oracle can prove the block channel produces compliance (n=1 control arm, session 2f45e6d9) — plus the stale-dist/lore false-oracle vector. The confirming observation on the first real consumed ticket has no recorded home. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Reject an evidence record whose output_tail test names do not mention the AC it claims to satisfy; require the attesting recorder to paste the tail containing the AC-named test plus the 'Test Files N' line. | AC-RCH-7's attested tail shows AC-RC-4 tests, so the strongest-stated criterion is unevidenced despite a pass marker. |
| process | Require the implementation diff in the audit bundle whenever an AC asserts a source-level property (e.g. AC-RCH-2's zero-hit search for a hand-typed literal) or a not-edited property (unmodified hook asset). | Source-level and negative-edit claims cannot be judged from test exit codes alone. |
| plan | Make the plan's stated verification gates (clean-tree full suite on main, --force turbo re-run, verified fresh dist/lore build) recorded evidence records rather than prose notes. | The plan names these as the anti-false-oracle controls, yet none appear in the evidence trail. |

## Unverifiable Materials

- T1 diff to packages/lore/src/adapters/cli/commands/handoff.ts and packages/core/src/session.ts: diff_available=false; no implementation source in bundle, so block-channel, reason-template, arming and cross-turn logic are unreadable.
- packages/lore/tests/unit/handoff-coverage-check.test.ts source: Only run summaries provided; SET-EQUALity, identity-vs-literal, and control-arm assertions inferred from test counts and names.
- AC-RCH-7 compiled-path assertion output: Attested tail shows unrelated AC-RC-4 tests and no matched-file count; hook exit/stdout behaviour on dist/lore not observable.
- Proof that assets/hooks/stop-handoff-coverage.mjs and the assets manifest were unmodified: No diff or git status output; the binary-only rollout claim rests on plan and task prose.
- Clean-tree full suite run on main and --force cache-bypassing re-run: Required by the plan's verification notes; no corresponding evidence record exists.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.40
