---
id: TASK-004
type: task
role: plan
title: "Draft SPEC: sync-docs reverse (corpus → file)"
status: archived
priority: medium
created: 2026-06-30
updated: 2026-06-30
tags: []
parent: PLAN-001
plan: PLAN-001
---
Track B · Task B3

Source: SPEC-018 only ships forward sync (file → corpus). Reverse is needed because:

- AI-created docs (SPEC-017) only live in corpus; git history loses them
- Dashboard edits (future) need a path back to git
- Disaster recovery: corpus loss should be replayable from git

Goal: Stub SPEC for lore export-docs (or sync-docs --reverse). Resolve:

- One file per doc vs combined? (forward is one-per-file)
- Where to write? docs/requirements/ subdirs by type, like forward?
- Conflict semantics if file already exists and corpus content differs
- Frontmatter shape (must roundtrip with forward sync)

Deliverable: spec-sync-docs-reverse in draft.
