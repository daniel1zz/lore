---
id: TASK-547
type: task
role: plan
title: "[T3] Core: upstream resolver + config writer"
status: archived
priority: medium
phase: "GREEN"
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-105
plan: PLAN-105
links:
  - {id: TASK-545, type: blocks}
---
Implement resolveUpstreamFromInstalledBinary() returning Result<{corpus_path, root_prd}, LoreError> — resolve the installed binary (symlink -> real path -> enclosing repo root carrying .lore/lore.db), handling the compiled dist/lore, a symlinked install, and bun run dev source execution; anything unresolvable is a LOUD err() naming what failed, never a guess. Accept a candidate ONLY when its .lore/lore.db opens AND its root PRD matches the expected lore root-PRD identity (reuse SPEC-072's matchRootPrd — path existence alone is insufficient). Implement provisionFeedbackUpstream() as the single config write: non-destructive (preserves every other key), idempotent (never overwrites an existing feedback.upstream). Both live behind the existing report-issue-wiring.ts seam — resolveFeedbackUpstreamCfg stays the ONLY feedback.upstream READ site (plan invariant 1). Do NOT touch FeedbackConfigSchema (plan invariant 2). Satisfies AC-OOB-2/3/4/5.
