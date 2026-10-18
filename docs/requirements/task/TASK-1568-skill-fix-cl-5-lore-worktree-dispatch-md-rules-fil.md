---
id: TASK-1568
type: task
role: plan
title: "[Skill:fix] CL-5 lore-worktree-dispatch.md rules file drifted from its fragment render (CL-4 hand edit); AC-RS-13 red on main"
status: archived
priority: high
phase: "Phase 1: cleanup without a human"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-205
plan: PLAN-205
---
Estimate: S
Approach: CL-4 (5227941c) edited assets/context/worktree-dispatch.md AND hand-edited its rendered copy .claude/rules/lore-worktree-dispatch.md. dist/lore fragments check: [rules_drift] .claude/rules/lore-worktree-dispatch.md changed versus a fresh render; packages/lore/tests/e2e/rs-shipped-catalog.bun.test.ts 'AC-RS-13 fragments check --json exits 0' exits 4 (reported by a peer session); the AC-CV-2 golden for worktree-dispatch probably too. lore context refresh refuses here because the spliced root CLAUDE.md would be 329 lines > 220 ceiling. Make the rules file byte-identical to a fresh render of the fragment via the product's render code (not by hand-copying), find out why refresh would grow CLAUDE.md to 329 lines (a separate defect? record it if so), and add/keep the guard that catches a hand-edited rendered rules file in the same task that edits a fragment.
Source: peer report 2026-10-18; AC-RS-13
AC: dist/lore fragments check exits 0; rs-shipped-catalog AC-RS-13 and the AC-CV-2 golden pass.
