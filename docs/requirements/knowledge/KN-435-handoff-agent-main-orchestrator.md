---
id: KN-435
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PLAN-128
---
# Handoff — agent:main-orchestrator

SCOPE: 3 decisions + 3 next steps = 6 items to account for

## Plan

plan-land-corpus-resolution-provenance-one-pure-resolver-one

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Resumed ticket CLOSED: 4 tasks archived, both plans archived + assessed (84/72/86 and 87/78/88). Merged-tree suite green — vitest 506/506, bun 2036 pass; the only 2 fails are the pre-existing migrate-ordinals SPEC-1 vs SPEC-001 defect, already tasked and reproduced on a parent commit@0.95 | — |
| KD2 | Nested-worktree corpus-write defect REPRODUCED in a throwaway repo with a discriminating control (parent 1->2 docs; a worktree owning .lore/ sees nothing). But the origin task's causal story is PARTLY FALSE: spec-loop-e2e's REPO_ROOT is the WORKTREE root, so its guard cannot see main@0.9 | — |
| KD3 | Both assess MAJORs name one true gap: a green broad-suite run on the MERGED tree exists as a fact this session but NOT as a corpus evidence row. Attested ratios 0.38 and 0.28 — per-AC passes are attested, surrounding typecheck/regression runs are self-reported@0.85 | — |

## Failing Oracle

(none)

## Next Steps

- NS1: Implement plan-land-corpus-resolution-provenance-one-pure-resolver-one (approved, 5 tasks). REAL dependency chain: resolver phase = pure @lore/core resolver (AC-CP-1) THEN collapse+relocation+header (AC-CP-2); guard phase = config sub-predicate (AC-CP-4) THEN the guard (AC-CP-3) THEN adapters (AC-CP-5). Anchors naming not-yet-existing files cannot participate in the mutex — serialize by hand.
- NS2: Close task-the-wire-contract-mirror-comment-in-issue-reports-routes (adhoc, AC-DC-12, machine-verified): issue-reports-routes.ts:85-101 still describes the dashboard hand-mirror gap AC-DC-12 closed; all three claims are false. Rewrite naming the @lore/core import site and the parity test, never the word 'fixed'.
- NS3: Record merged-tree full-suite runs as attested evidence, not just as a transcript fact — that is what both assess MAJORs indict. lore evidence --capture satisfies the done-gate's capture_source:runner check; lore verify remains the only attestation path.
