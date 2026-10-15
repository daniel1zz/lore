---
id: TASK-676
type: task
role: plan
title: "Replace the false git-tracked mechanism in the unconfigured-upstream disclosure with the real untracked-but-filesystem-shared one"
status: deprecated
priority: medium
phase: "remedy"
created: 2026-08-11
updated: 2026-10-10
tags: []
parent: PLAN-122
plan: PLAN-122
---
# Objective

Close AC-GD-4. The shipped unconfigured-upstream message says `.lore/config.yaml` is **git-tracked**. It is not — verified four independent ways (see spec D3's correction and AC-GD-4). Replace the mechanism clause with the true one, which is **more** alarming: the file is untracked yet shared by every linked worktree via `findLoreDbPath`'s walk-up, so an edit appears in no diff, gets no review, and can never raise a merge conflict.

# Provenance — read before touching the AC

⛔ AC-GD-2 pinned the substring `git-tracked` and holds an **attested pass** against that pin. Do NOT edit AC-GD-2 or its evidence: a retro-edited passed criterion is indistinguishable from concealment. AC-GD-4 supersedes the wording FORWARD. Both criteria coexist deliberately; if the new text breaks AC-GD-2's substring assertion, that is expected — report it and let the orchestrator decide, ⛔ do not silently weaken either one.

# Acceptance

**AC-GD-4** only — `lore get 01KZR9ZW8V`. Note it asserts the substantive consequence too: the message must name who can actually apply the remedy (orchestrator / main-checkout only), since a worktree-isolated agent is structurally refused the write.
