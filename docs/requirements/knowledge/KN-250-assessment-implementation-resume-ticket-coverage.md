---
id: KN-250
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
# Assessment: met (86/100)

Scope: plan `01KYXK8227XPEKC4CKMPTEJDPG`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-RCH-1 | 90 | Two passing script runs (1 attested by main-orchestrator on main checkout), Test Files 1 confirmed in output tail. Diff shows exit-status verdict removed and stdout JSON block written with per-id stderr lines retained. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [1] and [10], Test Files 1 passed), task-t1-coverage-check-verb-block-channel-verdict-arming (diff: process.exitCode=1 removed, stdout.write of decision) |
| AC-RCH-2 | 88 | Attested pass; named subtest visible in tail ('exactly one marker line per missing id, each dispositioning THAT id'). buildBlockReason composes solely from @lore/core exports; no hand-typed marker literal visible in the verb diff. Test body itself unseen (truncated). | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [2],[11]) |
| AC-RCH-3 | 82 | Attested pass, Test Files 1, 2 tests. Claim that the hook asset is unmodified is corroborated: no hook file appears in the diff or truncation manifest. Assertion bodies unseen, so byte-for-byte relay is taken from the oracle result rather than reviewed. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [3],[12]) |
| AC-RCH-4 | 88 | Attested pass. Diff shows tool_use_id pairing via armingToolUseIds and unpaired results skipped, which is exactly the negative half; the e2e file independently exercises the same paired/unpaired control on the compiled path. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [4],[13]), task-t3-compiled-consumer-path-oracle (arming provenance case array) |
| AC-RCH-5 | 90 | 12 tests pass under the filter, attested on main. toLoneCommandTokens does set-membership on edge-trimmed words, so order-independent and non-adjacent matching is structural, not incidental; D10 exemption preserved ahead of disposition inspection in the diff. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [5],[14] — 12 passed) |
| AC-RCH-6 | 86 | Attested pass, Test Files 1. Diff implements the union over dispositionBearingMessages with entryIndex > ticket.entryIndex plus last_assistant_message, matching the criterion; entry-index ordering is line-index based, which is sound for append-only JSONL. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [6],[15]) |
| AC-RCH-7 | 84 | Attested e2e run by main-orchestrator with build first. Test source is visible and strong: PATH shim to fresh dist/lore, real hook asset, both halves plus non-vacuity controls. Deduction: the shown output_tail lines are AC-RC-4 tests, not AC-RCH-7 ones, so the tail does not itself display the AC-RC… | task-t3-compiled-consumer-path-oracle (evidence [1],[2]; test file included in diff) |
| AC-RCH-8 | 88 | Attested pass with the named subtest visible: 'all five payload classes terminate with the IDENTICAL status, and only stdout tells them apart'. Diff confirms every early return is a bare return with process.exitCode untouched. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [7],[16]) |

## Gaps

- The output_tail attached to the AC-RCH-7 e2e evidence shows AC-RC-4 test lines (coverage-floor grammar across render surfaces), not the AC-RCH-7 describe block or a matched-file count. The run is attested and the test source is visible and well-constructed, but the captured tail does not itself witness the criterion it is filed under.
- The unit oracle file is truncated from the materials, so the assertion bodies for AC-RCH-1..6 and AC-RCH-8 (set-equality vs containment, identity assertions against @lore/core exports, the zero-hit source search) cannot be reviewed. Scores rest on the run records, the subtest titles in the tails, and the implementation diff.
- MCP arming matches when the last '__'-separated segment of the tool name equals 'lore_feed'. A tool from a different MCP server namespaced as mcp__other__lore_feed with a session-resume checkpoint would arm the floor. No fixture in the visible materials pins this boundary.

## Recommendations

- When recording an oracle run, capture the tail of the specific describe block under test (or the matched-file/test-count summary) rather than whatever trailing lines the suite printed.
- Add a follow-up observation step: on the first real consumed resume ticket after rollout, confirm a [RESUME_DISPOSITION] line actually appears, and record it as evidence against the compliance claim.
- Extend AC-RCH-5's fixture array with a foreign-namespace MCP shape (e.g. mcp__other__lore_feed with a session-resume checkpoint) asserted non-arming, or state that suffix matching is intended.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 112527ms
- Retried: true
- Truncated sections: task:task-t1-coverage-check-verb-block-channel-verdict-arming, diff:packages/lore/tests/unit/handoff-coverage-check.test.ts
- Reasoning clipped for: AC-RCH-7
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.8 | evidence | All 8 ACs have passing script runs with an attested run each; the visible diff independently implements H1-H5 as specified (stdout block, exported-constant template, tool_use_id arming, union disposi… |
| evidence_integrity | 78 | 0.75 | evidence | Every AC has an orchestrator-attested rerun on the main checkout with Test Files 1 visible; attested ratio 0.38, T1 wholly self-reported, and AC-RCH-7's tail shows unrelated AC-RC-4 lines. |
| scope_fidelity | 94 | 0.85 | evidence | Diff touches only the verb and the declared e2e anchor; hook asset untouched as the plan requires, anchors disjoint per task, no ac_scope narrowing and no unexplained extra files. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-RCH-7 | The output_tail attached to the AC-RCH-7 e2e evidence shows AC-RC-4 test lines (coverage-floor grammar across render surfaces), not the AC-RCH-7 describe block or a matched-file count. The run is attested and the test source is visible and well-constructed, but the captured tail does not itself witness the criterion it is filed under. |
| evidence_integrity | minor | AC-RCH-1 | The unit oracle file is truncated from the materials, so the assertion bodies for AC-RCH-1..6 and AC-RCH-8 (set-equality vs containment, identity assertions against @lore/core exports, the zero-hit source search) cannot be reviewed. Scores rest on the run records, the subtest titles in the tails, and the implementation diff. |
| outcome | minor | AC-RCH-5 | MCP arming matches when the last '__'-separated segment of the tool name equals 'lore_feed'. A tool from a different MCP server namespaced as mcp__other__lore_feed with a session-resume checkpoint would arm the floor. No fixture in the visible materials pins this boundary. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | When recording an oracle run, capture the tail of the specific describe block under test (or the matched-file/test-count summary) rather than whatever trailing lines the suite printed. | AC-RCH-7's tail shows unrelated AC-RC-4 lines, weakening an otherwise strong attested run. |
| plan | Add a follow-up observation step: on the first real consumed resume ticket after rollout, confirm a [RESUME_DISPOSITION] line actually appears, and record it as evidence against the compliance claim. | The plan explicitly carries this as residual behavioural risk with no CI oracle. |
| spec | Extend AC-RCH-5's fixture array with a foreign-namespace MCP shape (e.g. mcp__other__lore_feed with a session-resume checkpoint) asserted non-arming, or state that suffix matching is intended. | The implemented predicate compares only the trailing name segment; intent is currently undocumented. |

## Unverifiable Materials

- packages/lore/tests/unit/handoff-coverage-check.test.ts: Listed in the truncation manifest as present but omitted; assertion bodies for seven ACs could not be reviewed directly.
- assets/hooks/stop-handoff-coverage.mjs contents: Not shown; the unmodified-relay claim of AC-RCH-3 is inferred from its absence in the diff plus the passing oracle.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 5 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.38
