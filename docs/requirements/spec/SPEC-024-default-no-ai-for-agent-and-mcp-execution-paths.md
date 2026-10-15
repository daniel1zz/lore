---
id: SPEC-024
type: spec
role: spec
title: "Default --no-ai for agent and MCP execution paths"
status: deprecated
priority: medium
created: 2026-06-30
updated: 2026-10-10
tags: [ai, mcp, agent, defaults, latency, phase-10, stub]
---
# SPEC-024: Default `--no-ai` for agent and MCP execution paths

> **Status: stub.** Born from a dogfood session on 2026-06-30 where the main-loop agent (claude) found itself adding `--no-ai` to every single `lore create` call to avoid claude-on-claude nesting.

## 1. Purpose

SPEC-017 makes `lore create` default to AI-generation on (`--no-ai` is opt-out). That default is correct for **human** CLI users — they want a populated stub from a one-line title. It is **wrong** for every non-human caller:

- **AI agents** invoking lore (via main-loop tool call, subagent, or `Bun.spawn` from another tool) are themselves the LLM. Spawning `claude -p ...` from inside an agent's session creates claude-on-claude nesting: 3-30 s extra latency, doubled context cost (the inner claude re-reads the template fresh; no prompt-cache benefit), and a quality hit (template-rendered prompt is worse than the agent's intent).
- **MCP tool `lore_create`** is always called by an LLM — there is no human pathway through MCP. Same logic: AI on the receiving end is redundant.
- **HTTP API with agent-issued tokens** (SPEC-010 `lore agent create` flow) — by definition the caller is a non-human agent.

This SPEC inverts the default in those three surfaces: AI becomes opt-IN, not opt-out, whenever the caller is recognisably non-human.

## 2. Goals & Non-Goals

### 2.1 Goals

- **CLI path unchanged**: `lore create spec --title X` continues to default to AI-on for the human typing in a terminal.
- **Auto-detected agent paths default to AI-off**:
  - Env var `CLAUDECODE=1` present (Claude Code main loop / subagent context)
  - Env var `LORE_AI_DEFAULT=off` explicit override (works on any path)
  - Env var `CI=true` (any CI runner)
- **MCP path always defaults AI-off**: `lore_create` MCP tool ignores `ai.default_on` config — opt-IN via explicit `ai: true` argument from the calling LLM.
- **HTTP path with agent token defaults AI-off**: requests authenticated by an `lore agent` token default `ai=false`; requests via cookie (dashboard, SPEC-016) default `ai=true`.
- New config key `ai.default_per_surface: { cli: true, agent: false, mcp: false, http_token: false, http_cookie: true }` — explicit, overrideable.
- Telemetry: every `ai.generation` event gets `ai_default_source: env|cli|config|explicit_flag` discriminator, plus `caller_surface: cli|agent|mcp|http_token|http_cookie`.

### 2.2 Non-Goals

- ❌ **Heuristic ML detection of "is this caller an agent"** — only the explicit signals listed above. No fingerprinting.
- ❌ **Per-doc-type defaults** — global per-surface, not per-type.
- ❌ **Backward-compat with `--no-ai` deprecation** — `--no-ai` flag stays and remains the explicit opt-out on CLI.
- ❌ **MCP tool exposing `ai=true` automatically** — the LLM must explicitly pass `ai: true` in the MCP arguments; never inferred.
- ❌ **Cost throttling / quotas** — separate concern from defaults.

## 3. Open Design Questions

### Q1 — Which env signals are authoritative?

