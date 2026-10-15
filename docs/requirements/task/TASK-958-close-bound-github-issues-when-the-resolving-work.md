---
id: TASK-958
type: task
role: plan
title: "Close bound GitHub issues when the resolving work is archived"
status: archived
priority: medium
phase: "close-on-archive"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-155
plan: PLAN-155
---
Covers AC-IC-1..5 of spec-archiving-the-work-that-resolves-a-defect-report-closes (D1-D6). IssueCloser port over gh (close completed + comment, label best-effort, typed failures, already-closed no-op), wired in app.ts when feedback.upstream is configured; one post-archive step reached by every archive path (CorpusService status incl. plan close, TaskWorkflowService.done, archive apply/cascade) — post-commit, never rolls back; failures printed + audit row issue_close_failed; lore create --resolves <n|slug> (deterministic task-gh-<repo_id>-<n>, refuse whole creation on unknown); prose 'closes/fixes/resolves #N' warning on archive; lore issues --sync [--apply] [--json]; --check-issues D5(a) skips computed-fixed. Never touch the real GitHub repo or live .lore/ in tests. Red-first.
