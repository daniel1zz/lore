---
id: KN-222
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
| KD1 | SUPERSEDES handoff-67/66/64. Only NS5 changed: two of my own framings were wrong and both altered what NS5 is. The v5 task doc is corrected to v2; read it, not 67's NS5 line | 95 |
| KD2 | CORRECTION: freezing slot 5 does NOT conflict with AC-AEP-4. That AC constrains the FUNCTIONS buildAssessPrompt and buildAssessPromptV6 — both projected, both unfrozen. Slot 6 binds a separate buildAssessPromptV6Frozen. The knot I reported was not real | 95 |
| KD3 | CORRECTION: the SSOT citation was misattributed. 'template and stamped prompt_version can never drift apart' lives at ai-provider-service.ts:515 and is about GENERATE_PROMPT_VERSION and generate templates, not assess. No explicit SSOT invariant is written for the assess path | 95 |
| KD4 | The v5 policy (assess-template.ts:62-64, predates T3) is coherent: slot 5 is SLOT-frozen, output byte-identity is EXPLICITLY disclaimed, and only its existing tests bind. 'frozen' means slot-stable, not output-frozen — the two JSDoc sites use the word in both senses three lines apart | 95 |
| KD5 | All 20 ACs across both plans re-attested pass at HEAD 989a4f5; both plans archived with the readiness invariant asserted (2/2 and 4/4 ready:false == merged tasks) | 95 |
| KD6 | T6's suppression is CONFIRMED IN PRODUCTION: plan A's re-assessment suppressed evidence_integrity from dimension_scores AND its typed_gaps entry AND the legacy gaps projection (5 gaps to 1) | 95 |
| KD7 | A precise per-commit diff is the largest lever on assess quality, measured twice. Re-running plan A with one ELIMINATED the false scope_fidelity major and turned that dimension into 90/based_on=evidence | 95 |
| KD8 | handoff-59 NS7 CONFIRMED (50% unconfirmed since handoff-55): plan membership is extra.plan_id while computePlanNowFullyTerminal and ready() query parent_id. ready() lists a diverged member ready:true under the WRONG plan | 95 |
| KD9 | The non-empty-tail guard enforces FORM not CONTENT: hand-authored prose with real numbers satisfies it, and the red-first archive floor only fires for tasks that opted in via lore red-first | 95 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1: task-plan-membership-is-extra-plan-id-but-the-last-task (high) — decide the SSOT for plan membership; cover both call sites plus the phase tier. The readiness count the dispatch discipline depends on inherits this error
- NS2: NS2: task-lore-evidence-and-lore-release-accept-an-attestation-from (high) — refuse an attestation whose claim.worktree has uncommitted changes to declared anchors; scope to git-repo worktrees
- NS3: NS3: task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the (high) — have the CLI capture the tail itself (lore verify already does; only self-report lacks it), and decide whether red-first becomes opt-OUT
- NS4: NS4: task-lore-assess-derives-a-plan-s-commits-by-grepping-task (high) — make the miss LOUD and forbid absence-scoring in that state; state what happens to the back-catalogue, none of which carries slugs in commits
- NS5: NS5: task-assess-templates-5-binds-the-projected-renderer-while-two (high, doc now at v2) — a POLICY CALL, not a defect: keep the documented drift permission but surface the disclaimer where prompt_version is persisted, or freeze slot 5 mirroring T5's slot-6 work, or remove key 5. No AC amendment needed
- NS6: NS6: task-ac-eti-7-proves-the-tail-window-helper-but-not-its (medium) — port the orchestrator's P2 probe into the repo as a seam test; deleting the acRef forwarding must turn it RED
- NS7: NS7: NOT YET FILED — the AC-statement-drift detector (retro section 5): an AC whose statement is unchanged while every test matching its -t filter was renamed is deterministically detectable. Hit on AC-067-4
- NS8: NS8: NOT YET FILED — the too-wide-range warning false-positives on test files, measured twice (17 files/4 anchors, 8 files/2 anchors). It cannot distinguish 'range too wide' from 'tests are not declared anchors'
- NS9: NS9: task-verifying-a-handoff-you-just-authored-arms-the-coverage (medium) — prefer the same-session-authorship predicate over actor identity; a single orchestrator's actor is stable across sessions
