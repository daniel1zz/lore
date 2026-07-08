# Module: adapters/mcp

## Purpose

MCP (Model Context Protocol) stdio adapter. Entered via `lore --mcp-server` (top-level flag intercepted in `packages/lore/src/index.ts`) or `lore agent`. Registers 23 `lore_*` tools (16 original + 4 SPEC-025 task-workflow tools + 1 SPEC-026 assess tool + 1 SPEC-035 audit tool + 1 SPEC-034 review tool) and a small set of MCP resources against `@modelcontextprotocol/sdk`'s `McpServer` and connects over `StdioServerTransport`.

## Key Invariants

- **Never throws across the MCP boundary.** Every tool handler returns `{ content: [text] }` on success or `{ content: [text], isError: true }` on failure. Map service `LoreError` codes inside the handler — do not let them propagate.
- **3-arg `server.tool(name, desc, handler)` registration, then patch `inputSchema`** — see `tools.ts` header comment. The 4-arg overload with an inline ZodRawShape causes tsc to OOM (>7 GB heap) across 16 call sites. The current pattern (`registerToolWithArgs` helper, post-registration `inputSchema = z.object(...)` patch) keeps tsc check-time within seconds. **Do not rewrite to the 4-arg form.** Source: ADR-01KVYFJ5G8EVB6S5NMD3PNY5KA "Fast Path" Pattern 1.
- **Schema constants are module-level `z.object(...)` declarations**, not inline literals. Re-using `DOC_TYPE_ENUM` / `DOC_STATUS_ENUM` keeps tsc from re-resolving the shape per call site.
- **One registration per tool name.** Re-registering the same name corrupts the SDK's `_registeredTools` map.
- **Idempotent transport lifecycle** — `startMcpServer(app)` awaits `server.connect(transport)` and blocks until the transport closes. Caller is responsible for `app.close()` after return.

## Patterns

- **App is the only dependency** — `registerTools(server, app)` and `registerResources(server, app)` receive the wired App; tools never touch a store or service constructor directly.
- **`schema-info.ts` carries `CORPUS_SCHEMA_INFO`** — a static description of the corpus shape exposed as an MCP resource. Update it when adding a new doc type or required `extra` field.
- **Tool naming convention: `lore_<verb>`** — `lore_create`, `lore_get`, `lore_set`, `lore_search`, `lore_list`, `lore_tree`, `lore_link`, `lore_pending`, `lore_approve`, etc. Mirrors the CLI subcommand surface. SPEC-025 adds `lore_claim`, `lore_release`, `lore_evidence_add`, `lore_ready` (`by` is a required arg on these — MCP callers pass actor identity explicitly, unlike the CLI's `$LORE_ACTOR`/OS-username fallback). `lore_evidence_add`'s `oracle` enum is sourced from `@lore/core`'s `ORACLE_KINDS` SSOT tuple (SPEC-038 §7 D3) and it gains an optional `ac_ref?: string` — pointer to a structured AC id declared on the plan's parent spec, passed through untouched (validation that it names a *declared* AC is `TaskWorkflowService.addEvidence`'s job, SPEC-038 §4 D4). SPEC-026 adds `lore_assess` (`plan_id_or_slug`, `diff_text?`, `ai?`) — unlike `lore_create`'s `ai` (default `false`, MCP is always-agent), assess has no non-AI mode: `ai: false` is a contradiction (always errors), and the mcp surface's built-in AI-off default does NOT brake it — only an explicit `ai.default_per_surface.mcp = false` config override does (`isAssessAiBraked` from `../../ai/resolve-ai.js`). SPEC-035 adds `lore_audit` (`id_or_slug?`, `actor?`, `action?`, `since?`, `limit?`, `verify?`) — `verify: true` runs the versions⋈audit completeness oracle (ignores the other query filters); otherwise a filtered `AuditFilters` query, optionally scoped to one doc via `id_or_slug`. SPEC-034 adds `lore_review` (`id_or_slug`, `by` — required, same MCP actor-identity precedent as `lore_claim`/`lore_release`) — mirrors the CLI's single-doc `lore review <doc>`: deterministic pre-checks (`runDeterministicChecks`, `@lore/core`) run first; any failure records a `decision: "reject"` judgment WITHOUT invoking the AI provider; otherwise `aiProviderService.judgeDoc` runs. No `ai` override field on this tool — the surface-brake check (`isAssessAiBraked`) runs unconditionally, same as the CLI. `lore_pending` gains `include_judgments?: boolean` — when true, each returned doc is enriched with `judgment: ReviewJudgment | null` (its latest review judgment via `judgmentService.latestFor`). SPEC-033 F1: `lore_approve` gains `calibration_note?: string` and, after a successful approve, runs the same surface-neutral `runCalibrationHook` (`../../flows/calibration-hook.ts`) the CLI `approve` command and the HTTP dashboard's approve route run — MCP is NOT a second-class adjudication surface. `lore_approve` is the only MCP adjudication tool that mutates doc status via `ReviewService`; there is no `lore_reject` MCP tool (no reject-side wiring exists to mirror).

## Files

- `index.ts` — `startMcpServer(app)`; wires `McpServer` + `StdioServerTransport`.
- `tools.ts` — 23 tool registrations, schema constants, Zod input shapes.
- `resources.ts` — MCP resource registrations (corpus snapshots, etc.).
- `schema-info.ts` — `CORPUS_SCHEMA_INFO` constant describing doc types and `extra` requirements (knowledge `sub_type` includes `"assessment"`, SPEC-026).

## Links

- Depends on: [`@lore/core`](../../../../../core/src/CLAUDE.md), [`../../service`](../../service/CLAUDE.md) (via App).
- Entry points: `../../index.ts` (`--mcp-server`) and [`../cli`](../cli/CLAUDE.md) `lore agent`.
