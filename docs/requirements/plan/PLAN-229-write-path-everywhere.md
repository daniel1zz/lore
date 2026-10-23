---
id: PLAN-229
type: plan
role: plan
title: "Write path everywhere"
status: approved
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: SPEC-211
phases:
  - {name: "route"}
---
## Goal
One task (DCL-3b) owns all of spec-no-module-writes-around-the-write-path-the-remaining-17 and AC-DCL-5:
- D1: route the 17 modules through CorpusService write entry points.
- D2: remove the scan allowance list, so only corpus-service.ts and store/* may call store.update / insertVersion / appendAuditEntry / the store *WithProvenance methods.
- D3: make assignOrdinalForRepair one transaction, proven by an injected-failure test.

## Invariants
- Throwaway corpora only; never the repo .lore/.
- Starts after DCL-3 lands (shared corpus-service.ts), via a blocks link.
- AC-DCL-5 tests, per migrated module: version + audit row attributed to the caller AND the linked-worktree foreign-corpus refusal; plus one red run that restores a direct call.

## Phases
1. route — DCL-3b (D1, D2, D3).

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| 17 modules touch many gates | H | per-module behaviour test; existing tests of each module as scoped floor |
| baseline coverage gaps from new call paths | M | preview coverage before integrate; orchestrator maps |
