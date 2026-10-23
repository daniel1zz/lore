---
id: KN-521
type: knowledge
role: knowledge
title: "Assessment: Implementation — CLAUDE.md content-dimension checks (split first, then metrics) (2026-08-24)"
status: archived
priority: medium
created: 2026-08-24
updated: 2026-10-23
tags: []
parent: PLAN-139
links:
  - {id: PLAN-139, type: informs}
---
# Assessment: met (86/100)

Scope: plan `01M0Q3AWW1AYDJWSS28D6MZN15`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-WIRE-1 | 92 | Attested expected-fail then pass on claude-md-wiring.test.ts; diff shows reference_missing moved to AdvisoryFindingKind in claude-md-findings.ts and advisory array added to the JSON envelope. | task-skill-implement-three-way-split-runmemoryfilechecks (evidence 3,5 pass), task-skill-test-red-oracles-for-the-three-way-split-the-sole (attested expected-fail) |
| AC-WIRE-2 | 90 | RED then GREEN attested; ISO_DATE_DENSITY_THRESHOLD is exported in claude-md-admission.ts so the test reads the constant rather than restating it. Test body itself unseen (truncated). | task-skill-implement-three-way-split-runmemoryfilechecks (evidence 4,6) |
| AC-COMPOSE-1 | 88 | Lint script passes with the full 7-function banned list after N15; diff confirms status.ts/context-flow.ts import only runMemoryFileChecks. Phase-1 diff still shows direct computeHeadroom calls, later corrected — final state evidenced by the 7-function run. | task-skill-implement-checkslugpointers-on-a-new-check-memory (evidence 5, 7 functions) |
| AC-PURE-1 | 90 | check-claude-md-purity.ts went from could-not-run (targets absent) to pass on both split modules; diff confirms both import only types from @lore/core and siblings. | task-skill-implement-three-way-split-runmemoryfilechecks (evidence 2) |
| AC-SLUG-1 | 88 | Attested expected-fail (Unknown option --check-memory-pointers) then attested pass with 9 tests including the gate-name negative case. Flag placement per N14 honored per task brief; implementation file truncated. | task-skill-implement-checkslugpointers-on-a-new-check-memory (evidence 1) |
| AC-SLUG-2 | 86 | Positive control plus real-corpus sweep named in the passing test title; attested red-then-green. Cannot inspect the sweep's file enumeration (test truncated). | task-skill-implement-checkslugpointers-on-a-new-check-memory (evidence 2) |
| AC-EMPH-1 | 86 | Red (8 skipped) then 8 passing; config.ts diff shows emphasis.max_per_kb as a zod default only, single threshold, no warn/evict fractions — matching the AC's no-ceiling-band requirement. | task-skill-implement-checkslugpointers-on-a-new-check-memory (evidence 3), packages/core/src/config.ts (emphasis block) |
| AC-EMPH-2 | 84 | Positive control plus repo sweep passes at the shipped default 3, documented above the measured 1.46 max, so it lands non-tripping. Sweep breadth unverifiable from the truncated test. | task-skill-implement-checkslugpointers-on-a-new-check-memory (evidence 4) |
| AC-GRAM-1 | 84 | Attested red then 14 passing tests naming the npm-scope exclusion class; genuine-dangling control asserted per the task brief. Grammar implementation not visible in the shown diff. | task-skill-implement-reference-grammar-repair-for-five-false (evidence 1) |
| AC-RULES-1 | 82 | Red then 6 passing CLI-subprocess tests asserting two role=rules entries and zero worktree copies. The narrowed EXCLUDED_DIR_NAMES change is in a truncated file; only the header comment edit is visible. | task-skill-implement-reference-grammar-repair-for-five-false (evidence 2) |
| AC-CONTRACT-1 | 86 | Red then 23 passing content tests plus compiled governance byte-parity e2e and assets-ssot; manifest digest for claude-md-contract.md updated in the diff. One earlier inconclusive run superseded by a clean pass. | task-skill-implement-contract-prose-rules-section-reworded (evidence 3,6) |
| AC-ADV-1 | 80 | 7 tests pass with exit 0 asserted; the oracle's own red run is attested only against no ac_ref. OFFICIAL_LINE_TARGET placement in claude-md-admission.ts is unverifiable — that file is truncated. | task-skill-implement-official-line-target-constant-plus-the (evidence 1) |
| AC-TEMPLATE-1 | 88 | Attested expected-fail then 11 passing tests covering both the asset and the setup --project installed output; template manifest sha256 updated in the diff. | task-skill-implement-contract-prose-rules-section-reworded (evidence 2,4) |

