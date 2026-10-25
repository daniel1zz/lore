---
id: TASK-1857
type: task
role: plan
title: "[Skill:fix] lore issues --verify and --sync disagree on the same issues, and a GitHub close never reaches the corpus"
status: draft
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Estimate: M
Problem (measured 2026-10-19 in this repo):
1. `lore issues --local --verify` exits 11 listing 188 divergences, all `github=none` (no resolution:* label): adopted 108, fixed 39, rejected 20, duplicate 12, closed 7, resolving 1, superseded 1. In the same minute `lore issues --sync` (dry run) prints "sync: clean — no GitHub issue drift found" and `lore issues --verify` (upstream corpus) reports 0. Two commands describing the same issues disagree, and the one that repairs (`--sync --apply`) sees nothing to repair.
2. One direction is missing: 14 reports are `adopted` (open) in the corpus while their GitHub issue is CLOSED; nothing pulls a GitHub close back into the corpus, so the corpus keeps them open with no trace of why GitHub closed them.
Approach: one drift model shared by --verify and --sync over the same corpus selection (state which corpus each reads; a repo that is its own upstream must read the same one); sync covers both directions: corpus terminal -> GitHub close+label (exists), GitHub closed with no corpus resolution -> listed as drift needing a recorded resolution (never auto-resolved: a GitHub close is not evidence of a fix).
AC: throwaway corpus + stubbed GitHub port: (a) the same fixture yields the same drift set from --verify and --sync; (b) a GitHub-closed issue whose report is open in the corpus is listed by --sync with "closed on GitHub, no corpus resolution"; (c) --sync --apply never writes a corpus resolution for (b). Make (a) red once.
