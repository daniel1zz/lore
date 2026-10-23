---
id: TASK-1537
type: task
role: plan
title: "ac list in source mode from a worktree may show a different evidence view than the binary (unreproduced)"
status: deprecated
priority: medium
created: 2026-10-17
updated: 2026-10-23
tags: []
parent: PLAN-197
plan: PLAN-197
---
Estimate: S
Approach: Reported 2026-10-17 by the T31 implementer (task-skill-test-tg-31-corpus-fail-census-to-zero-stale-ac-080), NOT yet reproduced by the orchestrator: inside an agent worktree, `bun scripts/check-corpus-fail-census.ts` (which runs lore in source mode from that worktree) listed AC-061-7, AC-062-3, AC-062-5 as fail and its `ac list` showed only an old July fail row for AC-062-3, while the installed `lore` binary run on the same corpus showed today's attested passes for all three. No per-worktree .lore/lore.db exists (checked). Reproduce: run `lore ac list <spec> --json` and `bun run packages/lore/src/index.ts ac list <spec> --json` (from main and from a worktree based on an older commit) for the SPEC-062 spec and compare per-AC state and evidence ref counts. If they differ on the same corpus, find which read path drops rows (corpus resolution from a worktree, evidence join, a schema/version gate) — two surfaces disagreeing about one corpus is a corpus-must-not-lie defect.
Source: root CLAUDE.md North Star (the corpus must not lie)
AC: either a reproduced divergence with its root cause fixed and a test, or a recorded non-reproduction with the commands and outputs.
