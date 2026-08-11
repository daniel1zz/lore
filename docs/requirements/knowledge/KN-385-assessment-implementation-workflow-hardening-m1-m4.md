---
id: KN-385
type: knowledge
role: knowledge
title: "Assessment: Implementation — workflow hardening (M1-M4 from 2026-07-27 session review) (2026-07-27)"
status: draft
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-106
links:
  - {id: PLAN-106, type: informs}
---
# Assessment: partially_met (79/100)

Scope: plan `01KYHRF83AQFRMEGZF1FJQZ3TN`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-WH-1 | 70 | Enum widened end-to-end (core schema, acceptance.ts, assessment.ts mirror, CLI --result, MCP) and AC-coverage non-green asserted in ac-service.test.ts. But no diff/test evidence for 'distinct rendering', nor for verify-summary/assess-fact classification; AC names integration suites, verify cmd list… | 01KYHRFRG0G2VQXDBF44318DMT (M1 task: test+tsc self-reported, 4 attested orchestrator runs) |
| AC-WH-2 | 85 | rejectBlankClaimWorktree exported as SSOT, invoked before resolveTask/resolvePhase in both claim paths, so nothing persists; error is VALIDATION_ERROR with field 'worktree' naming the flag. REGRESSION pin for omitted/non-empty lives in the truncated task-workflow-service suite (unseen but attested … | 01KYHRFRX79ZC9RPD4HXC35ATK (M2 task; 5 pass / 4 attested on AC) |
| AC-WH-3 | 76 | done() implemented on both services: idempotent terminal no-op, pass-evidence + fresh-foreign-claim refusals, per-step CAS write with version row + audit row. Weakest evidence of the four (2 pass / 1 attested); the visible CLI suite only tests the pure formatter, and the blocks-link ready:true flip… | 01KYHRFSA8KS7TYVV6ZCM0Y98R (M3 task; done-command.test.ts covers rendering only) |
| AC-WH-4 | 87 | findMainCheckoutLoreDb differences --git-common-dir vs --git-dir, degrades to undefined on any probe failure, reused by findLoreDbPathQuiet so paths cannot drift; primary checkout returns undefined preserving old behavior. Compiled-binary e2e attested (4 pass/4 attested); tail shows HAPPY + REGRESS… | 01KYHRFSPTHFAG04P5112MK183 (M4 task; e2e output_tail truncated mid-second-test) |

## Gaps

- 'Stored verbatim with distinct rendering' and non-green classification in lore verify summaries / lore assess evidence facts are asserted only by prose comments. The diff changes no renderer, and the only visible test covers AC-coverage aggregation via ac-service.listCriteria.
- AC-WH-3 carries 2 pass / 1 attested — half the attestation of the other three ACs — and its CLI suite self-describes as rendering-only, so the substantive walk/idempotency/readiness-flip assertions are in a truncated, unseen file.
- Main-checkout root is derived as dirname(--git-common-dir); with --separate-git-dir or a bare main repository that directory is not the checkout root, so the fallback silently misses (returns undefined) rather than resolving the corpus.
- done() walks draft -> approved -> active -> archived through direct store writes, so a task reaches 'approved' without ReviewService or GateEnforcer participation. Intentional per the service CLAUDE.md note, but no visible test pins the interaction with gate/review consumers.

## Recommendations

- Extend AC-WH-1's verify command to include the verify/assess consumer suites and add a rendering assertion, so the AC's own oracle covers every clause it states.
- When an AC statement names 'unit + integration suites', require the verify command to list at least one integration file before the AC can be closed.
- Specify the git-common-dir fallback's root derivation for --separate-git-dir and bare main repos, or state explicitly that those shapes fall back to the existing loud failure.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 80307ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/e2e/worktree-corpus-resolution.bun.test.ts, diff:packages/lore/tests/unit/service/phase-workflow-service.test.ts, diff:packages/lore/tests/unit/service/task-workflow-service.test.ts
- Reasoning clipped for: AC-WH-1, AC-WH-2, AC-WH-3, AC-WH-4

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 82 | 0.7 | evidence | All four mechanizations visibly implemented and evidenced; residual doubt is AC-WH-1's rendering/verify-assess clauses and AC-WH-3's thin, formatter-only visible CLI coverage. |
| evidence_integrity | 80 | 0.65 | evidence | Attested orchestrator runs with output_tails on every task; honest inconclusive entries where done-command tests did not yet exist. Per-task self-reported entries carry no output_tail. |
| scope_fidelity | 90 | 0.75 | evidence | Diff stays inside the declared surfaces (core schema, CLI, MCP, the two workflow services, docs). Phase-service mirroring of claim/done is explicitly declared in the tasks. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-WH-1 | 'Stored verbatim with distinct rendering' and non-green classification in lore verify summaries / lore assess evidence facts are asserted only by prose comments. The diff changes no renderer, and the only visible test covers AC-coverage aggregation via ac-service.listCriteria. |
| evidence_integrity | minor | AC-WH-3 | AC-WH-3 carries 2 pass / 1 attested — half the attestation of the other three ACs — and its CLI suite self-describes as rendering-only, so the substantive walk/idempotency/readiness-flip assertions are in a truncated, unseen file. |
| outcome | minor | AC-WH-4 | Main-checkout root is derived as dirname(--git-common-dir); with --separate-git-dir or a bare main repository that directory is not the checkout root, so the fallback silently misses (returns undefined) rather than resolving the corpus. |
| outcome | minor | AC-WH-3 | done() walks draft -> approved -> active -> archived through direct store writes, so a task reaches 'approved' without ReviewService or GateEnforcer participation. Intentional per the service CLAUDE.md note, but no visible test pins the interaction with gate/review consumers. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Extend AC-WH-1's verify command to include the verify/assess consumer suites and add a rendering assertion, so the AC's own oracle covers every clause it states. | The AC's stated scope is broader than the command that closes it, so a green run does not prove the clause. |
| process | When an AC statement names 'unit + integration suites', require the verify command to list at least one integration file before the AC can be closed. | AC-WH-1 and AC-WH-2 both closed on unit-only commands despite naming integration coverage. |
| spec | Specify the git-common-dir fallback's root derivation for --separate-git-dir and bare main repos, or state explicitly that those shapes fall back to the existing loud failure. | Current dirname() derivation is an unstated assumption about repo layout. |

## Unverifiable Materials

- packages/lore/tests/unit/service/task-workflow-service.test.ts: Truncated from the diff; carries the AC-WH-2 REGRESSION pin and all substantive AC-WH-3 walk/idempotency/readiness assertions.
- packages/lore/tests/e2e/worktree-corpus-resolution.bun.test.ts: Truncated; output_tail cuts off mid-second test, so the 'neither .lore/ present fails loud' case is not directly observable.
- packages/lore/tests/unit/service/phase-workflow-service.test.ts: Truncated; phase-side claim validation and done() behavior not directly observable.
- evidence-panel.ts / doc-type-meta.ts / verify + assess read sites: Not present in the diff; their exclusion of expected-fail is asserted only in code comments.

## Facts Summary

- AC coverage: 4 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.67
