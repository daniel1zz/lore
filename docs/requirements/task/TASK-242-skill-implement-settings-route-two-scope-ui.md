---
id: TASK-242
type: task
role: plan
title: "[Skill:implement] Settings route + two-scope UI"
status: archived
priority: high
phase: "Phase 2: Frontend"
created: 2026-07-22
updated: 2026-07-22
tags: []
parent: PLAN-059
plan: PLAN-059
links:
  - {id: TASK-241, type: blocks}
  - {id: TASK-240, type: blocks}
---
Estimate: L
Approach: TanStack file-route (createFileRoute) mirroring existing routes/*.tsx; TanStack Query for read; typed api client extending packages/dashboard/src/api/*.ts; reuse ConflictModal (SPEC-022) for CAS conflicts; shadcn primitives already in components/ui.
Source: SPEC-064 D2/D3/D4/D5; packages/dashboard/src/routes/library.tsx (route pattern), api/ (client), components/ConflictModal.tsx, components/Editor.tsx (CAS-freeze precedent)
Dimensions: D-FUNC, D-UI, D-UX
Covers: AC-064-1, AC-064-2

Build the Settings route + two-scope UI as ONE cohesive task (render + write share the same components — splitting them creates file contention, R-3). Requirements:
- A new route packages/dashboard/src/routes/settings.tsx registered additively.
- TWO visually distinct containers — Team (.lore/config.yaml, git-tracked, wins precedence) and Machine (~/.config/lore/config.yaml, affects EVERY corpus on this machine, loses precedence). NOT two collapsible sections of one list.
- The Machine container renders a literal blast-radius disclosure (D3): its values affect every corpus on this machine while being edited from THIS corpus's dashboard. This is an asserted DOM element.
- Every CONFIG_DENY_KEYS entry present (including defaults.editor) renders READ-ONLY (no enabled input) with an "edit via YAML" note (D1/D2). Import the deny table from @lore/core — do not hardcode.
- defaults.* rows show machine / project / built-in layers with the effective one marked, using T1's config-precedence (imported, D4) — never re-derive precedence in the component.
- restart_required surfaced per key BEFORE editing (from the GET response's per-key effect) and per changed key in the save RESULT (never an undifferentiated success toast) — PRD R-3.
- Write flow for both scopes: freeze the CAS base hash at edit-START, disable refetchOnWindowFocus/reconnect while an edit is in flight (INV-5, R-2 — the exact SPEC-062-retro lost-update class), reuse ConflictModal on 409.
- Team writes hit SPEC-062's existing PATCH /api/dashboard/config; machine writes hit T3's machine route.
- @lore/core/node imported 0 times from dashboard/src (INV-4).

AC:
- Render + write behaviors above are exercised by the T5 e2e suites (settings-render.pw.ts / settings-write.pw.ts); this task's DoD is the UI implemented such that those suites (authored next) pass.
- No new @lore/core/node import in dashboard/src (browser-safety scan stays green).
- Covers spec AC-064-1 and AC-064-2 (behavior; e2e in T5 attests).
