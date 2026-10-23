---
id: SPEC-211
type: spec
role: spec
title: "No module writes around the write path: the remaining 17 modules route through CorpusService"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
links:
  - {id: SPEC-209, type: relates-to}
---
## Overview/Goal

Completes D3 of spec-defect-clusters-round-1-done-floors-judge-real-runs-on ("every corpus write goes through one write path"). That spec's AC-DCL-3 was narrowed by an audited correction to the nine services its reports name, because 17 other modules still call store write primitives directly. This spec carries the unchanged requirement for those modules.

## Scope

D1 — The 17 modules route every write through CorpusService's write route (version row, audit row with caller actor and run, foreign-corpus refusal, record lock, transaction, no-op skips): task-workflow, phase-workflow, review, outline-migration, drift-check, phase-checklist, plan-exemption, rule-change, spec-parent-migration, spec-kind, ac, issue-close-on-archive, judgment, state-binding, foreign-corpus-write-guard, baseline-adopt, app.ts.
D2 — The static scan has no allowance list: only corpus-service.ts and store/* may call the primitives.
D3 — assignOrdinalForRepair becomes one transaction.

## Acceptance Criteria

AC-DCL-5 (`lore ac list`).


## Acceptance Criteria (structured)

- [⚑] [script] AC-DCL-5: NO MODULE WRITES AROUND THE WRITE PATH. A static scan over packages/lore/src finds store.update( / insertVersion( / appendAuditEntry( / store *WithProvenance( calls only in corpus-service.ts and store/*, zero in every other module, with no pinned allowance list. For each of the 17 migrated modules (task-workflow, phase-workflow, review, outline-migration, drift-check, phase-checklist, plan-exemption, rule-change, spec-parent-migration, spec-kind, ac, issue-close-on-archive, judgment, state-binding, foreign-corpus-write-guard, baseline-adopt, app.ts) one behaviour test on a throwaway corpus asserts its write carries a version row and an audit row attributed to the caller, and that a write from a linked worktree resolving the main checkout's corpus is refused by the foreign-corpus rule. assignOrdinalForRepair is one transaction: a failure injected after the ordinal write leaves no ordinal change. Made red once by restoring one direct call in a migrated module.
  script: test — bun run test:file packages/lore/tests/integration/write-path-everywhere.bun.test.ts && echo 'AC-DCL-5 PASS: no module writes around the write path'
