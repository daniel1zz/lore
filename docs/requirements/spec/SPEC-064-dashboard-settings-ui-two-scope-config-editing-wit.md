---
id: SPEC-064
type: spec
role: spec
title: "Dashboard Settings UI: two-scope config editing with precedence and blast-radius disclosure"
status: approved
priority: medium
created: 2026-07-21
updated: 2026-10-17
tags: []
---
# SPEC-064 — Dashboard Settings UI: two-scope config editing with precedence and blast-radius disclosure

## Overview

SPEC-062 shipped the config WRITE BACKEND — `ConfigService.read/update`, `GET /api/config`, `PATCH /api/dashboard/config` with If-Match + `expectedHash` CAS + audit — and deliberately deferred the UI. There is still no way to see or change `.lore/config.yaml` except by hand-editing YAML, even though those 60+ keys across 22 specs decide whether the governance gates fire at all (`workflow.gates.*.enabled`), how long a claim lease lives, which AI provider runs, and what trust posture `lore verify` uses.

This spec adds the Settings surface, and extends the backend by exactly one thing the UI forces into existence: a WRITE path for the machine-level config.

There are two config files, and conflating them in one undifferentiated form is the primary hazard this design exists to prevent:

| | Team scope | Machine scope |
|---|---|---|
| Path | `.lore/config.yaml` | `$LORE_CONFIG_HOME` / `$XDG_CONFIG_HOME/lore` / `~/.config/lore/config.yaml` |
| Schema | `LoreConfigSchema` (60+ keys, 22 specs) | `GlobalLoreConfigSchema`, `.strict()`, exactly one section: `defaults` |
| Tracked | git — a change commits to the whole team | never — local to this machine |
| Blast radius | this corpus, every teammate after pull | EVERY corpus on this machine, immediately |
| Precedence | wins | loses (`mergeDefaults`: project spread last) |
| Write path today | `ConfigService.update` (SPEC-062) | **none — `loadGlobalConfig` has no `saveGlobalConfig` counterpart** |

A misclick's blast radius must be readable from the screen. The two scopes therefore get visually distinct containers with an explicit disclosure at the boundary, never two collapsible sections of one list.

## Scope

### In

- A Settings route in `@lore/dashboard` rendering both scopes.
- Per-key precedence display for `defaults.*`: machine value, project override, built-in default, and which layer is EFFECTIVE.
- Deny keys rendered READ-ONLY with an "edit via YAML" note — visible, never hidden.
- `restart_required` surfaced per key (before the edit) and per changed key (in the save result), never an undifferentiated success toast.
- `saveGlobalConfig` in `@lore/core/node` + a machine-scope service + cookie-only HTTP routes, mirroring SPEC-062's validate-then-write / CAS / audit shape.
- Optimistic concurrency for both scopes, reusing SPEC-022's `ConflictModal`.

### Out

- Machine-level `~/.claude/settings.json` (hooks/permissions) — a genuinely different trust domain, unchanged from SPEC-062's OUT list.
- A `lore config get/set` CLI verb — the CLI already edits YAML directly and has no concurrency problem to solve.
- Live reload / file watching — `restart_required` reports the truth rather than pretending to remove it.
- Adding new keys to `GlobalLoreConfigSchema` — its `.strict()` narrowness is a deliberate SPEC-003 §6.2 property, not a gap to fill here.

## Design Decisions

**D1 — One deny table, both scopes.** `CONFIG_DENY_KEYS` in `@lore/core/config-editability.ts` governs the machine scope too. `defaults.editor` is on that table (it is spawned by `adapters/cli/editor.ts::openEditor`), so the machine scope's writable surface is exactly `defaults.format` and `defaults.color`. Do NOT introduce a second, machine-specific deny table — one SSOT, two consumers.

**D2 — The server is the boundary; the UI imports the same tables only so it cannot offer an edit the server will reject.** State this in the module header. A deny key must be un-editable in the DOM (no enabled input), but that is a UX affordance, not the security control.

**D3 — Blast-radius disclosure is a required, asserted UI element.** The machine scope container carries a literal disclosure that its values affect every corpus on this machine while being edited from this one corpus's dashboard. This is asserted by an AC because it is the single sentence that makes the second write path defensible.

**D4 — Precedence is displayed, never re-derived.** Import `mergeDefaults` from `@lore/core` rather than reimplementing project-wins semantics in the component. A second implementation would drift from `loader.ts`'s real resolution.

**D5 — Freeze the CAS base at edit-start.** SPEC-062's own retro found the doc editor's If-Match reading the CURRENT render's version while TanStack Query's `refetchOnWindowFocus` silently adopted a concurrent writer's version mid-edit — CAS passed, lost update, ConflictModal never fired. Both scopes must freeze their base hash when editing begins and disable focus/reconnect refetch while an edit is in flight. This is a known-recurring defect class, not a hypothetical.

**D6 — Machine writes are cookie-only.** Same posture as `PATCH /api/dashboard/config`: bearer tokens are agent-issued and must not reach a machine-wide file. CSRF-Origin enforcement is inherited from the dashboard route group.

**D7 — Missing machine config is not an error.** `loadGlobalConfig` returns `ok({})` when no file exists; the UI renders the scope with built-in defaults and the first write CREATES the file (including parent directories). A malformed machine config must degrade to a loud, readable banner in that scope only — it must never blank the page or block the team scope.

## Acceptance Criteria

Declared structurally via `lore ac add` (see `lore ac list`). Summary:

