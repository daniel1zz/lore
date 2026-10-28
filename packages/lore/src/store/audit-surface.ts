/**
 * Audit write-surface carrier (issue #128, AS-19, AC-BLC-1).
 *
 * Every audit entry records WHICH surface performed the write — SPEC-024's
 * `CallerSurface` (`cli` / `agent` / `http_cookie` / `http_token`; legacy rows may carry `mcp`) — as
 * `details.surface`. It lives in `details` (not a new `audit` column) because
 * `details` is already inside the hash-chain payload (`computeAuditEntryHash`):
 * the surface is tamper-evident with no migration and no break of existing
 * chains (legacy rows simply have no `details.surface`).
 *
 * One choke point instead of ~40 audit-building call sites: the three stores
 * call {@link stampAuditSurface} at their single audit insert point, and the
 * adapters declare their surface here, explicitly:
 *   - CLI    — `setProcessAuditSurface(detectCliSurface())` at boot (loader.ts)
 *   - HTTP   — each authenticated request runs inside
 *              `runWithAuditSurface(actor.callerSurface, …)` (http/index.ts); the
 *              surface is per-REQUEST (cookie vs bearer), so a process-wide value
 *              cannot express it — hence AsyncLocalStorage.
 *
 * Resolution order: request-scoped (ALS) → process-scoped → none. With none, the
 * key is ABSENT (library / unit-test / migration use of a service with no
 * adapter, and every legacy row) — never a guessed value and never a made-up
 * "unknown" that would pollute rows no adapter wrote. An adapter-driven write
 * missing the key is a wiring bug the AC-BLC-1 test catches, and the HTTP
 * dispatch throws outright if an authenticated actor has no surface.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { AuditEntry, WritableCallerSurface } from "@lore/core";

const requestSurface = new AsyncLocalStorage<WritableCallerSurface>();
let processSurface: WritableCallerSurface | undefined;

/**
 * Declare the surface for every write this process makes outside a
 * request-scoped {@link runWithAuditSurface} (CLI invocation).
 */
export function setProcessAuditSurface(surface: WritableCallerSurface): void {
  processSurface = surface;
}

/**
 * Drop any process-scoped surface a previous {@link setProcessAuditSurface} declared, restoring the
 * "no adapter" state (key absent). The process surface is module state that outlives the call that set
 * it, so a single process that boots an adapter in-process and then exercises a store directly (one `bun test`
 * run over many files) must be able to put that state back: callers that assert the no-adapter behaviour
 * establish it with this instead of relying on whichever file ran before them.
 */
export function clearProcessAuditSurface(): void {
  processSurface = undefined;
}

/** Run `fn` (and everything it awaits) with `surface` as the request-scoped audit surface. */
export function runWithAuditSurface<T>(surface: WritableCallerSurface, fn: () => T): T {
  return requestSurface.run(surface, fn);
}

/**
 * The surface a write made right now would be recorded under, or `undefined`
 * when no adapter declared one.
 */
export function currentAuditSurface(): WritableCallerSurface | undefined {
  return requestSurface.getStore() ?? processSurface;
}

/**
 * Return `entry` with `details.surface` set to {@link currentAuditSurface}.
 * An entry that already carries `details.surface` is returned unchanged — an
 * explicit value is never overwritten. When no adapter declared a surface the
 * entry is returned UNCHANGED (key absent, never a guessed value).
 */
export function stampAuditSurface(entry: AuditEntry): AuditEntry {
  if (entry.details !== undefined && "surface" in entry.details) return entry;
  const surface = currentAuditSurface();
  if (surface === undefined) return entry;
  return { ...entry, details: { ...(entry.details ?? {}), surface } };
}
