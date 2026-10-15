---
id: KN-440
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-12
updated: 2026-10-10
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

- assets/hooks/pre-bash-git-safety-gate.mjs
- packages/lore/tests/unit/hooks/git-safety-gate.test.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | The 2026-08-02 worktree gate defect is FIXED, merged (22bc3888) and installed. Proven LIVE: I ran the incident command in this session and the hook BLOCKED it, naming the right reason (merged but reflog 26.5min < 30min). Ten days ago that exact shape passed silently@high | — |
| KD2 | Verified by four scratch-repo scenarios, not the implementer's report: pre-merge hook exits 0 on the incident; fixed hook exits 2 naming the losing commit; merged+live-reflog blocks; merged+quiet-2h PASSES (no over-block); unreadable repo fails CLOSED@high | — |
| KD3 | Distribution nearly voided it: assets/ is SSOT but the installed ~/.claude/ copy stayed OLD after merge (liveness constant count 0). Only 'lore setup' closed it — dry-run: 1 file written, 292 skipped, old backed up. Parity re-asserted byte-identical after@high | — |
| KD4 | active_sessions (filed 2026-08-02 as structurally inert) is FIXED — verified by natural experiment, not by its archived status: it correctly reported a live concurrent agent. Residual by design: an agent working WITHOUT a claim stays invisible; one did exactly that today@high | — |
| KD5 | main carries 2 RED e2e cases that are NOT from this work: migrate-ordinals-compiled expects SPEC-1, binary emits SPEC-001. The implementer flagged them unattributable and was right — I confirmed identical failures on clean main 18c52cf8 BEFORE merging@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: task-main-carries-two-red-e2e-cases-migrate-ordinals-compiled (high, draft) — decide WHICH SIDE is wrong before touching the assertion; SPEC-<n> vs SPEC-00n is a RESOLUTION surface, so assert lore get resolves both to the same doc, never silently to different ones
- NS2: task-the-resume-coverage-verb-accepts-a-reason-after-deferred (low, draft, untouched since 2026-08-02) — the only item from that session still unstarted
- NS3: worktree .claude/worktrees/agent-ab302765a5dcaffee is merged but was inside the 30-min liveness window at session end; the new gate correctly refuses removal. Retry after its branch reflog is quiet 30 min. Do NOT bypass the gate you just installed
- NS4: A concurrent session ran throughout (agent:foreign-write-guard, uncommitted work in packages/lore/src/service/). Its AC-CP-4 e2e is self-documented EXPECTED-RED until that guard lands — do not mistake it for a regression
- NS5: pre-push still runs FOUR corpus checks and ZERO tests, so every test-shaped oracle is push-invisible. That is how both the stale manifest (c3803eb2) and these 2 red e2e cases reached main. No task filed — it is the shared root of both
