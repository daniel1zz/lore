---
id: PLAN-071
type: plan
role: plan
title: "Implementation — SPEC-053 AC-vagueness advisory (single slice)"
status: archived
priority: medium
created: 2026-07-18
updated: 2026-07-26
tags: []
parent: SPEC-053
---
# Implementation — SPEC-053

## Goal
Implement the AI-advisory AC-vagueness supplement per SPEC-053: typed advisory[] on review judgment, REVIEW_PROMPT_VERSION v2 registry entry, advisory section builder, judgeDoc v2 selection, review-render advisory block. All 7 ACs script-mode/oracle-bound.

## Approach
Single vertical slice, one implementer in a worktree, TDD (failure-first): capture v1 frozen fixture BEFORE any change (AC-053-6), write failing v2/advisory/schema/render tests, implement to green, then lore verify.

## Phases
1. Implement + test (single slice)
