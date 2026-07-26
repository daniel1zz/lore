---
id: PLAN-059
type: plan
role: plan
title: "Implementation — SPEC-064 Dashboard Settings UI"
status: archived
priority: medium
created: 2026-07-22
updated: 2026-07-22
tags: []
parent: SPEC-064
phases:
  - {name: "Phase 1: Foundation + machine backend", description: "config-precedence pure contract + machine write backend (saveGlobalConfig/GlobalConfigService/routes)"}
  - {name: "Phase 2: Frontend", description: "cohesive Settings route + two-scope UI consuming precedence contract + team/machine APIs"}
  - {name: "Phase 3: Verification & Acceptance", description: "e2e suites, regression + verify/assess, UAT acceptance gate"}
links:
  - {id: SPEC-064, type: implements}
---
# Implementation — SPEC-064 Dashboard Settings UI

Governing spec: `spec-spec-064-dashboard-settings-ui-two-scope-config-editing-wit` (design-kind). Strategy: **Interface-First vertical slices** — a pure precedence contract + machine-config backend land first (parallel), the Settings UI consumes both, then e2e + UAT gate close it.

## Overview

SPEC-062 shipped the team-config write backend without a UI. This plan adds the Settings surface and the ONE backend extension the UI forces into existence — a machine-scope (`~/.config/lore/config.yaml`) write path (`saveGlobalConfig` had no counterpart). Two config scopes with sharply different blast radius get visually distinct containers with an explicit disclosure at the boundary.

## Invariants (verified at every Phase Gate)

- **INV-1 One deny SSOT.** `CONFIG_DENY_KEYS` in `@lore/core/config-editability.ts` governs BOTH scopes. No second, machine-specific deny table is introduced. `defaults.editor` is denied (AC-062-13); the machine scope's writable surface is exactly `defaults.format` + `defaults.color`.
- **INV-2 Server is the boundary.** The UI imports the deny/redact/precedence tables only so it cannot offer an edit the server will reject. Every write path (team + machine) is validate-then-write: a schema-invalid merge writes exactly 0 bytes.
- **INV-3 No re-derivation.** Precedence is displayed via imported `mergeDefaults`, never a second implementation. CAS hashing uses the single `config-service` helper, never a hand-rolled duplicate.
- **INV-4 Browser safety.** `@lore/core` default barrel imports 0 Node builtins; `packages/dashboard/src` imports `@lore/core/node` 0 times. (`packages/core/tests/browser-safety.test.ts`.)
- **INV-5 CAS base frozen at edit-start.** Both scopes freeze their base hash when editing begins and disable focus/reconnect refetch while an edit is in flight (the SPEC-022/SPEC-062-retro lost-update class — a known-recurring defect, not hypothetical).
- **INV-6 Machine writes are cookie-only.** Bearer → 403 on the machine PATCH route, CSRF-Origin inherited.

## Risk Register

| ID | Risk | Cat | Impact | Trigger | Mitigation | Contingency |
|---|---|---|---|---|---|---|
| R-1 | Machine write path becomes a browser-reachable write to a machine-wide file — new blast radius | Security | H | any bearer-accepted machine PATCH, or a deny key writable | INV-1/INV-6 + T2/T3 deny-enforcement tests + cookie-only route | revert machine write, ship read-only machine scope |
| R-2 | Lost update via mid-edit refetch (SPEC-062 retro recurrence) | Quality | H | ConflictModal never fires under a concurrent writer | INV-5, T4 freezes base + disables refetch, T5 e2e stale-hash case | block save on any refetch during edit |
| R-3 | Component-file contention between render and write frontend work | Dependency | M | two parallel tasks touch same Settings component | single cohesive frontend task (T4), not split | serialize with blocks link |
| R-4 | e2e authored against not-yet-built route stalls | Scope | M | e2e written before UI exists | e2e AFTER frontend (T5 blocked by T4) | — |
| R-5 | UAT gate un-passable / lore-uat needs running dashboard | Quality | M | plan cannot archive (plan-close gate) | T7 runs lore-uat with dashboard up, records verdict | accept-with-conditions verdict if P1/P2 only |

## Exit Criteria

- All 7 spec ACs attested (AC-064-1/2/7 via e2e, 3/4/5/6 via test).
- `lore verify` green; `lore assess` reviewed.
- UAT verdict recorded (P0-accepted) — required by the design profile + SPEC-054 plan-close gate.
- `lore status --check-drift` exit 0 after spec code anchors declared.

## Governance Mode

`attended` — orchestrator drives gate calls continuously; stops only for a genuine design decision or an Invariant violation.

## Phases

- **Phase 1: Foundation + machine backend** — pure precedence contract (T1) ∥ machine write backend (T2) → machine HTTP routes (T3).
- **Phase 2: Frontend** — cohesive Settings UI consuming the contract + both APIs (T4).
- **Phase 3: Verification & Acceptance** — e2e suites (T5), regression + verify/assess (T6), UAT acceptance gate (T7).

## Decisions Log

- Strategy: Interface-First vertical slices (user-selected 2026-07-22). Rationale: converts backend/frontend into O(1) critical-path depth behind a pre-defined precedence contract + API shape.
- e2e written AFTER frontend (user-selected) — avoids speculative selectors against a non-existent route.
- machine scope = full read-write (user-directed) — forces the `saveGlobalConfig` backend extension.
