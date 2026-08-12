/**
 * Session heartbeat marker — leaf IO (spec-multi-session-concurrency-
 * queryable-ownership-checkout §Scope L0, AC-OWN-5) recording/reading a
 * `SessionHeartbeatRecord` (`{pid, started_at, machine?}`) per session id, so
 * a later `lore session list|show` call — possibly from a DIFFERENT process
 * on the same machine — can answer "what pid/start-time did session `<id>`
 * last report for itself".
 *
 * Storage: one JSON file per session id under `os.tmpdir()`, filename
 * `lore-session-heartbeat-<sanitized-id>.json` — a DELIBERATE sibling
 * convention to `assets/hooks/session-start-marker.mjs`'s
 * `lore-session-start-<id>.json` (same directory, same inline-sanitize
 * pattern) — SAME directory, DIFFERENT filename prefix and DIFFERENT
 * payload shape, so the two markers never collide or get confused for one
 * another. A JSON sidecar under `os.tmpdir()` was chosen over the document
 * corpus because a heartbeat is ephemeral process-liveness data, not a
 * document — it is never written to `.lore/` at all (this repo's own "never
 * write to the corpus from tests/smoke checks" discipline, taken one layer
 * further: this isn't corpus data in the first place). Overwrites on every
 * write — a heartbeat is a CURRENT-STATE pointer, not an append log (mirrors
 * `real-git-port.ts::writeClaimSessionMarker`'s identical convention).
 *
 * Public surface:
 *   - WriteSessionHeartbeat / writeSessionHeartbeat(sessionId, record) —
 *     best-effort write, NEVER throws (advisory only, mirrors
 *     `bindClaimSessionForTrailer`).
 *   - ReadSessionHeartbeat / readSessionHeartbeat(sessionId) — validates the
 *     read boundary via `sessionHeartbeatRecordSchema` (`session-liveness.ts`'s
 *     Zod SSOT); an absent file, an unreadable file, or a malformed/legacy
 *     payload ALL degrade uniformly to `undefined` ("no recorded heartbeat"),
 *     never a throw.
 *
 * Side-effect class: IO (filesystem read/write under `os.tmpdir()`).
 *
 * Source: spec-multi-session-concurrency-queryable-ownership-checkout §Scope L0, AC-OWN-5.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sessionHeartbeatRecordSchema, type SessionHeartbeatRecord } from "../service/session-liveness.js";

/**
 * DELIBERATE literal duplicate of `session-start-marker.mjs`'s own sanitize
 * regex — see this module's own header for why the two markers stay
 * independent (self-contained hook script vs. this package's TS module).
 */
function heartbeatFilename(sessionId: string): string {
  return `lore-session-heartbeat-${sessionId.replace(/[^A-Za-z0-9._-]/g, "-")}.json`;
}

/** Injectable write port — `SessionService`'s constructor DI. */
export type WriteSessionHeartbeat = (sessionId: string, record: SessionHeartbeatRecord) => Promise<void>;

/** Injectable read port — `SessionService`'s constructor DI. */
export type ReadSessionHeartbeat = (sessionId: string) => Promise<SessionHeartbeatRecord | undefined>;

/**
 * @param sessionId - The session instance to record a heartbeat for.
 * @param record - The `{pid, started_at, machine?}` fact to persist.
 * @returns Always resolves — a filesystem fault is swallowed (advisory only,
 *   see this module's own header).
 */
export const writeSessionHeartbeat: WriteSessionHeartbeat = async (sessionId, record) => {
  try {
    writeFileSync(join(tmpdir(), heartbeatFilename(sessionId)), JSON.stringify(record), "utf8");
  } catch {
    // reason: advisory only — a tmpdir write fault must never fail the caller
    // (`SessionService.recordOwnHeartbeat`'s own doc), mirrors
    // `bindClaimSessionForTrailer`'s identical discard-and-continue shape.
  }
};

/**
 * @param sessionId - The session instance to look up a heartbeat for.
 * @returns The validated `SessionHeartbeatRecord`, or `undefined` when no
 *   heartbeat file exists, it is unreadable, or its content fails
 *   `sessionHeartbeatRecordSchema` validation.
 */
export const readSessionHeartbeat: ReadSessionHeartbeat = async (sessionId) => {
  try {
    const raw = readFileSync(join(tmpdir(), heartbeatFilename(sessionId)), "utf8");
    const parsed = sessionHeartbeatRecordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};
