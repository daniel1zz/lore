---
id: TASK-614
type: task
role: plan
title: "Dogfood pin: root CLAUDE.md must carry the claude-md-contract pointer line"
status: draft
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PRD-001
---
## Why
The content-contract rollout (spec-project-claude-md-content-contract-governance-injected) updated the distribution pipe (CLAUDE.md.template pointer line, AC-CMC-5) but this repo's own root CLAUDE.md — the only consumer NOT on the distribution pipe (hand-written, no managed marker) — silently missed the pointer. Instance of the standing lesson: consumer/end-to-end audits fail SILENT when an endpoint has no oracle. Root cause: AC-CMC-5 predicates cover template+SKILL.md only; the dogfooding endpoint had no invariant.

## What
Add a content-invariant assertion (NOT byte-parity — root CLAUDE.md is hand-authored) to packages/lore/tests/unit/assets/init-context-contract.test.ts (or a sibling dogfood-pin test): the repo root CLAUDE.md must contain the literal command `lore governance claude-md`. This rides the existing vitest suite + pre-push, so removal of the pointer line trips a deterministic oracle.

## AC
- vitest assertion fails when the pointer line is removed from root CLAUDE.md, passes with it present (red-first: verify by temporarily stripping the line in a fixture copy or via a mutation check).

The pointer line itself was already added to root CLAUDE.md in the same session that filed this task.
