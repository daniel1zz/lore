---
id: TASK-621
type: task
role: plan
title: "[Skill:implement] template pointer + lore-init-context SKILL.md contract consumption rewrite"
status: archived
priority: medium
phase: "Phase 2: Parallel Implementation"
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-116
plan: PLAN-116
links:
  - {id: TASK-611, type: blocks}
  - {id: TASK-606, type: blocks}
---
Estimate: M
Approach: template — add ONE pointer line (`lore governance claude-md` prints the project CLAUDE.md content contract) inside the managed marker section of assets/project/CLAUDE.md.template. SKILL.md — Step 0 preflight gains contract consumption (run `lore governance claude-md`, conform generation); DELETE the skill's own "What Goes In vs Stays Out"/style-rules taxonomy (replaced by verb output); append final oracle step (`lore status --check-claude-md` over generated files); lore-absent fallback = generic structure + recommend `lore setup`, NO contract copy.
Source: spec §Scope consumers 1-2; cohesion review (delete, not align)
Dimensions: D-DOC, D-FUNC
Scope-Alt: SKILL.md wording free; the two literal commands + taxonomy deletion + fallback rule are non-negotiable
Covers: AC-CMC-5

AC:
- Given the paired RED pin suite, When rewrite lands, Then `bunx vitest run packages/lore/tests/unit/assets/init-context-contract.test.ts` GREEN
- Given a lore-less fixture repo, When the skill's documented fallback path is followed, Then generation proceeds and no contract taxonomy text exists to copy (manual read-through recorded as human evidence)
- Integration: template stays within its own byte footprint discipline (<2KB) and marker pair intact
