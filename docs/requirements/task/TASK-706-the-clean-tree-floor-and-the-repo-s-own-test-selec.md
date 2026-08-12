---
id: TASK-706
type: task
role: plan
title: "The clean-tree floor and the repo's own test selection contradict each other, and five agents independently stashed to escape it"
status: draft
priority: high
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
Reported by the implementer of `task-the-handoff-and-uat-carve-out-in-the-foreign-write-guard`, which declined to file it itself because creating corpus docs is outside an implementer's mandate. Confirmed by direct inspection on main 2026-08-12.

## The deadlock

`lore evidence --result pass` and `lore release` enforce a WORKTREE-WIDE clean-tree floor. The repo's own mandated worktree oracle, `bun run test:changed <base>`, WRITES to the live corpus as a side effect of running (the e2e suites drive real corpus flows) and exports mirror files under `docs/requirements/`.

So an implementer whose diff is entirely inside its declared anchors reaches this state:

1. Runs the oracle the dispatch protocol requires.
2. The oracle dirties `.lore/` and `docs/requirements/` — files outside the task's anchors, which the implementer did not author and must not claim.
3. `lore evidence` / `lore release` now refuse: the tree is not clean.
4. The refusal prints a paste-ready command that commits those files.

Every exit is wrong. Committing them violates the path-scoped-commit rule and puts generated artifacts on a feature branch where they collide with the orchestrator's own re-export. Recording nothing loses the evidence. Pasting the gate's own suggested command is the path of least resistance and is the one that produces the collision.

## It is systemic, and it is measurable

`git stash list` on main, 2026-08-12 — 14 stashes, of which SIX are this exact pattern, from FIVE different worktree agents:

```
stash@{0} worktree-agent-a532c6b9988760725  mirror-export-side-effect-of-test-changed-run-...
stash@{1} worktree-agent-ade86fb8e13462a26  wip-sub-type-filter-mirror-artifacts-generated-by-test-changed-run
stash@{2} worktree-agent-ab8ab836397ea0015  wip-mirror-export-side-effect-round-2-...
stash@{3} worktree-agent-a4d96491ac36ae9f0  wip-mirror-export-side-effect-of-test-changed-run-...
stash@{4} worktree-agent-ab8ab836397ea0015  wip-mirror-export-side-effect-of-test-changed-run-...
stash@{5} worktree-agent-a0585fa8df17b5196  wip-mirror-dirt-trace-enumerate
```

Several of those worktrees are gone; the stashes outlived them. Independent agents, no shared prompt, converging on stash-and-hope because the protocol offers no correct move. That is the signature of a mechanism defect rather than five discipline failures.

## What must land

1. The clean-tree floor DISTINGUISHES author-authored dirt from oracle-generated dirt. `.lore/**` and `docs/requirements/**` are derived artifacts with a known generator; a floor that cannot tell them from a stray source edit is measuring the wrong thing. ⛔ Do NOT solve it by weakening the floor globally — its purpose (an evidence row must describe a known tree) is sound; the fix is to classify, not to relax.
2. The refusal's paste-ready command must never instruct a write the surrounding discipline forbids. If generated dirt is present, the remedy it prints should be the discard/regenerate path, not `git add` of files the task does not own.
3. Prefer removing the side effect at its source where possible: an e2e suite that writes the LIVE corpus is the deeper defect, and this repo already mandates `mkdtemp` + `lore init` for exactly that reason. Audit which suites still write the live corpus, and report the list rather than fixing silently — the count is the finding.
4. Oracle, two-sided: (a) a worktree dirty ONLY with regenerated `docs/requirements/**` + `.lore/export-index.json` still permits `lore evidence` / `lore release`; (b) a worktree with an unrelated source-file edit outside the task's anchors is STILL refused. ⛔ Half (b) is what keeps this from being a blanket relaxation — a fix that passes (a) alone has deleted the floor.
5. Sweep the six stale stashes once the fix lands; they are regenerable and currently indistinguishable from abandoned work.
