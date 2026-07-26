---
id: TASK-234
type: task
role: plan
title: "Implement SPEC-066: slugify CJK + set --slug (code + AC tests)"
status: archived
priority: medium
created: 2026-07-23
updated: 2026-07-23
tags: []
parent: PLAN-049
plan: PLAN-049
links:
  - {id: TASK-226, type: blocks}
---
Implements SPEC-066 D1-D5. Deliverables: (1) schemas.ts slugify opts.transliterate + FNV-1a hash guard + type-prefix dedup + token-boundary truncation, slugifyWithCollision forwards opts; (2) pinyin transliterator module outside the default barrel (pinyin-pro@latest dep of packages/core, reachable only via @lore/core/node or equivalent non-barrel subpath); (3) four packages/lore callers inject the transliterator; (4) CorpusService.set accepts slug patch (slugSchema + uniqueness + version log + NO draft-reset) and CLI lore set --slug (SPEC-051 strict-flag registration); (5) tests satisfying AC-066-1..9 with test names containing the AC ids. Oracles: bun run typecheck && bun run test.
