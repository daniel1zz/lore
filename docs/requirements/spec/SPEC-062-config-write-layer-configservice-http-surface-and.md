---
id: SPEC-062
type: spec
role: spec
title: "Config write layer: ConfigService, HTTP surface, and the edit-safety model"
status: approved
priority: medium
created: 2026-07-21
updated: 2026-10-17
tags: []
---
# SPEC-062 — Config write layer: ConfigService, HTTP surface, and the edit-safety model

## Overview

`.lore/config.yaml` governs 60+ settings spanning 22 specs — gate enablement,
verification profiles, claim TTLs, AI provider selection, verify trust posture.
A 2026-07-21 audit found it has **no runtime write path at all**: `saveConfig`
has exactly three callers (`commands/init.ts`, `commands/sync.ts`,
`flows/init-corpus.ts`), all CLI bootstrap. Every other setting — including
`workflow.gates.*.enabled`, which decides whether the governance gates fire —
can only be changed by hand-editing YAML.

PRD R-2 requires operators to manage this through the dashboard. That is not
merely a UI: it needs a service, an HTTP surface, a safety model, and honest
effect-timing reporting. This spec builds the backend half; the dashboard UI
is SPEC-063 (`design` kind, e2e + UAT gated).

### Why a naive "edit any key" surface is unacceptable

Three config keys are **arbitrary-code-execution or secret-bearing**, exactly
like a settings.json hook `command`:

- `ai.providers.<name>.command` / `.args` — spawned as an external process.
- `ai.http.headers.<name>` — may carry a literal API key.
- `verify.env.passthrough_all` — a single boolean that disables SPEC-039 §M2's
  entire trust-hardening, handing the full `process.env` (including
  `LORE_SYNC_TOKEN`) to every command `lore verify` executes.

A browser-reachable write path over these is a browser-reachable RCE and
secret-exfiltration path. The dashboard already binds a local port that has
once been mistaken for another process's (the 2026-07-07 corpus-pollution
incident). These keys are therefore **read-only over HTTP, by construction**,
not by UI convention.

## Scope

### In

- **D1 — `ConfigService`.** `packages/lore/src/service/config-service.ts`:
  `read()` → the parsed, **redacted** config; `update(patch, opts)` →
  validate-then-write via `@lore/core/node`'s `loadConfig`/`saveConfig`.
  Returns `Promise<Result<T, LoreError>>` like every other service. Node IO
  stays behind `@lore/core/node` — the service never imports `node:fs` itself.
- **D2 — editability classification (pure, in `@lore/core`).**
  `packages/core/src/config-editability.ts`:
  - `CONFIG_DENY_KEYS` — the 4 keys above, denied for WRITE over any HTTP
    surface. A patch touching one → `VALIDATION_ERROR` naming the key and
    stating "edit this key by hand in .lore/config.yaml".
  - `CONFIG_REDACT_KEYS` — keys whose VALUES are never emitted by `read()`
    (`ai.http.headers.*`, `sync.auth_token_env`'s resolved value is already
    absent by D-004, but the header map is not).
  - `classifyEffect(key): "live" | "restart_required"` — derived from a
    declared table of start-time-read prefixes (`sync.`, `ai.provider`,
    `ai.providers.`, `ai.http.`, `telemetry.`), everything else `live`.
- **D3 — HTTP surface.** `GET /api/config` (cookie **or** bearer; returns the
  redacted config plus a per-key `effect` map) and
  `PATCH /api/dashboard/config` (**cookie-only**, bearer → 403, mirroring the
  existing six dashboard write routes; CSRF Origin check inherited).
- **D4 — optimistic concurrency.** `PATCH` requires `If-Match` carrying a
  sha256 of the on-disk YAML bytes the client last read; a mismatch → 409 with
  the current hash, mirroring the doc-edit `ConflictPayload` shape. This is
  not version-number CAS (config is a file, not a `DocRecord`), so the hash IS
  the version.
