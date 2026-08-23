---
id: TASK-768
type: task
role: plan
title: "[Skill:test] glyph projection and the two-rule renderer scan — RED test scenarios"
status: archived
priority: critical
phase: "P1 Independent labels"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-758, type: blocks}
  - {id: TASK-767, type: supersedes}
---
⛔ RESTRUCTURED 2026-08-23: this task ABSORBED `task-skill-implement-projectaccoverageglyph-the-two-rule-site` (now invalidated, superseded by this doc). Reason, measured: `lore done` carries THREE independent conjunctive floors, and the third — `findMissingUnfilteredTestFileRuns` (`packages/lore/src/service/task-workflow-service.ts:2934`) — demands, for EACH declared `.test.ts` anchor, an `oracle:test result:pass` row running that file UNFILTERED, and offers NO escape hatch (the other two floors do: `--override-attestation`, `--declare-no-new-tests`). A RED-only task whose declared anchor IS the failing test file can therefore never archive, which deadlocks the paired impl task that `blocks` on it. Collapsing the pair into ONE archival unit satisfies all three floors truthfully: the red row comes from stage RED's agent, the attested unfiltered pass from stage GREEN's `lore verify`.

Structure: TWO SEQUENTIAL CLAIMS ON ONE TASK — stage RED then stage GREEN, each claimed by a DIFFERENT agent. Plan A D-A3 is preserved: the party that records the red must have no stake in it passing; the claim lease serialises them, and stage GREEN claims only after stage RED has released.

## Stage RED

Estimate: M
Source: AC of the paired glyph/scan task; SPEC-143 AC-CT-1, AC-CT-7, C4, C8, D7
TDD-Role: red | Paired-Impl: the AC-CT-1 + AC-CT-7 task
Dimensions: D-FUNC, D-CODE

Scenarios:
- Given all seven deriveAcCoverageState outputs, When each is projected, Then the resulting glyph set has size exactly 7 (enumerate all seven; ⛔ spot-checking two does not satisfy this).
- Given an eighth state added to the union, When tsc runs, Then the build fails at the never exhaustiveness check — a compile-failure fixture, not prose.
- Given a fixture violating ONLY scan rule 2 (a non-allowlisted function taking an AcCoverageFact and yielding a glyph), When the scan runs with --rule glyph-projection, Then it exits EXACTLY 1 naming that function.
- Given a fixture violating ONLY scan rule 1 (a .fail read outside acceptance.ts), When the scan runs with --rule glyph-projection, Then it exits EXACTLY 0 — ⛔ this direction is what proves the flag is not silently inert.
- Given a fixture violating only rule 1, When the scan runs with NO --rule flag, Then it exits EXACTLY 1 (no flag runs both rules).
- Given the scan cannot complete at all, Then it exits EXACTLY 2, distinct from a violation.

AC:
- All six scenarios exist as executable tests/fixtures.
- Running them before the implementation is RED for missing-implementation reasons.
- ⛔ Red recorded by THIS agent at the moment it is red: `lore evidence <this task> --oracle test --command "<cmd>" --result expected-fail --ac AC-CT-1 --ac AC-CT-7`.
  ⛔ The `--ac` reference is mandatory, not decoration: without it the red is free prose and "which ACs have an observed-red falsifier" stays unqueryable corpus-wide — the exact residual SPEC-143's own Falsifier-debt section names.


## Stage GREEN — absorbed verbatim from the invalidated impl task

Estimate: L
Approach: per SPEC-143 C4, C8 and D7 (v51). projectAcCoverageGlyph sits beside deriveAcCoverageState in packages/core/src/acceptance.ts and declares the glyph ALPHABET; the scan IMPORTS that alphabet and never re-lists it. Scan shape follows scripts/check-plan-membership-sites.ts (exit 1 = violation, exit EXACTLY 2 = scan broke).
Source: SPEC-143 Components C4/C8, Trade-off D7, Revision Records R2/R7/R9.
Dimensions: D-FUNC, D-CODE
Scope-Alt: the --rule selector could in principle ship as two separate scripts, but AC-CT-1 pins the flag and its non-inertness in both directions, so this is not descopable.
Covers: AC-CT-1, AC-CT-7

⛔ AC-CT-1 and AC-CT-7 are ONE task because both write scripts/check-ac-state-renderers.ts. Splitting them would put two agents on the same file; the anchor-overlap gate would stall the second.

⛔ D7 IS MECHANICALLY FORCED AND BELONGS TO THIS COMMIT. Fixing outline-service.ts::acCoveragePrefix alone turns two existing claims into falsehoods:
  - outline-service.ts:1013 JSDoc — "Mirrors AC-ACODE-9's coverage-prefix rule exactly"
  - outline-service.ts:804 JSDoc — "matching AC-ACODE-9's 无 plan 时全部 · rule"
  and SPEC-038's AC-ACODE-9 itself, whose implied prefix rule is the three-glyph one.
Amend all three in the SAME commit as the renderer change. Running `lore ac set SPEC-038 AC-ACODE-9 ...` DEMOTES SPEC-038 to draft — that is expected; do NOT try to re-approve it yourself, you cannot assert the merge landed. Report it in your return message; the main agent re-approves after merging.

AC:
- Given all seven deriveAcCoverageState outputs, When projected, Then seven pairwise-distinct glyphs result, asserted by enumerating all seven and comparing set size to 7.
- Given an eighth state, When tsc runs, Then the build fails at the never check (compile-failure fixture).
- Given outline-service.ts::acCoveragePrefix after the change, When it renders any AC, Then it delegates to the single projection and no longer reads fact.fail raw — so SPEC-136's AC-OX-1 and AC-OX-6, which hold attested passes, stop rendering as failed.
- Given --rule glyph-projection, When run against a rule-2-only violation, Then exit EXACTLY 1 naming the function; When run against a rule-1-only violation, Then exit EXACTLY 0. ⛔ Both directions required — one alone cannot tell a working selector from an inert flag.
- Given no --rule flag, When the scan runs, Then both rules run.
- Given the scan itself cannot complete, Then exit EXACTLY 2.
- Integration: the scan is wired into `bun run test` so it is INVOKED, not merely present — asserted by running `bun run test` and observing the scan execute.
- ⛔ Run both declared falsifiers once and record each: (a) make two switch arms return the same glyph → command exits EXACTLY 1; (b) add a non-allowlisted function taking an AcCoverageFact and returning a glyph → exits EXACTLY 1 naming that file.


⛔ Stage GREEN closes with `lore verify`, NOT a hand-recorded pass — one attested run of the declared AC command must also be an UNFILTERED run of every `.test.ts` anchor on this task, or the third floor above will refuse the archive.
