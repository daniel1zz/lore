---
id: KN-224
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 8 decisions + 8 next steps = 16 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | SUPERSEDES handoff-64 (written before the re-verify and plan A's re-assessment). All 20 ACs re-attested pass at HEAD 989a4f5; the 2 intervening concurrent commits touched only issue-report.ts, none of the six slices' anchors | 95 |
| KD2 | T6's suppression is CONFIRMED IN PRODUCTION, not just by unit tests: plan A's re-assessment suppressed evidence_integrity from dimension_scores AND its typed_gaps entry AND the legacy gaps projection (5 gaps to 1), with unverifiable[] carrying the synthetic entry | 95 |
| KD3 | A precise per-commit diff is the largest lever on assess quality — now measured twice. Re-running plan A's assessment with one ELIMINATED the false scope_fidelity major and turned that dimension into 90/based_on=evidence, confirming it was purely a bundle artifact | 95 |
| KD4 | NS7 CONFIRMED (50% unconfirmed since handoff-55): plan membership is extra.plan_id while computePlanNowFullyTerminal and ready() query parent_id. ready() does not merely omit a diverged member — it lists it ready:true under the WRONG plan | 95 |
| KD5 | NS1's guard binds the SELF-REPORT path only, never the shared appendEvidenceEntry chokepoint: a runner tail is legitimately empty on a silent nonzero exit or timeout, so binding it would turn a reportable failed AC into a lore verify partial-abort | 95 |
| KD6 | 3 of 6 agents attested work they never committed — one recorded 7 rows and released with git log main..branch EMPTY. evidence/release have zero git-tree checks; the known subagent-stop-guard gap yields FALSE CORPUS STATE, not just lost work | 95 |
| KD7 | AC-AEP-2's premise was unsatisfiable: truncateSection measures task.content ALONE, evidence is appended outside that budget. NS2's diagnosis was wrong — the 10 evidence rows never caused that truncation. Clause withdrawn, not satisfied | 90 |
| KD8 | The non-empty-tail guard enforces FORM not CONTENT: hand-authored prose with real numbers satisfies it, and the red-first floor only fires for tasks that opted in via lore red-first — T6 archived with zero reds while its report quoted the real pre-fix failure | 95 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1: task-plan-membership-is-extra-plan-id-but-the-last-task — decide the SSOT for plan membership; cover both call sites plus the phase tier. The readiness count the dispatch discipline depends on inherits this error
- NS2: NS2: task-lore-evidence-and-lore-release-accept-an-attestation-from — refuse an attestation whose claim.worktree has uncommitted changes to declared anchors; scope to git-repo worktrees so a non-git corpus is unaffected
- NS3: NS3: task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the — have the CLI capture the tail itself (lore verify already does; only self-report lacks it), and decide whether red-first becomes opt-OUT
- NS4: NS4: task-lore-assess-derives-a-plan-s-commits-by-grepping-task — prefer making the miss LOUD and forbidding absence-scoring in that state; state what happens to the back-catalogue, none of which carries slugs in commits
- NS5: NS5: task-assess-templates-5-binds-the-projected-renderer-while-two — settle v5 policy. Knot: the registry's pre-existing policy says v5 needs no guarantee AND AC-AEP-4 requires v5 to render the projected shape, so freezing v5 conflicts two ACs of one spec
- NS6: NS6: task-ac-eti-7-proves-the-tail-window-helper-but-not-its — port the orchestrator's P2 probe into the repo as a seam test; it proved the 3-hop acRef forwarding end-to-end but lives in a scratchpad, so it cannot stop the wiring breaking tomorrow
- NS7: NS7: NOT YET FILED — build the AC-statement-drift detector (retro section 5): an AC whose statement is unchanged while every test matching its -t filter was renamed is deterministically detectable. Hit on AC-067-4: oracle green, statement false, named function deleted
- NS8: NS8: NOT YET FILED — the too-wide-range warning false-positives on test files, now measured TWICE (17 files/4 anchors, and 8 files/2 anchors). It cannot distinguish 'range too wide' from 'tests are not declared anchors'
