---
id: TASK-1694
type: task
role: plan
title: "Audit backfill takes its boundary from the data: versions older than the first audit entry predate the writers; no config cut-off, no built-in date"
status: archived
priority: high
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
Observed 2026-10-20 after task-audit-verification-checks-every-version-pre-writer-history landed (9aae2c93): its branch removed audit.verify_since from the repo config, so lore migrate audit-backfill on main fell back to the built-in AUDIT_WRITERS_LIVE_FROM (2026-07-06T00:00:00Z) instead of the corpus's own 2026-07-06T12:02:00Z and previews 492 versions instead of 559; the 67 between would stay unaccounted and audit verification would keep failing. End state: the boundary is derived from the corpus itself — the created_at of the earliest audit entry; every version older than it without an entry is reconstructed; neither a config key nor a built-in date is read. AC: red-first test on a throwaway corpus whose first audit entry is at T: versions before T without entries are reconstructed, a version after T without an entry is reported missing and never reconstructed; the preview names the derived boundary and its source ('earliest audit entry'); AUDIT_WRITERS_LIVE_FROM is gone (grep). Then the coordinator applies it on main.
