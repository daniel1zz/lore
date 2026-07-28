/**
 * Trace event layer — Zod schema for a single `trace_events` row (SPEC-102
 * §Schema). Pure, browser-safe module: no IO, no `Date.now()` calls — `ts` is
 * always resolved by the caller (`TraceRecorder`,
 * `packages/lore/src/service/trace-recorder.ts`) and handed in as plain data,
 * mirroring `session.ts`'s "no wall-clock reads in @lore/core" convention.
 *
 * Public surface:
 *   - TRACE_EVENT_KINDS / TraceEventKind / traceEventKindSchema — the
 *     currently-known `kind` values. NOT a DB `CHECK` constraint (SPEC-102
 *     D2 — the `trace_events.kind` COLUMN accepts any TEXT, forward-compat
 *     for a future kind added without a migration) — this Zod enum is the
 *     recorder-seam typo guard `TraceRecorder` validates against BEFORE a
 *     row reaches the store; adding a new kind means adding it here (and a
 *     new `TraceRecorder.record*` call site) in the SAME commit, never a
 *     migration.
 *   - traceEventInputSchema / TraceEventInputValidated — the full per-row
 *     shape `TraceRecorder` validates before every insert.
 *
 * @see SPEC-102 §Schema, §Design Decisions D2/D5
 */

import { z } from "zod";

/**
 * The currently-known `trace_events.kind` values (SPEC-102 §Acceptance
 * Criteria, §Scope). Read instrumentation: `get`/`search`/`feed`/
 * `context_bundle`. Deny instrumentation: `gate_deny` (SPEC-102 D7 — recorded
 * at BOTH the hook layer and the service layer, disambiguated by
 * `details.layer`, never a separate kind per layer).
 */
export const TRACE_EVENT_KINDS = ["get", "search", "feed", "context_bundle", "gate_deny"] as const;

export type TraceEventKind = (typeof TRACE_EVENT_KINDS)[number];

/** Zod enum over {@link TRACE_EVENT_KINDS} — the `TraceRecorder` seam's typo guard, NOT a DB CHECK (D2). */
export const traceEventKindSchema = z.enum(TRACE_EVENT_KINDS);

/**
 * Full per-row shape `TraceRecorder` validates before every `insertTraceEvent`
 * call — the SAME fields `StoreInterface.TraceEventInput`
 * (`packages/lore/src/store/store-shared.ts`) accepts, re-validated here at
 * the recorder seam so a caller typo (an unrecognized `kind`, a negative
 * `hit_count`) is caught BEFORE it reaches the store, never silently
 * persisted as an untyped string/number the DB's CHECK-free columns would
 * otherwise accept without complaint.
 *
 * `surface` re-uses {@link CallerSurface}'s five SPEC-024 values (browser-safe
 * `types.ts`) rather than redefining its own union — a trace row's surface is
 * always one of the SAME five values `App.callerSurface` already carries.
 *
 * `details` defaults to `{}` — every kind's `details` shape (search→query,
 * feed→docs_served[], gate_deny→predicates_failed/target_slug/layer) is
 * documentation-only (SPEC-102 §Schema), not independently Zod-validated
 * per-kind here — `TraceRecorder`'s own typed `record*` methods are what
 * guarantee each kind's `details` shape is built correctly, this schema only
 * guards the row's TOP-LEVEL shape.
 */
export const traceEventInputSchema = z.object({
  /** ISO 8601 with ms — resolved by the caller (`TraceRecorder`), never here. */
  ts: z.string().min(1),
  actor: z.string().min(1),
  surface: z.enum(["cli", "agent", "mcp", "http_cookie", "http_token"]),
  session_id: z.string().min(1),
  kind: traceEventKindSchema,
  doc_id: z.string().min(1).optional(),
  checkpoint: z.string().min(1).optional(),
  hit_count: z.number().int().nonnegative().optional(),
  details: z.record(z.string(), z.unknown()).default({}),
});

/** The Zod-validated shape of one `trace_events` row, pre-insert. */
export type TraceEventInputValidated = z.infer<typeof traceEventInputSchema>;
