---
id: TASK-1672
type: task
role: plan
title: "The write-spec rule ships with the binary: init seeds no document, gate feeding falls back to the shipped asset by name"
status: archived
priority: high
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
Implements spec-the-write-spec-rule-ships-with-the-binary-lore-init-writes (BR-807, BR-1359). Built on the config takeover branch worktree-agent-a2e21971ddf014690 (merge it first): remove DC2 D5's seeding (init-seed.ts, the seed write in init-corpus.ts, the seed slug), make gate feeding fall back to assets/governance/write-spec-rule.md with a named source line, fail loud when the shipped asset is missing, and return every fixture that soft-deleted the seed to empty-corpus expectations (about 20 files reference the seed slug).
