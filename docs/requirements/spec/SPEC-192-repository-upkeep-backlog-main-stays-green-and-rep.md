---
id: SPEC-192
type: spec
role: spec
title: "Repository upkeep backlog: main stays green and repo data stays consistent"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
---
## Overview/Goal

Own this repository's upkeep backlog: work that is not a lore product defect (BR-1153) but keeps main trustworthy — tests already red on the baseline, stale ledgers, oversized module docs, docs/comments out of step with code, corpus and mirror data errors, dev-only scripts and test infrastructure. The 2026-10-16 report audit moved 29 such reports here (lore issue resolve --state adopted).

## Scope

In scope, grouped:
- Red main: #227 (fragment-prose pins incl. AC-083-1/AC-CP-7), #201 (plan-close cascade; investigate first: if a lore defect is found, file ONE report for it), #199, #139, #191, #170, #32 (flaky/red/budget-ledger tests).
- Corpus and mirror data: #210 (duplicate mirror human_ids, data half of #234), #74, #75 (wrong AC verify.command), #182, #215 (baseline rule data).
- Repo docs: #10 (module CLAUDE.md over its floor), #78, #42, #69, #110 (CLAUDE.md / comments out of step with code).
- Repo config and dev environment: #25 (.gitignore drops config.yaml), #15 (worktree without node_modules), #12, #14, #140 (dev-only scripts), #121, #147, #148, #16 (test isolation / coverage gaps), #120 (internal refactor), #11 (dispatch template evidence data), #39 (orchestration policy; boundary case).

Out of scope: any lore product defect — those stay defect reports.

## Acceptance Criteria

AC-UPK-1..3 (`lore ac add`).


## Acceptance Criteria (structured)

- [·] [script] AC-UPK-1: On main, bun run test:vitest exits exactly 0
  script: test — bun run test:vitest
- [·] [script] AC-UPK-2: On main, bun run test:bun exits exactly 0
  script: test — bun run test:bun
- [·] [script] AC-UPK-3: On main, bun run check:spec-mirror exits exactly 0 and no two live docs share a mirror human_id
  script: other — bun run check:spec-mirror
