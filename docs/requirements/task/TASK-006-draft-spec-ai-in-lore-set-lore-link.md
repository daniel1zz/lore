---
id: TASK-006
type: task
role: plan
title: "Draft SPEC: AI in lore set / lore link"
status: archived
priority: medium
created: 2026-06-30
updated: 2026-06-30
tags: []
parent: PLAN-001
plan: PLAN-001
---
Track B · Task B1

Source: SPEC-017 §6 "Out-of-scope rejections" — explicitly defers AI to lore set / link.

Goal: Stub a new SPEC (drafting only — no implementation) that extends the AI provider surface from SPEC-017 to mutating commands. Key questions to resolve in the draft:

- Should lore set --regenerate replace content via AI, or merge?
- Should lore link --infer use AI to suggest link type from doc content?
- Reuse SPEC-017 AIProvider interface or new shape?
- Failure semantics — same fail-loud as create?

Deliverable: spec-ai-in-lore-set-link in draft, parented to PRD, listing ACs + open questions.
