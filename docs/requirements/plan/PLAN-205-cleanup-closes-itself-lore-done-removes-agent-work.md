---
id: PLAN-205
type: plan
role: plan
title: "Cleanup closes itself: lore done removes agent worktrees; agents stop stashing and self-matching waits"
status: approved
priority: medium
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: SPEC-174
phases:
  - {name: "Phase 1: cleanup without a human", description: "CL-1..4"}
---
## Overview
The approved removal test (AC-WS-1..6) is correct, but nothing drives a finished worktree into the removable state, so cleanup fell to the human three times on 2026-10-18. Root-cause report (read-only, 2026-10-18): (1) `lore done` never removes an agent worktree: gatherWorktreeFacts (packages/lore/src/service/worktree-cleanup.ts:267) existsSync()s the claim's recorded `--worktree` value, which the dispatch protocol fills with the BRANCH name (assets/agents/lore-implementer.md:51), so every such claim reports `gone` (audit rows: 162 branch-form, all `gone`, 0 removed; 38 absolute-path rows removed). AC-WS-3's fixtures used absolute paths only. (2) Assets steer agents into `git stash push` (lore-implementer.md:36; gate safe-hints pre-bash-git-safety-gate.mjs:591/597/603) while drop is human-only: a one-way ratchet (28 stashes). (3) Self-matching `pgrep -f` polling loops kept an agent alive 16 h, so its run never ended and its worktree stayed locked. (4) The test helper run-process-group.ts reaps child groups only on process 'exit', which a signal-killed worker never fires, leaving PPID-1 orphans (npm pack, 25 h).

This plan fixes only what the approved spec already requires or what changes no decision. Reaping processes and dropping existing stashes are destructive and contradict adr-a-gate-premised-on-the-agent-s-judgment-being-untrustworthy; they belong to the autonomy design (separate ADR/spec, user decision).

| T | Task |
|---|---|
| CL-1 | lore done resolves a branch-name claim to its worktree path (git worktree list --porcelain) and removes it when the removal test allows; reports `gone` only when neither path nor branch resolves, naming which lookup failed; absorbs task-lore-done-prints-worktree-gone-for-a-worktree-that-still |
| CL-4 | lore-autopilot SKILL.md:119 uses lore done's removal outcome instead of a manual git worktree remove, and runs `lore worktree sweep --apply` at round end |

Dependencies: CL-1 blocks CL-4.

Scope note (plan review 2026-10-18): the stash steer (lore-implementer.md:36, gate safe-hints), self-matching pgrep waits, signal-killed helper orphans and leaked lore-attested-red-* worktrees are outside this spec; they move to the autonomy initiative's spec with their own ACs. This plan only makes lore done and autopilot do what D3/D4 already require.

## Invariants
- INV-1: the removal test (worktree-removal-test.ts) and the gate's refusals are not weakened; every fix makes the state safe, never the check lenient.
- INV-2: every shipped change (assets/, binary) is verified from a fresh consumer install path (CLAUDE.md dogfooding rule), not only in this repo.
- INV-3: red-first for each behaviour change with exact exit codes asserted.

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| Resolving a branch to a path picks a peer session's worktree of the same branch name | H | Resolve via git worktree list of THIS repository only, require the branch to match exactly and the removal test (owner run, occupancy) to pass |

## Exit Criteria
- AC-WS-3 re-verified via lore verify after its oracle (done-worktree-cleanup-compiled.bun.test.ts) gains three branch-name claim fixtures, each red before CL-1: (a) branch resolves, worktree clean+merged+unoccupied, run ended → removed, done exits 0, output names the removed path; (b) branch resolves but the removal test keeps it (e.g. a live process inside) → kept, output names the keep reason; (c) branch name resolves to no worktree and no path exists → `gone`, output names both lookups that failed (path, branch).
- CL-4: new test scripts/tests/autopilot-cleanup-path.test.ts asserts exit 0 of a grep over assets/skills/lore-autopilot/SKILL.md that finds no `git worktree remove` instruction on the post-merge path and finds `lore worktree sweep --apply`; red before the asset edit (exit 1, naming SKILL.md:119).
- INV-2 check: after `bun run build`, `lore setup` run with HOME set to a fresh mkdtemp directory installs a lore-autopilot SKILL.md byte-identical to assets/skills/lore-autopilot/SKILL.md (cmp exit 0), and the existing packages/lore/tests/integration/npm-install-simulation.test.ts passes.