Candidates:
- `CLAUDECODE=1` (current Claude Code marker)
- `CLAUDE_AGENT_TYPE` (subagent dispatch)
- `MCP_TRANSPORT` (set by lore's MCP server adapter at startup)
- `LORE_INVOKED_BY=agent` (explicit caller-set)
- `CI=true` (general CI)

Risk of false negatives if Claude Code rebrands env vars; risk of false positives if a human runs `CLAUDECODE=1 lore create` in their shell.

**Recommendation**: rank by trust. `LORE_AI_DEFAULT=off` is the explicit override (highest trust). `CLAUDECODE=1` and `CI=true` are external signals (medium trust). All combine via OR.

> **On MCP_TRANSPORT — corrected**: a process cannot reliably detect itself via an env var it sets on itself (timing problem: the var must be visible *before* the create-route handler runs, but the MCP adapter and the handler share one process). MCP surface detection therefore uses an **in-process state flag** (`appContext.callerSurface = "mcp"`) set by `adapters/mcp/server.ts` at startup, threaded through `app.ts` into the service layer. Same approach for HTTP cookie-vs-token discrimination (set by HTTP middleware on request enter). The env-var matrix governs CLI / agent / CI only — process-internal surfaces use the in-process flag.

### Q2 — Should config beat env?

If `ai.default_per_surface.cli: false` is in `.lore/config.yaml`, does that win over `CLAUDECODE=1` (which would force `agent` surface)?

**Recommendation**: env wins for surface detection (`CLAUDECODE=1` always classifies as agent), but config wins for the default value per surface. Two layers: surface classification (env), default value (config).

### Q3 — `--ai` and `--no-ai` mutual handling

Today `--no-ai` is the only flag. Adding `--ai` as an explicit opt-in for agent paths?

**Recommendation**: yes. `--ai` (no value) = force-on, `--no-ai` = force-off, neither = surface default.

### Q4 — MCP tool argument shape

`lore_create` MCP tool — add explicit `ai: boolean` argument? Or rely on `--no-ai` semantics via tool args?

**Recommendation**: explicit `ai: boolean = false` default in the MCP tool schema. Mirrors the inversion.

### Q5 — HTTP cookie vs token discriminator

How does the HTTP adapter know whether the request came via cookie (human) or bearer token (agent)?

**Recommendation**: middleware sets `request.context.caller_surface = "http_cookie" | "http_token"` on auth resolution; the create-route handler reads it.

### Q6 — Telemetry granularity

`ai.generation` events grow: `ai_default_source`, `caller_surface`, plus existing fields. Schema bloat?

**Recommendation**: add both fields. Bloat is small (two enum strings); the diagnostic value (which surface causes claude-on-claude when?) is high.

## 4. Acceptance Criteria (early draft)

**AC-NOAI-1** `lore create spec --title X` in a vanilla shell (no `CLAUDECODE`, no `LORE_AI_DEFAULT`) defaults `ai=true` — unchanged from SPEC-017.

**AC-NOAI-2** `CLAUDECODE=1 lore create spec --title X` defaults `ai=false`; explicit `--ai` flag overrides to true.

**AC-NOAI-3** `LORE_AI_DEFAULT=off lore create spec --title X` defaults `ai=false` on any path; explicit `--ai` overrides.

**AC-NOAI-4** MCP tool `lore_create` invoked without `ai:` argument creates the doc with empty content (no AI call). **Requires SPEC-008 amendment**: add optional `ai?: boolean` field to the `lore_create` tool argument schema, defaulting to `false`. SPEC-024 owns this amendment — implementor of SPEC-024 must land the SPEC-008 schema edit in the same PR.

**AC-NOAI-5** MCP tool `lore_create` invoked with `ai: true` calls the AI provider. (Same SPEC-008 amendment as AC-NOAI-4.)

**AC-NOAI-6** HTTP `POST /api/v1/docs` authenticated via bearer token defaults `ai=false`.

**AC-NOAI-7** HTTP `POST /api/dashboard/docs` authenticated via cookie session defaults `ai=true`.

**AC-NOAI-8** Telemetry on every `ai.generation` event includes `ai_default_source` and `caller_surface`.

**AC-NOAI-9** Config `ai.default_per_surface.cli: false` makes vanilla shell default `ai=false`; explicit `--ai` still overrides.

**AC-NOAI-10** `lore status --json` reports the resolved per-surface defaults (so a confused user can see what they'll get).

**AC-NOAI-DOC-1** CLAUDE.md updated with the env-var override matrix and recommended values for AI-agent users.

## 5. Out-of-scope rejections

- "Fingerprint caller via user-agent / process tree" — explicit env signals only.
- "Cost telemetry / billing dashboard" — covered by SPEC-012 telemetry follow-ups, not bolted on here.
- "Per-tool MCP defaults" — `lore_create` is the only AI-tool today; future SPEC-019 brings `lore_set_ai` / `lore_link_infer` MCP tools, each defaults `ai=false` per same rule.

## 6. Risks

| Risk | Mitigation |
|---|---|
| User sets `CLAUDECODE=1` in their shell rc and is surprised AI is off | `lore status` exposes the resolved defaults; doc the env var matrix prominently. |
| Subagent dispatched by Claude Code does NOT inherit `CLAUDECODE=1` | Verify in harness — Claude Code does set this for subagents per harness convention. Test guard in eval. |
| In-process `callerSurface` flag missed by a code path that bypasses `app.ts` | All mutating service calls go through `app.aiProviderService` per SPEC-017 §5.4 SSOT; bypass paths fail review. Test guard: spec calls without `callerSurface` set default to `cli` semantics (safest fallback per Q2). |
| Default-off in CI hides regressions where AI should run in test | Test fixtures explicitly set `LORE_AI_DEFAULT=on` for those tests. |
| Inversion confuses developers debugging "why didn't AI run?" | `lore status` + `--json` exposes the resolution; verbose error messages name the env var that flipped the default. |

## 7. Outstanding Decisions (block implementation)

~~Resolved — see §8 below.~~

## 8. Resolved Decisions (ratified 2026-06-30)

| Question | Ratified Answer |
|---|---|
| Q1 Env-var matrix | **OR-combine** these signals to classify caller as agent: `LORE_AI_DEFAULT=off` (highest trust, explicit override), `CLAUDECODE=1` (medium), `CI=true` (medium). MCP and HTTP surfaces use **in-process flag**, not env (timing problem — see §9.2). |
| Q2 Config vs env precedence | **Two layers**: env determines surface classification (`cli` / `agent` / `mcp` / `http_cookie` / `http_token`); config determines the default value per surface. Config key `ai.default_per_surface` carries one boolean per surface. |
| Q3 `--ai` vs `--no-ai` flag | **Both exist, mutually exclusive.** `--ai` = force on, `--no-ai` = force off, neither = surface default. Passing both → exit 2. |
| Q4 MCP arg shape | **Explicit `ai?: boolean` in tool schema, default `false`.** SPEC-008 (`lore_create` tool registration) is amended in the same PR as SPEC-024 implementation. |
| Q5 HTTP cookie vs token | **Middleware sets `request.context.callerSurface = "http_cookie" \| "http_token"`** on auth resolution. Create-route reads it. |
| Q6 Telemetry granularity | **Two enum fields added** to `ai.generation` event: `ai_default_source: env \| cli_flag \| config \| explicit_arg` and `caller_surface: cli \| agent \| mcp \| http_cookie \| http_token`. |

## 9. Architecture Notes (implementation-ready)

### 9.1 File touch list

| File | Change |
|---|---|
| `packages/core/src/types.ts` | Add `CallerSurface = "cli" \| "agent" \| "mcp" \| "http_cookie" \| "http_token"` type. |
| `packages/core/src/schemas.ts` | Extend `aiGenerationEventSchema` with `ai_default_source` + `caller_surface` enum fields. |
| `packages/core/src/config.ts` (or wherever `LoreConfigSchema` lives) | Add `ai.default_per_surface: { cli?: boolean, agent?: boolean, mcp?: boolean, http_cookie?: boolean, http_token?: boolean }` to schema. Defaults baked in code, NOT in Zod schema: `{cli: true, agent: false, mcp: false, http_cookie: true, http_token: false}`. |
| `packages/lore/src/app.ts` | `App` carries `callerSurface: CallerSurface` (mutable until first ai resolution, then frozen) + `resolveAiDefault(callerSurface, configDefaults)` helper. |
| `packages/lore/src/service/ai-provider-service.ts` (or the SPEC-017 path module) | Inject `App.resolveAiDefault` to decide `ai_default_source` + on/off when `ai` arg is null/undefined. |
| `packages/lore/src/adapters/cli/index.ts` (CLI entry, before command dispatch) | Read env: if `LORE_AI_DEFAULT=off` OR `CLAUDECODE=1` OR `CI=true` → `app.callerSurface = "agent"`, else `"cli"`. |
| `packages/lore/src/adapters/cli/commands/create.ts` | Add `--ai` flag (mutually exclusive with `--no-ai`). Resolve `ai = explicit_flag ?? resolveAiDefault(app.callerSurface)`. |
| `packages/lore/src/adapters/mcp/server.ts` | At startup: `app.callerSurface = "mcp"`. |
| `packages/lore/src/adapters/mcp/tools.ts` (lore_create registration) | Add `ai: z.boolean().default(false)` to tool input schema. |
| `packages/lore/src/adapters/http/middleware/auth.ts` (or wherever auth resolves) | After auth, set `request.context.callerSurface = "http_cookie" \| "http_token"` based on session type. |
| `packages/lore/src/adapters/http/routes/docs.ts` (POST /api/v1/docs, POST /api/dashboard/docs) | Forward `callerSurface` to `app.resolveAiDefault` when caller did not pass explicit `ai`. |
| `packages/lore/src/adapters/cli/commands/status.ts` | `lore status` (text + --json) reports the resolved per-surface defaults so a confused user can introspect (AC-NOAI-10). |
| `CLAUDE.md` (root) | Add env-var matrix + recommended values for AI-agent users (AC-NOAI-DOC-1). |

### 9.2 In-process flag, not env (Q1 / Q5 correction)

A process cannot reliably detect itself via an env var it sets on itself (timing: the var must be visible *before* the create-route handler runs, but in the MCP/HTTP adapters the create-route handler and the surface detector share one process). Therefore:

- **CLI / agent / CI** classification uses **env vars** (read at process startup, before any command dispatch).
- **MCP / HTTP** classification uses an **in-process `callerSurface` flag** on `App` (MCP) or on the request context (HTTP middleware).

This split is intentional. Do NOT try to set `MCP_TRANSPORT` env var from inside the MCP adapter — it won't survive the timing race.

### 9.3 Resolution algorithm (pseudocode)

```
function resolveAi(explicitArg: boolean | undefined, surface: CallerSurface, config: AiDefaults): {ai: boolean, source: AiDefaultSource} {
  if (explicitArg !== undefined) return { ai: explicitArg, source: "explicit_arg" }
  const fromConfig = config[surface]
  if (fromConfig !== undefined) return { ai: fromConfig, source: "config" }
  // Built-in defaults
  const builtIn = { cli: true, agent: false, mcp: false, http_cookie: true, http_token: false }
  return { ai: builtIn[surface], source: surface === "cli" || surface === "http_cookie" ? "cli_flag" : "env" }
}
```

### 9.4 Test layout

- Unit (vitest): `resolveAi` matrix — explicit / config / env override combinations.
- Unit (vitest): `aiGenerationEventSchema` accepts the two new enum fields.
- Integration (vitest subprocess): `CLAUDECODE=1 lore create spec --title X --no-ai-fail-if-spawned` smoke verifying AI path is NOT taken.
- Integration: MCP tool invocation without `ai:` arg creates doc with empty content; with `ai: true` calls provider.
- Integration: HTTP `POST /api/v1/docs` via bearer token defaults `ai=false`; via cookie defaults `ai=true`.
- Regression: existing SPEC-017 happy path (`lore create spec --title X` in vanilla shell) unchanged.

### 9.5 Out of §9 scope (still SPEC-024)

- Per-doc-type defaults (`ai.per_type.<type>.provider`) — SPEC-017 §6 deferred, stays deferred.
- AI default for `lore set` / `lore link` — covered by SPEC-019 when it lands.
- Telemetry dashboard / cost accounting — separate concern.
