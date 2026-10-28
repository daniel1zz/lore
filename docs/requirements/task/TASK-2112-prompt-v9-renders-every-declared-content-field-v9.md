---
id: TASK-2112
type: task
role: plan
title: "Prompt v9 renders every declared content field; v9 active"
status: draft
priority: high
phase: "P3 Prompt v9 and wiring"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-264
plan: PLAN-264
links:
  - {id: TASK-2087, type: blocks}
  - {id: TASK-2111, type: blocks}
  - {id: TASK-2063, type: blocks}
---
Covers: AC-JV-2, AC-JV-3, AC-JV-4, AC-JV-5
Approach: ADD buildReviewPromptV9 and the registry key (v1-v8 untouched). v9 renders through judgeContentFields(bundle.doc.type) with the existing cap; baseline keeps its v8 rule/glossary/dependency/example/command rendering, reached via the classification. Falsifier literals verbatim once: the for-loop over judgeContentFields, 'const omitted = entries.length - shown.length;', 'export const REVIEW_PROMPT_VERSION = "v9";', 'v9: buildReviewPromptV9'. Update the ai module CLAUDE.md file table (v9 active). Scoped floor: every importer of review-template.ts.

Derived parts: add ReviewBundle.derived_parts ({ heading, entries }[]) in review-checks.ts; CorpusService.getReviewBundle fills the plan parent-spec criteria into it (replacing the plan-only branch); v9 renders every derived part with the same frame and cap. Later specs (#416 children, #409 current values) only add bundle parts in the service, never edit v9.
