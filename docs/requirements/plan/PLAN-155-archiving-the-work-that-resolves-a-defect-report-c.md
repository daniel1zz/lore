---
id: PLAN-155
type: plan
role: plan
title: "Archiving the work that resolves a defect report closes its GitHub issue"
status: archived
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: SPEC-175
phases:
  - {name: "close-on-archive", description: "closer port, post-archive step, --resolves, --sync"}
---
# Plan — Archiving the work that resolves a defect report closes its GitHub issue

Implements `spec-archiving-the-work-that-resolves-a-defect-report-closes` (AC-IC-1..5), change set BR-1082 (resolve leaf), BR-1083 (create-a-document leaf), landing via `lore rule apply` at plan close. User request 2026-10-12 (auto-close bound issues when the bound work closes) — taken as S1 decision and S4 approval.

## Overview

One task: `IssueCloser` port (gh), one post-archive step reached by every archive path, `--resolves` on create, `lore issues --sync [--apply]`, `--check-issues` D5(a) adjusted.

## Invariants

| # | Invariant | How it is checked |
|---|---|---|
| I1 | An archive is never rolled back by a GitHub failure | AC-IC-1(c), AC-IC-2 |
| I2 | No test touches the real GitHub repository or the live `.lore/` | stub gh on PATH; recording fake closer; mkdtemp + lore init |
| I3 | Every failure is printed and audited, repaired by `--sync` | AC-IC-1(c)(d), AC-IC-4 |

## Order

Dispatched after `plan-one-worktree-removal-test-for-the-guard-lore-done-and-a` merges: both touch `task-workflow-service.ts` (`done`) and `app.ts`.

## Risk register

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | A real GitHub issue is closed by a test | H | I2: closer injected; e2e uses a stub `gh` first on PATH and a throwaway corpus whose upstream names a fake repo |
| R2 | Label creation needs admin (403 measured) | L | label is best-effort; failure reported, close kept |

## Decisions Log

- 2026-10-12 — rules moved from the snapshot into this spec's change set (BR-1080/1081 retired, re-proposed as BR-1082/1083).
- 2026-10-12 — #162/#168/#169 bound with `resolves` and closed on GitHub by hand (comment names the fixing plan/task); this plan makes it automatic.
