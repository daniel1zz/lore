---
id: SPEC-020
type: spec
role: spec
title: "HTTP-backed AI provider (alongside claude-cli)"
status: draft
priority: medium
phase: P10
created: 2026-06-30
updated: 2026-06-30
tags: [ai, http, provider, network, phase-10, stub]
parent: PRD-001
links:
  - {id: SPEC-017, type: extends, note: "Adds second AIProvider implementation under existing interface"}
  - {id: SPEC-010, type: relates-to, note: "Reuses bearer-token + env-var-name pattern from HTTP server auth"}
---

# SPEC-020: HTTP-backed AI provider

> **Status: stub.** Reserve the second slot SPEC-017 §3.5 already left open (`kind: "cli" | "http"`). Resolve the open shape before implementing.

## 1. Purpose

SPEC-017's `AIProvider` ships exactly one implementation: `claude-cli`, which spawns the local `claude` binary. Three scenarios demand an HTTP-backed variant:

1. **No-CLI environments** — CI runners, dashboard server, agents on remote hosts where installing `claude` CLI is heavy or impossible.
2. **Centralised quota / billing** — point all team users at one HTTP gateway that enforces rate-limit and cost cap once, instead of N local CLI installs each consuming Anthropic credits per-user.
3. **Provider-shape diversity** — Anthropic Messages API, OpenAI Chat Completions, self-hosted vLLM/llama.cpp servers all expose roughly compatible HTTP shapes; a single `http` provider abstracts them.

## 2. Goals & Non-Goals

### 2.1 Goals

- New `AIProvider` implementation: `HttpAIProvider`, alongside `ClaudeCliProvider`, behind the same interface.
- Config shape (auth lives **inside** `headers`, with `${ENV_VAR}` interpolation — D-004 SSOT: only env-var NAMES in config, never plaintext):
  ```yaml
  ai:
    provider: http              # was: claude-cli
    http:
      url: "https://api.anthropic.com/v1/messages"
      model: "claude-opus-4-8"
      headers:
        x-api-key: "${ANTHROPIC_API_KEY}"
        anthropic-version: "2023-06-01"
      timeout_ms: 60000
      max_tokens: 4096
  ```
  Header values matching `^\$\{[A-Z_][A-Z0-9_]*\}$` are resolved against `process.env` at request time; missing/empty env var → `VALIDATION_ERROR` (parallels SPEC-009 `resolveSyncCredentials()`).
- Loud failure on missing/empty env var (parallels `sync.auth_token_env` semantics from SPEC-009).
- HTTP errors / non-2xx / timeout / malformed JSON response → exit code 6, identical handling to SPEC-017's CLI failures.
- Six-dimension test coverage including a fake HTTP server fixture.

### 2.2 Non-Goals

- ❌ **Streaming response handling** — sync only; v1 reads full body.
- ❌ **Multiple HTTP providers in parallel** — `ai.provider` is a single value. Round-robin / fallback chain is a future SPEC.
- ❌ **Function-calling / tool use** — text completion only.
- ❌ **Bring-your-own-prompt-encoding** — request body shape is hardcoded per supported wire format (initial v1: Anthropic Messages only).
- ❌ **Embedded HTTP retry policy** — caller retries via `lore` exit codes if they want.

## 3. Open Design Questions

### Q1 — Single wire format vs adapter library?

Option A: v1 hardcodes Anthropic Messages shape. OpenAI / others wait for a follow-up SPEC.
Option B: small adapter sub-config (`ai.http.wire: "anthropic" | "openai"`), one shape per supported provider.

**Recommendation**: A. Anthropic Messages is the primary use case; OpenAI shape ships as SPEC-020.1 if needed.

### Q2 — Streaming vs sync

SPEC-017 is sync. Streaming would enable UI affordances (spinner with progressive text), but lore is non-interactive at boundary.

**Recommendation**: sync v1. Streaming is a future SPEC tied to dashboard write UI (SPEC-022).

### Q3 — Auth shape

Anthropic uses `x-api-key`, OpenAI uses `Authorization: Bearer`, self-hosted often uses neither. Where does auth live?

**Recommendation (chosen — see §2.1 config example)**: explicit `headers:` map under `ai.http`, with `${ENV_VAR}` interpolation. Provider configures `x-api-key: ${ANTHROPIC_API_KEY}` directly. No "smart auth" inference. No dedicated `auth_token_env` field — keeping the surface minimal and uniform with HTTP semantics.

### Q4 — Telemetry payload growth

HTTP responses carry usage data (`input_tokens`, `output_tokens`, `stop_reason`). Should telemetry capture these?

**Recommendation**: yes — extend `ai.generation` schema with optional `usage: { input_tokens, output_tokens, stop_reason }`. CLI provider leaves these null.

### Q5 — Where to validate the response

Provider returns JSON. We expect `content[0].text`. Where does extraction live?

