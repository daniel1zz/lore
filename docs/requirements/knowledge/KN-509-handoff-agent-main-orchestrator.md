---
id: KN-509
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
---
# Handoff — agent:main-orchestrator

SCOPE: 7 decisions + 13 next steps = 20 items to account for

## Plan

plan-land-corpus-truthfulness-part-a-the-two-axis-type

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Wave 1's three RED tasks landed; I reproduced each red on merged main myself. T1 exit 1, 4 failed, runner row printed with attestation undefined, zero FIXTURE FAILURE. T0 exit 1, 10/6, 27 MISSING IMPLEMENTATION. T2 exit 1, 10/4. typecheck exits 0 with all three in the tree. | 98 |
| KD2 | lore done has THREE conjunctive floors. Floor 3 (findMissingUnfilteredTestFileRuns, task-workflow-service.ts:2934) demands an UNFILTERED result:pass per .test.ts anchor and has NO escape, so a RED-only task owning the failing file can never archive. The 15-task shape deadlocked all 7 pairs. | 98 |
| KD3 | I recommended --override-attestation before measuring whether it clears the gate; it clears only floor 1. Corrected in-session, user re-decided. Same error class CLAUDE.md names: pinning a route without measuring it. | 97 |
| KD4 | Plan A restructured 15 to 8 tasks (D-A8): each RED/impl pair is now ONE task taking two sequential claims by two agents. Zero overrides on 6 of 7 pairs. T0 needs exactly one (D-A9): SPEC-143 C1/C2 carries NO acceptance criterion, so lore verify has nothing to bind to. | 96 |
| KD5 | The collapse traded a MECHANICAL independence guarantee for CONVENTION (D-A10), raised by lore review and correct: nothing compares recorded_by on the red row against the attesting pass. Recorded as a named loss with the predicate it needs; deliberately NOT closed mid-wave. | 97 |
| KD6 | Nine of ten recorded governance gaps came from the implementer agents or lore review; my own self-check found ONE. Four plan-doc review rounds each surfaced real staleness, three instances of it mine. | 96 |
| KD7 | dist/lore rebuilt after the wave's last merge (INV-6): provenance clean at HEAD b7f1222d, build_dirty false. lore status --check-tree --check-drift exits 0 over 93 specs. | 98 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1: plan A is draft v9 awaiting its 4th review then lore approve. Earlier rounds found real defects, three mine: the 8-vs-7 pair count, D-A2's superseded 6-unit claim with no AMENDED marker, an S/M/L label no single size expresses, a pre-collapse anchor-overlap basis, pre-collapse AC-CT-5 risk phrasing.
- NS2: NS2: Dispatch the three GREEN stages onto the SAME tasks the RED agents released: task-skill-test-two-axis-type-foundation-red-test-scenarios (P0 critical), task-skill-test-glyph-projection-and-the-two-rule-renderer-scan, task-skill-test-evidence-capture-attestation-red-test-scenarios. Each MUST use a LORE_ACTOR different from its RED agent (ct-t0-test-types / ct-t2-test-glyph / ct-t1-test-attest) and NOTHING enforces that (D-A10).
- NS3: NS3: T2's green stage carries D7 and WILL demote SPEC-038 -- amends AC-ACODE-9 plus outline-service.ts JSDoc at lines 804 and 1013 in the same commit as the renderer fix. The implementer cannot re-approve, so the main agent runs lore review plus lore approve on SPEC-038 right after merging T2. Carried from the prior handoff, still open.
- NS4: NS4: T2's second test anchor packages/lore/tests/unit/scripts/check-ac-state-renderers.test.ts is run by NO AC command (AC-CT-7's command is bun scripts/check-ac-state-renderers.ts), so floor 3 needs one extra truthful unfiltered oracle:test result:pass row on it beyond lore verify.
- NS5: NS5: Scan contract the RED agent had to INVENT and the green stage must honour: env override LORE_AC_STATE_RENDERERS_REPO_ROOT mirroring LORE_ANCHOR_COVERAGE_REPO_ROOT; set-but-EMPTY exits 2 rather than falling through to the real repo; exits 0/1/2 (check-anchor-coverage's shape, not check-plan-membership-sites' 3/4); violations name both the function and the repo-relative file.
- NS6: NS6: Rule 1 hits 12 sites across FOUR files, not just outline-service.ts -- also packages/core/src/evidence-panel.ts, packages/lore/src/ai/assess-template.ts, packages/lore/src/service/phase-workflow-service.ts. Each needs a written-reason allowlist entry or the matcher must narrow, else T2's clean-mirror control cannot go green.
- NS7: NS7: Type-foundation symbols live in packages/lore/src/service/gate-predicates.ts (StampClass, RadiusMeasurement, StampCurrency, StampVerdict, readStampVerdict) and packages/core/src/task-workflow.ts (StateStamp, ARMING_REV) per SPEC-143's Scope table, NOT @lore/core. My wave-1 bundle said @lore/core and was wrong; the agent correctly followed the spec over the bundle.
- NS8: NS8: Ten gaps recorded in knowledge-ten-measured-gaps-from-landing-plan-a-wave-1-and-the, NONE fixed. Best next mechanization is D-A10's predicate (compare recorded_by across red and attesting-pass rows) since it needs no new measurement. Also open: lore evidence --ac silently drops the ref when passed twice; packages/core/tests is typechecked by nothing; a worktree runtime import of @lore/core measures MAIN's source; mirror-human-id-brand.bun.test.ts is broken in every worktree with one vacuous pass; task file_anchors are not drift-checked; the scratchpad is shared across concurrent agents.
- NS9: NS9: Raw readiness, never inferred: plan A reads 8 records, 3 ready, 0 archived, 0 anchor_conflicts. SPEC-143 approved v51, SPEC-038 approved. This repo has NO reachable git remote (origin-local fetch fails, its ref is an ancestor of main), so the dispatch precondition git pull --rebase origin main has no object here.
- NS10: NS10: Three merged worktrees of mine remain (agent-a09cc6dfe2d48bde5, agent-a133fc0c569a31f0a, agent-aba5b518c757ff750), all 0 ahead of main. The git-safety-gate CORRECTLY refused removal because the 30-minute reflog quiet window had not elapsed. Remove after it has and do NOT bypass. A peer holds agent-a68cfe83fe614181e, also 0 ahead but NOT mine.
- NS11: NS11: AC-CT-6 is still in NEITHER plan (spec Migration Phase 3) and its advisory-first N (warn plus audit row for N clean runs) was never defined. Carried unchanged.
- NS12: NS12: Part B scope RE-CONFIRMED against lore ac list SPEC-143 this session: set of 10, part B = AC-CT-9 plus AC-CT-10, AC-CT-6 out of scope. Matches the plan's Scope table. Cut part B after plan A merges.
- NS13: NS13: The prior handoff's NS5 is confirmed AT THE SOURCE: prd-sync-domain-doc.ts:51-79 requires the ancestor spec's parent or implements target to be type spec and explicitly excludes prd, and SPEC-143's parent is the root PRD, so plan-close reads prdOutlineSynced as NOT-APPLICABLE. Do NOT wire a fake spec-typed edge to force the gate; that is gaming it.
