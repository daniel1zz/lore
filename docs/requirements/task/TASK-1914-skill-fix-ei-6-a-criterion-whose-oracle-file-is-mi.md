---
id: TASK-1914
type: task
role: plan
title: "[Skill:fix] EI-6 a criterion whose oracle file is missing renders not_measured even with no evidence (AC-EI-2 'whenever'), not 'none'"
status: archived
priority: medium
phase: "Phase 1: rule and re-verification"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-203
plan: PLAN-203
---
Estimate: S
Approach: lore assess of the EI plan (2026-10-18, met 80) found deriveAcCoverageState (packages/core/src/acceptance.ts) returns not_measured for a missing oracle only when a pass exists; an AC whose oracle file is missing and that has no evidence renders 'none'. AC-EI-2 says "Whenever any extracted path is missing on disk, the AC renders not_measured" and the user's decision for this plan was "any missing oracle file means not measured". Make the missing-oracle check precede the no-evidence case, so every renderer (ac list, verify, status) shows not_measured naming the path; keep 'none' for a present oracle with no evidence.
Red-first: an AC whose test file is missing and has zero evidence renders not_measured (red today: none). Control: present oracle, zero evidence -> none.
Source: lore assess plan-evidence-identity-count-only-equal-command-attested-rows 2026-10-18, gap 2
AC: AC-EI-2's oracle still passes with the new half added; check:ac-state-renderers and the corpus-fail-census / ac-oracle-ownership scripts still pass (ledgered not-built ACs now render not_measured — confirm no script treats that as a failure).