- **D5 — honest effect reporting (PRD R-3).** A successful `PATCH` returns
  `{updated: string[], restart_required: string[]}`; `restart_required` lists
  exactly those changed keys whose `classifyEffect` is `restart_required`. A
  save is never reported as undifferentiated success.
- **D6 — audit.** Every accepted `PATCH` writes an audit row (`AuditService`)
  recording actor, changed key set, and the before/after hash — config changes
  are governance-relevant and must be as traceable as doc edits.

### Out

- The dashboard Settings UI (SPEC-063, `design` kind — e2e + UAT).
- A `lore config get/set` CLI verb (plausible sibling; no PRD requirement
  demands it, and adding a second write path before the first is proven would
  widen the blast radius for no covered requirement).
- Machine-level `~/.claude/settings.json` editing (a different trust domain —
  hook `command` strings are the same RCE class as D2's denied keys, and that
  file is not corpus state).
- Live config reload / file watching — `restart_required` reports the truth
  rather than pretending to eliminate it.
- Per-user config permissions (the corpus has one local operator identity).

## Design

`config-editability.ts` is pure and browser-safe so SPEC-063's UI can import
the same deny/redact/effect tables the server enforces — one SSOT, so the UI
cannot offer an edit the server will reject. Enforcement remains server-side;
the shared table is for honest affordances, never as the security boundary.

`ConfigService` is constructed in `app.ts` alongside the other services and
receives the corpus directory, not a store — config is file state, not
`StoreInterface` state.

## Acceptance Criteria

- **AC-062-1** — `PATCH /api/dashboard/config` with a patch touching any of the
  4 `CONFIG_DENY_KEYS` returns `VALIDATION_ERROR` naming that key, and the
  on-disk `config.yaml` bytes are unchanged (sha256 identical before/after).
- **AC-062-2** — `GET /api/config` never emits a value for any
  `CONFIG_REDACT_KEYS` entry: a config containing a literal
  `ai.http.headers.x-api-key` value yields a response whose serialized body
  does not contain that literal string.
- **AC-062-3** — `PATCH` with a stale `If-Match` hash returns HTTP 409 carrying
  the current hash, and leaves `config.yaml` byte-identical.
- **AC-062-4** — A successful `PATCH` changing `sync.enabled` returns
  `restart_required` containing exactly `["sync.enabled"]`; a `PATCH` changing
  `workflow.claim_ttl_minutes` returns `restart_required` as an empty array.
- **AC-062-5** — `PATCH /api/dashboard/config` with a bearer token (no cookie)
  returns HTTP 403 and writes 0 bytes, matching the 6 existing dashboard write
  routes' auth posture.
- **AC-062-6** — A `PATCH` whose patch fails the `LoreConfig` Zod schema is
  rejected with `VALIDATION_ERROR` and leaves `config.yaml` byte-identical
  (validate-then-write, never partial application).
- **AC-062-7** — Every accepted `PATCH` produces exactly 1 audit row whose
  details name the changed key set; a rejected `PATCH` produces 0 audit rows.
- **AC-062-8** — REGRESSION: `@lore/core`'s default barrel still imports zero
  Node builtins after adding `config-editability.ts` (the dashboard's Vite
  build constraint), asserted by the existing browser-safety source scan.


## Acceptance Criteria (structured)

- [⚑] [script] AC-062-1: PATCH /api/dashboard/config with a patch touching any of the 4 CONFIG_DENY_KEYS returns VALIDATION_ERROR naming that key, and config.yaml sha256 is identical before and after
  script: test — bunx vitest run packages/lore/tests/unit/service/config-service.test.ts -t 'deny keys'
- [⚑] [script] AC-062-2: GET /api/config emits 0 occurrences of a literal ai.http.headers.x-api-key value present in the on-disk config: the serialized response body does not contain that string
  script: test — bunx vitest run packages/lore/tests/unit/service/config-service.test.ts -t 'redaction'
- [⊘] [script] AC-062-3: PATCH with a stale If-Match hash returns HTTP status exactly 409 carrying the current hash, and leaves config.yaml byte-identical
  script: test — bunx --bun vitest run packages/lore/tests/unit/adapters/http/config-routes.test.ts -t 'stale If-Match'
