---
id: TASK-1873
type: task
role: plan
title: "[Skill:fix] The ownership check reads red-first ACs from the corpus's allow-missing-path declarations; the JSON not-built ledger is deleted"
status: archived
priority: medium
created: 2026-10-18
updated: 2026-10-19
tags: []
parent: PRD-001
---
Estimate: S
Problem (measured 2026-10-19): `scripts/ac-oracle-not-built-ledger.json` repeats what the corpus already records: an AC declared red-first via `lore ac add|set --allow-missing-path "<reason>"` is tracked by the corpus as an UNREDEEMED declaration. Keeping the JSON in sync forces every implementing task to edit the same file (HR-T4 and HR-T5 were serialized by the task-claim anchor-overlap gate on it, and adding a spec's red-first ACs turned every session's integrate floor red until a ledger commit landed).
Approach: `check-ac-oracle-ownership` treats a `missing-owner-file` finding as ledgered exactly when the AC carries a live allow-missing-path declaration (read from `lore ac list --json`), and reports it with that reason; delete the JSON ledger file and its readers; a declaration whose file now exists needs nothing (the corpus drops it from the unredeemed count on read).
AC: unit tests of the pure classifier: (a) missing file + declaration -> ledgered with the declaration's reason; (b) missing file, no declaration -> missing-owner-file (exit 1); (c) the JSON ledger file is gone and no script reads it (grep). Make (b) go red once by treating every missing file as ledgered.
