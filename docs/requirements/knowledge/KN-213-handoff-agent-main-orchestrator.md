---
id: KN-213
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-02
updated: 2026-08-02
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

- packages/lore/tests/unit/store/provenance-writes-io-error.bun.test.ts
- packages/lore/tests/unit/hooks/session-start-freshness.test.ts
- packages/lore/src/adapters/cli/utils.ts
- CLAUDE.md

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | All three ticket-70 NS tasks landed and archived, each merge-verified by orchestrator-side checks, not implementer reports. Full suite on clean tree d4f5999: vitest 438f/7717 pass/0 fail; bun 162f/1751 pass/0 FAIL. Ticket-70 KD1's 1-in-3 false RED is GONE@high | — |
| KD2 | I removed a LIVE peer's worktree: read 'git branch --merged main' output batched beside 'git branch -a' and merged the two lists visually. Restored from branch tip, ZERO source loss; that agent later merged itself into main. Correct predicate: 'git log main..<branch>' EMPTY@high | — |
| KD3 | The guard already EXISTS and SHIPS: assets/hooks/pre-bash-git-safety-gate.mjs has the blocking predicate at line 363, but its regex (line 418) matches only --force, its header calls non-force SAFE, and its remediation text steers INTO the hole. SSOT/installed byte-identical@high | — |
| KD4 | active_sessions is structurally INERT, not merely wrong: derived only over ACTIVE plans' tasks, and this corpus has 114 archived plans / 0 active, adhoc tasks parented to the PRD. It can never be non-empty. Contract says corpus-global; code is plan-scoped@high | — |
| KD5 | Re-querying is necessary but NOT sufficient. I queried active_sessions, claim age and corpus.last_updated FRESH — all three structurally silent. A fresh-but-inert reading feels like evidence and is not. Only 'git reflog show <branch>' answered@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: task-active-sessions-derives-only-over-active-plans-tasks-with (high, draft) — must also decide what stale:true means to a consumer (lease age is provably not death) and address the plan-scoped-derivation pattern, not only this site
- NS2: task-the-git-safety-gate-s-worktree-rule-matches-only-force-and (high, draft) — wire the non-force path through the existing line-363 predicate, add reflog-recency liveness, correct the header that recommends the unguarded path. Fix assets/ + regen manifest + fresh-setup probe
- NS3: task-the-resume-coverage-verb-accepts-a-reason-after-deferred (low, draft) — accepts a reason after 'deferred:' but rejects one after 'done', and first reports the explained completion as 'still unaccounted'. Cost two Stop rounds this session
- NS4: User's GLOBAL ~/.claude/CLAUDE.md:123 still names 'git branch --merged main' as the worktree-cleanup predicate — the command that misled me. Flagged to the user, deliberately NOT edited (their personal surface). This repo's CLAUDE.md:30 WAS corrected in cd0a8ac
- NS5: CLAUDE.md root 24542/24576 bytes (34 free), 206/220 lines. Ticket-70 NS4 still binds: the next slice needing space must evict a standing lesson, never raise the ceiling. My correction was byte-NEGATIVE (-2); that is not headroom
