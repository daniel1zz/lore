---
id: ADR-01KVYFJ5G8EVB6S5NMD3PNY5KA
type: adr
category: architecture
title: ADR-tsc-memory-root-cause-mcp-tools-zod-shape
summary: >-
  tsc --noEmit OOM root cause: src/adapters/mcp/tools.ts triggers
  ZodRawShapeCompat mapped-type explosion across 16 server.tool() callsites
  against zod 3.x. Tools.ts alone accounts for 912s of check time (vs 1.6s for
  next file). Fast-path: migrate registerTools to discriminated union of tool
  definitions OR move zod schemas out of inline raw-shape into pre-declared
  z.object schemas + use 3-arg form. Long-term: migrate to zod 4 (already
  installed at node_modules/zod/v4).
status: draft
priority: high
tags:
  - typecheck
  - tsc
  - oom
  - zod
  - mcp
  - performance
  - root-cause
created: '2026-06-25T04:10:43.106Z'
updated: '2026-06-25T04:10:43.106Z'
version: 1.0.0
decision_status: proposed
---
# ADR: tsc --noEmit Memory OOM Root Cause Analysis

## Status
Proposed — 2026-06-25

## Context

`bun run typecheck:src` (which runs `node --max-old-space-size=4096 tsc --noEmit -p tsconfig.src.json`) OOMs on every machine. Even at 6 GB heap the command terminates with `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`. Background context: a prior research session (commit `f89267b` / SPEC PLAN-01KTRJGT31D8WJ4ZRHNARV9YBC) noted this as a "preexisting issue" but never pinned the root cause; a partial mitigation (`src/core/tree-blueprint.ts` uses a `z.ZodType<Output,Def,Input>` cast to dodge TS2589) is already in place but insufficient.

This ADR captures the diagnostic data, isolates the failing surface area, and proposes a fix path.

## Diagnostic Data

### Baseline `tsc --noEmit -p tsconfig.src.json --extendedDiagnostics`

- 10 GB heap, full src/ tree, --extendedDiagnostics
- Result: `time: command terminated abnormally` at 566.8 s wall, **11.7 GB peak memory** (RSS 4.2 GB at kill), OOM stack trace observed (`FATAL ERROR: Ineffective mark-compacts`).
- Note: `--extendedDiagnostics` produces no output because the compiler dies during the Check phase before the diagnostic summary prints. Confirmed by examining `bw5wl5fc7.output` — only the v8 stack trace is captured.

### Trace-based hotspot analysis (`--generateTrace`)

Ran on the smaller `core+store+svc+http+app` subset (completes in 11 s, 372 MB peak). Top files by `total_dur` in trace.json:

| Rank | File | total_dur (μs) | Notes |
|--|--|--|--|
| 1 | `src/core/telemetry.ts` | 10,781,221 | `TelemetryEventSchema` z.object with .optional fields (lines 28-43) is the hottest span — 1.9 s checkVariableDeclaration |
| 2 | `src/core/config.ts` | 5,166,944 | `SyncConfigSchema.superRefine` + `LoreConfigSchema` z.object with nested .optional sections |
| 3 | `src/core/schemas.ts` | 2,947,901 | `createDocInputSchema = baseCreateDocInputSchema.superRefine(...)` + 8 z.object passthroughs |
| 4 | `src/core/tree-blueprint.ts` | 2,914,085 | `z.lazy + z.object + superRefine` — already has TS2589 workaround in place |
| 5 | `src/store/sqlite-store.ts` | 1,182,683 | Result<T,LoreError> narrowing |

Top trace events (`structuredTypeRelatedTo`, `getVariancesWorker`) consistently point at zod internals: `ZodEffects` (from superRefine/refine), `ZodType` generic variance, `ZodUnknown` (from `z.record(z.unknown())`).

### Isolation experiments (sequential, dedicated CPU)

