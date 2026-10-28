---
id: TASK-1569
type: task
role: plan
title: "[Skill:implement] IV-1 owned-only rules prune: source identity + hash in the managed header"
status: archived
priority: medium
phase: "P1 stop the bleeding"
created: 2026-10-18
updated: 2026-10-25
tags: []
parent: PLAN-208
plan: PLAN-208
---
Implement spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D1 (BR-1176). Rules files record fragment source folder realpath + rendered body hash in the lore-managed header; prune deletes only same-source, hash-matching files; else foreign_skip / diverged_skip; legacy: adopt selected byte-equal, else legacy_skip. Red-first test iv-owned-prune.test.ts with it-titles containing AC-IV-1 / AC-IV-2. Until IV-2 lands run user-scope tests with a scratch starting HOME.
