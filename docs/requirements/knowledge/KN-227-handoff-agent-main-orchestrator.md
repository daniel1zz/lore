---
id: KN-227
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

SCOPE: 7 decisions + 7 next steps = 14 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | NS7 CONFIRMED (50% unconfirmed since handoff-55): the advisory misfires because plan membership is extra.plan_id while computePlanNowFullyTerminal and ready() query parent_id. ready() does not merely omit a diverged member — it lists it ready:true under the WRONG plan | 95 |
| KD2 | NS1's guard binds the SELF-REPORT path only, never the shared appendEvidenceEntry chokepoint: a runner tail is legitimately empty on a silent nonzero exit or timeout, so binding it would turn a reportable failed AC into a lore verify partial-abort | 95 |
| KD3 | 3 of 6 agents attested work they never committed — one recorded 7 rows and released with git log main..branch EMPTY. evidence/release have zero git-tree checks; the known subagent-stop-guard gap yields FALSE CORPUS STATE, not just lost work | 95 |
| KD4 | T4's suppression was incomplete (typed_gaps and legacy gaps still published what unverifiable[] claimed was suppressed). Root cause was MY AC naming a concept ('dimension findings') instead of enumerating fields. Fixed in-session by T6 | 90 |
| KD5 | AC-AEP-2's premise was unsatisfiable: truncateSection measures task.content ALONE, evidence is appended outside that budget. NS2's diagnosis was wrong — the 10 evidence rows never caused that truncation. Clause withdrawn, not satisfied | 90 |
| KD6 | A precise per-commit diff is the largest lever on assess quality: without one the judge produced a FALSE major and missed the real defect; with one built from exactly the plan's 4 task commits, all 6 findings checked out true | 85 |
| KD7 | The non-empty-tail guard enforces FORM not CONTENT: hand-authored prose with real numbers satisfies it, and the red-first floor only fires for tasks that opted in via lore red-first — T6 archived with zero reds while its report quoted the real pre-fix failure | 95 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1: task-plan-membership-is-extra-plan-id-but-the-last-task — decide the SSOT for plan membership; cover both call sites plus the phase tier. The readiness count the dispatch discipline depends on inherits this error
- NS2: NS2: task-lore-evidence-and-lore-release-accept-an-attestation-from — refuse an attestation whose claim.worktree has uncommitted changes to declared anchors; scope to git-repo worktrees so a non-git corpus is unaffected
- NS3: NS3: task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the — have the CLI capture the tail itself (lore verify already does; only self-report lacks it), and decide whether red-first becomes opt-OUT
- NS4: NS4: task-lore-assess-derives-a-plan-s-commits-by-grepping-task — prefer making the miss LOUD and forbidding absence-scoring of scope_fidelity in that state; state what happens to the back-catalogue, none of which carries slugs in commits
- NS5: NS5: task-assess-templates-5-binds-the-projected-renderer-while-two — settle v5 policy. Knot: the registry's pre-existing policy says v5 needs no guarantee AND AC-AEP-4 requires v5 to render the projected shape, so freezing v5 conflicts two ACs of one spec. The false 'frozen v5 entry' JSDoc goes regardless
- NS6: NS6: NOT YET FILED — build the AC-statement-drift detector (retro section 5): an AC whose statement is unchanged while every test matching its -t filter was renamed is deterministically detectable. Hit this session on AC-067-4: oracle green, statement false, named function deleted
- NS7: NS7: NOT YET FILED — the too-wide-range warning false-positives on test files: it warned on 8 changed files vs declared anchors, but 6 were tests and anchors name source only. It cannot distinguish 'range too wide' from 'tests are not anchors'
