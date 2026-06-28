# Module: ai

## Purpose

Runtime AI provider implementations, registry builder, template engine, and in-memory test double. Wires the `AIProvider` interface (defined type-only in `@lore/core`) to concrete spawn-based execution. Four files cover: CLI spawner, registry, template rendering, and test double.

## Key Invariants

- **Type-only interface in `@lore/core`, concrete classes here** — `AIProvider` is declared in `packages/core/src/ai.ts` and imported by `ClaudeCliProvider` and `InMemoryAIProvider` via `@lore/core`. No reverse dependency: `@lore/core` never imports from `packages/lore/src/ai/`.
- **All providers use ClaudeCliProvider in v1** — `buildProviderRegistry` constructs a `ClaudeCliProvider` for every entry in the merged config map. A future SPEC (not this one) will add a `kind` discriminator and an `HttpProvider` class.
- **User provider entries REPLACE whole built-in entries** — no deep-merge. The user owns the full `{ command, args, timeout_ms }` block or none.
- **InMemoryAIProvider ships in src/ not tests/** — so any test in any package (including `@lore/core` tests) can import it without path hacks.
- **Never throw** — all public async methods return `Promise<Result<T, LoreError>>`. `ClaudeCliProvider.generate` wraps `Bun.spawn` in try/catch to map ENOENT to `AI_PROVIDER_ERROR`.

## Patterns

- **No module-level IO** — `ClaudeCliProvider` only spawns inside `generate()`, never in the constructor. Registry construction is purely synchronous object creation.
- **Timeout watchdog** — `setTimeout` + `proc.kill("SIGTERM")` + `clearTimeout` on normal completion. The killer timer is always cleared to prevent stale-timer surprises on reuse.
- **Template rendering is two-pass** — conditionals (`{{#key}}…{{/key}}`) before substitutions (`{{key}}`), to prevent partial expansion of vars inside a collapsed block.

## Files

| File | Role |
|------|------|
| `claude-cli-provider.ts` | `ClaudeCliProvider` — Bun.spawn-based provider; implements `AIProvider` |
| `in-memory-provider.ts` | `InMemoryAIProvider` — test double; configurable mode; records all `generate()` calls |
| `registry.ts` | `buildProviderRegistry(config)` — merges built-ins + user overrides, validates active provider |
| `templates.ts` | `BUILT_IN_TEMPLATES`, `renderTemplate(tpl, vars)` — minimal mustache-subset renderer |

## Links

- Depends on: [`@lore/core`](../../../../core/src/CLAUDE.md) (for `AIProvider`, `AiProviderConfig`, `AiConfig`, `Result`, `ok`, `err`)
- Used by: [`../service/ai-provider-service.ts`](../service/ai-provider-service.ts) (via registry + provider map), [`../../app.ts`](../../app.ts) (via `buildProviderRegistry`).
- Source: SPEC-017
