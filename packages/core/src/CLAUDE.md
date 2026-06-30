# Module: core

## Purpose

Foundational types, error model, runtime validation, lifecycle rules, config, and telemetry. Pure modules with no I/O except `config.ts` (file read/write) and `telemetry.ts` (append-only JSONL). Published as `@lore/core` workspace package; depends on no other `@lore/*` package.

## Key Invariants

- **`DOC_TYPE_ROLE_MAP`** in `types.ts` is the SSOT for `DocType → DocRole`. Never derive role another way.
- **Result over throws** — `errors.ts` defines the `Result<T, LoreError>` discriminated union and `ok()` / `err()` constructors. Modules that import `LoreError` use these helpers, not raw object literals.
- **Slug shape** — `^[a-z][a-z0-9-]{1,62}[a-z0-9]$` (3–64 chars, no leading/trailing hyphen). Generation lives in `schemas.ts::slugify`; collision resolution (-2, -3, …) is delegated to the caller via `slugifyWithCollision`'s `existsSlug` callback (sync or async).
- **Lifecycle graph** — `VALID_TRANSITIONS` in `schemas.ts` is the only authority on status moves. `isValidTransition(from, to)` and `getAllowedTransitions(from)` are the only public reads.
- **Config: env-var NAME, never plaintext (D-004)** — `sync.auth_token_env` stores the variable name (`"LORE_SYNC_TOKEN"` by default). `resolveSyncCredentials()` reads `process.env` at call time and fails loud (`VALIDATION_ERROR`) when missing or empty.
- **Telemetry never throws** — `JsonlTelemetry.record()` swallows IO errors; `close()` is idempotent; post-close `record()` is a no-op. Caller-visible behaviour does not change between `NoOpTelemetry` and `JsonlTelemetry`.

## Patterns

- **Zod is SSOT for runtime-validated shapes** — `TelemetryEventSchema`, `LoreConfigSchema`, `createDocInputSchema`, etc. Derived TS types come from `z.infer<typeof Schema>`; never duplicate the shape as a hand-written interface.
- **Type-specific validation via `superRefine`** — `createDocInputSchema` enforces `spec/task → parent_id`, `adr → extra.decision_status`, `knowledge → extra.sub_type`, `task → extra.plan_id`, `plan → extra.phases uniqueness` (`schemas.ts`).

### Plan Phases Schema Invariants (SPEC-023)

`planExtraSchema` (in `schemas.ts`) governs plan extra fields:
- `phases?: Array<{name: string, description?: string}>` — max 30 entries (hard cap via `.max(30)`).
- `phases[].name` **must be unique** within the array — enforced by `superRefine` at write time (no built-in Zod uniqueness validator).
- Names are **case-sensitive, exact-match** at validation time; callers must trim whitespace before passing (service layer handles this).
- `phase?: string` — legacy singular field, deprecated. `lore migrate phases` converts it to `legacy_phase`. Do NOT write new code that reads `extra.phase` on plans (may be legacy or undefined). Read `extra.phases[]` instead.
- `legacy_phase?: string` — set by migration only. Informational. Not consumed by runtime code.

`taskExtraSchema` adds `phase?: string` — validated against parent plan's `extra.phases[].name` by `CorpusService` (not Zod, since it's cross-entity). Tasks without `extra.phase` are always valid regardless of plan phase declarations.
- **Parent-type contract** — `doc-type-rules.ts::PARENT_TYPE_CONTRACT` and `isValidParentType(child, parent)` are imported by `CorpusService` and `TreeCheckService`. Adding a new doc type requires updating this contract.
- **Graph helpers stay pure** — `graph-utils.ts::ancestorChainWalk` and `tree-blueprint.ts` operate on plain data; they don't take a `StoreInterface`. Callers fetch the data and pass it in.
- **Config side effects isolated to `loadConfig` / `saveConfig`** — `parseConfig` and `loadConfigFromString` are pure and Result-returning; tests pass YAML strings, not file paths.

## Links

- Depends on: **(no other `@lore/*` packages)** — leaf of the dependency graph.
- Used by: `@lore/lore` (all of `packages/lore/src/`): service/, store/, adapters/cli/, adapters/mcp/, adapters/http/, eval/, and app.ts.
