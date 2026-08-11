---
id: KN-210
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-02
updated: 2026-08-03
tags: []
parent: PRD-001
---
> ⚠ INVALIDATED 2026-08-03T04:22:02.595Z — superseded by knowledge-handoff-agent-main-orchestrator-74; Written prematurely — the orchestrator mistook 'the approved batch is done' for 'the session should close', then kept working for many more hours. Of its 6 next-steps, 5 were completed and archived in this same session (getassesstemplatereproducibility, mcp-assess-adapter, plan-membership, output-tail, uncommitted-attestation). Superseded by handoff-74, which reflects the actual end state: 14 tasks archived, 5 filed-and-open, and one unanswered governance question.

# Handoff — agent:main-orchestrator

SCOPE: 5 decisions + 6 next steps = 11 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | READ FIRST: adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the. All 7 filed defect tasks now carry a binding Proxy/Silence/Opt-in section in their OWN doc, and it OVERRULES the fix 3 of them originally proposed (NS3 anchor-scoped predicate, NS5 candidate 2, NS6 option b) | 95 |
| KD2 | Dispatch-bundle prose is measurably NOT a mechanism: two implementers each recorded 8 pass rows with ZERO-length output_tail, the second AFTER the bundle quoted the first as a warning. Conclusion tightened: CLI capture must be the DEFAULT path for a pass row, never an opt-in flag | 95 |
| KD3 | Six of seven observed agents passed through 'uncommitted implementation + EMPTY branch' — the majority mid-flight state, not a tail risk. One did not survive: watchdog-killed, then its worktree DELETED mid-run with 458 uncommitted lines and a live claim | 95 |
| KD4 | All 3 dispatched tasks archived via --override-attestation, NOT implementer evidence: every implementer row was self-reported with an empty tail, so the orchestrator re-ran every oracle itself on merged main. The new attested-pass floor correctly refused the first attempt with exit 4 | 95 |
| KD5 | NS6 shipped INERT: getAssessTemplateReproducibility has zero production callers and ai-provider-service.ts mentions 'reproducible' 0 times, so every real assess run leaves it absent and the presence-guarded renderers never fire. Verified by grep on merged main | 95 |

## Failing Oracle

(none)

## Next Steps

- NS1: task-getassesstemplatereproducibility-has-zero-production (high) — stamp reproducible in _finalizeAssessment from the SAME version stamped as prompt_version. The oracle MUST drive a real lore assess run; a unit test over _finalizeAssessment reproduces the very defect
- NS2: task-the-mcp-assess-adapter-still-calls-derivecommitsetforplan (high) — add the 3 CLI-sibling steps at tools.ts:1611, THEN drop the optional defaults so typecheck enforces future adapters; that removal is the actual mechanization
- NS3: task-plan-membership-is-extra-plan-id-but-the-last-task and task-a-non-empty-output-tail-can-be-hand-authored-prose (both high) — blocked on files held by a concurrent session; re-measure contention first, those blocker notes are explicitly non-durable
- NS4: task-lore-evidence-and-lore-release-accept-an-attestation-from (high) — priority raised by the 6-of-7 recurrence data now in the doc. Predicate already decided: whole-worktree porcelain, NOT anchor-scoped
- NS5: Filed with full three-question reviews, none dispatched: task-the-session-start-marker-collapses-five-distinct, task-ac-eti-7-proves-the-tail-window-helper-but-not-its, task-ac-statement-drift-is-deterministically-detectable-an, task-computescopemismatchwarning-cannot-distinguish-a-too-wide
- NS6: UNANSWERED USER QUESTION (asked 3x, do not decide alone): file the actor-collapse finding as its own task? Two live orchestrators both resolved to agent:main-orchestrator, collapsing SPEC-042 sessions (active_sessions reads []) and disabling noAnchorOverlap