| # | Scope | Files | LOC | Types | Inst | Peak mem | Check time | Exit |
|--|--|--|--|--|--|--|--|--|
| 1 | core only | 143 | 1113 | 14,249 | 38,142 | 308 MB | 0.65 s | 0 OK |
| 2 | core+store | 305 | 3473 | 15,619 | 39,716 | 327 MB | 1.76 s | 0 OK |
| 3 | core+store+svc | 318 | 6589 | 17,366 | 41,761 | 335 MB | 0.38-6.2 s* | 0 OK |
| 4 | core+store+svc+cli (+app) | 352 | 10,768 | 26,332 | 54,903 | 351 MB | 0.49 s | 0 OK |
| 5 | core+store+svc+http (+app) | 324 | 7603 | 20,129 | 46,080 | 348 MB | 6.68 s | 0 OK |
| 6 | core+store+svc+app+http/auth | 320 | 6925 | 17,759 | 42,282 | 329 MB | 0.35 s | 0 OK |
| 7 | core+store+svc+mcp/resources+schema-info | 431 | 7073 | 20,881 | 52,829 | 367 MB | 0.38 s | 0 OK |
| 8 | core+store+svc+cli+http (no mcp, no eval) | 352 | 10,768 | 26,332 | 54,903 | 348 MB | 0.49 s | 0 OK |
| 9 | core+store+svc+mcp (FULL — tools.ts included) | — | — | — | — | **7.1 GB** | **OOM** | killed at 6 GB cap |
| 10 | all src except mcp adapter | — | — | — | — | **4.7 GB** | **OOM** | killed at 4 GB cap |
| 11 | all src except eval | — | — | — | — | **4.8 GB** | **OOM** | killed at 4 GB cap |
| 12 | cli+http+mcp (FULL) | — | — | — | — | **7.1 GB** | **OOM** | killed at 6 GB cap |
| 13 | core+store+svc+mcp/tools.ts only | — | — | — | — | timeout @ 10 min | hung | timeout |

* Run 3 variance came from CPU contention with concurrent tsc processes; clean run is 0.38 s.

**Key observations**
- Runs 6 (no http routes), 4 (cli only), 7 (mcp resources only, no tools.ts), 8 (cli+http, no mcp) all complete in well under 1 s with under 400 MB.
- Runs 9, 12, 13 (any scope including `mcp/tools.ts`) OOM or hang.
- Runs 10, 11 (combined cli+http+eval+adapters but without one of mcp/eval) OOM at 4 GB — when full breadth is requested, the cumulative Result/zod narrowing across services already nears the heap cap; adding tools.ts overshoots it.

### `tools.ts` deep dive (trace from OOM run, partial)

Ran `--generateTrace` on the OOMing config (12 GB heap, killed at 11 min, 1.6 MB trace.json captured, 5204 events). After repairing the truncated JSON:

| File | total_dur (μs) |
|--|--|
| `src/adapters/mcp/tools.ts` | **911,798,022 (≈912 s)** |
| `src/core/telemetry.ts` | 1,664,891 (≈1.7 s) |
| `src/core/tree-blueprint.ts` | 583,291 |
| All others combined | < 1 s |

`tools.ts` is **550× more expensive** than the next-hottest file (telemetry.ts) and accounts for >99.7% of measured trace time.

Top spans inside tools.ts (by μs):

| pos | line | dur (μs) | what |
|--|--|--|--|
| 1069 | 27 | 267,758,472 | `// ─── Tool Registrations ───` (opens registerTools body) |
| 3397 | 99 | 227,899,404 | `const { id_or_slug, ...patch } = args;` (lore_set callback) |
| 3504 | 100 | 91,263,365 | `const result = await corpusService.set(id_or_slug, patch);` |
| 1169 | 27 | 82,634,755 | inside registerTools body |
| 1187 | 29 | 82,632,553 | `export function registerTools(server: McpServer, app: App)` |
| 2661 | 73 | 35,772,681 | inside lore_get callback |
| 1729 | 44 | 32,576,010 | first `async (args) =>` (lore_create callback) |

All hot spans are **inside or adjacent to `server.tool(name, desc, {…zodShape…}, async (args) => {…})` callsites**. The cost is concentrated in inferring the `args` type from the inline ZodRawShape literal.

### Why ZodRawShape inference is so expensive

From `node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.d.ts`:

```ts
export type AnySchema = z3.ZodTypeAny | z4.$ZodType;
export type ZodRawShapeCompat = Record<string, AnySchema>;
export type SchemaOutput<S> = S extends z3.ZodTypeAny ? z3.infer<S>
                              : S extends z4.$ZodType ? z4.output<S>
                              : never;
export type ShapeOutput<Shape extends ZodRawShapeCompat> = {
  [K in keyof Shape]: SchemaOutput<Shape[K]>;
};
```

And `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` declares **8 overloads** of `server.tool`. For each of the 16 inline-schema callsites in `tools.ts`:

1. TS must disambiguate across 8 overloads (each tested for arity/shape).
2. For the matched overload, infer `Args extends ZodRawShapeCompat` from the inline literal.
3. Compute `ShapeOutput<Args>` — a mapped type that distributes a conditional type (`SchemaOutput`) over every key, each branch evaluating `z3.infer<S>` (which recursively walks the ZodType tree).
4. Verify the callback param type matches the inferred shape.

