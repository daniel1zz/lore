---
id: TASK-232
type: task
role: plan
title: "Hotfix SPEC-068: pinyin lazy-load must survive bun compile (dynamic import, not createRequire)"
status: archived
priority: medium
created: 2026-07-23
updated: 2026-07-23
tags: []
parent: PLAN-049
plan: PLAN-049
---
Compiled dist/lore cannot resolve pinyin-pro via createRequire at runtime (bunfs virtual root) — CJK create fails exit 1 in production form; all prior ACs ran source-mode only. Fix: slugify-node.ts exposes cached async getter using await import('pinyin-pro') (static specifier — bundled by bun compile, probe-verified 29ms load in compiled form); 4 service callers await the cached getter once and pass the sync fn to slugify; NO silent un-transliterated fallback. Add compiled-binary e2e test per AC-068-10.
