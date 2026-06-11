---
id: RETRO-01KTTHD4F3F6S40C1XQGN85WAS
type: retrospective
category: planning
title: DocMan frontmatter orphan root cause — lore docs/ index repair
summary: >-
  Why 14 lore docs were orphaned in DocMan index: type 'spec' not in DocMan type
  registry (must be 'feature-spec'/'tech-spec'), and unquoted YAML numbers
  (version: 0.4) fail z.string(). Fixed PRD-001 + SPEC-009; 11 spec files +
  RETRO-001 + IDEATION-001 still orphaned.
status: published
priority: medium
tags:
  - docman
  - frontmatter
  - indexing
  - lore
created: '2026-06-11T05:10:15.780Z'
updated: '2026-06-11T05:10:15.780Z'
version: 1.0.0
links:
  - target_id: PLAN-01KTRJGT31D8WJ4ZRHNARV9YBC
    link_type: references
---
# DocMan Frontmatter Orphan Root Cause

## Context

During Phase 2c planning (2026-06-10), `reindex` reported 14 orphan files in lore's docs/. The plan→spec→PRD chain gate (assert_doc_chain) required SPEC-009 + PRD-001 registered, forcing root-cause analysis.

## Root Causes (verified in ~/.claude/docman-mcp/src/schemas.ts FrontmatterRecoverySchema)

1. `type: spec` — not in DocMan's DocumentType registry. Valid spec-role types: `feature-spec`, `tech-spec`, `api-spec`, `data-model`, `design-spec`, `test-plan`. Fix: `type: feature-spec`.
2. `version: 0.4` (unquoted) — YAML parses as number; schema requires `z.string()`. Fix: `version: "0.4"`.

## Fixed

- PRD-001 (version quoted), SPEC-009 (type → feature-spec) — both now indexed.

## Remaining Orphans (12) — fix when chain needed or via docman-doctor

- SPEC-001..SPEC-008, SPEC-010, SPEC-011 (all `type: spec` → `feature-spec`)
- knowledge/RETRO-001-phase1.md, knowledge/ideation/IDEATION-001 (likely same class of issue — verify before edit)

## Detection Command

```
mcp__docman__reindex(report_orphans=true)
```
