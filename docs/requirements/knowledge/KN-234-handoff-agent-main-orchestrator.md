---
id: KN-234
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

- CLAUDE.md
- scripts/changed-tests.ts
- packages/lore/tests/unit/scripts/changed-tests-selector.test.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | NS4/NS5 were ALREADY resolved at read time, each verified by two independent facts: 717d9c9 is an ancestor of main AND a fresh manifest regen yields zero diff; the two NS5 worktrees no longer exist. Re-verifying before building saved that whole half — second ticket in a row@high | — |
| KD2 | test:changed predicate widened, merged ca4ccbc. Verified DISCRIMINATINGLY, not by a bare green: verify.test.ts now selected with reason=binary-consumer, only possible under the new predicate for a vitest .test.ts spawning INDEX_TS. 136->186 files; build-first still only for 64 compiled@high | — |
| KD3 | NS3 decided on the READ side: adr-lore-done-requires-a-runner-attested-pass-the-sixth-false. lore done must demand an ATTESTED pass; lore evidence stays an honest self-report ledger. Root cause: task-workflow-service.ts:1254 reads bare result===pass, though attestation is already unforgeable@high | — |
| KD4 | That ADRs audited escape hatch is LOAD-BEARING, proven live: all 9 evidence rows on the task archived this session are attested=false, and an --adhoc task with no declared AC gives lore verify nothing to run, so attestation is structurally unobtainable there@high | — |
| KD5 | anchor-overlap gate fired CORRECTLY against a foreign live session: agent:assess-commit-set holds a fresh claim on assess.ts, rewriting the same spawnSync call site. The dispatched agent refused to --steal and made zero edits. Mechanism working as designed, not a defect@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: task-key-test-budget-ledger-rows-on-a-test-title-fingerprint was IN FLIGHT at write time — outcome UNKNOWN here. Do NOT assume it landed: check lore get plus git branch for worktree-agent-afffcdceebdff8400. Commits present -> merge-verify independently then lore done; empty -> re-dispatch
- NS2: task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-over-1 is BLOCKED not failed — re-dispatch only after task-lore-assess-asks-the-caller-for-a-git-range-that-cannot-be releases assess.ts. That sibling rewrites the same spawnSync line; coordinate or merge the dispatches, do not race
- NS3: task-session-start-freshness-boundary-cases-assert-a-wall-clock deliberately NOT dispatched — its oracle needs the file green inside a FULL suite on a loaded machine, but 4 foreign locked worktrees had load rising 3.84->8.10. Dispatch when quiet, else the verification self-destructs
- NS4: task-lore-done-accepts-an-unattested-self-reported-pass-as is filed, unimplemented. AC-5 demands a retroactive sweep in the SAME slice; its landing-order section warns against arming it while self-reported-evidence tasks are in flight. Its ADR is still draft (SPEC-103 judgment needed)
- NS5: No full-suite verdict taken this session, deliberately (5 concurrent worktrees + rising load = exactly KD5s load-dependent false reds). A clean-tree full suite at a named commit is still owed before any no-regression claim about ca4ccbc/9aec354 is trustworthy
