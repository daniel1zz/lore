---
id: PLAN-230
type: plan
role: plan
title: "Complete-coverage integrate floor"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: SPEC-207
phases:
  - {name: "P1-census"}
  - {name: "P2-report"}
  - {name: "P4-floor"}
links:
  - {id: TASK-1839, type: supersedes}
---
# Plan: Complete-coverage integrate floor

Parent: spec-baseline-coverage-cannot-silently-regress-one-program (AC-BCR-1..6, proposed rule BR-1248). Owner choice 2026-10-19: build the mechanism that makes a silent baseline regression impossible; end state only (no base comparison, no allowlist, no deferral).

## Phases
- P1-census: one-program, closure-scoped many-entry census; output identical to the per-command census (AC-BCR-1); root coverage of the real tree within 120 s (AC-BCR-6).
- P2-report: root coverage reports undeclared runnable commands and names the exact fix per pair and command, with probable-rename hints (AC-BCR-2, AC-BCR-3, AC-BCR-4).
- P3-repair: main reaches complete root coverage (done in plan-baseline-completeness-restoration-every-verb-declared-0: account for the current pairs, declare the current commands). Not a task of this plan; P4 is blocked by it.
- P4-floor: the integrate floor runs root coverage on the merged tree and refuses unless complete (AC-BCR-5). Wired immediately after P3 lands; this plan does not close before.

## Invariants
- Census output never changes as a side effect of the speed-up (AC-BCR-1 compares key sets).
- No allowlist, deferral or base comparison is introduced at any point.
- Never write the repo's own .lore/ from tests.
