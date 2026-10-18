---
id: TASK-1561
type: task
role: plan
title: "[Skill:fix] TG-39 one post-merge static floor: bun run check:static runs build, typecheck and every check:* and prints one exit per step"
status: draft
priority: high
phase: "Phase 3b: one runner"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-201
plan: PLAN-201
---
Estimate: S
Approach: 2026-10-18 the orchestrator merged branches after running only build/typecheck/ownership and missed red checks three times (duplicate import -> typecheck; ambient reads -> check:ambient-reads; spawn-heavy tests without timeouts -> check:test-budgets), each found later by a peer or the full suite. 'Remember to run X before merging' is not enforced. Add an aggregate script (reuse scripts/run-chain.ts's run-every-step runner with a static step list = build, typecheck, every package.json check:* except the corpus-mirror ones that depend on an export, or include them and label them) as `bun run check:static`, exit non-zero if any step fails, per-step exit table; name it in the shipped worktree-dispatch fragment (assets/context/worktree-dispatch.md -> render the rules file through the product renderer, never by hand) as the post-merge floor. Red-first: a fixture step failing -> exit non-zero naming it.
Source: incidents 2026-10-18 (3a9efb24, peer reports on check:ambient-reads)
AC: bun run check:static exits 0 on clean main and non-zero naming a failing step.
