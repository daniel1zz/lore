---
id: KN-555
type: knowledge
role: knowledge
title: "Assessment: Close the read side: a GitHub-filed defect becomes claimable, on every surface (2026-08-25)"
status: approved
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PLAN-145
links:
  - {id: PLAN-145, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01M0SW7T0EYWM18W7GWHJG0K8W`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-GR-1 | 92 | Two attested passes, including the declared e2e command run from the repo root; red-first expected-fail recorded at the moment it was red. Diff shows the refusal branch replaced by runGithubIssuesListing. | 01M0SW92ND5NQ2M3CG5PFCDD8Z (expected-fail [1] then pass [6],[11]) |
| AC-GR-2 | 92 | Attested pass twice; the injectivity is structural, not conventional — GithubProjectedRow.resolution is IssueResolution \| 'not_ingested' and joinListing's row kinds keep not_ingested outside the 9-state vocabulary (D6). | 01M0SW92ND5NQ2M3CG5PFCDD8Z |
| AC-GR-3 | 86 | Red-first shows 'Unknown command adopt', then attested pass plus an unfiltered whole-file pass. Deduction: commands/issue.ts is unseen and every AC-GR-3 pass tail is consistent with the worktree run, with no main-checkout re-run shown. | 01M0SW92237ZABBVDDGKMKQDBZ ([1] red, [2] pass, [3] unfiltered pass) |
| AC-GR-4 | 85 | Genuine two-process barrier race, 142 expect() calls over 20 iterations; red-first pinned the '-2' aliasing. Diff confirms no findBySlug pre-check, so the UNIQUE index really is the arbiter. Only one attested pass, resolve path unprinted. | 01M0SW90NPZ4EKQSBYVS9Y6Z21 |
| AC-GR-5 | 93 | Red (module missing) then pass in worktree AND a companion pass in the main checkout, which mitigates invariant 7. joinListing keys strictly on ref.repo_id !== currentRepoId, never the owner/repo string. | 01M0SW917V4MK1TST3DQJG5Z1S |
| AC-GR-6 | 93 | Attested pass in worktree and again in the main checkout. githubIssueTaskSlug is `task-gh-${repoId}-${issueNumber}` — injective over the pinned domain and slugSchema-total by construction. | 01M0SW917V4MK1TST3DQJG5Z1S |
| AC-GR-7 | 92 | Red-first, then pass in worktree and in the main checkout. buildPartialSuccessStoreError interpolates both #number and url, and both mint failure paths route through it. | 01M0SW91MXYE7P45PHYZ9WEF3Y |
| AC-GR-8 | 60 | Scan is attested 0. But the GitHub branch in commands/issues.ts retains a loud refusal reworded to 'are not yet supported by' plus 'a later phase of spec-a-github-filed-defect-must-be-claimable' — text that evades both pinned needles, so the oracle no longer measures what it claims. | 01M0SW93KFXF2QTXS5E6NBY3VA (sole evidence row on a draft task) |
| AC-GR-9 | 92 | Red-first captured a real split-write failure, then attested pass plus an unfiltered whole-file pass. fileGithubIssue now calls mintIssueTask before returning ok. | 01M0SW91MXYE7P45PHYZ9WEF3Y |
| AC-GR-10 | 90 | Two attested passes. The boundary literal is a module-level const emitted on both the table and --json (local_note) paths, and the GitHub branch never calls readLocalRows, so no union is possible. | 01M0SW92ND5NQ2M3CG5PFCDD8Z |
| AC-GR-11 | 90 | Three attested passes, one from the main checkout; red-first was a real assertion diff. Deduction: tools.ts is unseen, so the registerTools import path and refusal deletion are taken on the test's word. | 01M0SW934QYERAVGMYW3MGM53X |
| AC-GR-12 | 85 | Attested pass twice. resolveGithubJoinedRows demonstrably calls only listFull/get. Deduction: the invariance assertion covers task count and version logs only — the read still constructs a GitHubIntakePort with receiptsPath, unasserted. | 01M0SW92ND5NQ2M3CG5PFCDD8Z |

## Gaps

- The AC-GR-8 scan reports 0 while a loud surface refusal survives in packages/lore/src/adapters/cli/commands/issues.ts: the GitHub branch refuses --verify/--open/--resolved/--all/--severity/--category with the text 'are not yet supported by' and 'a later phase of spec-a-github-filed-defect-must-be-claimable-...'. Needle 1 is 'is not yet supported' and needle 2 names a different spec, so neither matches the new wording. The AC's claim — 'no refusal stub survives on any surface' — is therefore not…
- P5's task is status=draft with one evidence row. The plan's Exit Criteria require declared --falsifier-* fields whose mutations actually produce their declared exit codes, spec re-approval after the ac set demotion, a rebuilt dist/lore, both runners green on the full suite on main, a green pre-push chain, and a triaged lore assess. None of these appears in the bundle, so the plan is not closed even though every AC is green.
- In packages/lore/src/adapters/cli/commands/issues.ts, explicitModeFlag makes `lore issues --open` exit 4 against a GitHub-configured upstream, although the branch already lists exactly the open issues and 'open' is the derived default mode. The most natural invocation of the newly-opened flow fails loudly with nothing wrong.
- Every AC-GR-3 pass tail is consistent with the worktree that produced the red (agent-a735890a65628bd1e); no companion run from the main checkout is recorded, unlike AC-GR-5/6/7/9/11. Combined with invariant 7 being unenforced prose, the adopt lifecycle verdict rests on a module-resolution assumption nobody printed.
- resolveGithubJoinedRows in packages/lore/src/adapters/cli/report-issue-wiring.ts loads every task via listFull then performs one corpusService.get() per issue-report task before joining. Read-only as claimed, but the per-read store cost is unbounded by any AC and grows linearly with the corpus.

## Recommendations

- Rewrite AC-GR-8 so its oracle survives rewording: assert the complete set of refusal sites under packages/lore/src rather than two pinned substrings, or pin the exact allowed residual refusal and fail on any other.
- Require the P5 task to carry one oracle row per Exit Criterion before archival — falsifier mutations, full suite on main, dist rebuild, pre-push chain, lore assess triage — rather than a single lint row.
- Implement the resolve-guard sibling to assert-fresh-binary.ts that invariant 7 names, and have it print the resolved @lore/core path into the captured output of every worktree oracle run.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 104419ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/store/verbatim-slug-concurrency.bun.test.ts, diff:packages/lore/tests/unit/service/github-issue-listing.test.ts, diff:packages/lore/tests/unit/service/issue-task-shaping.test.ts, diff:packages/lore/tests/integration/cli/github-defect-claim-lifecycle.bun.test.ts, diff:packages/lore/tests/integration/helpers/payload-gh-stub.ts, diff:packages/lore/tests/unit/service/github-filing-split-write.test.ts, diff:packages/lore/tests/unit/service/issue-task-shaping.test.ts, diff:packages/lore/tests/integration/cli/github-issue-read-surface.bun.test.ts, diff:packages/lore/src/adapters/mcp/tools.ts, diff:packages/lore/tests/unit/adapters/mcp-github-filing.test.ts, diff:packages/lore/src/adapters/cli/commands/issue.ts, diff:packages/lore/tests/integration/cli/github-defect-claim-lifecycle.bun.test.ts, diff:packages/lore/tests/integration/helpers/payload-gh-stub.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.75 | evidence | All 12 ACs attested green and the diff shows real wiring on every surface, but P5 is draft and none of the plan's own exit criteria beyond the AC-GR-8 scan is evidenced. |
| evidence_integrity | 82 | 0.8 | evidence | Red-first rows are contemporaneous and specific, unfiltered companion runs are present per invariant 8, several ACs re-run on main. AC-GR-8's oracle no longer measures its claim. |
| scope_fidelity | 88 | 0.8 | evidence | Diff tracks the declared P0-P4 phases; the D13 signature correction and the report-issue --list delegation are documented in-code, not silent drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-GR-8 | The AC-GR-8 scan reports 0 while a loud surface refusal survives in packages/lore/src/adapters/cli/commands/issues.ts: the GitHub branch refuses --verify/--open/--resolved/--all/--severity/--category with the text 'are not yet supported by' and 'a later phase of spec-a-github-filed-defect-must-be-claimable-...'. Needle 1 is 'is not yet supported' and needle 2 names a different spec, so neither matches the new wording. The AC's claim — 'no refusal stub survives on any surface' — is therefore not… |
| outcome | major | — | P5's task is status=draft with one evidence row. The plan's Exit Criteria require declared --falsifier-* fields whose mutations actually produce their declared exit codes, spec re-approval after the ac set demotion, a rebuilt dist/lore, both runners green on the full suite on main, a green pre-push chain, and a triaged lore assess. None of these appears in the bundle, so the plan is not closed even though every AC is green. |
| outcome | minor | — | In packages/lore/src/adapters/cli/commands/issues.ts, explicitModeFlag makes `lore issues --open` exit 4 against a GitHub-configured upstream, although the branch already lists exactly the open issues and 'open' is the derived default mode. The most natural invocation of the newly-opened flow fails loudly with nothing wrong. |
| evidence_integrity | minor | AC-GR-3 | Every AC-GR-3 pass tail is consistent with the worktree that produced the red (agent-a735890a65628bd1e); no companion run from the main checkout is recorded, unlike AC-GR-5/6/7/9/11. Combined with invariant 7 being unenforced prose, the adopt lifecycle verdict rests on a module-resolution assumption nobody printed. |
| outcome | minor | AC-GR-12 | resolveGithubJoinedRows in packages/lore/src/adapters/cli/report-issue-wiring.ts loads every task via listFull then performs one corpusService.get() per issue-report task before joining. Read-only as claimed, but the per-read store cost is unbounded by any AC and grows linearly with the corpus. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Rewrite AC-GR-8 so its oracle survives rewording: assert the complete set of refusal sites under packages/lore/src rather than two pinned substrings, or pin the exact allowed residual refusal and fail on any other. | A literal-needle scan is defeated by 'is' -> 'are' and a new spec name, which is exactly what happened here. |
| plan | Require the P5 task to carry one oracle row per Exit Criterion before archival — falsifier mutations, full suite on main, dist rebuild, pre-push chain, lore assess triage — rather than a single lint row. | 12 green ACs currently coexist with a draft P5 whose criteria are entirely unevidenced. |
| process | Implement the resolve-guard sibling to assert-fresh-binary.ts that invariant 7 names, and have it print the resolved @lore/core path into the captured output of every worktree oracle run. | Invariant 7 is self-declared as unenforced prose; worktree verdicts about main-checkout code are silent today. |

## Unverifiable Materials

- packages/lore/src/adapters/mcp/tools.ts: Omitted from the diff; AC-GR-11's refusal deletion and registerTools registration path are taken from test output alone.
- packages/lore/src/adapters/cli/commands/issue.ts: Omitted from the diff; the adopt subcommand and its idempotency behaviour are judged only from AC-GR-3's evidence tails.
- All 11 test files, including payload-gh-stub.ts: Omitted; assertion strength (row counts, token distinctness, byte-equality) is inferred from AC statements and expect() counts, not read.
- P5 exit-criteria artifacts: No evidence rows for falsifier mutations, spec re-approval, dist/lore rebuild, full-suite-on-main, pre-push chain, or lore assess triage.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 12 declared criteria
- Task evidence: 7 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.71
