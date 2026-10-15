---
id: KN-535
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-24
updated: 2026-10-10
tags: []
parent: PLAN-141
---
# Handoff — agent:main-orchestrator

SCOPE: 4 decisions + 7 next steps = 11 items to account for

## Plan

plan-retire-spec-146-s-split-debt-repoint-the-eight-stale

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | F2 landed and closed: 4 files, 12/11, zero behaviour change. Verified on main independently of the worktree — AC-SPLITDEBT-1 unmarked=0 marked=4 exit 0, and lore verify --falsify drove the DECLARED falsifier to attested red (exit 1 vs declared 1)@0.95 | — |
| KD2 | F6 RETRACTED as a defect: version-less phase writes are DELIBERATE, rationale at phase-service.ts:5 (SPEC-023) and ac-service.ts:8. The neighbour measurements stand; 'five siblings log so this one forgot' does not. Behaviour is not the same as stated reasons@0.9 | — |
| KD3 | What survives F6: S1 root CLAUDE.md asserts a lifecycle universal three writers break (a DOC falsehood), and S2 SPEC-023's soft-groupings premise moved once extra.phases[] began gating task validation and plan-close. SPEC-148 rewritten, ACs re-baselined, re-approved@0.85 | — |
| KD4 | The plan's first assess was INVALIDATED: scope_fidelity 45 charged the diff with CLAUDE.md/export-index edits that git show --name-only a199d386 shows ZERO of. Cause: diff derived from 2 commits incl. the --no-ff merge. Scoped --diff-file re-run: 92/86@0.9 | — |

## Failing Oracle

(none)

## Next Steps

- NS1: SPEC-148 needs a plan: one task authoring packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts for AC-PHASEVER-1/2, plus an ADR answering S2 either way. Retire SPEC-148's anchor-coverage-ledger row only if that ADR resolves toward changing the write path
- NS2: F3 and F4 still unowned, no spec: F3 = flag an index-section list item carrying no resolvable slug; F4 = code-derive or test-diff the Document Lifecycle fenced block against schemas.ts VALID_TRANSITIONS
- NS3: BLOCKED, NOT MINE: check-anchor-coverage exits 1 on spec-lore-issues-falls-through-to-the-local-corpus-on-a-retired (concurrent session's F1 spec, no anchors, no ledger row). pre-push stays red until they dispose it; filing a cohort for work I do not own would be fabrication
- NS4: RED, NOT MINE: bun run typecheck exits 2, 3 errors all in packages/lore/tests/integration/cli/issues-upstream-shape-refusal.bun.test.ts from merge 3536bc8b. A red-first test should still COMPILE; TS2339 on SyncSubprocess.error looks like a real API mistake worth telling that session
- NS5: PENDING CLEANUP: git worktree remove .claude/worktrees/agent-a6aace58b34574206 then git branch -d worktree-agent-a6aace58b34574206, WITHOUT --force. The git-safety gate refuses until the branch reflog is quiet 30 min; last activity 17:57:37, unblocked from about 18:27:37
- NS6: DISPATCH PRECONDITION CORRECTED: worktrees are cut from origin/main, proved in this run's own reflog ('branch: Created from origin/main'). Check git rev-list --count origin/main..main == 0 before dispatch; non-zero means PUSH or declare a stale baseline in the bundle. This run dispatched at 56
- NS7: PRD-001-lore-positioning.md is a drifted mirror, deliberately not forced (not this session's doc); lore export-docs --dry-run keeps reporting it
