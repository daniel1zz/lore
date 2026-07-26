---
id: TASK-308
type: task
role: plan
title: "[Skill:implement] Author standalone corpus-workflow.md governance snippet (fresh)"
status: archived
priority: high
phase: "P0-assets"
created: 2026-07-16
updated: 2026-07-16
tags: []
parent: PLAN-033
plan: PLAN-033
links:
  - {id: TASK-307, type: blocks}
---
Estimate: M
Approach: Author `assets/governance/corpus-workflow.md` FRESH as a standalone, versioned governance snippet describing the Lore-governed FEED→PRODUCE→EXECUTE→CLOSE corpus workflow. Extract the WORKFLOW rules clean — NEVER copy from the owner's private global CLAUDE.md (R2). No personal rules (agent-browser/keychain/profile paths/language-preference/persona anchors).
Source: SPEC-046 Scope IN (P0 governance snippet, authored fresh); R2 mitigation.
Dimensions: D-FUNC (content correctness), D-CODE (standalone parse + private-rule exclusion)
Scope-Alt: none — R2 is a Medium risk with a dedicated conformance assertion.
Covers: AC-046-D (partial — governance standalone-parse + private-exclusion half)

AC:
- Given the file assets/governance/corpus-workflow.md, When a markdown parser reads it standalone (no external includes/placeholders), Then it parses without error and every heading/section is self-contained.
- Given the file content, When grep scans for private-rule markers, Then NONE of these appear: "agent-browser", "钥匙串", "~/.agent-browser", "claude-profile", "钥匙串不兼容", "use-mock-keychain", or any personal profile path (negative-grep asserted in the AC-046-D conformance test).
- Given the file content, When a reader checks coverage, Then it describes the four workflow stages (FEED / PRODUCE / EXECUTE / CLOSE) and the four gate checkpoints (spec-create / spec-promote / plan-promote / task-claim) in distributable, project-agnostic terms.
- Oracle: assets-ssot conformance test (AC-046-D) asserts presence + standalone parse + negative-grep.
