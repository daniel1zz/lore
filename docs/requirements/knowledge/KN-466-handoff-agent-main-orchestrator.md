---
id: KN-466
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-17
updated: 2026-08-17
tags: []
parent: PLAN-124
links:
  - {id: KN-461, type: supersedes}
---
# Handoff — agent:main-orchestrator

SCOPE: 7 decisions + 7 next steps = 14 items to account for

## Plan

plan-land-oracle-exclusivity-a-mirror-check-that-can-fail-a

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | plan-land-oracle-exclusivity is CLOSED (archived, v9). 6 tasks archived, all 7 ACs hold an attested pass, every declared phase holds at least one task (no empty-phase vacuity). The plan-close gate refused once for ASSESSMENT_STALE and was right; I re-ran assess rather than use its exempt escape | 97 |
| KD2 | AC-OX-7 was SPLIT OUT of AC-OX-4, whose prose promised two layers while its oracle drove one. I ran the declared falsifier MYSELF: --git-common-dir to --git-dir exited 1 as declared, and the red hit the DISCRIMINATING test while the semantics-free BOUNDARY case stayed green | 97 |
| KD3 | The AC coverage badge is BROKEN, now visible on a CLOSED plan: SPEC-136 renders AC-OX-1 and AC-OX-6 as failed while BOTH hold attested passes. acCoveragePrefix reads fact.fail>0 and never consults deriveAcCoverageState fail_superseded. 2 of 7 misrender. See knowledge-the-ac-coverage-badge-ignores | 98 |
| KD4 | A spec approved BEFORE an ac add can never have that AC reviewed: ac add does not demote, and approved to in-review is NOT in VALID_TRANSITIONS, so the only re-review path is ac set, which demotes to draft and hard-blocks every descendant claim. Not an author oversight, unreachable by design | 96 |
| KD5 | lore evidence --capture labels capture_source runner but writes NO attestation block. Verified here: the implementer sincerely reported its pass as attested; it was not. A newer rule pushes oracle=test passes toward --capture, so the rule steers authors onto the non-attested path | 97 |
| KD6 | assess MAJOR on AC-OX-7 was TRUNCATION not a defect, machine-refuted: test line 68 imports the exported resolveDefaultLockDir, line 127 runs git worktree add. Its AC-OX-6 MAJOR IS real - that verdict tracks live corpus state, so an unrelated soft-delete reds it with no code change | 95 |
| KD7 | Writing the live corpus mid-dispatch is what reddened 9 corpus-reading tests last round, and the orchestrator was the polluter. Recorded as knowledge-a-concurrent-write-silently-invalidates-the-other. This round I deferred every corpus write until the agent returned | 96 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1: Remove worktree .claude/worktrees/agent-adc3194ed5fab9ce2 (clean + merged, branch worktree-agent-adc3194ed5fab9ce2). The safety gate refused only because reflog activity was 8 min old, inside its 30-minute liveness window. Also present and NOT mine: worktree-agent-a1d04c7ee88aff120 (zero commits, identical to main) - confirm ownership before touching
- NS2: NS2: UNCHANGED - do NOT close plan-land-oracle-executability (01KZN4F66X). Re-verified this round: records 5, ready 0, archived 5, but phases corpus-cleanup and backlog-and-arm each hold ZERO tasks. Decompose them first
- NS3: NS3: Mechanize the four recorded findings, each needs a spec (not writable inside a plan): the fail_superseded badge, the AC-id-not-globally-unique convention, the concurrent-write verdict staleness, and judge truncation (SPEC-028 is approved with AC count 0). Run /lore-design
- NS4: NS4: assess RECOMMENDS splitting AC-OX-6 into a tree-state-independent structural assertion plus a live-corpus census re-verified at merge time, so unrelated corpus drift cannot red a landed AC. Sound - it reddened mid-session this round when a lore done ran before the mirror converged
- NS5: NS5: Two mirror body drifts remain by CONSTRUCTION, not neglect: PRD-001 embeds a ModuleTree MDX placeholder so its body re-drifts on EVERY corpus write. Zero body drift is unreachable for placeholder-bearing docs. Do not keep force-repairing it expecting convergence
- NS6: NS6: Raw readiness, never inferred - exclusivity 01KZR6QS8H records 6 ready 0 archived 6 (plan ARCHIVED); executability 01KZN4F66X records 5 ready 0 archived 5; multi-session-p1 01KZV0A0KC records 9 ready 0 archived 9; peer plan 01KZQF85CB records 6 ready 5 archived 1 - NOT mine, a concurrent session owns it
- NS7: NS7: README.md is modified in the working tree by a PEER session (148 insertions) and deliberately untouched. A full-suite verdict needs a clean tree at a named commit, so no compliant full-suite run is possible until that lands. Coverage instead: full suite green at 08091dfd, plus the peer's 19 new tests and check-anchor-coverage green on the merged tree
