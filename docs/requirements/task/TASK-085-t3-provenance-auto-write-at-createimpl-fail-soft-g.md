---
id: TASK-085
type: task
role: plan
title: "T3: provenance auto-write at _createImpl (fail-soft) + --governed-by + backlink"
status: archived
priority: high
phase: Provenance + query
created: 2026-07-09
updated: 2026-07-09
tags: []
parent: PLAN-021
plan: PLAN-021
links:
  - {id: TASK-084, type: blocks}
---
## Task Objective
Two things:
1. **Provenance auto-write** at the `CorpusService._createImpl` link seam: after a doc is successfully created, if `findFeedingSkill(newDoc.type)` returns an approved skill, write ONE `link(skill.id, newDoc.id, "governs")`. ⛔ FAIL-SOFT: any link-write failure is caught + logged, NEVER thrown — the created doc is the SSOT and `create` must still succeed. ⛔ IDEMPOTENT: skip if an identical `governs` edge already exists (so re-create/re-run doesn't duplicate).
2. **Reverse query** `lore list --governed-by <skill-id-or-slug>`: returns artifacts that the skill governs (docs on the `to` side of the skill's `governs` links). Add the same filter to the MCP list tool. The inverse direction (an artifact's governing skill) is already answerable via the existing nav/Related backlink now that `governs` is a link type — verify it renders.

## Spec Reference
§5.3 (fail-soft write at _createImpl), §2 IN(3,4), §9 R1 (fail-soft is the High-sev mitigation). AC-P4-3/4/5. Depends on T1 (`governs` enum) landed.

## Acceptance Criteria
- AC-P4-3: create a spec while an approved applies_to=spec skill exists -> a skill--governs-->spec link exists; re-run does not duplicate.
- AC-P4-4: with the provenance link-write forced to fail (inject/simulate), `create` STILL returns ok + the doc exists; failure logged not thrown.
- AC-P4-5: `lore list --governed-by <skill>` lists the governed spec; artifact nav shows the governs backlink.
- Full suites + typecheck green; throwaway corpus.

## Context Digest
`CorpusService._createImpl` is where a doc + its links are persisted — locate the point after the doc row is inserted. Links are written via the store's link API / `CorpusService` link CRUD (grep `manage_links`/`createLink`/link insert). `findFeedingSkill` reused from P1. For AC-P4-4, structure the write so a store link error is Result-checked and swallowed-with-log, not propagated. `lore list` command + its filters live in `packages/lore/src/adapters/cli/commands/list.ts` (or similar) + the corresponding store query.

## File Anchors
- EDIT `packages/lore/src/service/corpus-service.ts` (`_createImpl` provenance write)
- EDIT `packages/lore/src/adapters/cli/commands/list.ts` (+ store query) for `--governed-by`
- EDIT MCP list tool for the filter
- NEW tests (throwaway corpus)
