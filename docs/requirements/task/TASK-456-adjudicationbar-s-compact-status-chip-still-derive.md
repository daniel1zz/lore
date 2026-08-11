---
id: TASK-456
type: task
role: plan
title: "AdjudicationBar's compact status chip still derives from meets_floor alone — the same gate/UI disagreement just fixed in PlanAttestationPanel, one surface over"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
Reported by the implementer of `task-meets-floor-renders-pass-while-the-declared-scope-conjunct` (landed 2026-08-01 as 5749d39) as an explicitly out-of-anchor observation.

## Defect

`PlanAttestationPanel` was fixed to render three states (meets floor / below floor / scope
undeclared) by ANDing `meets_floor` with the declared-scope conjunct, so the badge can no
longer disagree with the `plan-close` gate. But `summarizeForAdjudicationBar`s `plan` branch
in `packages/core/src/evidence-panel.ts`, and `AdjudicationBar.tsx` which renders it, still
derive their compact status chip from `meets_floor` ALONE.

Same defect class, different surface: a plan whose declared scope is undeclared will show a
passing chip in the adjudication bar while `plan-close` denies it. The fix that just landed
makes this WORSE in one specific way -- the two dashboard surfaces now disagree with EACH
OTHER, so a reader who sees a green chip and an amber badge has no way to know which is right.

## Required

Route the compact chip through the same three-valued verdict the panel now uses
(`declared_scope_verdict` on `PlanEvidencePanel`, already populated by
`verification-projection-service.ts`). ⛔ Do not re-derive the math -- `PlanEvidencePanel`
already carries both `declared_scope_coverage` and `declared_scope_verdict`; the chip only
needs the precedence combinator (FAIL > NOT-APPLICABLE > PASS), mirroring
`derivePlanAttestationBadgeState`.

## Oracle

RED first: a fixture plan with an undeclared scope must currently render a PASSING chip while
the panel badge renders "scope undeclared" -- assert that disagreement exists before fixing.
GREEN: both surfaces agree. CONTROL: a plan that legitimately meets the floor must still show
a passing chip on both surfaces (guard against making the chip unconditionally negative).
