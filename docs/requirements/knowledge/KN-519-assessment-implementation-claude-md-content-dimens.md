---
id: KN-519
type: knowledge
role: knowledge
title: "Assessment: Implementation — CLAUDE.md content-dimension checks (split first, then metrics) (2026-08-23)"
status: approved
priority: medium
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-139
links:
  - {id: PLAN-139, type: informs}
---
# Assessment: met (84/100)

Scope: plan `01M0Q3AWW1AYDJWSS28D6MZN15`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-WIRE-1 | 90 | Two attested passing CLI-subprocess runs; diff shows N13 migration (reference_missing removed from MemoryFileFindingKind, added to AdvisoryFindingKind) and advisory array plumbed into the JSON payload. | task-skill-implement-three-way-split-runmemoryfilechecks (evidence [3],[5]) |
| AC-WIRE-2 | 88 | Attested passes on the boundary test; ISO_DATE_DENSITY_THRESHOLD now exported so the test reads it rather than restating. Threshold semantics (>=) preserved verbatim in the moved code. | task-skill-implement-three-way-split-runmemoryfilechecks (evidence [4],[6]) |
| AC-COMPOSE-1 | 85 | Phase 1's script checked only 5 functions and passed while headroom bypassed the entry; N15 extended it to 7 and Phase 2 re-ran it green. Final lint output names all 7. Script contents unseen (truncated). | task-skill-implement-checkslugpointers-on-a-new-check-memory (evidence [5], 7-function check) |
| AC-PURE-1 | 88 | Lint pass attested; visible diff confirms claude-md-budget.ts and claude-md-admission.ts import only @lore/core types plus sibling type modules, with IO via injected fileExists/docExists. | task-skill-implement-three-way-split-runmemoryfilechecks (evidence [2]) |
| AC-SLUG-1 | 85 | Red-then-green attested (red showed 'Unknown option: --check-mem'); green run names the HAPPY case with exit code exactly 3. Implementation file truncated, so grammar (plan-close exclusion) unverified directly. | task-skill-implement-checkslugpointers-on-a-new-check-memory (evidence [1]) |
| AC-SLUG-2 | 85 | Attested pass on the positive-control-plus-real-corpus-sweep describe, satisfying the non-vacuity requirement; prior expected-fail recorded by the test author. | task-skill-implement-checkslugpointers-on-a-new-check-memory (evidence [2]) |
| AC-EMPH-1 | 85 | Attested pass; config diff shows a single-threshold emphasis.max_per_kb block with no warn/evict fractions (N5) and a documented version floor. Test body truncated, so 'never restate the number' is unverified. | task-skill-implement-checkslugpointers-on-a-new-check-memory (evidence [3]) |
| AC-EMPH-2 | 85 | Attested pass on the positive-control-plus-repo-sweep describe. Default 3 sits above the documented measured max (~1.46/KB), consistent with N6's non-tripping requirement. | task-skill-implement-checkslugpointers-on-a-new-check-memory (evidence [4]) |
| AC-GRAM-1 | 85 | Red-then-green attested; 14 tests pass including the named npm-scope exclusion case. Repaired grammar in claude-md-admission.ts is truncated, so exclusion precision is judged from test names only. | task-skill-implement-reference-grammar-repair-for-five-false (evidence [1]) |
| AC-RULES-1 | 82 | Attested green CLI test (6 tests) after a recorded red. Narrowing of EXCLUDED_DIR_NAMES in real-memory-file-probe.ts is not visible in the shown diff hunk, so precision vs .claude/worktrees/ rests on the test. | task-skill-implement-reference-grammar-repair-for-five-false (evidence [2]) |
| AC-CONTRACT-1 | 78 | Attested pass over contract-content, compiled governance parity and assets-ssot; manifest digests updated in the diff. A later run of the same command was recorded 'inconclusive' (vitest/config resolution), leaving the final state slightly muddied. | task-skill-implement-contract-prose-rules-section-reworded (evidence [3] pass, [5] inconclusive) |
| AC-ADV-1 | 84 | Attested green (7 tests) after a recorded red run. Assertions are on JSON kinds/fields per the task brief; OFFICIAL_LINE_TARGET and the advisory emitters live in truncated files. | task-skill-implement-official-line-target-constant-plus-the (evidence [1]) |
| AC-TEMPLATE-1 | 88 | Red-then-green attested (11 tests); template asset sha256 changed in the regenerated manifest, corroborating that the pointer actually shipped. | task-skill-implement-contract-prose-rules-section-reworded (evidence [2] red, [4] green) |

