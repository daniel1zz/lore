/**
 * SessionStore — manages cookie-based sessions for the local-bootstrap auth flow.
 * Purpose: create / resolve / touch / delete session rows in the sessions table.
 * Public surface: SessionStore class (create, resolve, touch, delete, pruneExpired).
 * Invariants:
 *   - Session IDs are 32 hex chars (crypto.getRandomValues, 16 bytes).
 *   - Sessions expire after 30 days (sliding renewal on each use).
 *   - Constructor auto-creates the sessions table and prunes expired rows.
 *   - api_key_name references api_keys.name (soft link, no FK constraint).
 * Side-effect class: IO (bun:sqlite)
 * Source: SPEC-016 §3.4, §3.5
 */

import { Database } from "bun:sqlite";

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Session lifetime: 30 days in milliseconds. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id    TEXT PRIMARY KEY,
  api_key_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  last_used_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`;

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Resolved session data joined with api_keys.owner. */
export interface ResolvedSession {
  /** api_key_name from the sessions row (e.g. "dashboard-local"). */
  name: string;
  /** Owner from api_keys.owner (e.g. "admin"). */
  owner: string;
  /** ISO 8601 expiry timestamp. */
  expires_at: string;
}

// ─── Row shape ─────────────────────────────────────────────────────────────────

interface SessionRow {
  api_key_name: string;
  expires_at: string;
  owner: string | null;
}

// ─── SessionStore ───────────────────────────────────────────────────────────────

/**
 * SessionStore — manages the sessions table for cookie-based local bootstrap auth.
 * Takes the same bun:sqlite Database as ApiKeyStore (shared connection, no WAL conflicts).
 *
 * @example
 *   const store = new SessionStore(db);
 *   const { session_id, expires_at } = store.create("dashboard-local");
 *   const session = store.resolve(session_id);  // { name, owner, expires_at }
 *   store.touch(session_id);   // slide expiry +30d
 *   store.delete(session_id);  // logout
 */
export class SessionStore {
  constructor(private readonly db: Database) {
    this.db.exec(CREATE_TABLE_SQL);
    this.pruneExpired();
  }

  /**
   * Create a new session for the given API key name.
   * Generates a random 32-hex session_id and inserts a row with 30-day expiry.
   *
   * @param apiKeyName - The api_keys.name that owns this session (e.g. "dashboard-local").
   * @returns Created session_id and expires_at ISO string.
   */
  create(apiKeyName: string): { session_id: string; expires_at: string } {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const session_id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

    const now = new Date().toISOString();
    const expires_at = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    this.db.prepare(
      `INSERT INTO sessions (session_id, api_key_name, created_at, expires_at, last_used_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(session_id, apiKeyName, now, expires_at, now);

    return { session_id, expires_at };
  }

  /**
   * Resolve a session_id to its owner context.
   * Joins with api_keys to get the owner field.
   * Returns null if the session does not exist (not found or expired+pruned).
   *
   * @param sessionId - 32-hex session ID from the lore_sid cookie.
   * @returns ResolvedSession or null if the session row does not exist.
   */
  resolve(sessionId: string): ResolvedSession | null {
    const row = this.db.prepare(
      `SELECT s.api_key_name, s.expires_at, k.owner
       FROM sessions s
       LEFT JOIN api_keys k ON s.api_key_name = k.name
       WHERE s.session_id = ?`,
    ).get(sessionId) as SessionRow | null;

    if (row === null) return null;

    return {
      name: row.api_key_name,
      // reason: api_keys.owner may be missing if key was revoked+purged but session row remains;
      // fallback to "admin" is safe for a local single-user tool (SPEC-016 §2.2 non-goal: multi-user).
      owner: row.owner ?? "admin",
      expires_at: row.expires_at,
    };
  }

  /**
   * Slide the session expiry by +30 days from now and update last_used_at.
   * No-ops if the session does not exist.
   *
   * @param sessionId - 32-hex session ID to renew.
   */
  touch(sessionId: string): void {
    const now = new Date().toISOString();
    const expires_at = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    this.db.prepare(
      `UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE session_id = ?`,
    ).run(now, expires_at, sessionId);
  }

  /**
   * Delete a session row (logout or expiry cleanup).
   * No-ops if the session does not exist (idempotent).
   *
   * @param sessionId - 32-hex session ID to remove.
   */
  delete(sessionId: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE session_id = ?`).run(sessionId);
  }

  /**
   * Remove all expired sessions (expires_at < now).
   * Called once in the constructor at server startup; no background timer.
   *
   * @example
   *   store.pruneExpired(); // idempotent; safe to call any time
   */
  pruneExpired(): void {
    // reason: datetime(expires_at) normalises the ISO 8601 string for SQLite date comparison.
    // datetime('now') returns UTC time matching our ISO strings (stored in UTC). SPEC-016 §3.4.
    this.db.exec(`DELETE FROM sessions WHERE datetime(expires_at) < datetime('now')`);
  }
}
