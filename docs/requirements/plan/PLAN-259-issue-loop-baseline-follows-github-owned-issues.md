---
id: PLAN-259
type: plan
role: plan
title: "Issue-loop baseline follows GitHub-owned issues"
status: archived
priority: medium
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: SPEC-254
phases:
  - {name: "T", description: "Tests for the AC-IL criteria and two comment fixes"}
links:
  - {id: SPEC-254, type: implements}
---
# Issue-loop baseline follows GitHub-owned issues

## Goal

Land spec-the-issue-loop-baseline-states-github-owned-issues-stale: the 11-entry rule change set, tests for every AC-IL criterion no existing test asserts, two stale code comments, and the subtree prose rewrite.

## Preconditions

Spec approved.

## Tasks

- T1 (phase T): tests only, plus two comment fixes. No behaviour change: every new assertion must pass on main as is; each new test is made red once by a deliberate mutation (recorded as expected-fail evidence) and then restored.
  - github-filing-split-write.test.ts: AC-IL-1 (failed state read -> err, code TRANSPORT_UNAVAILABLE, no create call), AC-IL-2 (different description, same open title -> retried, no create call).
  - report-issue-no-quota-gh.bun.test.ts: AC-IL-3 uses the existing AC-DC-1/AC-DC-3 tests; record its red run by a mutation (reintroduce a limit of 10).
  - issues-upstream-shape-refusal.bun.test.ts: AC-IL-4 (no destination; retired form; lore issues and report-issue --list both exit 4).
  - github-issue-read-surface.bun.test.ts: AC-IL-5 in its own describe and fixture (the existing tests pin total 2): severity bogus exit 2; category case-sensitive (Security -> 0 rows, exit 0); no-block issue never matches.
  - issue-adopt-work-task.bun.test.ts: AC-IL-6 (malformed numbers for adopt, and for resolve with --state rejected --reason r, stderr names field 'number'; bare -1 exit 1), AC-IL-7 (no-prd fixture), AC-IL-8 (no-block and damaged-block bodies adopted; only-deprecated carrier adopted as -r1; archived task and archived plan refusals name the work and --sync).
  - issue-resolve-github-owned.bun.test.ts: AC-IL-9 (pointer refusals incl. --superseded-by under another verdict and naming itself; both --superseded-by forms), AC-IL-10 (close pending and fixed refuse a verdict).
  - report-issue-wiring.ts: every comment that says retry recognition makes no network call or never fails the call (~:96-97, ~:713-716, ~:731-735, ~:756) states the GitHub state read and its failure by kind (#397); commands/report-issue.ts ~:361-364: the listing switch matches lore issues --all, not bare lore issues.

## After landing (main agent, in this order)

1. lore verify the plan (all AC-IL-n, full scope), then lore done T1.
2. lore rule apply the spec.
3. Rewrite the subtree prose from the 2026-10-26 audit: branch baseline-issue-loop (intro, boundary, children table, split/merge, both diagrams, ubiquitous language, cross-cutting, glossary: remove Ingested, Explicit resolution, Adopted (resolution), Resolving link, Drift; rewrite Defect report, Adopt, Resolution -> Displayed status, Finished issue, Resolution label; add Naming document, Verdict, Sync), leaves file-a-defect-report, list-defect-reports, adopt-a-github-issue, resolve-a-defect-report (prose and stale site_map keys); deprecate baseline-check-resolution-labels; BR-503's wording is not touched; then lore review + lore approve each changed node.
4. lore assess the plan.

## Decisions Log

- 2026-10-26: one spec carries rules and prose (D3); code is the source where GS D6 and code differ (D1); label-check leaf retired (D2).
