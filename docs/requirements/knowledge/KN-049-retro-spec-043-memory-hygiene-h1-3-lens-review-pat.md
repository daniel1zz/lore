---
id: KN-049
type: knowledge
role: knowledge
title: "Retro — SPEC-043 memory hygiene H1 (3-lens review pattern-priming + side-door audit + honest surface inventory)"
status: approved
priority: medium
created: 2026-07-11
updated: 2026-07-14
tags: [retro, spec-043, validity, memory-hygiene]
parent: PLAN-027
---
## Context

Session 2026-07-11 (continuation — same session as the SPEC-042 cycle): SPEC-043 (memory
hygiene H1 — bi-temporal invalidation) drafted, 3-lens adversarially reviewed (9 HIGH + 8
MED findings), implemented via two serial worktree agents, 12/12 script ACs runner-attested,
v6-assessed (85/100, sole gap = owner-executed AC-MH-11, open by design per D12).

## What shipped
- `extra.validity` on knowledge/adr (zero-migration read-side defaults); `isInvalidated`/
  `effectiveValidAt`/`renderValidityBanner` pure SSOT in @lore/core.
- `ValidityService` sole write path: `lore invalidate` (+ `--undo` with structured
  `decision_status_unchanged`), ADR three-surface convergence (decision_status /
  superseded_by / supersedes link) with pinned ordering + idempotent link repair.
- Default filtering (search/list/RecentDecisions/RelatedOf, order-preserving,
  `--include-invalid` escapes) + loud markers everywhere else: get/export/feed banner
  (single shared renderer), Embed degrade note, judge Staleness Notice, status
  invalidated-feeding-source warning via the shared armed-gate helper, MCP
  `lore_get.validity_state`, `[invalid]` badges.
- `lore create --supersedes` orchestration with loud-orphan half-failure UX; MCP
  `lore_invalidate` (29 tools).

## Learnings (durable)
1. **3-lens review scales with codebase memory**: reviewers armed with prior-cycle incident
   patterns (SPEC-042 T1's misleading-superRefine error, wholesale-extra clobber, SSOT
   re-derivation) found the SAME classes recurring in a fresh design (ADR error collapse,
   set() side door, status-warning re-derivation) — pattern-priming the review prompts with
   named past incidents is cheap and high-yield.
2. **"One write path" claims need a side-door audit**: D2's front-door consolidation was
   true while CorpusService.set stayed an unguarded mutation channel for the same field.
   Writer-identity guards (SPEC-041 handoff precedent) are the reusable closure.
3. **Read-surface promises need an exhaustive channel inventory**: the v1 draft's "default
   reads filter invalidated knowledge" was honest for 4 surfaces and false for Embed/feed/
   MCP-get/judge materials — exactly the surfaces agents consume. The fix pattern:
   filter list-shaped reads, MARK composed/direct reads, never silently either way.
4. **Worktree agent cwd discipline**: T2 caught itself running typecheck against the main
   repo (cd resets between Bash calls) — silently validating the wrong tree. Dispatch
   prompts should mandate absolute worktree paths for every oracle invocation.
5. **InMemoryStore oracle honesty**: assertions must match the double's actual signal
   (score always 0 → order-preservation, not ranking equality). An AC that cannot fail on
   its declared runner is not an oracle.

## Open items
- AC-MH-11: owner-executed live check (D12 — independent party, never orchestrator
  self-recorded). Plan stays active until recorded. Script embedded in the AC statement.
- H2 staleness probes (next cycle): `lore review --staleness`, in-degree × age priority,
  escalation lands on H1's invalidate verb. Then H3 drift oracle.
- Optional (deferred to H2): judge byproduct `superseded_candidate` field as the
  invalidation nudge (review U9).