## Gaps

- Phase 1 declared packages/lore/src/service/claude-md-admission.ts's runMemoryFileChecks the sole entry while packages/lore/src/adapters/cli/commands/status.ts still called computeHeadroom/computeHeadroomWarnings from packages/lore/src/service/claude-md-budget.ts directly; the lint script's banned list omitted exactly those two, so the oracle passed over the bypass. Repaired later via N15.
- packages/lore/src/adapters/cli/claude-md-render.ts's CheckClaudeMdRenderInput takes findings/advisory/headroom/warnings as independently-supplied fields, reflecting the pre-N15 shape where status.ts computed headroom itself; the shown contract does not express the composed return type.
- The RED oracle run for packages/lore/tests/integration/claude-md-advisories.test.ts was recorded with ac_ref=(none), as were the red runs for the grammar and rules-discovery suites, so the red-to-green pairing for AC-ADV-1/AC-GRAM-1/AC-RULES-1 must be inferred from command strings rather than read from the evidence linkage.
- One AC-CONTRACT-1 verification run is inconclusive: unresolved 'vitest/config' import and a Vitest 4 poolOptions removal warning. A later clean pass supersedes it, but the toolchain instability means the passing run's environment differed from at least one attempt.

## Recommendations

- Derive the composition lint's banned-function list mechanically from the metric functions exported by the service modules instead of a hand-maintained literal, so adding a metric cannot silently bypass runMemoryFileChecks.
- Require --ac-ref on every expected-fail evidence record so each AC's red-to-green transition is machine-verifiable rather than inferred from the command string.
- Add a phase-exit check that re-reads each phase's Module Boundary claims against the code, not only its ACs, before release.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 135900ms
- Retried: true
- Truncated sections: task:task-skill-implement-checkslugpointers-on-a-new-check-memory, diff:packages/lore/tests/integration/claude-md-wiring.test.ts, diff:scripts/check-claude-md-composition.ts, diff:scripts/check-claude-md-purity.ts, diff:packages/lore/tests/integration/status-claude-md.test.ts, diff:packages/lore/tests/unit/service/claude-md-admission.test.ts, diff:packages/lore/tests/unit/service/claude-md-check.test.ts, diff:packages/lore/tests/unit/service/claude-md-headroom.test.ts, diff:packages/lore/tests/integration/claude-md-emphasis.test.ts, diff:packages/lore/tests/integration/claude-md-slug-pointers.test.ts, diff:assets/governance/claude-md-contract.md, diff:assets/project/CLAUDE.md.template, diff:packages/lore/tests/integration/claude-md-template-pointer.test.ts, diff:packages/lore/tests/unit/assets/claude-md-contract-content.test.ts, diff:packages/lore/src/adapters/cli/commands/status.ts, diff:packages/lore/src/service/claude-md-admission.ts, diff:packages/lore/src/service/claude-md-findings.ts, diff:scripts/check-claude-md-composition.ts, diff:packages/lore/tests/integration/claude-md-rules-discovery.test.ts, diff:packages/lore/tests/unit/service/claude-md-reference-grammar.test.ts, diff:packages/lore/src/service/CLAUDE.md, diff:packages/core/src/config.ts, diff:packages/lore/src/adapters/real-memory-file-probe.ts, diff:packages/lore/src/service/CLAUDE.md, diff:packages/lore/src/service/claude-md-admission.ts, diff:packages/lore/src/service/claude-md-findings.ts, diff:packages/lore/tests/integration/claude-md-advisories.test.ts, diff:packages/lore/src/adapters/cli/claude-md-render.ts, diff:packages/lore/src/service/claude-md-admission.ts, diff:packages/lore/src/service/claude-md-findings.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.75 | evidence | All 13 ACs have attested passing oracles; visible diff corroborates the split, purity, N13 migration, and single-threshold emphasis config. |
| evidence_integrity | 80 | 0.7 | evidence | Red-then-green attested for most ACs, but ratio is 0.63, three red runs lack ac_ref, and one run landed inconclusive on toolchain errors. |
| scope_fidelity | 85 | 0.7 | evidence | Phases match the plan and anchors stay disjoint; N15 was an in-scope repair of a Phase-1 boundary violation rather than new scope. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | — | Phase 1 declared packages/lore/src/service/claude-md-admission.ts's runMemoryFileChecks the sole entry while packages/lore/src/adapters/cli/commands/status.ts still called computeHeadroom/computeHeadroomWarnings from packages/lore/src/service/claude-md-budget.ts directly; the lint script's banned list omitted exactly those two, so the oracle passed over the bypass. Repaired later via N15. |
| outcome | minor | AC-ADV-1 | packages/lore/src/adapters/cli/claude-md-render.ts's CheckClaudeMdRenderInput takes findings/advisory/headroom/warnings as independently-supplied fields, reflecting the pre-N15 shape where status.ts computed headroom itself; the shown contract does not express the composed return type. |
| evidence_integrity | minor | AC-ADV-1 | The RED oracle run for packages/lore/tests/integration/claude-md-advisories.test.ts was recorded with ac_ref=(none), as were the red runs for the grammar and rules-discovery suites, so the red-to-green pairing for AC-ADV-1/AC-GRAM-1/AC-RULES-1 must be inferred from command strings rather than read from the evidence linkage. |
| evidence_integrity | minor | AC-CONTRACT-1 | One AC-CONTRACT-1 verification run is inconclusive: unresolved 'vitest/config' import and a Vitest 4 poolOptions removal warning. A later clean pass supersedes it, but the toolchain instability means the passing run's environment differed from at least one attempt. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Derive the composition lint's banned-function list mechanically from the metric functions exported by the service modules instead of a hand-maintained literal, so adding a metric cannot silently bypass runMemoryFileChecks. | N15 showed a hand-maintained list omitting exactly the two bypassed functions, making the AC and its enforcer jointly false. |
| skill | Require --ac-ref on every expected-fail evidence record so each AC's red-to-green transition is machine-verifiable rather than inferred from the command string. | Three red runs landed with ac_ref=(none), weakening the strongest signal this spec relies on. |
| plan | Add a phase-exit check that re-reads each phase's Module Boundary claims against the code, not only its ACs, before release. | The false sole-entry claim survived a green phase because no oracle tested the boundary prose. |

## Unverifiable Materials

- packages/lore/src/service/claude-md-admission.ts final contents (slug pointers, emphasis, grammar exclusions, OFFICIAL_LINE_TARGET): Listed in the truncation manifest; only the Phase 1 version is visible in the diff.
- All 12 test files for the new metrics: Omitted for budget; assertion strength judged from evidence tails and task briefs only.
- scripts/check-claude-md-composition.ts and check-claude-md-purity.ts source: Truncated; the checks' precision is inferred from their printed summary lines.
- Narrowed EXCLUDED_DIR_NAMES in packages/lore/src/adapters/real-memory-file-probe.ts: Only the header comment change is visible in the shown diff.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 5
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 13 declared criteria
- Task evidence: 10 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.63