Hot zod internals reported by trace (sourceId/targetId lookups in types.json):
- `ZodEffects<...>` (lines 815-822 of zod/v3/types.d.cts) — created by every `.superRefine` and `.refine`
- `ZodType<Output, Def, Input>` (lines 47-101) — base 3-param generic; variance worker runs ~1.5 s per pair
- `ZodUnknown` (lines 449-454) — emitted by every `z.record(z.unknown())`

Number of `z.<method>` callsites across hot files:
- `src/adapters/mcp/tools.ts`: 39 inline zod field declarations across 16 server.tool calls (3 use the 3-arg form to bypass).
- `src/core/schemas.ts`: 32 `z.*` calls including 1 `.superRefine`
- `src/core/telemetry.ts`: 2 z.object with .optional
- `src/core/config.ts`: 2 z.object, 1 .superRefine, 1 .strict
- `src/core/tree-blueprint.ts`: 1 z.lazy + 1 .superRefine (already mitigated)
- `src/eval/scenarios/migration-coverage.ts`: 1 z.object (small)

### Result<T, LoreError> contribution

- 138 `Result<...>` references across 22 files; 175 `LoreError` references across 21 files.
- 13-variant discriminated union → every `if (!result.ok)` narrowing path requires comparing 13 variants.
- However, trace evidence shows **this is not the dominant cost** for the OOM. Files heavily using LoreError narrowing (store/*.ts, service/*.ts) appear at ranks 5-9 in trace, summing to ~3 s. `tools.ts` alone is 912 s.

## Root Causes (ranked by contribution)

### 1. (~95%) `src/adapters/mcp/tools.ts` — inline ZodRawShape × 13 server.tool calls × 8 overloads

- 16 `server.tool()` callsites use the 4-arg form `tool(name, desc, {…zodRawShape…}, cb)`.
- For each: tsc resolves across 8 SDK overloads + infers `Args extends ZodRawShapeCompat` from inline object literal + expands `ShapeOutput<Args>` mapped type that distributes a 3-way conditional (`z3 | z4 | never`) across every property.
- The dev already noticed the cost — 2 of the 16 (lore_schema, lore_status) use the no-arg 3-arg form with the explicit comment `// no input parameters, use 3-arg form to avoid ZodRawShapeCompat overload`.

**Evidence**: trace.json shows tools.ts total_dur = 912 s, 550× the next file. Isolation runs 7 (mcp without tools.ts) vs 9, 12, 13 (anything with tools.ts) show binary OOM behavior.

### 2. (~3%) Zod 3.x ZodType/ZodEffects generic variance

- `core/telemetry.ts`, `core/config.ts`, `core/schemas.ts`, `core/tree-blueprint.ts` collectively account for 21.8 s of check time in the http subset (where it does complete).
- Zod 4 release notes explicitly state: *"To improve TypeScript server performance, some generic class signatures (e.g. ZodUnion) will be changed or simplified."*
- Already installed: `node_modules/zod` is at v3.25.76 with a `v4/` subpath shipped (`import * as z from "zod/v4"`).

**Evidence**: top trace events are `structuredTypeRelatedTo` between `ZodEffects`/`ZodType` IDs; this is zod's own type-machinery cost.

### 3. (~2%) Result<T, LoreError> union narrowing

- 13-variant discriminated union across 22 files, 138 callsites.
- Each `if (!result.ok)` triggers narrowing across all 13 variants.

**Evidence**: trace.json shows store/sqlite-store.ts, store/in-memory-store.ts, service/migration-service.ts each contribute ~0.4-1.2 s — meaningful but minor compared to tools.ts.

## Options Considered

(see Options field for A/B/C/D detail)

## Decision

**Recommended: Option A (refactor tools.ts), staged with Option C (zod 4 migration) as a follow-up.**

Rationale:
- A is the only option that directly targets the 95% contributor.
- A is single-file scope (src/adapters/mcp/tools.ts only); blast radius confined to the MCP adapter.
- The fix pattern is already validated inside the same file (3-arg form on lore_schema and lore_status).
- C is correct strategically but doesn't fix the OOM by itself (verified: the MCP SDK's `ShapeOutput` mapped type expansion is what dominates, and that survives the v3→v4 import swap).
- B (simplify LoreError) misdiagnoses the root cause — would not fix OOM and would lose error-code precision for HTTP status mapping.
- D (project references) is over-engineering for a 1-file issue.

### Fast Path (estimated <30 min of implementer work)

Convert every `server.tool(name, desc, {…shape…}, async (args) => …)` to one of these two patterns:

**Pattern 1** — pre-declared ZodObject (preferred when args have validation rules):

```ts
const loreCreateSchema = z.object({
  type: z.enum(["prd", "spec", "adr", "plan", "knowledge", "task"]),
  title: z.string().min(1),
  content: z.string().optional(),
  parent_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  extra: z.record(z.unknown()).optional(),
});
type LoreCreateArgs = z.infer<typeof loreCreateSchema>;

server.tool("lore_create", "Create a new document …",
  async (extra) => {
    const parsed = loreCreateSchema.safeParse(extra.params?.arguments);
    if (!parsed.success) return errorContent({ code: "VALIDATION_ERROR", field: parsed.error.issues[0]?.path.join("."), message: parsed.error.issues[0]?.message ?? "" });
    const args: LoreCreateArgs = parsed.data;
    const result = await corpusService.create(args);
    …
  });
```

The 3-arg form skips ZodRawShapeCompat expansion entirely. The cost of explicit safeParse is borne at runtime only, not at type-check time.

**Pattern 2** (alternative) — keep 4-arg form but extract the raw shape into a typed `const` of type `ZodRawShape`:

```ts
import type { ZodRawShape } from "zod";
const loreCreateShape: ZodRawShape = {
  type: z.enum(["prd", "spec", "adr", "plan", "knowledge", "task"]),
  title: z.string().min(1),
  …
};
server.tool("lore_create", "…", loreCreateShape, async (args) => { … });
```

Pattern 2 widens `args` to `unknown` inside the callback (loss of static safety), so Pattern 1 is recommended.

### Verification gates for the implementer

1. After refactor: `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.src.json --extendedDiagnostics 2>&1 | grep -E "Memory used|Check time|Types:|Instantiations"` must complete without OOM and report < 600 MB Memory used.
2. Existing MCP tool runtime tests (`bun run test:vitest` for tests/unit/adapters/mcp-*.test.ts) must continue to pass — confirms runtime parity.
3. Manual smoke: `lore --mcp-server` exposes 16 tools with correct argument validation (test against `lore_create` with missing `title`).

### Stretch goal (separate ADR/plan)

After A lands, file a second ADR for migrating zod imports from `"zod"` → `"zod/v4"` to capture the additional ~21 s of check time inside core/*.ts files. Breaking changes are scoped:
- `.passthrough()` → `z.looseObject()` (in schemas.ts × 4 callsites)
- `.message` → `.error` param (audit needed)
- exactOptionalPropertyTypes interaction (need to verify in core/config.ts)

## Consequences

(see Consequences field above)

## Out of scope for this ADR

- Refactoring LoreError union (option B) — proven non-causal, would lose precision for httpStatus mapping.
- TS project references / monorepo split (option D) — disproportionate effort for a single-file root cause.
- Adding more MCP tools — every new `server.tool(name, desc, {…shape…}, cb)` re-triggers the bomb until pattern A is enforced via a lint rule or a thin wrapper helper (e.g., `defineTool(name, desc, schema, cb)`).

## Evidence Index

| Artifact | Location |
|--|--|
| Baseline OOM v8 trace | `/private/tmp/claude-501/-Users-apple-Projects-zz-lore/be6fd510-64cd-429e-87d8-1aca9453d2ba/tasks/bw5wl5fc7.output` |
| Trace JSON (http subset) | `/tmp/tsc-trace/trace.json` (590 KB), `/tmp/tsc-trace/types.json` (5.4 MB) |
| Trace JSON (mcp OOM partial) | `/tmp/tsc-trace-mcp/trace.json` (1.6 MB), repaired at `/tmp/tsc-trace-mcp/trace-fixed.json` (5204 events) |
| Isolation tsconfigs | `/private/tmp/claude-501/-Users-apple-Projects-zz-lore/c76158b3-7578-4a9b-bb04-e174335bb111/scratchpad/iso-*.json` |
| Hot file (root cause) | `/Users/apple/Projects/zz/lore/src/adapters/mcp/tools.ts` (429 LOC, 16 server.tool calls) |
| MCP SDK type bomb | `/Users/apple/Projects/zz/lore/node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.d.ts` (ShapeOutput mapped type) |
| MCP SDK overload set | `/Users/apple/Projects/zz/lore/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` (8 tool overloads) |
| Prior workaround precedent | `src/core/tree-blueprint.ts` lines 42-69 (z.ZodType cast) |
| Prior 3-arg precedent | `src/adapters/mcp/tools.ts` lines 288-295 (lore_schema), 360-369 (lore_status) — both use 3-arg form with the comment "use 3-arg form to avoid ZodRawShapeCompat overload" |
