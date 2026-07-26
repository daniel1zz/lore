---
id: TASK-239
type: task
role: plan
title: "[Skill:uat] UAT acceptance + record verdict"
status: archived
priority: high
phase: "Phase 3: Verification & Acceptance"
created: 2026-07-22
updated: 2026-07-22
tags: []
parent: PLAN-059
plan: PLAN-059
---
Estimate: M
Approach: lore-uat skill — requirement inventory over SPEC-064's promises, real user journeys via agent-browser against the running dashboard, independent judge, UIUX production-bar audit; record verdict via lore uat record.
Source: SPEC-064 (design profile → SPEC-054 plan-close gate); lore-uat skill
Dimensions: D-UX, D-A11Y
Covers: (acceptance gate — not a single spec AC)

Run product-level UAT for the Settings UI and record a structured verdict. The plan declares requires_uat: true, so plan-close (archive) is gated on a P0-accepted UAT verdict (lore uat record <plan> ...). Cover: both scopes visible + correctly separated; deny keys read-only; blast-radius disclosure present; precedence correct; restart_required honest; CAS conflict handling; no P0 UIUX blocker.

AC:
- lore uat record plan-implementation-spec-064-dashboard-settings-ui produces a verdict with isP0Accepted true (verdict != reject, no P0 rejected, no uncovered P0, no UIUX blocker).
- The plan can then archive (plan-close gate passes).
