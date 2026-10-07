---
id: TASK-904
type: task
role: plan
title: "[Skill:implement] hooks-session — new session-start-fragments hook, resume Phase C removal, compact registration"
status: archived
priority: critical
phase: "Phase 3: Surfaces & wiring"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
links:
  - {id: TASK-910, type: blocks}
---
Estimate: M
Approach: per spec D6, D7, D10, D12 — assets/hooks/session-start-resume.mjs: delete Phase C (governance prose) only; keep seat-briefing + bootstrap framing + `lore bootstrap --injection`. NEW assets/hooks/session-start-fragments.mjs: spawn `lore fragments render --outlet hook:session-start --cwd <payload.cwd>`, print its JSON verbatim, never write files, never block (render failure → its banner). packages/core/src/distribution-hooks.ts: register session-start-fragments for SessionStart (startup, resume) AND matcher 'compact'. Re-baseline tests/e2e/context-provenance-compiled + resume-coverage-compiled for the removed Phase C (record original command, failure, why-correction in evidence). Regenerate assets manifest.
Source: spec D6, D7, D10, D12; assets/hooks/session-start-resume.mjs
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-CF-8, AC-CF-11, AC-CF-12

AC:
- `cd packages/lore && bun test tests/e2e/context-fragments-compiled.bun.test.ts -t 'AC-CF-8'` (and -t 'AC-CF-11', -t 'AC-CF-12') → ≥1 pass, 0 fail each.
- context-provenance-compiled and resume-coverage-compiled pass.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
