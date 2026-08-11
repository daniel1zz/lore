---
id: TASK-451
type: task
role: plan
title: "T1 — lore ac set: service + CLI + six-dimension suite"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-085
plan: PLAN-085
links:
  - {id: TASK-448, type: blocks}
---
## Task

Build `lore ac set <spec> <id>` — in-place edit of one declared acceptance
criterion — per `spec-lore-ac-set-in-place-edit-of-a-declared-acceptance` D1–D6.

Service layer first (`AcService`), then the citty subcommand alongside the existing
`add` / `list` / `rm` in `packages/lore/src/adapters/cli/commands/ac.ts`.

## Spec Reference

`spec-lore-ac-set-in-place-edit-of-a-declared-acceptance` — read D1, D2, D3, D4, D5,
D5a, D6 before writing code. D5a fixes the exit-code boundary and is the decision most
likely to be got wrong by analogy.

## Acceptance Criteria

Owns AC-ACS-1, AC-ACS-2, AC-ACS-3, AC-ACS-4, AC-ACS-5, AC-ACS-6. Each is declared on
the spec with its exact oracle command — run them, do not invent variants. Declare
`--ac-scope` covering exactly those six ids when you claim, so the runner-attested
path is reachable (`lore verify <plan> --task <this> --ac ...`).

## Context Digest

- `extra.acceptance_criteria` is an array of `{id, statement, verify:{mode, oracle?,
  command?, rubric?, note?}, covers?}`; `AcService` already owns every write to it
  (`packages/lore/src/service/ac-service.ts`, see `add` / `rm` and the
  `specAcceptanceCriteriaSchema` parse at ~line 362).
- `CorpusService` is what demotes `approved` → `draft` on a content/title edit. D2
  requires `ac set` to take the SAME path — do not re-implement the transition, route
  through the existing one, or the two will drift.
- Exit-code family (D5a, and `adapters/cli/utils.ts::exitCode`): argv-decidable faults
  exit 2 and are raised in the command module BEFORE any service call; document-state
  faults are `VALIDATION_ERROR` → exit 4 from the service. Unknown id and
  mode-inconsistent flag are BOTH document-state, hence both 4.
- `id` and `mode` are not editable. `--mode` exits 2 naming the `rm`+`add` path.
- No-op (zero field flags) exits 2 AND must not bump the document version — assert the
  version, not just the exit code.

## File Anchors

- `packages/lore/src/service/ac-service.ts`
- `packages/lore/src/adapters/cli/commands/ac.ts`
- `packages/lore/tests/unit/service/ac-set.test.ts`
- `packages/lore/tests/unit/adapters/cli-ac-set.test.ts`

## Verification discipline

Six dimensions (HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION) — the six
ACs map onto them one-to-one. Write each test RED first and record the red run; a
suite that was green on its first execution has proven nothing about the code it
claims to cover. Scoped oracle only in the worktree: `bun run test:changed <base>`.
