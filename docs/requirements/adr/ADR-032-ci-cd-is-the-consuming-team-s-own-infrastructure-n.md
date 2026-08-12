---
id: ADR-032
type: adr
role: decision
title: "CI/CD is the consuming team's own infrastructure, not a lore deliverable — lore ships corpus gates, never a test runner or pipeline"
status: draft
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
## Decision

Lore does NOT build, ship, or prescribe CI/CD. `hooks/pre-push` and its shipped twin
`assets/project/pre-push` stay **corpus-only**: tree/drift, audit chain, PRD budget, CLAUDE.md
budget. They will not grow a test-running step.

Each consuming team owns its own pipeline and wires the test suite there.

## Context

Filed 2026-08-12 immediately after `task-nothing-automated-runs-the-test-suite-pre-push-runs-four`
proposed exactly that, on measured evidence: pre-push runs zero tests, no CI configuration exists
anywhere in the repo, and this checkout has no git remote so pre-push never fires at all. The
measurements stand; the proposed remedy was rejected by the user on scope grounds.

## Rationale

- **Scope**: lore is a knowledge/memory platform. A test-runner gate is pipeline infrastructure —
  it belongs to whoever owns the repo's build, not to the tool that governs its corpus.
- **Portability**: a shipped pre-push that runs tests would have to guess every consumer's runner,
  workspace layout, and latency budget. Measured here: the bun phase alone is 476s. A gate that slow
  gets `--no-verify`, which would ALSO disable the four corpus checks that currently work — the
  shipped hook would become net-negative for consumers.
- **Separation**: the corpus checks are cheap, deterministic, and universal across consumers.
  Test invocation is none of those.

## Consequences — accepted, not solved

⛔ The measured gap does not disappear; it is REASSIGNED. In this repo nothing automated runs the
suite, and that remains true. Two defects have already landed through it (stale assets manifest
`c3803eb2`; two RED e2e cases in `task-main-carries-two-red-e2e-cases-migrate-ordinals-compiled`).
Under this decision those are caught by the team's own CI, or by an agent running
`bun run test:changed` / `bun run test` before merge — not by anything lore ships.

⛔ Do not re-file the pre-push-should-run-tests task. The evidence that motivated it is real and will
be rediscovered; this ADR is the answer to it. If the boundary is ever revisited, supersede this ADR
rather than reopening the task.
