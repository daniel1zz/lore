# Module: adapters/mcp

## Purpose

MCP (Model Context Protocol) stdio adapter. Entered via `lore --mcp-server`
(top-level flag intercepted in `packages/lore/src/index.ts`) or `lore agent`.
Registers 33 `lore_*` tools plus a small set of MCP resources against
`@modelcontextprotocol/sdk`'s `McpServer`, connects over
`StdioServerTransport`. Per-spec mechanism history:
`lore search "mcp"` or the frozen snapshot
`knowledge-module-claude-md-snapshot-packages-lore-src-adapters-2`.

## Key Invariants

- **Never throws across the MCP boundary.** Every tool handler returns
  `{ content: [text] }` on success or `{ content: [text], isError: true }` on
  failure. Map service `LoreError` codes inside the handler — never let them
  propagate.
- **3-arg `server.tool(name, desc, handler)` registration, then patch
  `inputSchema`** — see `tools.ts` header comment. The 4-arg overload with an
  inline ZodRawShape causes tsc to OOM (>7 GB heap) across 16 call sites.
  **Do not rewrite to the 4-arg form.** Source: ADR-01KVYFJ5G8EVB6S5NMD3PNY5KA
  "Fast Path" Pattern 1.
- **Schema constants are module-level `z.object(...)` declarations**, not
  inline literals. Reuse `DOC_TYPE_ENUM` / `DOC_STATUS_ENUM` — keeps tsc from
  re-resolving the shape per call site.
- **One registration per tool name.** Re-registering the same name corrupts
  the SDK's `_registeredTools` map.
- **Idempotent transport lifecycle** — `startMcpServer(app, getConfig?)`
  awaits `server.connect(transport)` and blocks until the transport closes.
  Caller is responsible for `app.close()` after return. `getConfig` is an
  optional zero-arg GETTER (not a one-time value) so a long-lived server
  observes `.lore/config.yaml` edits made mid-session — threaded straight to
  `registerTools`.
- **MCP callers pass actor identity (`by`) explicitly** on every write tool
  that needs one — no `$LORE_ACTOR`/OS-username fallback like the CLI (MCP
  callers are always agents).
- **`attestation` is never an accepted field on `lore_evidence_add`'s
  schema** — `lore_verify` is the only MCP-reachable path to attested
  evidence. `capture: true` does NOT change this: it yields
  `capture_source: "runner"`, which is strictly weaker than an `attestation`,
  so a captured MCP row still cannot satisfy `lore done`'s runner-attested
  floor.
- **`capture_source` is DERIVED, never an input.** No adapter exposes it as a
  field — `lore_evidence_add` stamps `"runner"` only on the path where this
  server actually spawned the command, `"self-report"` on every other write.
  A caller-settable value was explicitly rejected as a self-report wearing a
  runner's label (task-mcp-lore-evidence-add-cannot-set-capture-source-and-has-no).
  `TaskWorkflowService.appendEvidenceEntry` additionally FORCES `"runner"` for
  any row carrying an `attestation`, whatever the adapter passed.

## Patterns

- **App is the only dependency** — `registerTools(server, app, getConfig?)`
  and `registerResources(server, app)` receive the wired App; tools never
  touch a store or service constructor directly.
- **`schema-info.ts` carries `CORPUS_SCHEMA_INFO`** — a static description of
  the corpus shape exposed as an MCP resource. Update it when adding a new
  doc type or required `extra` field.
- **Tool naming convention: `lore_<verb>`** — mirrors the CLI subcommand
  surface (`lore_create`, `lore_get`, `lore_set`, `lore_search`, `lore_list`,
  `lore_tree`, `lore_link`, `lore_pending`, `lore_approve`, etc.).
- **Dispatch-descriptor SSOT for `lore_feed`** — branch membership,
  required-field validation, and contradictory-field rejection derive from
  ONE exported descriptor,
  `../../flows/feed-flow.ts::SPECIAL_FEED_CHECKPOINTS` — the same descriptor
  the CLI's `commands/feed.ts` handler table asserts coverage against at
  module init. Never re-derive this list independently.

