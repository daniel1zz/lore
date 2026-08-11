---
id: PLAN-049
type: plan
role: plan
title: "Slugify CJK fix + set --slug: single-implementer execution"
status: archived
priority: medium
created: 2026-07-23
updated: 2026-07-24
tags: []
parent: SPEC-089
---
# Plan

Two-task execution of SPEC-066 (see parent spec for design D1-D5).

- T1 (implementation): all code changes in one worktree — @lore/core slugify (transliterate hook, hash guard, prefix dedup, token-boundary truncation, pinyin module outside barrel, pinyin-pro dep) + packages/lore wiring (4 slugify callers inject transliterator; CorpusService.set slug patch; CLI --slug strict flag) + AC-driven tests (slugify-cjk, barrel-isolation, set-slug).
- T2 (independent adversarial tests): separate tester agent, fresh worktree after T1 merges — six-dimension sweep (HAPPY/NEGATIVE/BOUNDARY/ERROR/STATE/REGRESSION) against the merged implementation; may only add/modify test files.

Oracles: bun run typecheck, bun run test (both runners), lore verify (script ACs).



> Numbering note (2026-07-23): plan/task text authored under the working number "SPEC-066"; the spec settled at **SPEC-068** (AC-068-*) after narrative-number collisions with two concurrently-merged specs. Task slugs retain the historical 066 token by design (slugs are addresses). Assessment gap "unexplained numbering drift" is hereby explained.
