---
id: KN-277
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 6 decisions + 6 next steps = 12 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | SUPERSEDES handoff-47 (same thread: the handoff-46 resume). Note actor collision — several concurrent sessions write handoffs as agent:main-orchestrator, so latest-by-actor is ambiguous; resume by explicit slug only. | 95 |
| KD2 | Everything actionable by an agent is now closed. NS1+NS2 landed, attested (AC-GS 8/8, AC-SL 8/8), plans assessed+archived; NS4 done; NS5 done; NS6 deferred on measurement. Remaining items all require the OWNER's shell or an owner decision. | 95 |
| KD3 | AC-SL-8's open recommendation is RESOLVED without code: line 440 is toBeGreaterThanOrEqual(SUITE_CASE_FLOOR) — a floor, plus a self-pinned constant at :452 and a skip/todo/only guard at :458. The audit gap was that the RECORD did not say so; the measurement is now in the assessment doc. | 95 |
| KD4 | The dashboard doc's reject is resolved by fixing what the judge named, not by bypassing: six numbered verdicts vs a five-in-title, parenthetical listing four. Corrected from the doc's own body; judge re-ran approve 0.86 (was reject 0.72). | 92 |
| KD5 | The escalate I filed away is now durably recoverable: its three blocking questions are preserved verbatim in a retro linked to the source doc, because an approved doc resurfaces in no queue and nothing reads review_judgments.blocking_questions back. | 90 |
| KD6 | Declined to route around two safety-gate refusals. Both targets are provably worthless (a stash byte-identical to 46e1157; a 2-line regenerated manifest in a dead session's worktree), but my judging them worthless is exactly the judgment the gate is designed not to trust from an agent. | 85 |

## Failing Oracle

(none)

## Next Steps

- NS1: OWNER's shell, NS3: drop the stash entry at index 0 — redundant copy of the settings.json hook registration, byte-identical to commit 46e1157, cmp-verified twice. The git-safety gate refuses it and says to ask you.
- NS2: OWNER's shell: remove the stale worktree fullsuite-wt (session 495922ce, dead ~24h). Its only dirty content is 2 lines of regenerated assets-manifest.ts (tree_digest + corpus-workflow.md sha) — a build byproduct. Non-force removal refuses it; clearing needs --force, which the gate blocks.
- NS3: OWNER decision, the three blocking questions: read knowledge-an-ungated-approve-is-not-a-mechanized-approve-a. They concern PRD G9's data gate vs auto-approve, whether freezing committed G5/G6 needs an ADR or PRD amendment, and how writer-not-approver is decided under branch-derived actors.
- NS4: OWNER policy: should judgment_required_types include knowledge, or should escalate alone gate every type? Three options with tradeoffs are in that same retro. checkReviewJudgment already separates JUDGMENT_ESCALATED_REASON from JUDGMENT_REJECTED_REASON, so an escalate-only split has a natural seam.
- NS5: Cheap adjacent improvement nobody owns yet: surface an unanswered escalate's blocking_questions on direct-address reads of the doc, the way SPEC-043 shows an invalidation banner. Makes the questions visible regardless of which types are gated.
- NS6: Two pending ADRs stay correctly BLOCKED by the review-judgment gate (adr-product-skill-chain escalate, adr-distribution-first reject) — they need their authors to address the judgments, not an approve. A third (adr-lore-verify, 9h old) was skipped deliberately as too fresh to touch.
