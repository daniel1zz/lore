---
id: KN-180
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-10
updated: 2026-10-10
tags: []
parent: PLAN-079
---
# Handoff — agent:main-orchestrator

SCOPE: 7 decisions + 8 next steps = 15 items to account for

## Plan

plan-land-oracle-executability-the-discovery-refusal-primitive

## Task Refs

(none)

## Modified Files

- packages/core/src/attestation-completeness.ts
- packages/core/src/oracle-file-existence.ts
- packages/lore/src/service/verify-runner-service.ts
- packages/lore/src/adapters/cli/evidence-precheck.ts
- packages/lore/src/service/ac-service.ts
- packages/lore/src/service/corpus-service.ts
- packages/lore/src/service/tree-check-service.ts
- packages/lore/src/adapters/cli/commands/ac.ts
- packages/dashboard/tsconfig.tests.json
- package.json
- CLAUDE.md

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | handoff-82's four genuine reds are ALL false. AC-061-7/062-3/062-5 declare paths with NO git history (mistyped at authoring, never measured anything); all three exit 0 once corrected. AC-064-7 is green today (23 passed). Real corpus defects: 0, not 4 | 95 |
| KD2 | The obvious fix is a MEASURED NO-OP: all three runners' discovery refusals carry NO summary line, so parseExecutedUnits returns null and judgeCompleteness answers unknown_runner, never zero_match. findDiscoveryRefusal is a prerequisite, not a nicety | 95 |
| KD3 | NS3-a and a root CLAUDE.md rule are BOTH FALSE: lore set --status archived DOES evaluate plan-close (corpus-service.ts:2029, default-enabled, since 6d1b25f0). Real defect: it passes VACUOUSLY — the source records 4 plans archived on a vacuous predicate | 90 |
| KD4 | NS5 understated ~13x: tests/e2e holds 27 .ts files (8 pw + 6 spec + 13 helpers), not 'two helpers', and no tsconfig resolves any of them. The exclude's reason is sound (102 TS6059 of rootDir noise); the understated count is the defect | 95 |
| KD5 | NS6 confirmed by reversible probe: routeTree.gen.ts moved aside gives typecheck:dashboard-tests exit 2 with exactly 24 errors (21 TS2345, 2 TS7006, 1 TS2307); restored byte-identical. A ready-made red-first oracle needing no new code | 95 |
| KD6 | The 29 pass_unfalsified split 19 script / 10 human, undistinguished in handoff-82. Five of the 19 carry NO path token at all, so declaration-time validation is structurally silent on them; AC-OX-4 asserts that limit rather than implying full coverage | 90 |
| KD7 | Declaration-time path validation would break red-first TDD: 'mistyped' and 'not written yet' are indistinguishable from the path alone. Resolved as spec A D8 — refuse by default, ONE audited escape, made non-silent by counting UNREDEEMED declarations | 90 |

## Failing Oracle

(none)

## Next Steps

- NS1: FIRST: 8 implementers dispatched, NONE merged/verified/done. Actors: finddiscoveryrefusal, attested-callsite, promote-primitives, predicate-provenance, tree-check-hint, demotion-notice, fresh-install-pack, typecheck-coverage. Recover via lore bootstrap + git branch -a, never a self-report
- NS2: Merge protocol unconditionally: run git branch -a and git log main..<branch> for EVERY branch, not only those an agent named — a subagent's sub-agent opens branches the parent never reports (prior cost: 726 lines stranded). Merge --no-ff with the task slug, then lore done
- NS3: Post-merge oracle MUST bypass cache (--force): turbo caches are shared across worktrees, so a plain re-run reads the agent's own cache = self-report. Also bun run build packages/core BEFORE dependent typecheck — spec A adds a new @lore/core export
- NS4: phase-2/3 tasks of this plan were NOT created. corpus-cleanup: fix the 3 mistyped commands + re-attest all 4 reds (AC-OX-6). backlog-and-arm: clear the 29 (19 script via reverse control, 10 human by hand), AC-OX-7 population union, then arm the gate
- NS5: HARD SEQUENCING: corpus-cleanup edits SPEC-061/062/064 ACs and lore ac set demotes a spec to draft, freezing EVERY descendant claim. Do not start it until phase mechanism is merged; re-read each spec's status immediately before each dispatch, never a snapshot
- NS6: Two tooling gaps have NO owning spec — see knowledge-four-governance-tooling-gaps-measured-while-resuming. G1: lore feed accepts only spec-create, so 3 of 4 deterministic gates are unfeedable. G2: status reports pass_unfalsified_count but nothing lists WHICH — needs a --list <bucket> sibling
- NS7: Root CLAUDE.md still carries the FALSE rule about lore set --status archived. Not hand-edited: the in-flight task-correct-the-tree-check-hint owns that file and AC-GV-3 checks it mechanically. Verify AC-GV-3 went green after merge; if that task failed, the false rule is still live
- NS8: A standing lesson is drafted but NOT in CLAUDE.md (same file contention): a silent gate pass, a count without its member list, and an unfeedable checkpoint are one defect in three costumes — an outcome the tool will not let you decompose. Add after merge, within the ceiling
