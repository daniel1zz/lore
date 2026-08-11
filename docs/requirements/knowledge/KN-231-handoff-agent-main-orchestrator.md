---
id: KN-231
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 5 decisions + 5 next steps = 10 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

- scripts/changed-tests.ts
- scripts/check-no-nul-bytes.ts
- .gitattributes
- packages/lore/src/adapters/cli/commands/assess.ts
- CLAUDE.md

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | SIX tasks archived this session, each merge-verified by the orchestrator with DISCRIMINATING checks, not bare greens. main at e6b7ac6 is green on check-test-budgets (536 files, 0 new), check-no-nul-bytes (2088 files), tsc, and every scoped suite touched@high | — |
| KD2 | The tree-scanning selector edge fired TWICE in one day by two different actors, and the second time the first cause was already gone (7f02c1f had landed). The universe fix was necessary and NOT sufficient. Both measurements are in task-test-changed-s-fourth-invisible-edge-a-tree-scanning@high | — |
| KD3 | That second occurrence was an orchestrator-dispatched agent with a scoped oracle list; it ran everything it was told to. Argument for fixing SELECTION, not lengthening dispatch checklists — a hand-written list of whole-tree oracles will be wrong when the next one is added@high | — |
| KD4 | vitest run silently DROPS a .bun.test.ts named alongside a valid file: exit 0, one file run, no warning. Alone it exits 1 loud, so the guard dies to a quorum of one. Orchestrator-reproduced; filed as task-vitest-run-silently-drops-a-bun-test-ts-named-alongside-a@high | — |
| KD5 | Raw NUL bytes in source are position-dependent poison and content-only fixes CANNOT undo them: git tests binariness per diff SIDE, so a fixed file still renders Bin against a poisoned parent. Only the diff gitattribute fixes it; text is a different attribute and would be wrong@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: THREE tasks filed and unimplemented: task-lore-done-accepts-an-unattested-self-reported-pass-as (its ADR is still draft; approving an adr needs a SPEC-103 current-version judgment), task-test-changed-s-fourth-invisible-edge-a-tree-scanning (proven twice), task-vitest-run-silently-drops-a-bun-test-ts-named-alongside-a
- NS2: task-session-start-freshness-boundary-cases-assert-a-wall-clock is the ONLY ticket-58 NS1 item not landed, deferred all session on purpose: its oracle needs the file green inside a FULL suite on a loaded machine, and load sat at 8-14 with 4-7 foreign locked worktrees throughout. Dispatch when quiet
- NS3: No full-suite verdict taken this entire session. Every claim above is scoped-oracle scope ONLY. A clean-tree full suite at a named commit is still owed before any repo-wide no-regression assertion, and per the standing lesson it must run on a clean tree or in an isolated worktree
- NS4: Five foreign worktrees/branches remain (a1beb20b, a6eb98b6, ab1df7a6, acdf4c9a, ad53c670) — NOT mine, none match any agent this session spawned. Do not remove them. All seven of this session's own worktrees/branches were merged, verified with git branch --merged, and cleaned
- NS5: Minor, unfiled: lore link truncates ULIDs to 8 chars, so two docs created in the same millisecond print an IDENTICAL source id and a correct link looks like a bug. Hit once, resolved by re-reading both full ids. Decide whether it earns a task
