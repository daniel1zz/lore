---
id: TASK-901
type: task
role: plan
title: "[Skill:implement] core context-fragments types, schema, resolveContextConfig and config keys"
status: archived
priority: critical
phase: "Phase 1: Foundation"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
links:
  - {id: TASK-890, type: blocks}
  - {id: TASK-898, type: blocks}
  - {id: TASK-894, type: blocks}
  - {id: TASK-897, type: blocks}
---
Estimate: M
Approach: per spec §Public Interface / Module Boundary — add browser-safe `packages/core/src/context-fragments.ts` exporting FragmentFrontmatterSchema (strict Zod: id, title, audience[], mode, when{language[]}), Fragment, Audience, OutletId ('claude-md:project'|'claude-md:user'|'hook:session-start'|'hook:subagent-start'), ResolvedContextConfig, pure resolveContextConfig(global, project, outlet) honouring D11/D14 (user outlet = global only; project outlet = project only; hook outlets = project over global), WHEN_MATCHERS registry, HOOK_STRING_CAP=10000, POINTER_CEILING=600, NOTICE_RESERVE=400, SUBAGENT_FRAGMENT_CAP, SESSION_FRAGMENT_CAP, LANGUAGE_NAMES {zh:Chinese,en:English,ja:Japanese}. Extend contextConfigSchema with `language` (string) and `fragments.disable` (string[]); extend GlobalLoreConfigSchema with an optional `context` subset {language, fragments.disable}. Re-export from index.ts. No Node builtin imports.
Source: spec D3, D6, D11, D14; existing patterns packages/core/src/config.ts (contextConfigSchema), packages/core/src/memory-markers.ts (browser-safe constants).
Dimensions: D-FUNC, D-CODE
Scope-Alt: WHEN_MATCHERS may ship with only `language`.
Covers: (foundation for AC-CF-2, AC-CF-3, AC-CF-14, AC-CF-21 — no AC owned directly)

AC:
- Given global {context:{language:'zh'}} and project {context:{language:'en'}}, When resolveContextConfig(..,'claude-md:user'), Then language==='zh'; for 'claude-md:project' Then 'en'; for 'hook:subagent-start' Then 'en' (unit test in packages/core/tests/unit/context-fragments.test.ts, vitest, `Tests N passed`).
- FragmentFrontmatterSchema rejects unknown keys and audience 'subagents:*' (typo) — unit test.
- `bun run typecheck` exits 0.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
