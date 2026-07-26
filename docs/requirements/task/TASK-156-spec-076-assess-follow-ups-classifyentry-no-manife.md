---
id: TASK-156
type: task
role: plan
title: "SPEC-076 assess follow-ups: classifyEntry no-manifest-entry edge, prune substring match, markerRewrites contract"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PRD-001
---
Three minor findings from knowledge-assessment-implementation-spec-076-distribution (all triaged real, none release-blocking):
1. planUpdate classifyEntry routes 'installed manifest has no entry but disk sha == embedded sha' to diverged (gated behind --force-diverged) instead of sync/missing-restore. Pin intended state in plan-update.test.ts RED first, then fix.
2. mergeSettings orphan prune uses command.includes(hooksPathPrefix) — a foreign command merely CONTAINING the hooks path would be pruned, contradicting AC-076-5's non-lore-byte-identical half. Respec as path-boundary/filename-set match + add foreign-command NEGATIVE oracle.
3. UpdatePlan.markerRewrites is documented always-empty (T6 implemented markers in setup-project-flow instead) — either wire population into planUpdate or remove the field from the type + spec Downstream Handoff (misleading bucket for future consumers).
Also process notes for next retro: RED-task evidence recorded result=pass on exit-1 runs (needs expected-red marker convention); evidence entries should be one-command-per-entry replayable.
