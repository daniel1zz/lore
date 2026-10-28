---
id: PLAN-245
type: plan
role: plan
title: "Decision records follow-ups"
status: archived
priority: medium
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: SPEC-258
phases:
  - {name: "F", description: "Follow-up fixes"}
---
# Decision records follow-ups

## Goal

Two defects found after plan-decision-records-on-writes closed:
- #482 (security): the milestone re-check re-runs agent-written cmd: premises from an allowlist keyed on command names with a deny-list of flags (decision-recheck.ts FORBIDDEN_FLAG); flags such as rg --pre-glob/-z/--search-zip, git grep -O / --open-files-in-pager, git -c, git diff --output variants and lore subcommands that write can still run programs or write files. Replace with a closed allowlist: per command, only listed flags are accepted; anything else is not-rerunnable.
- weight table liveness: WeightTableService counts a deprecated or invalidated table as holding its kind, so a replaced table can never be superseded.

## Tasks

- F1: weight-table liveness (AC-DR-10).
- F2: closed flag allowlist for re-run commands (AC-DR-7), resolves #482.

## After landing

lore verify; lore done; create the corrected weight tables (knowledge-weight-table-rule-revision-2 / -document-revision-2 already exist as drafts); lore assess.
