---
id: SPEC-254
type: spec
role: spec
title: "The issue-loop baseline states GitHub-owned issues: stale rules corrected, the label-check leaf retired"
status: approved
priority: medium
created: 2026-10-26
updated: 2026-10-26
tags: []
links:
  - {id: SPEC-212, type: relates-to}
---
# The issue-loop baseline states GitHub-owned issues: stale rules corrected, the label-check leaf retired

## Overview/Goal

`spec-github-owns-issue-report-state-no-mirror-task-work-carries` (GS) landed on main (e5c9a8c3) and `lore issues migrate --apply` ran (0 issue_report documents, 0 resolves links). GS's rule change set (40 entries, all applied) retired and rewrote the rules it named, but an audit of the `baseline-issue-loop` subtree on 2026-10-26 against main found:

- Eight live rules GS did not touch whose text is now false or uses retired terms: BR-498, BR-499, BR-1240 (filing), BR-506, BR-509 (listing; withdrawn from GS's apply by correction because no criterion cited them), BR-520, BR-523, BR-524 (adoption).
- Three behaviours the code enforces that no rule states: an issue closed on GitHub or named by archived work cannot be adopted; the resolve pointers (`--of`, `--superseded-by`); an issue already fixed cannot be given a verdict.
- GS D6 says "BR-520..523 unchanged", but the code no longer reads the filing field block on adoption and accepts only plain digits as an issue number. This spec follows the code (the baseline states the product as built).
- The branch and leaf prose still describe the mirror model ("the corpus is the authority, GitHub is the mirror", the report's own task, not ingested, `--verify`, `--local`), and the leaf "Check resolution labels" describes a mode that no longer exists (`--verify` removed, its five rules retired by GS).

Goal: the issue-loop subtree states, rule by rule, what main does, and every changed or new rule is cited by a criterion with a runner-attested pass.

Relates to (approved, locked): GS (this spec carries the rule changes its change set missed), `spec-a-plan-s-known-defects-are-its-own-record-of-github-issues` (KD; known defects are recorded on the plan, mentioned in the branch boundary).

## Scope

In:
- Rule change set (`lore rule propose`), table below.
- Baseline prose (living documents, edited in place, then review + approve): branch `baseline-issue-loop` (intro, boundary, children table, split and merge decisions, both diagrams, ubiquitous language, cross-cutting notes, glossary) and leaves `baseline-file-a-defect-report`, `baseline-list-defect-reports`, `baseline-adopt-a-github-issue`, `baseline-resolve-a-defect-report`; the leaf `baseline-check-resolution-labels` is retired (deprecated) and removed from the branch's table and diagrams. Stale `extra.site_map` keys naming deleted functions (`mintIssueTask`, `fetchGithubLabelResolutions`) are removed with the prose.
- Two stale code comments: `report-issue-wiring.ts` says "Retry recognition: no network call" while the same block reads the earlier issue's state from GitHub (#397); `commands/report-issue.ts` says the listing switch matches a bare `lore issues`, which shows only unfinished issues.
- Tests for any criterion below whose behaviour no existing test asserts.

Out:
- Any behaviour change. Every new rule text states what main already does.
- `baseline-diagnose-a-defect-report` (draft, owned by its own spec; no conflict with GS).
- Correcting GS's own criteria' cite text (GS is locked; corrections go through `lore ac set --correction` only where a criterion's cite text quotes a rule this spec rewrites).

## Rule change set

Recorded with `lore rule propose` (`lore rule changes <this spec>` lists the final texts): modify BR-498, BR-499, BR-1240 (file-a-defect-report), BR-506, BR-509 (list-defect-reports), BR-520, BR-524 (adopt-a-github-issue); retire BR-523; add BR-1456 (adopt: any open issue is adoptable; closed or archived-work issues are refused), BR-1457 (resolve: pointer rules), BR-1458 (resolve: a fixed issue takes no verdict). BR-499 stays a suspected defect, tracked by #286. BR-503 ("filing, listing, adopting and label updates" reach GitHub only through the caller's gh) is left as is; the prose rewrite does not restate it.

## Design Decisions

| # | Decision | Chosen | Rejected | Why |
|---|---|---|---|---|
| D1 | Source of truth where GS's text and the code differ (BR-520..523) | the code on main | GS D6's "unchanged" | the baseline states the product as built; GS's tests already pin the code's behaviour |
| D2 | The label-check leaf | retire the leaf | keep it with a "removed" note; fold into list | its only command mode is gone and all five of its rules are retired; the surviving label clean-up already lives in resolve (BR-1084) |
| D3 | One spec for rules and prose | yes | rules here, prose as a separate edit | the prose cites the rules this spec rewrites; landing one without the other leaves the subtree contradicting itself |

## Acceptance Criteria

Declared with `lore ac add`, each citing the rule it pins; new assertions are named with their AC id.

- AC-IL-1 (BR-498): an earlier issue still open dedupes; a closed one does not; a failed state read fails the filing with its transport kind.
- AC-IL-2 (BR-499): a different description under an open issue's title is recognised as a repeat (no second create call).
- AC-IL-3 (BR-1240): eleven filings in a row all file (existing AC-DC-1/AC-DC-3 tests).
- AC-IL-4 (BR-506): `report-issue --list` and `issues --all` list the same numbers; with nothing configured and with the retired form, both exit 4.
- AC-IL-5 (BR-509): severity filter is a strict subset with the filtered total; unknown severity exits 2; category is case-sensitive; an issue without the block never matches.
- AC-IL-6 (BR-520): adopt and resolve refuse each malformed number with exit 4, naming it, with no GitHub call.
- AC-IL-7 (BR-524): adopt without a plan in a corpus with no requirements document exits 4 and creates nothing; with a live plan it exits 0.
- AC-IL-8 (new adoptability rule): an issue without the filing block is adopted; a closed issue and an issue named by archived work exit 4, the latter naming the work and the sync.
- AC-IL-9 (new pointer rule): `--of` with another verdict, `--of` naming itself, an unresolvable `--superseded-by` exit 4 with no GitHub write; `--superseded-by` a corpus document puts its slug in the comment.
- AC-IL-10 (new fixed rule): an issue whose naming work is archived (close pending, and closed as completed) refuses a verdict with exit 4 naming that work, with no GitHub write.

## Structure

```
corpus: baseline-issue-loop and its leaves (prose, glossary, rule change set)
packages/lore/src/adapters/cli/report-issue-wiring.ts   (stale comments only)
packages/lore/src/adapters/cli/commands/report-issue.ts (stale comment only)
tests named by the criteria (new assertions only where none exists)
```


## Acceptance Criteria (structured)

- [⚑] [script] AC-IL-1: Unit level (issue filing service): a prior same-title issue still open makes the filing return retried with that number and no create call; a closed prior issue lets a new issue be filed; a failed state read makes the filing return err with code TRANSPORT_UNAVAILABLE and no create call.
  script: test — bun run test:file packages/lore/tests/unit/service/github-filing-split-write.test.ts -t 'AC-IL-1\b' && bun run test:file packages/lore/tests/unit/service/github-filing-split-write.test.ts -t 'CLOSED is not recognised|still OPEN' && echo 'AC-IL-1 PASS: open prior dedupes, closed prior refiles, failed read fails by kind'
- [⚑] [script] AC-IL-2: Unit level (issue filing service): a report with a different description under the title of an earlier still-open issue from this corpus returns retried with the earlier number and makes no create call.
  script: test — bun run test:file packages/lore/tests/unit/service/github-filing-split-write.test.ts -t 'AC-IL-2' && echo 'AC-IL-2 PASS: title alone decides a repeat while the issue is open'
- [⚑] [script] AC-IL-3: Eleven filings in a row all exit 0 and gh receives one create call per filing.
  script: test — bun run test:file packages/lore/tests/integration/cli/report-issue-no-quota-gh.bun.test.ts -t 'AC-DC-1|AC-DC-3' && echo 'AC-IL-3 PASS: no open-issue limit on filing'
- [⊘] [script] AC-IL-4: report-issue --list and issues --all list the same non-empty number set, closed issues included; with no destination configured and with a retired-form destination, lore issues and lore report-issue --list each exit exactly 4.
  script: test — bun run test:file packages/lore/tests/integration/cli/issues-upstream-shape-refusal.bun.test.ts -t 'AC-IL-4' && bun run test:file packages/lore/tests/integration/cli/issue-read-surfaces-gh.bun.test.ts -t 'are EQUAL' && echo 'AC-IL-4 PASS: same live list, both refuse unconfigured and retired form'
  other_command=1
- [⚑] [script] AC-IL-5: In its own fixture: lore issues with severity bogus exits exactly 2; the category filter matches case-sensitively (Regression does not match regression; Security matches 0 rows, exit 0); an issue without the filing field block matches no filter; plus the existing strict-subset boundary test with the filtered total.
  script: test — bun run test:file packages/lore/tests/integration/cli/github-issue-read-surface.bun.test.ts -t 'AC-IL-5' && bun run test:file packages/lore/tests/integration/cli/github-issue-read-surface.bun.test.ts -t 'BOUNDARY: --severity' && echo 'AC-IL-5 PASS: exact filters, filtered total, unknown severity exit 2'
- [⚑] [script] AC-IL-6: issue adopt <n> and issue resolve <n> --state rejected --reason r refuse each malformed number (empty, 0, 007, 1.5, 0x10, 1e3, abc, a value beyond the safe integer range) with exit exactly 4, stderr naming field 'number' and the value given, and no gh call; a bare -1 exits exactly 1 reporting the missing argument.
  script: test — bun run test:file packages/lore/tests/integration/cli/issue-adopt-work-task.bun.test.ts -t 'AC-IL-6' && echo 'AC-IL-6 PASS: malformed issue numbers refused before GitHub'
- [⚑] [script] AC-IL-7: In a corpus with no prd, issue adopt without a plan exits exactly 4 and the task count is unchanged; the same adoption with a live plan exits 0.
  script: test — bun run test:file packages/lore/tests/integration/cli/issue-adopt-work-task.bun.test.ts -t 'AC-IL-7' && echo 'AC-IL-7 PASS: ad-hoc adoption needs a requirements document, plan adoption does not'
- [⚑] [script] AC-IL-8: An open issue whose body has no filing field block (hand-written, and a damaged block) is adopted (exit 0, the task body carries the issue text); an issue whose only naming task is deprecated is adopted as task-issue-<repo_id>-<n>-r1 (exit 0); an issue closed on GitHub exits exactly 4; an open issue named by an archived task, and one named by an archived plan, each exit exactly 4 with stderr naming that work and lore issues --sync; no task is created by a refusal.
  script: test — bun run test:file packages/lore/tests/integration/cli/issue-adopt-work-task.bun.test.ts -t 'AC-IL-8' && bun run test:file packages/lore/tests/integration/cli/issue-adopt-work-task.bun.test.ts -t 'closed on GitHub' && echo 'AC-IL-8 PASS: any open issue adoptable, closed or archived-work issues refused'
- [⚑] [script] AC-IL-9: issue resolve refuses with exit exactly 4 and no GitHub write: --of under a non-duplicate verdict, --of naming the issue itself, --of naming an unlisted issue, --superseded-by under a non-superseded verdict, --superseded-by naming the issue itself, --superseded-by naming nothing resolvable; --superseded-by a listed issue and --superseded-by a corpus document each close the issue with a comment naming the pointer.
  script: test — bun run test:file packages/lore/tests/integration/cli/issue-resolve-github-owned.bun.test.ts -t 'AC-IL-9' && bun run test:file packages/lore/tests/integration/cli/issue-resolve-github-owned.bun.test.ts -t 'duplicate \(issue on page 2\)' && echo 'AC-IL-9 PASS: pointer rules enforced before any GitHub write'
- [⚑] [script] AC-IL-10: issue resolve --state rejected on an open issue named by an archived task (fixed, close pending) and on an issue closed as completed with an archived naming task (fixed) each exit exactly 4 with stderr naming that task and no GitHub write.
  script: test — bun run test:file packages/lore/tests/integration/cli/issue-resolve-github-owned.bun.test.ts -t 'AC-IL-10' && echo 'AC-IL-10 PASS: a fixed issue is not re-judged'
