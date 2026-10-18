---
id: TASK-1600
type: task
role: plan
title: "[Skill:fix] TG-44 an exemption whose criterion now cites a live rule stops counting as active (satisfied state), so replacing exemptions with cites frees the 10% cap"
status: draft
priority: medium
phase: "Phase 3b: one runner"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1593, type: blocks}
---
Estimate: S
Approach: An exemption excuses an UNCITED criterion (BR-959), yet "active" is defined only as expires_at > now (ac-exemption-service.ts header; activeExemptedAcIds and exemptionHeadroom in ac-cite-gate.ts). Once the criterion cites a live rule the exemption has nothing left to excuse, but it still counts against the 10% cap until it expires, and there is no verb to end it. Measured 2026-10-18: TG-43 and EI-5 replace 12 exemptions with cites; without this they keep occupying cap headroom for 30 days. End state (derived, no new verb, no extra write): an exemption is active iff unexpired AND its criterion cites no live rule; list/counts show a third state `satisfied` (cited) next to active/expired; headroom and the gate use the same predicate (one definition).
Red-first: grant an exemption, cite a live rule on that criterion, then counts().active and exemptionHeadroom must exclude it (red on current code). Control: an uncited criterion's unexpired exemption stays active; a cite of a retired rule does not satisfy it.
Source: TG-43 / EI-5 triage 2026-10-18; spec-baseline-slice-2-completeness-census-per-branch-citation C4 (AC-BLS2-10), BR-959
AC: red-first test green; AC-BLS2-10 oracle still passes.
