---
id: KN-765
type: knowledge
role: knowledge
title: "Assessment: Complete-coverage integrate floor (2026-10-19)"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-23
tags: []
parent: PLAN-230
links:
  - {id: PLAN-230, type: informs}
---
# Assessment: met (85/100)

Scope: plan `01M591F7BBPDEKD8CN5SM1CXWJ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BCR-1 | 85 | Red-first (traceCensusMany undefined), then 5/5 pass on the AC command. The closureScoped:false probe exists in site-census.ts. The test file was omitted, so the fixture/real-command equality and the 'unscoped differs' assertion can't be read. The run logged 'close timed out after 10000ms'. | task-one-program-closure-scoped-census-with-output-identical-to (evidence [1] expected-fail, [4] AC pass) |
| AC-BCR-2 | 92 | The test fixes ALPHA_OLD and adds ALPHA_NEW, so the gap count stays 1→1. It asserts exit 1, names the new pair and the leaf-A map fix, and has an exit-0 control. Red-first, then pass. | task-root-coverage-reports-undeclared-commands-and-names-the (evidence [1] expected-fail, [4] pass) |
| AC-BCR-3 | 90 | Only beta.ts is edited, and shared.ts is asserted byte-identical. The test checks exit 1, leaf B INCOMPLETE, the gap and fix lines, and 'incomplete leaves (1)', with an exit-0 baseline before the edit. There is one affected leaf only, so 'each newly affected leaf' is shown with n=1. | task-root-coverage-reports-undeclared-commands-and-names-the (evidence [5]) |
| AC-BCR-4 | 92 | 5 tests: a control, the undeclared 'gamma add' case with exit 1 and the --command fix, JSON output, the hyphen-spelling clear, and a check that the leaf level doesn't query. They still pass after the static rewrite (static-list task evidence [2]). | task-root-coverage-reports-undeclared-commands-and-names-the (evidence [6]), task-root-coverage-lists-runnable-commands-statically-so-the (re-run after static rewrite) |
| AC-BCR-5 | 80 | Real integrate on a throwaway repo: an unaccounted pair gives exit 1 with main unchanged, the pair and fix are named, and once mapped it lands. Red-first, then pass. But the test sets floor_command itself. scripts/check-baseline-coverage.ts and the real repo's floor wiring are not shown. | task-integrate-floor-refuses-unless-root-coverage-of-the-merged (evidence [1] expected-fail, [4] pass) |
| AC-BCR-6 | 82 | Recorded rc=0 in 14 s, well under 120 s. The run is from source only. Whether it was re-measured after the static runnable-command rewrite is not shown, and the 'other' oracle on one machine is weaker evidence. | task-one-program-closure-scoped-census-with-output-identical-to (evidence [5]) |

## Gaps

- A draft task records the real integrate floor failing with 'database or disk is full' (a VACUUM INTO snapshot of a 1.1 GB corpus). The floor may not run reliably on the real corpus until batched site mapping lands.
- Static-vs-dynamic runnable-command equality on the real tree is recorded only as a manual self-report (oracle=manual).
- In baseline.ts root coverage, every declared leaf command goes through resolveCommandEntry. A stale or renamed declaration likely throws a census error rather than being reported with a fix or rename hint (P2's probable-rename hints are unevidenced).

## Recommendations

- Before closing P4, add an evidence item showing the real repo's integrate floor_command invokes check-baseline-coverage on the merged tree, plus a successful real integrate run.
- Re-run oracles for time- or behaviour-sensitive ACs (AC-BCR-6) after later tasks change the code they depend on.
- Add an AC for a leaf declaring a no-longer-existent command: root coverage reports it with a fix or rename hint rather than a census error.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 41326ms
- Retried: false
- Truncated sections: diff:package.json, diff:scripts/check-baseline-coverage.ts, diff:CLAUDE.md, diff:packages/lore/tests/unit/service/site-census-many.test.ts, diff:packages/lore/tests/integration/cli/compiled-root-coverage.bun.test.ts, diff:CLAUDE.md, diff:packages/lore/tests/unit/service/site-census-factory-subcommand.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.7 | evidence | All six ACs have red-first then pass evidence, and the code matches the claims. Floor wiring in the real repo, and its viability given the disk-full failure, are unverified. |
| evidence_integrity | 83 | 0.7 | evidence | Attested runs with output tails and red-first records. Weak spots: one manual self-report, one 'other' timing oracle, and an AC-BCR-6 run that may predate the static rewrite. |
| scope_fidelity | 84 | 0.65 | evidence | Changes follow P1/P2/P4. The factory and static-registry tasks are justified fixes for blockers. No allowlist or base comparison was added. The batch-map draft is an open follow-up outside scope. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | — | A draft task records the real integrate floor failing with 'database or disk is full' (a VACUUM INTO snapshot of a 1.1 GB corpus). The floor may not run reliably on the real corpus until batched site mapping lands. |
| evidence_integrity | minor | — | Static-vs-dynamic runnable-command equality on the real tree is recorded only as a manual self-report (oracle=manual). |
| outcome | minor | — | In baseline.ts root coverage, every declared leaf command goes through resolveCommandEntry. A stale or renamed declaration likely throws a census error rather than being reported with a fix or rename hint (P2's probable-rename hints are unevidenced). |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Before closing P4, add an evidence item showing the real repo's integrate floor_command invokes check-baseline-coverage on the merged tree, plus a successful real integrate run. | The AC-BCR-5 test proves the mechanism but not that the production wiring is in place. |
| process | Re-run oracles for time- or behaviour-sensitive ACs (AC-BCR-6) after later tasks change the code they depend on. | The static registry rewrite changed root-coverage cost after the AC-BCR-6 evidence was recorded. |
| spec | Add an AC for a leaf declaring a no-longer-existent command: root coverage reports it with a fix or rename hint rather than a census error. | The plan promises rename hints, but no AC covers them. |

## Unverifiable Materials

- scripts/check-baseline-coverage.ts: Omitted from the diff, so how the floor invokes root coverage can't be read.
- packages/lore/tests/unit/service/site-census-many.test.ts: Omitted, so the fixture equality and the falsifying probe for unscoped programs can't be inspected.
- packages/lore/tests/integration/cli/compiled-root-coverage.bun.test.ts: Omitted, so the compiled-binary AC of the static-list task can't be inspected.
- Real repo .lore config floor_command: Not in the materials, so it can't be confirmed that the real floor is wired.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 1
- Unverifiable (confirmed absent — finding withdrawn): 1
- Not shown to the judge (omitted from the diff by truncation — finding withdrawn, NOT judged): 1
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

2 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [major] The AC-BCR-5 test writes floor_command into the fixture's own config. Whether the real repo's integrate floor runs scripts/check-baseline-coverage.ts is not shown, and the script itself is omitted from the diff. — "scripts/check-baseline-coverage.ts" was never shown to the judge (omitted from the truncated diff)
- [minor] The AC-BCR-6 timing evidence is a single source-mode run. A re-measurement after runnable-commands.ts switched to a static TypeScript program walk is not shown. — "packages/lore/src/adapters/cli/runnable-commands.ts" not found at commit eee01152170f7c15c7990f02351d0b7b8112c0d5

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 6 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.91
