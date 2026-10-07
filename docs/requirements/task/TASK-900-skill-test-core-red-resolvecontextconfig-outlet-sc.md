---
id: TASK-900
type: task
role: plan
title: "[Skill:test] core RED — resolveContextConfig outlet scoping and frontmatter schema"
status: archived
priority: critical
phase: "Phase 1: Foundation"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
---
Estimate: S
Source: task core AC; spec D3, D11, D14
TDD-Role: red | Paired-Impl: core
Scenarios:
- Given global {context:{language:'zh'}} and project {context:{language:'en'}}: resolveContextConfig(..,'claude-md:user').language === 'zh'; 'claude-md:project' → 'en'; 'hook:subagent-start' → 'en'; global-only disable list reaches claude-md:user only.
- FragmentFrontmatterSchema rejects unknown keys, audience 'subagents:*', mode 'always'; accepts the spec example frontmatter.
- HOOK_STRING_CAP - POINTER_CEILING === SUBAGENT_FRAGMENT_CAP === 9400; HOOK_STRING_CAP - NOTICE_RESERVE === SESSION_FRAGMENT_CAP === 9600; LANGUAGE_NAMES.zh === 'Chinese'.
AC:
- Written against `packages/core/src/context-fragments.ts` (does not exist yet) → RED for missing module; record `lore evidence --result expected-fail` at that moment.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
