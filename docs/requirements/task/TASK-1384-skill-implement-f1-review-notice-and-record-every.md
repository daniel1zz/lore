---
id: TASK-1384
type: task
role: plan
title: "[Skill:implement] F1 review: notice and record every cut section, parent included"
status: archived
priority: high
phase: "Phase 1: fixes"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-189
plan: PLAN-189
links:
  - {id: TASK-1381, type: blocks}
---
Estimate: M
Approach: per spec F1 — extend the Truncation Notice to every cut section (reuse buildOmittedSectionsNotice for the parent); keep the stored truncated: true for a cut body (AC-ADF-8, review-template-truncation.test.ts:141,154 unchanged) and ADD truncation: [{section, shown_chars, total_chars}] (no key when inputs fit); print one line per cut section in lore review text output.
Source: spec-close-the-eight-verified-critical-defects-no-judge-listing §Design F1; packages/lore/src/ai/review-template.ts:518-541; packages/lore/src/service/ai-provider-service.ts:2131
Resolves: task-lore-review-truncates-the-parent-spec-before-the-judge, task-gh-1343388703-34 (machine-readable cut only; verdict policy out of scope)
Dimensions: D-FUNC, D-CODE
Scope-Alt: the CLI line may be deferred only if the stored record lands (no: AC-CRIT-2 asserts both)
Covers: AC-CRIT-1, AC-CRIT-2
AC:
- Given a parent > max_context_chars with '## D8' after the cut, When the review prompt is built, Then it contains a parent truncation notice with shown/total chars listing D8 (AC-CRIT-1)
- Given body and parent both cut, When the review is stored, Then truncated stays true, truncation has exactly two entries whose numbers equal the real lengths, and lore review prints two cut lines; inputs that fit store no truncation key and print none (AC-CRIT-2)
Integration: lore review (CLI) and lore_review (MCP) both render from the stored judgment; existing readers of the old bool keep compiling (bun run typecheck exit 0).