- [⚑] [script] AC-062-4: A successful PATCH changing sync.enabled returns restart_required containing exactly 1 entry equal to sync.enabled; a PATCH changing workflow.claim_ttl_minutes returns restart_required with exactly 0 entries
  script: test — bunx vitest run packages/lore/tests/unit/service/config-service.test.ts -t 'restart_required'
- [⊘] [script] AC-062-5: PATCH /api/dashboard/config with a bearer token and no cookie returns HTTP status exactly 403 and writes 0 bytes to config.yaml
  script: test — bunx --bun vitest run packages/lore/tests/unit/adapters/http/config-routes.test.ts -t 'bearer rejected'
- [⚑] [script] AC-062-6: A PATCH whose merged result fails the LoreConfig Zod schema is rejected with VALIDATION_ERROR and leaves config.yaml byte-identical, proving validate-then-write with 0 partial application
  script: test — bunx vitest run packages/lore/tests/unit/service/config-service.test.ts -t 'schema rejection'
- [⚑] [script] AC-062-7: Every accepted PATCH produces exactly 1 audit row naming the changed key set; a rejected PATCH produces exactly 0 audit rows
  script: test — bunx vitest run packages/lore/tests/unit/service/config-service.test.ts -t 'audit'
- [⚑] [script] AC-062-8: REGRESSION: the @lore/core default barrel imports exactly 0 Node builtins after adding config-editability.ts, asserted by the existing browser-safety source scan
  script: test — bunx vitest run packages/core/tests/browser-safety.test.ts
- [⚑] [script] AC-062-9: REPLACES AC-062-3 whose declared path packages/lore/tests/unit/http/ does not exist: a stale If-Match hash returns HTTP status exactly 409 with the current hash and leaves config.yaml byte-identical, with at least 1 matched test case
  script: test — bunx vitest run packages/lore/tests/unit/adapters/http/config-routes.test.ts -t 'stale If-Match'
- [⚑] [script] AC-062-10: REPLACES AC-062-5 whose declared path does not exist: a bearer-token PATCH with no cookie returns HTTP status exactly 403 and writes exactly 0 bytes to config.yaml, with at least 1 matched test case
  script: test — bunx vitest run packages/lore/tests/unit/adapters/http/config-routes.test.ts -t 'bearer rejected'
- [⚑] [script] AC-062-11: ConfigService.update accepts an expectedHash option and performs the staleness comparison itself: a concurrent writer changing config.yaml between the route precheck and the service write causes the second update to be rejected with 0 bytes written, proven by at least 2 test cases (matching hash accepted, mismatched hash rejected)
  script: test — bunx vitest run packages/lore/tests/unit/service/config-service.test.ts -t 'expectedHash'
- [⚑] [script] AC-062-12: findDeniedConfigKeys denies a patch whose leaf path is a proper ancestor of any CONFIG_DENY_KEYS pattern — {ai:{providers:null}}, {ai:{providers:{}}}, {ai:{providers:[]}}, {verify:{env:null}} and {ai:null} each yield at least 1 denied key — while benign sibling patches such as {ai:{provider:'cli'}} and {workflow:{claim_ttl_minutes:30}} yield exactly 0; exactly 1 test file runs and exits 0
  script: test — bunx vitest run packages/core/src/config-editability.test.ts
- [⚑] [script] AC-062-13: defaults.editor is a CONFIG_DENY_KEYS entry: findDeniedConfigKeys({defaults:{editor:'/tmp/evil.sh'}}) returns exactly 1 denied key and ConfigService.update rejects that patch writing exactly 0 bytes, closing the deferred-execution RCE where a cookie-authenticated PATCH sets the binary openEditor spawns on the next interactive lore create/set; exactly 2 test files run and exit 0
  script: test — bunx vitest run packages/core/src/config-editability.test.ts packages/lore/tests/unit/service/config-service.test.ts

## Code anchors

- packages/core/src/config-editability.ts
- packages/lore/src/service/config-service.ts
- packages/lore/src/adapters/http/config-routes.ts