**Recommendation**: inside `HttpAIProvider`, with a Zod schema for the response shape. Schema lives in `@lore/core` under `aiHttpResponseSchema`. Schema mismatch → AI_PROVIDER_ERROR.

### Q6 — Connection pooling / agent reuse

Per-call new fetch vs single keep-alive `Bun.fetch`?

**Recommendation**: per-call. lore is short-lived. Pooling premature.

## 4. Acceptance Criteria (early draft)

**AC-HTTP-1** `ai.provider: "http"` + valid config + env var → `HttpAIProvider` constructed by `app.ts`, `ClaudeCliProvider` not loaded.

**AC-HTTP-2** Missing `ai.http.url` → Zod rejection at config load; exit 1 with field path.

**AC-HTTP-3** Any `headers` value of form `${FOO}` where `process.env.FOO` is unset or empty → `VALIDATION_ERROR` at config-load time, error names the env var (parallels SPEC-009 `resolveSyncCredentials()` behaviour).

**AC-HTTP-4** Happy path: POST request body matches Anthropic Messages shape (`model`, `max_tokens`, `messages: [{role:"user", content: <rendered template>}]`), `x-api-key` header from env, response body parsed via `aiHttpResponseSchema`, `content[0].text` returned.

**AC-HTTP-5** HTTP 4xx/5xx → exit 6, error includes status + first 1024 chars of body.

**AC-HTTP-6** Network timeout > `timeout_ms` → exit 6, error mentions `timeout`.

**AC-HTTP-7** Response is 200 but body is invalid JSON → exit 6, telemetry records `error: "response parse"`.

