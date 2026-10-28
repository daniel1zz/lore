---
id: TASK-2018
type: task
role: plan
title: "I4 lore migrate fragments and automatic migration in lore setup"
status: archived
priority: medium
phase: "W"
created: 2026-10-23
updated: 2026-10-26
tags: []
parent: PLAN-274
plan: PLAN-274
---
Covers: AC-IT-5. Spec section Migration mapping, the Command paragraph (--scope required, user needs no corpus, preview default, --apply header-only rewrite with per-file hash precondition, exit 5 > 4 > 0) and the lore setup paragraph (setup applies the migration for the user layer and, inside a lore project, the project layer before refreshing rules files; refused/conflicting files do not stop setup but set its exit code naming each file). Parse the raw frontmatter (the old keys are refused by the new schema). Add 'fragments' to migrate.ts's action list and help text.
