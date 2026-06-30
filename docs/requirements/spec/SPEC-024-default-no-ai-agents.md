---
id: SPEC-024
type: spec
role: spec
title: "Default --no-ai for agent and MCP execution paths"
status: draft
priority: medium
phase: P10
created: 2026-06-30
updated: 2026-06-30
tags: [ai, mcp, agent, defaults, latency, phase-10, stub]
parent: PRD-001
links:
  - {id: SPEC-017, type: extends, note: "Inverts the default for non-human callers"}
  - {id: SPEC-008, type: extends, note: "MCP tools should default ai_off"}
  - {id: SPEC-011, type: extends, note: "HTTP API key callers should default ai_off"}
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

- Q1: ratify the env-var matrix.
- Confirm `MCP_TRANSPORT` is a stable env-var name across MCP transports (`stdio` / `http` / `sse`).
- Decide whether `--ai` flag exists or only `--no-ai` (recommendation: add `--ai`).
