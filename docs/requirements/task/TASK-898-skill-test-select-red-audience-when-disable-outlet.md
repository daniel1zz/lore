---
id: TASK-898
type: task
role: plan
title: "[Skill:test] select RED — audience/when/disable, outlet layering, cross-file override refusal, determinism"
status: archived
priority: high
phase: "Phase 2: Pure services"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
---
Estimate: S
Source: AC-CF-2, 14, 19, 20, 21 statements; impl task: select
TDD-Role: red
Scenarios (describe names contain the AC id):
- AC-CF-2: hook:subagent-start + agentType tester + language zh → includes subagent:* and subagent:tester; excludes subagent:lore-reviewer-only, when.language [en], disabled id.
- AC-CF-14: claude-md:user output byte-equal under project language zh vs en.
- AC-CF-19: shipped/user/project static main fragments → claude-md:project = shipped+project, claude-md:user = user; disjoint.
- AC-CF-20: user fragment overriding a shipped static main id → err naming id; global disable of shipped static main → err; project fragment/disable targeting user static main → err; same targeting dynamic/subagent-only fragments → accepted.
- AC-CF-21: claude-md:project render byte-equal across differing user layer + global config.
AC:
- Run → RED for missing implementation; record expected-fail evidence at that moment.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
