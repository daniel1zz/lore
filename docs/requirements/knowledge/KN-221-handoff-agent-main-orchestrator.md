---
id: KN-221
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

SCOPE: 9 decisions + 10 next steps = 19 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | SUPERSEDES handoff-68/67/66/64. READ THIS FIRST: adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the (accepted). The 7 filed defects share ONE shape and the earlier handoffs shipped them as 7 unrelated point-fixes with no lens | 95 |
| KD2 | The shape: every mechanism checks a PROXY for the property, never the property, and fails SILENT (empty-set / pass / no-op is indistinguishable from clean). Measured across 7 rows in the ADR table, not reasoned about | 95 |
| KD3 | This is INHERENT to mechanizing epistemic discipline, not a bug class to finish. So the ADR is a standing review lens: every new deterministic mechanism must answer Proxy / Silence / Opt-in in its own doc before it counts as built | 90 |
| KD4 | Dogfooding makes authorship and mechanism defects bleed: a concept-level AC ('removed from the dimension findings') was faithfully implemented against the narrowest legal reading, all its ACs passed attested, and the motivating defect survived. Question 1 applies to AC authoring too | 95 |
| KD5 | CORRECTION carried forward: freezing slot 5 does NOT conflict with AC-AEP-4 (it constrains two unfrozen FUNCTIONS; slot 6 binds a separate buildAssessPromptV6Frozen). The knot I reported was not real | 95 |
| KD6 | CORRECTION carried forward: the 'template and stamped prompt_version never drift apart (SSOT)' comment is at ai-provider-service.ts:515 and is about GENERATE_PROMPT_VERSION, not assess. Do not reuse it as an assess-side argument | 95 |
| KD7 | All 20 ACs across both plans re-attested pass at HEAD 989a4f5; both plans archived with the readiness invariant asserted (2/2 and 4/4 ready:false == merged tasks) | 95 |
| KD8 | T6's suppression is CONFIRMED IN PRODUCTION: plan A's re-assessment suppressed evidence_integrity from dimension_scores AND its typed_gaps entry AND the legacy gaps projection (5 gaps to 1) | 95 |
| KD9 | A precise per-commit diff is the largest lever on assess quality, measured twice: re-running plan A with one ELIMINATED the false scope_fidelity major and turned that dimension into 90/based_on=evidence | 95 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS0 (DO BEFORE THE OTHERS): read the ADR, then re-read each of NS1-NS6 and NS9 through its three questions. Several of those task docs propose fixes that are themselves proxies — the uncommitted-attestation predicate keys on DECLARED anchors, which is blind to undeclared ones, exactly the noAnchorOverlap limitation. Decide per task whether the proxy gap is accepted, and write that down
- NS2: NS1: task-plan-membership-is-extra-plan-id-but-the-last-task (high) — decide the SSOT for plan membership; cover both call sites plus the phase tier. The readiness count the dispatch discipline depends on inherits this error
- NS3: NS2: task-lore-evidence-and-lore-release-accept-an-attestation-from (high) — refuse an attestation whose claim.worktree has uncommitted changes to declared anchors; scope to git-repo worktrees. Apply ADR question 1 to the declared-anchor proxy before building
- NS4: NS3: task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the (high) — have the CLI capture the tail itself (lore verify already does; only self-report lacks it), and decide whether red-first becomes opt-OUT per ADR question 3
- NS5: NS4: task-lore-assess-derives-a-plan-s-commits-by-grepping-task (high) — the canonical ADR question 2 case: make the empty result LOUD and forbid absence-scoring in that state; state what happens to the back-catalogue
- NS6: NS5: task-assess-templates-5-binds-the-projected-renderer-while-two (high, doc at v2) — a POLICY CALL, not a defect: keep the documented drift permission but surface the disclaimer where prompt_version is persisted, or freeze slot 5, or remove key 5. No AC amendment needed
- NS7: NS6: task-ac-eti-7-proves-the-tail-window-helper-but-not-its (medium) — port the orchestrator's P2 probe into the repo as a seam test; deleting the acRef forwarding must turn it RED
- NS8: NS7: NOT YET FILED — the AC-statement-drift detector: an AC whose statement is unchanged while every test matching its -t filter was renamed is deterministically detectable. Hit on AC-067-4 (oracle green, statement false, named function deleted)
- NS9: NS8: NOT YET FILED — the too-wide-range warning false-positives on test files, measured twice (17 files/4 anchors, 8 files/2 anchors). It cannot distinguish 'range too wide' from 'tests are not declared anchors'
- NS10: NS9: task-verifying-a-handoff-you-just-authored-arms-the-coverage (medium) — prefer the same-session-authorship predicate over actor identity; a single orchestrator's actor is stable across sessions
