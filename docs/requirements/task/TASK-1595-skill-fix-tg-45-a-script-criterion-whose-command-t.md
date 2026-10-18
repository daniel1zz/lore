---
id: TASK-1595
type: task
role: plan
title: "[Skill:fix] TG-45 a script criterion whose command the shell cannot parse is refused at write time (AC-AU-8 declared with an unbalanced quote, verify failed exit 2 without running)"
status: draft
priority: medium
phase: "Phase 3b: one runner"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-201
plan: PLAN-201
---
Estimate: S
Approach: AC-AU-8 was declared (AU plan, 2026-10-18) with a command ending echo 'AC-AU-8 PASS: ... its class's calibration ...'; the apostrophe closes the single-quoted string, so the shell cannot parse the command. lore ac add accepted it, and the first lore verify on main recorded fail exit 2 in 149 ms with no test run (corrected in place the same day). A criterion whose command cannot be parsed can never pass and reads as a product failure. End state: every path that writes a script criterion's command (ac add, ac set, spec create/import paths — the single write chokepoint) refuses with exit 4 and a named rule when the command does not parse under the same shell lore verify executes it with (parse only, no execution; reuse that shell's no-exec parse mode), naming the parser message. Corpus scan 2026-10-18: 1200 live script commands, 0 unparseable after the AC-AU-8 fix, so no backfill.
Red-first: ac add with an unbalanced single quote is accepted today (red); after: exit 4, nothing written. Control: a command with a quoted apostrophe ("class's") is accepted; a parseable command whose test fails still writes (parse != run).
Source: AU-T8 merge 2026-10-18, AC-AU-8 correction
AC: red-first test green; existing ac add/set tests green.
