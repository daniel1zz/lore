---
id: TASK-1821
type: task
role: plan
title: "[Skill:fix] lore verify from a linked worktree is refused on its derived baseline write — regression from DCL-3b"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Estimate: S
Problem (measured 2026-10-19, regression from DCL-3b 5f13396f): `lore verify plan-write-path-everywhere --task task-skill-refactor-dcl-3b-route-the-17-remaining-modules --ac AC-DCL-5 --yes` run from a detached linked worktree of main (.claude/worktrees/verify-wp) is refused: "gate:corpus-write:foreign-provenance: this baseline write resolved a corpus OUTSIDE the caller's own working tree, and no fresh claim lease held from THIS worktree declares a corpus scope covering the target's branch". The same command from a worktree passed before 5f13396f (verify-dcl, AC-DCL-1..4). Verifying from a worktree is the mandated route (tests never run in the shared checkout), so after DCL-3b no plan can be verified.
Approach: find the baseline write verify makes (likely rule-state stamping derived from the verified ACs' cited rules) now routed through CorpusService.writeDoc. Decide by design, in this order: (1) if the write is derived state that verify recomputes from attested runs, it is authorized by the same declared intent that authorizes the evidence row (the verify run's target task/plan), not by a corpus_scope lease; (2) the evidence row itself keeps its existing rule. One decision function (CorpusWriteAuthority.decide) gets the case; no bypass.
AC: integration test with a throwaway repo + linked worktree: verify of a script AC from the worktree records the attested row and the derived baseline write (exit 0); an unrelated baseline write from the same worktree without a scoped lease is still refused with gate:corpus-write:foreign-provenance (exit 4). Runner-produced red (--capture) against current main.