- Deny keys (including `defaults.editor`) render read-only in both scopes with the YAML note.
- A team-scope save reports `restart_required` for exactly the restart-classified keys changed and zero entries for live-classified ones.
- A stale hash on either scope surfaces `ConflictModal` and writes zero bytes.
- `saveGlobalConfig` is validate-then-write and atomic: a schema-invalid merge writes exactly 0 bytes.
- The machine scope's blast-radius disclosure is present in the rendered DOM.
- Precedence rows show the effective layer consistent with `mergeDefaults`.
- REGRESSION: the `@lore/core` default barrel still imports zero Node builtins.

## Verification

This is a `design`-kind spec; this corpus's `workflow.verification_profiles.design` floor requires an `e2e` oracle and its plan must declare `requires_uat: true` (SPEC-058 → SPEC-054 plan-close gate). E2E runs under the existing Playwright harness (`packages/dashboard/tests/e2e/`, `global-setup.ts`'s throwaway-corpus pattern — never the repo's own `.lore/`).


## Acceptance Criteria (structured)

- [○] [script] AC-064-1: Render invariants: the Settings page shows both scopes; every CONFIG_DENY_KEYS entry present in either config (including defaults.editor) renders with 0 enabled input elements and carries the literal 'edit via YAML' note; the machine scope container renders its blast-radius disclosure text; each defaults.* row shows machine/project/built-in layers with exactly 1 marked effective. Exactly 1 e2e spec file runs and exits 0.
  script: e2e — cd packages/dashboard && bunx playwright test tests/e2e/settings-render.pw.ts
- [○] [script] AC-064-2: Write invariants: saving a team-scope change to sync.enabled reports restart_required containing exactly 1 entry (sync.enabled); saving workflow.claim_ttl_minutes reports exactly 0 entries; a save whose base hash is stale opens ConflictModal and leaves the target config file byte-identical. Exactly 1 e2e spec file runs and exits 0.
  script: e2e — cd packages/dashboard && bunx playwright test tests/e2e/settings-write.pw.ts
- [○] [script] AC-064-3: saveGlobalConfig is validate-then-write and atomic: a patch whose merged result fails GlobalLoreConfigSchema writes exactly 0 bytes and leaves any pre-existing file byte-identical; a valid write to a non-existent XDG path creates parent directories and produces a file that loadGlobalConfig round-trips to the same object. Exactly 1 test file runs and exits 0.
  script: test — bunx vitest run packages/lore/tests/unit/core/global-config.test.ts
- [⚑] [script] AC-064-4: The machine-scope service rejects any patch touching a CONFIG_DENY_KEYS entry (defaults.editor yields exactly 1 denied key) with VALIDATION_ERROR naming the key and 0 bytes written, and accepts defaults.format and defaults.color; it enforces expectedHash CAS inside the service, not only at the route. Exactly 1 test file runs and exits 0.
  script: test — bunx vitest run packages/lore/tests/unit/service/global-config-service.test.ts
- [○] [script] AC-064-5: Precedence derivation is consistent with mergeDefaults for all 8 presence combinations of machine/project values across the 3 defaults keys: the layer marked effective equals the value mergeDefaults(machine, project) resolves to, and falls back to the declared built-in default when both are absent. Exactly 1 test file runs and exits 0.
  script: test — bunx vitest run packages/core/src/config-precedence.test.ts
- [○] [script] AC-064-6: REGRESSION: the @lore/core default barrel imports exactly 0 Node builtins after adding config-precedence.ts, and packages/dashboard/src imports @lore/core/node exactly 0 times, asserted by the existing browser-safety source scan. Exactly 1 test file runs and exits 0.
  script: test — bunx vitest run packages/core/tests/browser-safety.test.ts
- [⊘] [script] AC-064-7: RETIRED 2026-10-17 (TG-31), REPLACED BY AC-064-8: the original wording required 4 dashboard e2e suites to exit 0, which is unsatisfiable because browse-ux and review-loop carry pre-existing spec-create seed-gate debt (knowledge-pre-existing-e2e-seed-gate-debt-dashboard-spec-create, identical at baseline 1e5ac3c). This criterion stays as a tombstone only because an approved spec with evidence cannot drop a criterion; it asserts the surviving fact: the routing/auth/write-sensitive suites read-flow and write-flow both run and exit 0 after the Settings route was added
  script: e2e — cd packages/dashboard && bunx playwright test tests/e2e/read-flow.pw.ts tests/e2e/write-flow.pw.ts
- [⚑] [script] AC-064-8: REPLACES AC-064-7 whose 4-suite exit-0 wording is unsatisfiable due to pre-existing spec-create-gate seed debt in browse-ux/review-loop (proven identical at pre-session baseline 1e5ac3c, knowledge-pre-existing-e2e-seed-gate-debt-dashboard-spec-create): the routing/auth/write-regression-sensitive suites read-flow and write-flow both run and exit 0 on merged main, proving the Settings route added zero e2e regression; exactly 2 e2e spec files run and exit 0
  script: e2e — cd packages/dashboard && bunx playwright test tests/e2e/read-flow.pw.ts tests/e2e/write-flow.pw.ts

## Code anchors

- packages/core/src/config-precedence.ts
- packages/core/src/config-node.ts#saveGlobalConfig
- packages/lore/src/service/global-config-service.ts
- packages/lore/src/adapters/http/config-routes.ts
- packages/dashboard/src/routes/settings.tsx
- packages/dashboard/src/components/ConfigScopePanel.tsx
