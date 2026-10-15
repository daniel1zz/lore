---
id: KN-495
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-21
updated: 2026-10-10
tags: []
parent: PLAN-136
---
# Handoff — agent:main-orchestrator

SCOPE: 1 decisions + 1 next steps = 2 items to account for

## Plan

plan-close-the-falsify-green-control-gap-an-unrunnable-scratch

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Green control landed: --falsify now runs the UNMUTATED command in the scratch worktree first and records inconclusive with no attestation when it fails, closing the 100%-false-match defect. Verified end-to-end on the real corpus. Plan archived, 2 tasks archived, assess 2 MAJOR to 0. @high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1 (the real blocker, worth an ADR): the fix makes every test-oracle falsifier resolve to inconclusive in a standard scratch worktree — node_modules is GITIGNORED so it is never in a 'git stash create' tree. The mechanism moved from FALSE reds to NO reds; both leave discriminating power unproven. Options measured, none chosen: symlink/hardlink node_modules in; --include-untracked (needed for new test files, insufficient for node_modules); install inside the scratch tree (ALREADY OBSERVED TO FAIL — a pre-fix evidence tail shows bun install ran and the command still failed); or replace worktree isolation (conflicts with D3, pinned by AC-FR-3). Measurement: knowledge-the-green-control-pattern-and-its-cost-a-falsifier. NS2: worktree .claude/worktrees/agent-a999667b67419c531 and its branch are clean/merged/0-ahead but the git safety gate needs 30min of reflog quiet (last commit 16:43) — remove both once quiet. NS3: lore report-issue is at cap 10 open, so a NEW defect could not be filed — the lore-done refusal that says 'attested' while its predicate accepts an unattested --capture row lives ONLY in that knowledge doc's F3, not in the defect channel. Free a slot or the channel is write-blocked. NS4: spec-falsifiability-reachability has ZERO code_anchors and sits in scripts/anchor-coverage-ledger.json as debt. I deliberately did NOT anchor it: only AC-FR-11/12 landed here, and a partial anchor would force deleting the ledger row in the same commit, erasing the fact that the other 10 ACs are still unanchored. Needs a pass over all 12 ACs' implementation paths. NS5: falsifier-execution-root.bun.test.ts had its fixture semantics changed by this plan and has NO attested per-file run; I re-ran it by hand (6 pass, exit 0) but no AC binds it, so nothing records that. NS6: root CLAUDE.md is at 23803/23838 bytes against the 0.97 eviction floor — 35 bytes left, so the next addition MUST be paired with an eviction.