## Tools (one line each — mechanism/spec detail via `lore search <tool>` or the frozen snapshot)

- `lore_create/get/set/search/list/tree/link/pending/approve` — core CRUD, mirrors CLI. `lore_create` also takes optional `file_anchors`/`supersedes`.
- `lore_claim/release/evidence_add/ready` (SPEC-025) — task workflow; `by` required. `evidence_add` runs the oracle-file-existence precheck before dispatch, supports `ac_ref`/`checklist_ref`, and takes `capture: boolean` — the MCP peer of the CLI's `lore evidence --capture` (task-mcp-lore-evidence-add-cannot-set-capture-source-and-has-no): the server runs `command` itself via the shared `../evidence-capture.ts::captureOracleCommand`, cross-checks the real exit code against `result`, and records the child's real stdout+stderr as `output_tail`. `capture: true` REQUIRES `caller_cwd` (refused when absent — this server's own `process.cwd()` was fixed at startup and is not the caller's directory); mutually exclusive with `output_tail` and `oracle: "manual"` via the CLI's own `findCaptureFlagConflict`.
- `lore_assess` (SPEC-026) — plan-outcome AI judge; no non-AI mode, `summary` Markdown digest via `assess-render.ts`.
- `lore_audit` (SPEC-035) — filtered audit query; `verify: true` runs the versions⋈audit completeness oracle.
- `lore_review` (SPEC-034) — single-doc structured review judgment; deterministic pre-checks short-circuit before the AI provider.
- `lore_verify` (SPEC-039) — attested script-AC runner; `allow_new_commands` replaces the CLI's TTY approval prompt (MCP is non-interactive).
- `lore_feed` (SPEC-041/070) — checkpoint dispatch: gate / `session-resume` / `phase-start` / `task-start`, see Patterns above.
- `lore_bootstrap` / `lore_handoff` (SPEC-041) — session pointer-set (read-only) + sole non-CLI handoff writer.
- `lore_anchor_set` (SPEC-042/045) — declarative REPLACE of anchors; task vs spec dispatch DIVERGES from the CLI's incremental `anchor add`/`rm`.
- `lore_invalidate` (SPEC-043) — sole MCP write path for `extra.validity`.
- `lore_staleness_probe` (SPEC-044) — batch / single-doc / list-only staleness scan; `by` also used as the audit-row actor.
- `lore_uat_record` (SPEC-054), `lore_requirement_add` (SPEC-055), `lore_phase_status` (SPEC-056) — thin pipes over their respective services, same construction the CLI equivalents use.

## Files

- `index.ts` — `startMcpServer(app, getConfig?)`; wires `McpServer` + `StdioServerTransport`.
- `tools.ts` — 33 tool registrations, schema constants, Zod input shapes.
- `assess-render.ts` — `buildAssessSummaryText(result)` — Markdown digest for `lore_assess`'s `summary` field.
- `resources.ts` — MCP resource registrations (corpus snapshots, etc.).
- `schema-info.ts` — `CORPUS_SCHEMA_INFO` constant describing doc types and `extra` requirements.

## Links

- Depends on: [`@lore/core`](../../../../../core/src/CLAUDE.md), [`../../service`](../../service/CLAUDE.md) (via App), `../evidence-capture.ts` (runner-capture SSOT, shared with the CLI), `../cli/evidence-precheck.ts` (shared self-report refusals).
- Entry points: `../../index.ts` (`--mcp-server`) and [`../cli`](../cli/CLAUDE.md) `lore agent`.
- Full mechanism history (per-spec narratives, byproducts, review fixes): frozen snapshot `knowledge-module-claude-md-snapshot-packages-lore-src-adapters-2`; ongoing detail lives in each spec doc (`lore get SPEC-0NN`).
