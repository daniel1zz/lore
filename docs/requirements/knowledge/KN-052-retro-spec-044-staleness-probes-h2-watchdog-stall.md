---
id: KN-052
type: knowledge
role: knowledge
title: "Retro — SPEC-044 staleness probes H2 (watchdog-stall recovery + stale-binary rebuild protocol + composition-root anchor gap)"
status: approved
priority: medium
created: 2026-07-12
updated: 2026-07-14
tags: [retro, spec-044, staleness, memory-hygiene]
parent: PLAN-028
---
## Context

Session 2026-07-12 (resumed via /pickup from handoff-20260712T062319Z): closed SPEC-043 (owner AC-MH-11 executed via owner-authorized agent proxy, plan archived), then ran the full SPEC-044 cycle: spec drafted from PRD §16 H2 + SPEC-043 retro/U9 → 3-lens adversarial review (35 findings, 12 HIGH) → v2 revision + 13 structured ACs → AI judge approve 0.80 → approved → plan + 2 serial worktree tasks → 12/12 script ACs runner-attested + AC-SP-13 live-provider proxy run → v6 assessment met 90/100.

## What shipped

- Pure staleness layer (selectProbeCandidates / computeStalenessPriority, in_degree × age_days, lastConfirmedAt clock-reset) in @lore/core; migration-005 (review_judgments.kind + superseded_candidate); kind-scoped store contract (countLinksByToIds, latestJudgmentsByDocIds, kind param on latestJudgment/findJudgments) across SQLite/Turso/InMemory.
- StalenessProbeService (batch, ONE call per batch method, audit staleness_probe actor=by excluded from VERSION_ACTION_AUDIT_FAMILY, probed doc never mutated) + AIProviderService.probeStaleness (STALENESS_PROMPT_VERSION v1, SPEC-026 retry pattern).
- CLI lore review --staleness/--list/--fail-on-candidate (collect-and-continue partial batches, loud limit accounting), MCP lore_staleness_probe (30 tools), status/bootstrap open_stale_candidates (single derivation site), superseded_candidate nudge on regular reviews (U9 closed), ValidityService stalenessCalibration port + kind-disaggregated calibration stats.

## Learnings (durable)

1. **Watchdog-stall recovery loop works**: T1 stalled mid-edit (600s no progress). SendMessage resume with explicit recovery steps (git status/diff to re-establish state, then continue) restored it losslessly. The load-bearing instruction was 'work in smaller increments + checkpoint-commit after each coherent unit' — bake this into every dispatch prompt from the start, not only after a stall.
2. **Merge protocol must rebuild BEFORE bun suites**: post-merge, 5 spawned-CLI bun files fail on the SPEC-039 assertFreshBinary guard until 'bun run build' runs. That guard is doing its job — the orchestrator checklist is now merge → build → typecheck/vitest/bun → lore verify.
3. **3-lens pattern-primed review remains high-yield on specs, not just code**: 35 findings pre-implementation, four of which would have shipped broken behavior — phantom calibration action_family field (schema didn't exist), store-contract kind gap that would corrupt lore pending badges via staleness rows masquerading as review approvals, a tautological AC that a no-op implementation would pass, and spawned-CLI tests that would select zero candidates under the min_age_days default. Cost: ~3 reviewer-agent runs; every one paid for itself.
4. **Composition-root is an anchor blind spot**: neither T1 nor T2 File Anchors covered app.ts, forcing T2 to step outside its declared scope for DI wiring (justified deviation). Task decomposition rule: the adapter/wiring task's anchors MUST include the composition root explicitly.
5. **Flaky-under-load e2e recurring**: p2-e2e-closed-loop.bun.test.ts exceeds its 5000ms per-step budget under full-suite parallel load (7.4s observed), passes isolated. Second sighting this week — raise its timeout or isolate it; do not keep re-diagnosing it per cycle.

## Open items

- H3 drift oracle (lore status --check-drift; normalizeFileAnchors from SPEC-042 reusable) — next cycle.
- Assessment recommendation: full transcript capture (not truncated tail) for human-AC evidence; consider raising evidence output_tail cap for manual oracles.
