/**
 * Machine-scope dashboard auth store (SPEC-078 D1).
 * Purpose: hold dashboard cookie sessions + the local bootstrap ("dashboard-local") API
 *   key in ONE machine-wide SQLite file, instead of the per-corpus `lore.db`/replica file
 *   `ApiKeyStore`/`SessionStore` used before this spec.
 * Public surface: createMachineAuthStores, MachineAuthStores, CreateMachineAuthStoresOptions.
 * Invariants:
 *   - "Who is logged into this local dashboard" is an operator/machine fact, not a
 *     per-corpus one — storing it per-corpus was a single-corpus-era accident that (a)
 *     leaks session secrets into Turso replicas via SPEC-009 sync, (b) couples every login
 *     to one corpus's health (meta-violation of R-17's per-project isolation goal), and
 *     (c) ties logins to registry ordering once multi-mount lands.
 *   - Unconditional re-point (spec-078 D1): the SAME machine store backs cookie auth in
 *     BOTH registry-less (today) and future multi-project modes — ONE auth code path
 *     forever, never a per-mode branch. Bearer API keys (SPEC-010 `lore serve`) explicitly
 *     STAY per-corpus (corpus-scoped consent by design) — this module never touches them.
 *   - `dashboard-auth.db` is created (or opened) at `<baseDir>/dashboard-auth.db` and
 *     hardened to file mode 0600 (owner read/write only) on every call, not just first
 *     creation — a pre-existing file from an older/differently-permissioned process is
 *     hardened too. Session secrets + the local bootstrap key live in this file.
 *   - `ApiKeyStore`/`SessionStore` are REUSED verbatim over this new `Database` handle —
 *     this module never re-implements their logic, only relocates which file backs them.
 *   - No corpus migration: corpus-DB `sessions` tables become vestigial (existing rows
 *     simply expire; schema untouched).
 * Side-effect class: IO (bun:sqlite file creation, fs mkdir/chmod)
 * Source: SPEC-078 §Design Decisions D1
 */

import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { ApiKeyStore } from "./auth.js";
import { SessionStore } from "./sessions.js";
import { MIGRATION_002_SQL } from "../../store/migrations/migration-002.js";

/** Filename of the machine-scope auth database, relative to its resolved base dir. */
const DB_FILENAME = "dashboard-auth.db";

/** Result of {@link createMachineAuthStores} — one shared `Database` handle plus the two
 * store classes constructed over it, and the resolved absolute path (for callers that
 * need to co-locate another file, e.g. the cached raw bootstrap key). */
export interface MachineAuthStores {
  /** The shared bun:sqlite handle backing both stores below. */
  db: Database;
  /** Per-corpus-independent ApiKeyStore — holds the "dashboard-local" bootstrap key. */
  apiKeyStore: ApiKeyStore;
  /** Machine-wide SessionStore — holds every dashboard cookie session, any project. */
  sessionStore: SessionStore;
  /** Absolute path to the opened/created database file. */
  dbPath: string;
  /** Absolute path to the resolved base directory (dbPath's parent). */
  baseDir: string;
}

/** Options for {@link createMachineAuthStores}. */
export interface CreateMachineAuthStoresOptions {
  /**
   * Base directory the auth db is created in (`<baseDir>/dashboard-auth.db`). Production resolves it once at
   * its entry with {@link resolveMachineAuthBaseDir}; tests MUST pass an `mkdtemp` directory here — never
   * the real `~/.local/state` and never the repo's own `.lore/` (root CLAUDE.md 2026-07-07 pollution-incident rule).
   */
  baseDir: string;
}

/**
 * Resolve the machine-scope state directory for the dashboard auth DB.
 *
 * Follows the SAME env-var-escape-hatch-then-XDG-then-default precedence shape as
 * {@link resolveGlobalConfigPath}/{@link resolveGlobalConfigWritePath}
 * (`@lore/core/config-node.ts`), but STATE- rather than CONFIG-scoped per the XDG Base
 * Directory spec (`$XDG_STATE_HOME`, default `~/.local/state`):
 *   1. `$LORE_STATE_HOME` — app-specific escape hatch (highest precedence)
 *   2. `$XDG_STATE_HOME/lore` — XDG explicit
 *   3. `~/.local/state/lore` — XDG default
 *
 * Pure: computes from the values it is given (the invocation's `env` and `paths.home`). Never touches the filesystem.
 */
export function resolveMachineAuthBaseDir(env: Readonly<Record<string, string | undefined>>, home: string): string {
  const loreStateHome = env["LORE_STATE_HOME"];
  if (loreStateHome) return loreStateHome;

  const xdgStateHome = env["XDG_STATE_HOME"];
  if (xdgStateHome) return join(xdgStateHome, "lore");

  return join(home, ".local", "state", "lore");
}

/**
 * Create (or open) the machine-scope dashboard auth stores.
 *
 * Ensures the base directory exists, opens/creates `dashboard-auth.db` there, runs the
 * api_keys migration (idempotent `CREATE TABLE IF NOT EXISTS`), constructs `ApiKeyStore`
 * over it (SessionStore's own constructor creates the sessions table), and hardens the
 * file to mode 0600.
 *
 * @param opts.baseDir - the directory to open the db in (production: {@link resolveMachineAuthBaseDir}).
 * @returns The shared `db` handle, both stores, and the resolved paths.
 * @example
 *   const stores = createMachineAuthStores({ baseDir: resolveMachineAuthBaseDir(inv.env, inv.paths.home) });
 *   const testStores = createMachineAuthStores({ baseDir: mkdtempSync(...) }); // tests
 */
export function createMachineAuthStores(opts: CreateMachineAuthStoresOptions): MachineAuthStores {
  const baseDir = opts.baseDir;
  mkdirSync(baseDir, { recursive: true });

  const dbPath = join(baseDir, DB_FILENAME);
  const db = new Database(dbPath);
  db.exec(MIGRATION_002_SQL);

  // reason: session secrets + the local bootstrap key live in this file — 0600 (owner
  // read/write only), never world/group readable. Applied unconditionally (idempotent
  // chmod) on every open, not just first creation, so a pre-existing file from an
  // older/differently-permissioned process is hardened too.
  try {
    chmodSync(dbPath, 0o600);
  } catch (e) {
    // reason: Scope-Alt (dispatch bundle, SPEC-078 T7) — 0600 enforcement on non-POSIX
    // platforms (e.g. Windows, where chmod bit semantics differ) degrades to best-effort
    // with a stderr note, never a hard failure — the auth store must still function.
    process.stderr.write(
      `Warning: could not set file mode 0600 on ${dbPath}: ${e instanceof Error ? e.message : String(e)}\n`,
    );
  }

  const apiKeyStore = new ApiKeyStore(db);
  const sessionStore = new SessionStore(db);

  return { db, apiKeyStore, sessionStore, dbPath, baseDir };
}
