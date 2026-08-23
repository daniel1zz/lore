---
id: TASK-764
type: task
role: plan
title: "[Skill:test] blast-radius staleness — RED test scenarios"
status: draft
priority: high
phase: "P2 Stamp mechanisms"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-763, type: blocks}
---
Estimate: S
Source: AC of the paired blast-radius task; SPEC-143 AC-CT-4, C3; measured git semantics recorded in R8
TDD-Role: red | Paired-Impl: the AC-CT-4 blast-radius task
Dimensions: D-FUNC

Scenarios:
- Given a throwaway git repo and a recorded HEAD, When a peer commit touches a path INSIDE the declared radius, Then the earlier verdict classifies stale.
- Given the same repo, When a peer commit touches ONLY paths outside the radius, Then the verdict stays bound. ⛔ Without this half the "inside" case passes vacuously under an ancestry test.
- Given a radius pathspec that did NOT exist at the recorded HEAD, When a peer CREATES it, Then the verdict classifies stale; live control — a pathspec that never exists stays bound.
- Given an AC whose command yields NO pathspec at all (e.g. `bun run typecheck`), When the radius is resolved, Then it classifies unmeasured; live control — a sibling AC yielding one still classifies bound.

AC:
- All four scenarios exist as executable tests against a throwaway git repo.
- RED before implementation.
- ⛔ Red recorded by THIS agent at the moment it is red (lore evidence --result expected-fail).
