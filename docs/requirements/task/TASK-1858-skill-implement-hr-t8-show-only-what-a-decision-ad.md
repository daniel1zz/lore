---
id: TASK-1858
type: task
role: plan
title: "[Skill:implement] HR-T8 show only what a decision adds or removes; no factor scores on human-always classes"
status: draft
priority: medium
phase: "surfaces"
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-237
plan: PLAN-237
---
Estimate: S
Problem (observed 2026-10-19 smoke on a throwaway corpus, decision 2 governance-loosen "+ tmpcache/"): the detail shows `change.before` and `change.after` as two full 11-entry lists, so the human must diff them by eye to find the one added entry; and the factors B=0 C=0 E=0 R=0 are shown for a human-always class, where they are not measured and carry no meaning.
Approach: the dashboard detail page and the `lore decide` / `lore pending` lines render a list-valued before/after as the difference (`Added: …` / `Removed: …`, full lists behind a disclosure on the page); for a human-always class the factors are replaced by one line "This kind of change always goes to a person; no score applies." Same renderer facts for CLI and page (decision-detail-lines.ts and the dashboard component).
AC: component test: a loosen decision with an 11-item before and a 12-item after shows exactly "Added: tmpcache/" and no full list by default; a human-always decision shows the sentence and no factor values. CLI test: the decide confirmation prints "Added: tmpcache/" instead of Before/After lists. Make each red once.
