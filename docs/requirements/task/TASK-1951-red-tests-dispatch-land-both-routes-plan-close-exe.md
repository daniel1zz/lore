---
id: TASK-1951
type: task
role: plan
title: "Red tests: dispatch, land (both routes, plan close), execution log, finished-task review, drift, close-task migration (AC-LND-1..8)"
status: deprecated
priority: high
phase: "P1 Red"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-247
plan: PLAN-247
links:
  - {id: TASK-1944, type: blocks}
---
Covers: AC-LND-1..AC-LND-8
TDD-Role: red
Approach: integration tests over the compiled binary and a throwaway repository with a bare-minimum remote-less layout: a project, a plan with an integration branch, tasks with contracts. AC-LND-3 builds both a fast-forwardable and a diverged integration branch and asserts parent counts; AC-LND-4 asserts main and the plan status unchanged when the landed task is not the last; AC-LND-6 hashes the task body before and after land; AC-LND-8 asserts exit 4 and an unchanged worktree listing for a stale falsifier. Each test name carries its AC id.
Done when: each AC command runs red for the right reason; lore evidence --result expected-fail --capture per AC, recorded by the agent that ran the red.
