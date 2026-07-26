---
id: KN-066
type: knowledge
role: knowledge
title: "Round-2 retro: spec numbering collision, min_ratio x2, reject-status trap bit twice, e2e rot window"
status: draft
priority: medium
created: 2026-07-24
updated: 2026-07-25
tags: [retro, spec-073, spec-074, autopilot, dogfood]
parent: PLAN-044
links:
  - {id: PLAN-043, type: relates-to}
---
## Overview

Round-2 execution retro (plans SPEC-073 trigger surfaces + SPEC-074 dashboard Issues triage, autopilot, 2026-07-24). Both plans: all ACs attested pass (4+5), assess "met" 88/100 each, archived via plan-level attestation exemption. Full oracles green (vitest 310/5587, bun 1024, typecheck 0, drift 0). Dashboard e2e: issues.spec.ts fully green; 2 PRE-EXISTING failures (browse-ux seed, review-loop home) bisect-verified present at session-start commit a6d2afa — filed as ad-hoc task task-fix-pre-existing-dashboard-e2e-regression-browse-ux-spec.

## Findings

1. **SPEC number collision**: two independent sessions both allocated "SPEC-073" (this round's trigger-surfaces spec vs an earlier strict-flag-hardening spec), and both used AC id AC-073-4 — `-t 'AC-073-4'` cross-matches 6 unrelated tests. Root cause: spec numbering has no allocation mechanism (title-declared numbers, no uniqueness check). Mechanization: export-docs' human_id allocator already dedupes — surface a `lore next-number spec` helper or a create-time advisory when a title-declared number is already taken.
2. **SPEC-069 min_ratio tension, occurrences 3 and 4**: both plans blocked at plan-close purely on ratio (0.40/0.31) while every task carried attested entries and every AC an attested pass. Amendment case now has 4 data points (see spec-072 retro finding 4).
3. **Reject-leaves-no-status-trace bit twice**: the same SPEC-005 invariant (reject is audit-only, status stays draft) that shaped SPEC-072's getDocStatus ALSO invalidated SPEC-074 T1's status-only open-set filter — caught by the dashboard e2e, fixed by audit-join derivation. Lesson: any "open/pending" projection over adjudicable docs MUST consult the audit reject trail, never status alone; candidate mechanization: a shared core predicate (isEffectivelyRejected) consumed by both flows and http projections.
4. **Pre-existing e2e rot detection worked as designed but late**: gate-conformance tightening (spec-create skeleton) silently broke e2e seeds that create bare specs; nothing runs the dashboard e2e on merge (it only runs when a dashboard task happens to). Candidate: add the dashboard e2e to the plan-close full-oracle checklist for any plan touching packages/lore/src/adapters/http or service gate predicates.
5. **UAT self-verification honesty**: plan-074's requires_uat gate satisfied by an accept_with_conditions verdict with run_meta.degraded=true (self-verified, independent UIUX audit not run) — human spot-check of the live dashboard recommended; the schema's degraded flag carried the honesty cleanly.
