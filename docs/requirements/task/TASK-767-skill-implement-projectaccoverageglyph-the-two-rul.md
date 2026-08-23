---
id: TASK-767
type: task
role: plan
title: "[Skill:implement] projectAcCoverageGlyph, the two-rule site scan, and D7's same-commit SPEC-038 amendment"
status: draft
priority: critical
phase: "P1 Independent labels"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-758, type: blocks}
---
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
