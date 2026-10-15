---
id: KN-232
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-01
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

- scripts/changed-tests.ts
- scripts/check-test-budgets.ts
- .gitattributes
- scripts/check-no-nul-bytes.ts
- CLAUDE.md

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | main was RED on check-test-budgets (exit 2, 8 new violations) from a FOREIGN session, now green at 99ed7cd. Attribution verified not assumed: 98fc22b's parent is f3242aa, the ledger re-key d6b87a9 is NOT its ancestor, and it touched neither ledger nor oracle — their own new debt@high | — |
| KD2 | The escape route was the scripts/ selector blind spot: at base f3242aa test:changed could not see scripts/tests/check-test-budgets.test.ts even by rule (a), so 8 spawn-heavy cases merged on a confident scoped green. Escape and fix (7f02c1f) happened in opposite directions within 24h@high | — |
| KD3 | A FOURTH invisible edge remains after 7f02c1f: tree-scanning oracles (check-test-budgets, check-no-nul-bytes) judge files they never import, so no reverse-dep walk reaches them. Measured: the 8-timeout diff did not select the test that had just gone red on it. Filed, unimplemented@high | — |
| KD4 | vitest run silently DROPS a .bun.test.ts named alongside a valid file — exit 0 on a partial run, no warning. Reproduced by the orchestrator. Alone it exits 1 loud, so the guard is defeated by a quorum of one. A concrete sixth-false-oracle-face instance. Filed, unimplemented@high | — |
| KD5 | Two real defects shipped past a FULLY GREEN oracle set (43/43, exit 0, tsc 0) and were found by reading git show --stat during merge-verify. Method that worked all session: discriminating checks, never bare greens. Recorded in knowledge-merge-verify-must-read-the-diff-s-shape-not-just-re@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-over-1 was IN FLIGHT at write time — outcome UNKNOWN. Do NOT assume: check lore get plus git branch for worktree-agent-a3e931f69848d643b. Its premise was re-verified live (call site moved 153 to 190, still no maxBuffer) before dispatch
- NS2: THREE filed and unimplemented: task-lore-done-accepts-an-unattested-self-reported-pass-as (has an ADR, still draft — approving needs a SPEC-103 judgment), task-test-changed-s-fourth-invisible-edge-a-tree-scanning, task-vitest-run-silently-drops-a-bun-test-ts-named-alongside-a
- NS3: task-session-front... session-start-freshness boundary task STILL load-deferred: its oracle needs the file green inside a FULL suite on a loaded machine. Machine carried 4-7 foreign locked worktrees and load 8-14 all session. Dispatch only when quiet, else the verification self-destructs
- NS4: No full-suite verdict taken this whole session, deliberately. Scoped oracles only. A clean-tree full suite at a named commit is still owed before any repo-wide no-regression claim. Note check-test-budgets and check-no-nul-bytes are now both green on main, verified by the orchestrator
- NS5: Minor observability nit, not filed: lore link truncates ULIDs to 8 chars, so two docs created in the same millisecond print an IDENTICAL source id and a correct link operation looks wrong. Verified by re-reading both full ids. Decide whether it is worth a task
