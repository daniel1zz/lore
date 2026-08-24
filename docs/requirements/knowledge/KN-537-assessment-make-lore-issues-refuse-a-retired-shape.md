---
id: KN-537
type: knowledge
role: knowledge
title: "Assessment: Make lore issues refuse a retired-shape upstream as loudly as report-issue already does (2026-08-24)"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-140
links:
  - {id: PLAN-140, type: informs}
---
# Assessment: met (89/100)

Scope: plan `01M0SJ5RZMHX7QF9VESK9PPNH2`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-IS-1 | 94 | Evidence [7] shows the named describe passing with 3 expect() calls; the diff's test asserts exitCode===4 plus both verbatim substrings against a throwaway mkdtemp+lore init corpus whose corpus_path points at a DIFFERENT corpus. Fix in issues.ts routes retired->refusal. | 01M0SJJ1VBA1FTDCVT9CWKAD8F (evidence [7] AC-IS-1 pass), 01M0SJJ174MZT2X1V7NZYFAJVE (test authored red-first) |
| AC-IS-2 | 78 | Passes (evidence [8]) but the test body asserts ONLY exitCode===4 (1 expect()). The AC statement says the refusal must name 'the later-phase gap'; no stderr substring is asserted, so the control cannot distinguish the intended GitHub refusal from any other exit-4 failure. | 01M0SJJ1VBA1FTDCVT9CWKAD8F (evidence [8]; diff shows single expect) |
| AC-IS-3 | 93 | Evidence [9], 6 expect() calls: exit 0 on both retired and GitHub shapes, first stdout line equals `Corpus: ${realpathSync(dir)}` in each. Directly pins the --local opt-out against collateral damage (spec D2). | 01M0SJJ1VBA1FTDCVT9CWKAD8F (evidence [9]) |
| AC-IS-4 | 91 | Compound oracle [2]/[10] runs all four greps then the describe. Diff confirms isGithubUpstreamCfg removed from both command files, classifyFeedbackUpstream imported+called in both, and the literal living only in report-issue-wiring.ts. CLI-surface probe covers both verbs. | 01M0SJJ1VBA1FTDCVT9CWKAD8F (evidence [2],[10]; diff of all three source files) |
| AC-IS-5 | 92 | Lint evidence [3]/[11] pass, and the diff visibly rewrites both stale phrases in commands/issues.ts into an accurate description of the new refusal, so the grep is not passing by deletion of the whole comment block. | 01M0SJJ1VBA1FTDCVT9CWKAD8F (evidence [3],[11]; issues.ts header diff) |

## Gaps

- The AC-IS-2 describe in packages/lore/tests/integration/cli/issues-upstream-shape-refusal.bun.test.ts asserts only expect(result.exitCode).toBe(4) (1 expect() call), while the AC statement requires the refusal to name the later-phase gap. Any unrelated exit-4 failure under the GitHub shape would satisfy this control.
- packages/lore/src/adapters/cli/report-issue-wiring.ts keeps isGithubUpstreamCfg exported for the MCP lore_report_issue tool, which still derives shape policy outside classifyFeedbackUpstream. D1's 'nowhere left for a second verdict to live' holds for the two CLI verbs only, not for the MCP surface.
- The P1 task's expected-fail record has no visible output_tail, so the RED state of AC-IS-1/AC-IS-4 cannot be confirmed from the bundle; the same task also carries attested AC-IS-1..4 PASS records, which must post-date P2's fix, leaving the red-then-green ordering asserted rather than shown.

## Recommendations

- Require green-control describes to assert a discriminating stderr substring, not just an exit code, whenever the AC statement names what the message must say.
- Retain the failing output tail on expected-fail evidence, and keep post-fix AC attestations on the implementing task rather than re-attesting them on the red-first test task.
- Open a follow-up covering adapters/mcp/tools.ts so every feedback.upstream consumer routes through classifyFeedbackUpstream.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 59196ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 91 | 0.85 | evidence | All five ACs attested pass; diff shows a real shared discriminated-union classifier consumed by both verbs, stale comments rewritten, --local opt-out preserved. |
| evidence_integrity | 84 | 0.75 | evidence | 11/6 attested records, 0.94 attested ratio, tsc + adjacent unit/vitest suites green. Weakened by an unviewable expected-fail tail and AC passes attested on the red-first task. |
| scope_fidelity | 93 | 0.85 | evidence | Diff touches exactly the plan's anchors: one new test file plus issues.ts, report-issue.ts, report-issue-wiring.ts. No unrelated edits; test-harness hardening stays inside the test file. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | AC-IS-2 | The AC-IS-2 describe in packages/lore/tests/integration/cli/issues-upstream-shape-refusal.bun.test.ts asserts only expect(result.exitCode).toBe(4) (1 expect() call), while the AC statement requires the refusal to name the later-phase gap. Any unrelated exit-4 failure under the GitHub shape would satisfy this control. |
| outcome | minor | AC-IS-4 | packages/lore/src/adapters/cli/report-issue-wiring.ts keeps isGithubUpstreamCfg exported for the MCP lore_report_issue tool, which still derives shape policy outside classifyFeedbackUpstream. D1's 'nowhere left for a second verdict to live' holds for the two CLI verbs only, not for the MCP surface. |
| evidence_integrity | minor | AC-IS-1 | The P1 task's expected-fail record has no visible output_tail, so the RED state of AC-IS-1/AC-IS-4 cannot be confirmed from the bundle; the same task also carries attested AC-IS-1..4 PASS records, which must post-date P2's fix, leaving the red-then-green ordering asserted rather than shown. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Require green-control describes to assert a discriminating stderr substring, not just an exit code, whenever the AC statement names what the message must say. | Exit-code-only controls can be satisfied by an unrelated failure with the same code, weakening the discriminating-power argument the control exists to make. |
| process | Retain the failing output tail on expected-fail evidence, and keep post-fix AC attestations on the implementing task rather than re-attesting them on the red-first test task. | Both make the red-then-green sequence auditable from the bundle instead of inferable from task descriptions. |
| spec | Open a follow-up covering adapters/mcp/tools.ts so every feedback.upstream consumer routes through classifyFeedbackUpstream. | The remaining direct isGithubUpstreamCfg call site is the same drift vector this spec closed for the CLI verbs. |

## Unverifiable Materials

- Content of the P1 expected-fail run (evidence [1], tail_bytes=1948): No output_tail included in the bundle, so the specific pre-fix failures are not inspectable.
- adapters/mcp/tools.ts: Referenced in report-issue-wiring.ts comments as a remaining isGithubUpstreamCfg consumer but not present in the diff or any oracle output.
- Full source of commands/issues.ts and report-issue.ts outside the diff hunks: Only hunks are shown; unused imports (e.g. Result/ok/err in report-issue.ts) cannot be checked since tsc alone may not flag them.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 2
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.94