## Gaps

- Phase 1 recorded AC-COMPOSE-1 as passing while packages/lore/src/adapters/cli/commands/status.ts called computeHeadroom/computeHeadroomWarnings directly, bypassing the declared sole entry — scripts/check-claude-md-composition.ts checked only 5 names. The pass was vacuous until N15 widened it to 7.
- The AC-CONTRACT-1 command chain has both a pass and a later 'inconclusive' record (vitest/config unresolved, poolOptions deprecation), so the most recent recorded run of that oracle is not a clean pass over assets/governance/claude-md-contract.md.
- The repaired reference grammar and rules discovery are only verifiable through test names: packages/lore/src/service/claude-md-admission.ts and packages/lore/src/adapters/real-memory-file-probe.ts are truncated, so exclusion-class precision and the narrowed .claude exclusion cannot be inspected.
- Phase 3 recorded oracle=tsc result=fail for `bun run typecheck` and then a pass for the narrower typecheck:core/typecheck:lore pair; the repo-wide typecheck failure is never shown resolved.
- No linked knowledge doc captures the N12/N13/N15 lessons (a declared sole entry enforced by an under-specified checker), so the reasoning that produced the correction is not durable outside this bundle.

## Recommendations

- Generate AC-enforcing lint scripts' banned-name lists from the spec text mechanically, and fail the script when its list is narrower than the AC's enumeration.
- Require the final recorded run of every AC oracle to be a pass; an 'inconclusive' recorded after a pass should force a re-run before release.
- Treat a failing broad oracle (`bun run typecheck`) as blocking rather than substitutable by narrower per-package variants.
- When a spec declares a module boundary ('sole entry'), require the enforcing AC to enumerate every function in that module's public surface, not a hand-picked subset.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 135616ms
- Retried: true
- Truncated sections: task:task-skill-implement-checkslugpointers-on-a-new-check-memory, diff:packages/lore/tests/integration/claude-md-wiring.test.ts, diff:scripts/check-claude-md-composition.ts, diff:scripts/check-claude-md-purity.ts, diff:packages/lore/tests/integration/status-claude-md.test.ts, diff:packages/lore/tests/unit/service/claude-md-admission.test.ts, diff:packages/lore/tests/unit/service/claude-md-check.test.ts, diff:packages/lore/tests/unit/service/claude-md-headroom.test.ts, diff:packages/lore/tests/integration/claude-md-emphasis.test.ts, diff:packages/lore/tests/integration/claude-md-slug-pointers.test.ts, diff:assets/governance/claude-md-contract.md, diff:assets/project/CLAUDE.md.template, diff:packages/lore/tests/integration/claude-md-template-pointer.test.ts, diff:packages/lore/tests/unit/assets/claude-md-contract-content.test.ts, diff:packages/lore/src/adapters/cli/commands/status.ts, diff:packages/lore/src/service/claude-md-admission.ts, diff:packages/lore/src/service/claude-md-findings.ts, diff:scripts/check-claude-md-composition.ts, diff:packages/lore/tests/integration/claude-md-rules-discovery.test.ts, diff:packages/lore/tests/unit/service/claude-md-reference-grammar.test.ts, diff:packages/lore/src/service/CLAUDE.md, diff:packages/core/src/config.ts, diff:packages/lore/src/adapters/real-memory-file-probe.ts, diff:packages/lore/src/service/CLAUDE.md, diff:packages/lore/src/service/claude-md-admission.ts, diff:packages/lore/src/service/claude-md-findings.ts, diff:packages/lore/tests/integration/claude-md-advisories.test.ts, diff:packages/lore/src/adapters/cli/claude-md-render.ts, diff:packages/lore/src/service/claude-md-admission.ts, diff:packages/lore/src/service/claude-md-findings.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 86 | 0.7 | evidence | All 13 ACs have attested passing script/test oracles, each preceded by a recorded red run; visible diff corroborates the split, N13 migration and single-threshold emphasis config. |
| evidence_integrity | 74 | 0.65 | evidence | Red-then-green discipline is real and attested, but ratio 0.63, one inconclusive AC-CONTRACT-1 rerun, a failing broad typecheck, and a formerly vacuous AC-COMPOSE-1 checker temper trust. |
| scope_fidelity | 88 | 0.7 | evidence | Phases land in the declared order with disjoint anchors; no ac_scope restriction; the only drift (headroom outside the sole entry) was detected and repaired in-plan via N15. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-COMPOSE-1 | Phase 1 recorded AC-COMPOSE-1 as passing while packages/lore/src/adapters/cli/commands/status.ts called computeHeadroom/computeHeadroomWarnings directly, bypassing the declared sole entry — scripts/check-claude-md-composition.ts checked only 5 names. The pass was vacuous until N15 widened it to 7. |
| evidence_integrity | minor | AC-CONTRACT-1 | The AC-CONTRACT-1 command chain has both a pass and a later 'inconclusive' record (vitest/config unresolved, poolOptions deprecation), so the most recent recorded run of that oracle is not a clean pass over assets/governance/claude-md-contract.md. |
| outcome | minor | AC-GRAM-1 | The repaired reference grammar and rules discovery are only verifiable through test names: packages/lore/src/service/claude-md-admission.ts and packages/lore/src/adapters/real-memory-file-probe.ts are truncated, so exclusion-class precision and the narrowed .claude exclusion cannot be inspected. |
| evidence_integrity | minor | AC-RULES-1 | Phase 3 recorded oracle=tsc result=fail for `bun run typecheck` and then a pass for the narrower typecheck:core/typecheck:lore pair; the repo-wide typecheck failure is never shown resolved. |
| outcome | minor | AC-ADV-1 | No linked knowledge doc captures the N12/N13/N15 lessons (a declared sole entry enforced by an under-specified checker), so the reasoning that produced the correction is not durable outside this bundle. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Generate AC-enforcing lint scripts' banned-name lists from the spec text mechanically, and fail the script when its list is narrower than the AC's enumeration. | AC-COMPOSE-1 passed while the exact bypass it forbids existed, because the checker enumerated 5 of 7 names. |
| plan | Require the final recorded run of every AC oracle to be a pass; an 'inconclusive' recorded after a pass should force a re-run before release. | AC-CONTRACT-1's last record is inconclusive, weakening an otherwise green trail. |
| process | Treat a failing broad oracle (`bun run typecheck`) as blocking rather than substitutable by narrower per-package variants. | A recorded tsc fail sits unresolved beside narrower passes. |
| spec | When a spec declares a module boundary ('sole entry'), require the enforcing AC to enumerate every function in that module's public surface, not a hand-picked subset. | N15 existed only because the boundary statement and its AC were authored independently. |

## Unverifiable Materials

- scripts/check-claude-md-composition.ts and scripts/check-claude-md-purity.ts: Omitted from the diff; their pass semantics (what counts as a reference) cannot be inspected, only their printed summary lines.
- Test bodies for all 8 new/updated suites: Truncated; anti-dual-write claims (reading thresholds from exported constants/config rather than restating numbers) rest on task briefs and test names.
- Final contents of packages/lore/src/service/claude-md-admission.ts: Phase 2-4 additions (checkSlugPointers, measureEmphasis, OFFICIAL_LINE_TARGET, grammar repair) are not shown in the diff.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 5
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 13 declared criteria
- Task evidence: 10 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.63
