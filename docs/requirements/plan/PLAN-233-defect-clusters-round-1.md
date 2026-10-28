---
id: PLAN-233
type: plan
role: plan
title: "Defect clusters round 1"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-25
tags: []
parent: SPEC-209
phases:
  - {name: "fix", description: "Four cluster fixes in parallel"}
---
## Goal
Fix the four defect clusters of spec-defect-clusters-round-1-done-floors-judge-real-runs-on concurrently, one task per cluster, closing their GitHub reports on archive.

## Invariants
- Tests use throwaway repos and corpora only; never the repo's `.lore/`; never assume port 8787.
- Concurrent tasks have disjoint anchors; the one shared file (corpus-service.ts, DCL-1 and DCL-3) is serialized by a blocks link.
- No silent fallback: an undeterminable value is reported as not measured.

## Task map (each report closed by exactly one task, via --resolves)
| Task | AC | Reports |
|---|---|---|
| DCL-1 done floors | AC-DCL-1 | #171 #174 #188 #49 #51 + local reports "red-first floor ignores capture_source" (#11 is its recorded duplicate), "latest attested result per AC", "test-anchor refusal text" |
| DCL-2 filters | AC-DCL-2 | #81 #243 #248 #283 #278 #80 |
| DCL-3 one write path | AC-DCL-3 | #252 #253 #255 #113 #145 #161 #44 #276 #297 #298 |
| DCL-4 cwd parser | AC-DCL-4 | #229 #164 #221 #211 (#238 is its recorded duplicate) |

## Ownership answers
- One write path: CorpusService's write route (corpus-service.ts) is THE write path, carrying version row, audit row (caller actor and run), foreign-corpus refusal, record lock and transaction. DCL-3 routes version / migration / validity / rule / phase / tree-check / requirement writes through it, extending CorpusService where an entry point is missing. No second route: services never call store *WithProvenance or store.update directly. AC-DCL-3's static scan allows store.update / insertVersion / appendAuditEntry only in corpus-service.ts and store/*.
- Because DCL-1 (set --status archived and plan close, both in corpus-service.ts at the BR-1072 sites) and DCL-3 both edit corpus-service.ts, DCL-3 is blocked by DCL-1 (blocks link): DCL-1, DCL-2 and DCL-4 run concurrently; DCL-3 starts when DCL-1 has landed.
- Plan close (corpus-service.ts, BR-1072 sites ~3389 / ~3495) is owned by DCL-1, which owns AC-DCL-1(h).
- #188 lives in task-workflow-service.ts (the test-file-anchor floor counts only oracle==='test'); DCL-1 owns case (c) and its test. attestation-completeness.ts belongs to DCL-4 alone; the export `commandRunsFileUnfiltered(command, file)` keeps its signature and its current true cases (DCL-4 may only add true cases, e.g. the #164 subshell), so DCL-1's case (c) is unaffected by DCL-4.

## Phases
1. fix — the four cluster tasks, parallel.

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| Tightened done floors refuse in-flight tasks of other sessions | H | refusal names the exact repair route; land after other sessions are told |
| Write-path refactor touches many services | M | static scan AC; existing service tests as scoped floor |
| Filter validation breaks a script passing an old alias | L | accepted values listed in the refusal |
