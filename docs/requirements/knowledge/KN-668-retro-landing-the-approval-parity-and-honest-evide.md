---
id: KN-668
type: knowledge
role: knowledge
title: "Retro: landing the approval-parity and honest-evidence plans (8 issues)"
status: approved
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
links:
  - {id: PLAN-154, type: relates-to}
  - {id: PLAN-153, type: relates-to}
---
# Retro: landing the approval-parity and honest-evidence plans (8 issues, 2026-10-12)

## Overview

Two plans, run by one orchestrator with worktree-isolated implementers, closed GitHub issues #65 #50 #47 #173 (plan-approval-and-plan-closure-go-through-the-same-checks-on, 9 tasks) and #48 #43 #19 #53 (plan-evidence-labels-and-reds-are-honest, 11 tasks). Every script AC passed `lore verify` on main (10/10 and 11/11). This doc records the full-suite measurement and the process findings the per-task evidence does not carry.

## Full-suite measurement on main (orchestrator, after the last merge)

- vitest (`bun run test:vitest`, main checkout, HEAD 6101920d): 15 files / 47 tests red. Compared file-by-file against the pre-work base 5931d5c9 in a clean detached worktree: 9 files were already red at base (anchor-coverage-ratchet, anchor-coverage-stale-exemption, setup.test AC-046-E.R1, check-ac-ref-integrity, check-shipped-defaults, check-test-budgets, mirror-status-parity, spec-mirror-export, claude-md-eviction-floor). Of the 6 newly red files, 5 (rule-change-set, rule-service, rule-snapshot-views, embed-assets-manifest, baseline.test) went green on re-run once another session's merge e671617e — landing mid-run — was complete; the 6th (migration-coverage) passes on a clean HEAD worktree and fails only in the main checkout because of ~840 uncommitted mirror files written by `bun run mirror:export` (links_broken 1).
- bun (`bun run test:bun`, clean HEAD worktree): 3132 pass / 6 fail of 3139. Pre-existing: AC-076-6.S1 (#55). Environmental: github-intake-reach (repo daniel1zz/lore-e2e-target unreachable). Caused by this initiative and fixed in commit 5b5b206c: AC-BLS2-11 (frozen status --json key set lacked capture_source_runner_unattested_count, #48) and AC-ICL-6 x3 (issue-check.bun.test.ts approved a spec through `lore set --status approved` with no judgment — the #65 bypass).

## Findings

1. **The affected-test enumeration missed two tests.** The #65 implement task's enumeration grepped the literal `"--status", "approved"`; issue-check.bun.test.ts passes the status through a helper variable, and the #48 change widened a frozen key set no grep named. Only the orchestrator's full suite caught them. A literal-token enumeration is a lower bound, never the set.
2. **Implement half of a TDD pair cannot meet lore done's red-first floor (GitHub #23/#149).** Each implement task's red lives on its paired RED task. Measured workaround used for all 8 implement tasks: build a detached worktree at the RED-merge commit (before the fix), run the RED file there, and record that genuine red on the implement task with `--capture`. `lore red-first` is a trap here: it adds a floor demanding a red row on the same task and blocks `--declare-no-new-tests`.
3. **Orchestrator `cd` into a worktree moves the harness's primary directory**, and worktrees created afterwards branch from that worktree's HEAD (two RED branches carried a foreign RED commit 90327415; rebased with `git rebase --onto`). Use subshells or `git -C`.
4. **An implementer wrote into the main checkout** (routes.ts, byte-identical to its committed branch copy); the merge refused. Stashed under a unique tag, merged, compared equal; the stash `claude-dup-routes-65-50` remains (the safety hook forbids dropping it).
5. **Concurrent sessions share the main checkout.** A `lore verify` typecheck failed on merge-conflict markers in issue-check.bun.test.ts that another session's in-progress merge left for seconds; the file was clean on re-check and the re-run passed. Full-suite and verify verdicts in the main checkout are only as stable as the slowest concurrent merge — run them in a clean detached worktree.
6. **Flaky oracle**: falsifier-dep-materialization.test.ts:963 failed 1 of 4 runs during concurrent builds (GitHub #191).
7. **Stop doc-sync hook charges subagent edits to the main turn and lists one line per edit event** (GitHub #190).
8. **Baseline leaves**: rule writes demoted 10 leaves + 2 branch nodes. 10 of 12 were re-reviewed and re-approved. Still draft, by design of this initiative's scope: baseline-submit-a-document-for-review (BR-310/BR-312 statements omit the reopen and locked-record exceptions owned by other specs) and baseline-archive-a-task (no live rule replaces retired BR-961 for the archived task's own worktree removal; another session's BR-1079 domain).

## Scope

Applies to any orchestrated plan that pairs RED and implement tasks and lands them on a main checkout other sessions also write to.
