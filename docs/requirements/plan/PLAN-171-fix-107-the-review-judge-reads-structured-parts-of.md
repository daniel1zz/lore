---
id: PLAN-171
type: plan
role: plan
title: "Fix #107: the review judge reads structured parts of the document"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: SPEC-159
phases:
  - {name: "fix", description: "RED then implement"}
---
# Fix #107: the review judge reads structured parts of the document

governance_mode: unattended (owner: "继续，快速全部做完")

## Acceptance
AC-RJI-1 on spec-the-review-judge-reads-the-document-as-stored-including.

## Invariants
- RED first by a separate tester; the implementer never edits test assertions.
- No silent fallback; exit codes measured without pipes.
- Census coverage of every armed branch stays 0 gaps.

## Tasks
1. RED (tester, worktree)
2. Implement (implementer, worktree)

## Risk register
| Risk | Impact | Mitigation |
|---|---|---|
| Change reaches consumers of the touched module | M | test:changed + main re-run after merge |
