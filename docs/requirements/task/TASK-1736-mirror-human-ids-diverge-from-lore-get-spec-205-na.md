---
id: TASK-1736
type: task
role: plan
title: "Mirror human ids diverge from lore get: SPEC-205 names two different specs; BASE-n is unresolvable"
status: draft
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Found 2026-10-19: the docs/requirements mirror's human ids are not the ids lore resolves, and at least one collides.
- Mirror `docs/requirements/spec/SPEC-205-*.md` = ULID 01M4APBSGVFFX67X04RSR6GDMZ (spec-product-baseline-architecture-trees-the-product-s-current), per .lore/export-index.json.
- `lore get SPEC-205` returns a DIFFERENT doc: 01M57NF1QYSAN18F34CWMQJCCD (spec-module-index-lists-only-folders-with-a-memory-file-managed), which has no export-index entry.
- `lore get SPEC-032` and the mirror SPEC-032 agree (same title), so older ids agree and recent ones diverge.
- `lore get BASE-095` → "Document not found"; BASE-n exists only in the mirror.
Root CLAUDE.md tells agents to "read the governing spec (`lore get SPEC-0NN`)" and the mirror is the git-visible index, so an agent reading SPEC-205 in the mirror and then `lore get SPEC-205` gets a different spec. This breaks North Star "the corpus must not lie / rendering is injective / addressable".

Expected: one human id names one document everywhere: `lore get <human id>` and the mirror file agree for every exported doc (spec, baseline, plan, task, adr, knowledge, prd), or the mirror stops presenting ids lore cannot resolve. Oracle: for every export-index entry, `lore get <human_id>` resolves to that ULID (or fails loudly for a type lore does not number), checked by a script in the floor. Find which allocator is authoritative and why they diverged (mirror stale vs two allocators).
