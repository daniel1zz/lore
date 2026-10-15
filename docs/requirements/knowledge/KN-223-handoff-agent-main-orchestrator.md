---
id: KN-223
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-10-10
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 9 decisions + 9 next steps = 18 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | SUPERSEDES handoff-66 and handoff-64. 66 was written before task-verifying-a-handoff-you-just-authored-arms-the-coverage was filed, so it is missing NS9. Nothing else changed | 95 |
| KD2 | All 20 ACs across both plans re-attested pass at HEAD 989a4f5; both plans archived with the readiness invariant asserted (2/2 and 4/4 ready:false == merged tasks) | 95 |
| KD3 | T6's suppression is CONFIRMED IN PRODUCTION, not just by unit tests: plan A's re-assessment suppressed evidence_integrity from dimension_scores AND its typed_gaps entry AND the legacy gaps projection (5 gaps to 1) | 95 |
| KD4 | A precise per-commit diff is the largest lever on assess quality, measured twice. Re-running plan A with one ELIMINATED the false scope_fidelity major and turned that dimension into 90/based_on=evidence | 95 |
| KD5 | NS7 of handoff-59 CONFIRMED (50% unconfirmed since handoff-55): plan membership is extra.plan_id while computePlanNowFullyTerminal and ready() query parent_id. ready() lists a diverged member ready:true under the WRONG plan | 95 |
| KD6 | The non-pass tail guard binds the SELF-REPORT path only, never the shared appendEvidenceEntry chokepoint: a runner tail is legitimately empty on a silent nonzero exit or timeout | 95 |
| KD7 | 3 of 6 agents attested work they never committed — one recorded 7 rows and released with git log main..branch EMPTY. evidence/release have zero git-tree checks; that gap yields FALSE CORPUS STATE, not just lost work | 95 |
| KD8 | AC-AEP-2's premise was unsatisfiable: truncateSection measures task.content ALONE, evidence is appended outside that budget. NS2's original diagnosis was wrong — the 10 evidence rows never caused that truncation | 90 |
| KD9 | The non-empty-tail guard enforces FORM not CONTENT: hand-authored prose with real numbers satisfies it, and the red-first archive floor only fires for tasks that opted in via lore red-first | 95 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1: task-plan-membership-is-extra-plan-id-but-the-last-task (high) — decide the SSOT for plan membership; cover both call sites plus the phase tier. The readiness count the dispatch discipline depends on inherits this error
- NS2: NS2: task-lore-evidence-and-lore-release-accept-an-attestation-from (high) — refuse an attestation whose claim.worktree has uncommitted changes to declared anchors; scope to git-repo worktrees
- NS3: NS3: task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the (high) — have the CLI capture the tail itself (lore verify already does; only self-report lacks it), and decide whether red-first becomes opt-OUT
- NS4: NS4: task-lore-assess-derives-a-plan-s-commits-by-grepping-task (high) — make the miss LOUD and forbid absence-scoring in that state; state what happens to the back-catalogue, none of which carries slugs in commits
- NS5: NS5: task-assess-templates-5-binds-the-projected-renderer-while-two (high) — settle v5 policy. Knot: the registry's pre-existing policy says v5 needs no guarantee AND AC-AEP-4 requires v5 to render the projected shape
- NS6: NS6: task-ac-eti-7-proves-the-tail-window-helper-but-not-its (medium) — port the orchestrator's P2 probe into the repo as a seam test; deleting the acRef forwarding must turn it RED
- NS7: NS7: NOT YET FILED — the AC-statement-drift detector (retro section 5): an AC whose statement is unchanged while every test matching its -t filter was renamed is deterministically detectable. Hit on AC-067-4: oracle green, statement false, named function deleted
- NS8: NS8: NOT YET FILED — the too-wide-range warning false-positives on test files, measured twice (17 files/4 anchors, 8 files/2 anchors). It cannot distinguish 'range too wide' from 'tests are not declared anchors'
- NS9: NS9: task-verifying-a-handoff-you-just-authored-arms-the-coverage (medium) — prefer the same-session-authorship predicate over actor identity; a single orchestrator's actor is stable across sessions, so actor alone would break legitimate cross-session resumes