**AC-HTTP-8** Response is 200 with empty / whitespace-only `content[].text` → exit 6, no document created, telemetry records `output_chars: 0` and `error` field (same shape as SPEC-017's empty-output failure path).

**AC-HTTP-TEL-1** Successful HTTP call emits exactly one `ai.generation` event with `usage` field populated.

**AC-HTTP-CORE-1** `aiHttpResponseSchema` lives in `@lore/core`; `HttpAIProvider` lives in `packages/lore/src/ai/http-provider.ts`; no `Bun.*` references reach `@lore/core`.

## 5. Out-of-scope rejections

- "Auto-detect provider from env (`ANTHROPIC_API_KEY` set → use HTTP)" — explicit config only.
- "Mock provider for tests baked into runtime" — tests use vitest mocks per SPEC-013 pattern; no `kind: "mock"` in prod config.
- "Bidirectional rate-limit feedback" — provider returns text or fails; rate-limit info not propagated.
- "Per-doc-type HTTP overrides" — `ai.per_type.<type>.provider` was deferred by SPEC-017 §6 and stays deferred.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Env-var token logged via `lore status --json` or telemetry | Token never reaches log paths; only the env-var NAME is in config. Test guards in eval. |
| Different wire formats trigger silent body-shape mismatch | Zod schema for response shape rejects unknowns; `aiHttpResponseSchema.strict()`. |
| Self-hosted endpoints exhibit Anthropic-incompatible shape | Q1 recommendation gives them an explicit out-of-scope footnote in v1; SPEC-020.1 adds wire format adapter. |
| Bun's `fetch` lacks AbortController for early termination | Verified — Bun has full AbortController support; use it for `timeout_ms`. |
| HTTP provider is slower than CLI in some networks | Document expected p95 latency in CLAUDE.md once measured. |

## 7. Outstanding Decisions (block implementation)

~~Resolved — see §8 below.~~

## 8. Resolved Decisions (ratified 2026-07-02)

| Question | Ratified Answer |
|---|---|
| Q1 Wire format | **A: Anthropic Messages hardcoded in v1.** No adapter registry. OpenAI/self-hosted → SPEC-020.1 follow-up. |
| Q2 Streaming vs sync | **Sync only** in v1. Streaming = SPEC-022 follow-up when dashboard UI needs progressive text. |
| Q3 Auth shape | **`headers:` map with `${ENV_VAR}` interpolation** (already chosen in §2.1). No dedicated `auth_token_env`. |
| Q4 Telemetry payload growth | **Yes** — extend `aiGenerationEventSchema` with optional `usage: { input_tokens, output_tokens, stop_reason }`. CLI provider leaves null. |
| Q5 Response validation location | **Inside `HttpAIProvider` via Zod `aiHttpResponseSchema`** (lives in `@lore/core`). Schema mismatch → `AI_PROVIDER_ERROR`. |
| Q6 Connection pooling | **Per-call `fetch()`** (Bun's built-in). No custom agent. |

## 9. Architecture Notes (implementation-ready)

### 9.1 File touch list

| File | Change |
|---|---|
| `packages/core/src/schemas.ts` | Add `aiHttpResponseSchema`: Anthropic Messages response shape `{ id, type, role, model, content: [{type: "text", text: string}], stop_reason?, usage?: { input_tokens, output_tokens } }` with `.strict()`. Extend existing `aiGenerationEventSchema` with optional `usage: { input_tokens, output_tokens, stop_reason? }`. |
| `packages/core/src/ai.ts` (or wherever `AiConfigSchema` lives) | Add `http: { url: string, model: string, headers: Record<string,string>, timeout_ms?: number, max_tokens?: number }?` under `ai`. Discriminate via existing `ai.provider` enum → `"claude-cli" \| "http"`. |
| `packages/lore/src/ai/http-provider.ts` | **NEW** — `HttpAIProvider` implementing `AIProvider` interface. Constructor takes resolved config + `process.env`. `generate(prompt, opts)`: builds Anthropic Messages body, resolves `${ENV}` in headers, POSTs via Bun's `fetch()` with AbortController for `timeout_ms`, validates response via `aiHttpResponseSchema`, extracts `content[0].text`, returns `Result<AIGenerateResult, LoreError>` with `usage` populated. |
| `packages/lore/src/ai/env-resolve.ts` | **NEW (small helper)** — `resolveEnvInHeaders(headers, env): Result<Headers, LoreError>`. Rejects `${FOO}` where `env.FOO` unset/empty. Parallels SPEC-009 `resolveSyncCredentials()`. |
| `packages/lore/src/ai/provider-factory.ts` (or `app.ts` if factory logic lives there) | Wire `ai.provider === "http"` → construct `HttpAIProvider`; `"claude-cli"` → existing `ClaudeCliProvider`. Reject unknown provider strings via Zod (already in SPEC-017 AC-AI-11). |
| `packages/lore/src/app.ts` | Route the correct provider based on config; no other change. |
| `packages/lore/src/ai/telemetry.ts` (or wherever `ai.generation` events are emitted) | Populate `usage` field when provider returns it (HTTP always; CLI leaves null). |
| `CLAUDE.md` (root) | Add `SPEC-020` to Specs list. Note that HTTP provider exists but CLI is default. |
| `packages/lore/tests/unit/ai/http-provider.test.ts` | **NEW** (tester subagent). Uses `Bun.serve` fixture as fake Anthropic endpoint. Six-dim coverage. |
| `packages/core/tests/unit/schemas.test.ts` | Extend with `aiHttpResponseSchema` tests + new `usage` telemetry field. |

### 9.2 Config shape (final)

```yaml
ai:
  provider: http                             # or "claude-cli"
  http:
    url: "https://api.anthropic.com/v1/messages"
    model: "claude-opus-4-8"
    headers:
      x-api-key: "${ANTHROPIC_API_KEY}"
      anthropic-version: "2023-06-01"
    timeout_ms: 60000                        # default 60s
    max_tokens: 4096                         # default 4096
```

### 9.3 Request body shape (Anthropic Messages)

```json
{
  "model": "claude-opus-4-8",
  "max_tokens": 4096,
  "messages": [
    { "role": "user", "content": "<rendered SPEC-017 template>" }
  ]
}
```

### 9.4 Response body shape (validated via `aiHttpResponseSchema`)

```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "model": "claude-opus-4-8",
  "content": [
    { "type": "text", "text": "..." }
  ],
  "stop_reason": "end_turn",
  "usage": { "input_tokens": 42, "output_tokens": 128 }
}
```

Extract `content[0].text` when `content[0].type === "text"`. Any other shape (empty content, non-text first element, missing usage on non-error responses) → `AI_PROVIDER_ERROR`.

### 9.5 Failure mode matrix

| Failure | Behaviour |
|---|---|
| Env var (`${FOO}`) unset/empty at config load | `VALIDATION_ERROR`, exit 1 |
| Network timeout > `timeout_ms` | `AI_PROVIDER_ERROR` with "timeout", exit 6 |
| HTTP 4xx / 5xx | `AI_PROVIDER_ERROR` with status + first 1024 chars of body, exit 6 |
| Response body not JSON | `AI_PROVIDER_ERROR` with "response parse", exit 6 |
| Response schema mismatch | `AI_PROVIDER_ERROR` with Zod issue path, exit 6 |
| Empty `content[0].text` | `AI_PROVIDER_ERROR` with "empty output" (mirrors SPEC-017 AC-AI-7), exit 6 |

### 9.6 Test layout

- Unit (vitest): `aiHttpResponseSchema` accepts/rejects fixtures; `env-resolve.ts` interpolation; `HttpAIProvider.generate` happy path via `Bun.serve` fake endpoint on ephemeral port.
- Unit (vitest): factory picks correct provider from config.
- Integration (vitest): full `lore create spec --ai` with `ai.provider: http` config, fake server verifies request body shape.
- Regression: `ai.provider: claude-cli` path unchanged (SPEC-017 tests still pass).

### 9.7 Out of §9 scope (still SPEC-020)

- OpenAI wire format — SPEC-020.1.
- Streaming — SPEC-020.2 or SPEC-022 follow-up.
- Retry policy — caller-owned via exit code.
- Cost / billing dashboard — SPEC-012 follow-up.
