---
id: TASK-806
type: task
role: plan
title: "[Skill:implement] wire a real ResolutionLabelPort so the projector is not a production no-op"
status: archived
priority: critical
phase: "P5: Projection + reads"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
links:
  - {id: TASK-775, type: blocks}
---
Estimate: M
Approach: implement a `ResolutionLabelPort` backed by `GhRunner` (read the issue's current labels, converge to exactly one `resolution:*` label — remove any stale sibling, add the current one), then assign it in `createApp` so `app.resolutionProjector` is defined in production. GhRunner is already on main and is the ONLY module permitted to name a gh subcommand (AC-GI-7), so the port goes through it.
Source: the disclosed gap in `task-skill-implement-resolutionprojector-invoked-from-lore`; spec Per-Field Authority (resolution → `resolution:*` label, write-only); plan Invariant 3
Dimensions: D-FUNC
Scope-Alt: label convergence may start as add-only (never removing a stale sibling) provided the drift detector reports the resulting multi-label state rather than hiding it
Covers: AC-GI-4

## Why this task exists

`ResolutionProjector` landed with a DI seam and 19/19 green tests, including a spy scenario proving `lore issue resolve` calls it. But `App.resolutionProjector` is declared `optional` and `createApp` never assigns it, so **in production the projection is a no-op**. The implementer disclosed this explicitly in the field's JSDoc rather than leaving it silent — the right call, and exactly why this task exists instead of a false green.

This is the repository's four-times-measured pattern in its purest form: a capability whose ACs are all green while nothing reaches it. AC-GI-4's attested pass proves the STATE MAPPING is correct; it does not prove a label ever reaches GitHub. Those are two different claims and only one of them currently has evidence.

## AC

- Given `createApp` returning an `App`, When `app.resolutionProjector` is read, Then it is DEFINED — asserted against the real composition root, not a test fixture
- Given a corpus issue record carrying `extra.issue_report.github`, When `lore issue resolve` ratifies a verdict, Then a `resolution:<state>` label matching the corpus-computed resolution is present on that GitHub issue afterwards, verified by reading it back through `gh api` (this read is the DRIFT CHECK path, never an authority path — Invariant 6)
- Given an issue that already carries a STALE `resolution:*` label, When a new verdict is ratified, Then exactly one `resolution:*` label remains and it is the current one
- Given a projection failure, When `lore issue resolve` runs, Then the corpus verdict is still recorded and the failure is reported loudly with a non-zero exit code
- Given AC-GI-7's scan, When this task's port is in place, Then the scan is still exit 0 — the port must reach gh only through `gh-runner.ts`
- SCOPED typecheck exit 0 (`bunx tsc --noEmit -p packages/lore/tsconfig.json`); full-repo belongs to the phase gate per plan Invariant 1

Integration: this task IS the wiring task. Its first AC asserts the live composition root, not a constructor call in a test — an implementation that only satisfies the unit tests has changed nothing about production behaviour.
