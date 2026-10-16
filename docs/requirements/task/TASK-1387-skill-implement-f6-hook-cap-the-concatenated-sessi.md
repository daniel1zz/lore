---
id: TASK-1387
type: task
role: plan
title: "[Skill:implement] F6 hook: cap the concatenated SessionStart injection under 10,000 chars"
status: archived
priority: high
phase: "Phase 1: fixes"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-189
plan: PLAN-189
links:
  - {id: TASK-1381, type: blocks}
---
Estimate: M
Approach: per spec F6 — SPEC-080 forbids clipping (packages/core/src/session.ts:150-163,1386-1392 return over-budget output whole), so check the FINAL concatenated additionalContext in the hook: when seat briefing + framing + bootstrap fence reach 10,000 chars, drop the bootstrap fence whole and record a degradation exactly as the existing backstop does (session-start-resume.mjs:335-345); never cut the seat briefing; replace the 12000 INJECTION_BACKSTOP_CAP (:118) with this total check.
Source: spec F6; assets/hooks/session-start-resume.mjs:118,335-345,513-514,535; packages/core/src/session.ts:150-163,1386-1392; existing oracle packages/lore/tests/e2e/context-fragments-compiled.bun.test.ts:87,572
Resolves: task-gh-1343388703-20
Dimensions: D-FUNC
Scope-Alt: none
Covers: AC-CRIT-8
AC:
- Given a sandboxed worktree session with seat claims whose seat + framing + bootstrap fence total >= 10000 chars, When the hook runs, Then additionalContext.length < 10000, the seat briefing is byte-identical to its unbudgeted form, the bootstrap fence is absent and a degradation is recorded; when the total fits, the fence is present unchanged (AC-CRIT-8)
Integration: the shipped asset assets/hooks/session-start-resume.mjs is what lore setup installs; the test runs that file, not ~/.claude/hooks (INV-5). Set a per-test timeout in the file.
