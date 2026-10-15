---
id: KN-211
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-03
updated: 2026-10-10
tags: []
parent: PRD-001
links:
  - {id: KN-210, type: supersedes}
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
| KD1 | ADR three-question review (Proxy/Silence/Opt-in) is a BINDING lens, not advice: every filed defect task carries its verdict in its own doc, and in 4 cases it OVERRULED the fix the task body originally proposed. Read a task's verdict section before touching it | 95 |
| KD2 | Prose in a dispatch bundle is measurably NOT a mechanism — two implementers each recorded 8 zero-tail pass rows, the second AFTER the bundle quoted the first as a warning. Now closed mechanically: a self-reported pass without captured output is REFUSED (82157f3) | 95 |
| KD3 | AC-067-4 is a BAD precedent and people will copy it. Rewriting a falsified AC as a supersession NOTE makes it un-checkable — the AI judge caught this. Correct repair: restate the criterion to pin CURRENT behaviour, supersession as a trailing clause. Cost 0.74/3-advisory vs 0.82/0 | 90 |
| KD4 | Two branches can each be fully green and still produce a red on merge — the 8-sites fixture recorded a tail-less pass that NS4's new floor refused. Only a WIDE post-merge rerun catches this; per-branch scoped oracles structurally cannot | 95 |
| KD5 | All 14 archivals used --override-attestation, never implementer evidence alone: ad-hoc tasks have no script-mode AC so lore verify is structurally unreachable, and the orchestrator re-ran every oracle itself on merged main with unpiped exit codes | 95 |
| KD6 | CLAUDE.md byte budget is SATURATED — root 34 bytes free, service/ 42. Two real invariants could not be written this session. Needs a governance decision: structural trim, or declare core command behaviour corpus-only | 85 |

## Failing Oracle

(none)

## Next Steps

- NS1: task-evidence-precheck-only-sees-a-cd-in-the-first-segment-of-a — falsely refuses this repo's own mandated `bun run build && cd packages/lore && bun test <e2e>` form; its false-refusal exit nudges authors to --oracle manual, which skips the check entirely
- NS2: task-ac-statement-drift-is-deterministically-detectable-an — now has TWO measured instances one day apart (AC-067-4, AC-ETI-4), the second produced by this very session. Doc carries the structural signature to key on and warns against the literal-word trap
- NS3: task-a-ninth-plan-member-query-hides-in-the-one-shot-task-phase — migration drops are unrecoverable (no second run); also carries one stale comment this sweep created and one orthogonal parent_id dependence to settle
- NS4: task-two-independent-copies-of-does-this-task-have-a-claim-now and task-mcp-lore-evidence-add-cannot-set-capture-source-and-has-no — both are MCP/service duplication or capability gaps left by slices that shipped today
- NS5: Consolidate isPlanMember: three copies exist (task-workflow-service, phase-workflow-service, and the new shared plan-membership.ts). Oracle: grep -c 'function isPlanMember' must report exactly one file
- NS6: UNANSWERED USER QUESTION (asked 3x, do not decide alone): file the actor-collapse finding as its own task? Two live orchestrators both resolved to agent:main-orchestrator, collapsing SPEC-042 sessions and disabling noAnchorOverlap
