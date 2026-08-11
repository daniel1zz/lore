---
id: TASK-473
type: task
role: plan
title: "meets_floor renders pass while the declared-scope conjunct blocks — surface it in the projection and panel"
status: archived
priority: high
created: 2026-07-31
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Task

`meets_floor` no longer means what the dashboard says it means. A plan blocked at
plan-close by the declared-scope coverage conjunct currently renders **"meets
floor"** — the gate refuses while the UI reports success.

## Verified cause (measured at source on main, 2026-07-31)

Landed by `task-t3-exercised-acs-rename-declaredscopecoverage-and-the`
(AC-VS-6/7): `deriveAttestationSummary.meets_floor` became the **opt-in ratio
conjunct alone**. Condition 1 was demoted to the reported `zero_attested_tasks`
fact, and the exercised/declared coverage conjunct no longer gates it.

The two consumers were not updated, because doing so would have required a new
mandatory parameter on `deriveAttestationSummary` and that file sits outside T3's
declared anchors:

- `packages/lore/src/service/verification-projection-service.ts:207-208` —
  calls `deriveAttestationSummary(taskAttestationInfos, this.minRatio, acCoverage)`
  and returns it verbatim as the `doc_type: "plan"` projection.
- `packages/dashboard/src/components/evidence/PlanAttestationPanel.tsx:86-87` —
  renders `attestation.meets_floor` as the badge, `"meets floor"` (secondary) vs
  `"below floor"` (destructive).

## What to do

Surface the declared-scope conjunct in the projection and the panel so the badge
cannot disagree with the gate. `deriveDeclaredScopeCoverage` is already exported
from `@lore/core` (`packages/core/src/evidence-panel.ts`) and the projection
service already holds the task documents it needs, so no new IO is required.

Design constraints:
- ⛔ Do NOT restore the old conflated `meets_floor`. The separation is deliberate
  (spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts): an
  evidence-derived fact and a declared-scope fact must be able to disagree,
  because that disagreement is the whole signal.
- The panel must distinguish three states, not two: floor met, floor not met, and
  **scope undeclared** (the `notApplicable` / `scope-undeclared` applicability
  verdict). Rendering "undeclared" as either pass or fail reintroduces the
  proxy-for-invariant defect this line of work exists to remove.
- ⛔ No silent fallback: an unresolved declared-scope input must not render as
  compliant.

## Oracle

An external oracle must show the badge and the gate agreeing on the SAME fixture:
a plan whose evidence-bearing tasks declare no `ac_scope` must NOT render as
passing. Prove the assertion can fail — a control fixture that legitimately meets
the floor must still render as meeting it.

Regression surface: the Playwright e2e suite (`cd packages/dashboard && bunx
playwright test`), serialized against a fixed dev-server port.
