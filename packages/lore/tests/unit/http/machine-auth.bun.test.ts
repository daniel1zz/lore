/**
 * SPEC-078 D1 — machine-scope dashboard auth DB, RED scenarios (TDD red phase).
 *
 * Why this exists: today `ApiKeyStore`/`SessionStore` are constructed against the
 * PER-CORPUS `bun:sqlite` handle (`app.ts::buildAppFromSqlite`/`buildAppFromTurso`,
 * both open `sessions`/`api_keys` on the corpus db file). D1 (unanimous 6/6 roles,
 * spec-078-dashboard-multi-project-mount-registry-machine-scope) re-points COOKIE
 * auth to a single machine-scope SQLite file — "who is logged into this local
 * dashboard" is an operator/machine fact, not a per-corpus one, and a per-corpus
 * home would (a) leak session secrets into Turso replicas via SPEC-009 sync, (b)
 * couple every login to one corpus's health (a meta-violation of R-17's per-project
 * isolation goal), (c) tie logins to registry ordering once multi-mount lands.
 *
 * D1's "unconditional re-point": `handleLocalBootstrap`/`authenticateRequest`'s
 * cookie path use the machine store in BOTH registry-less (today) and future
 * multi-project modes — ONE auth code path forever, never a per-mode branch.
 * Bearer API keys (SPEC-010 `lore serve`) explicitly STAY per-corpus (corpus-scoped
 * consent by design) — only cookie auth moves.
 *
 * This file is the RED half of a paired red/green split: T7 (machine auth store +
 * bootstrap re-point) implements `packages/lore/src/adapters/http/machine-auth.ts`
 * exporting `createMachineAuthStores()` to turn these tests green. Until then,
 * every test below fails at import resolution ("Cannot find module") — that IS
 * the expected RED signal (AC-078-4's script command records `--result fail`).
 *
 * Designed factory surface (this file's own expectation of what T7 must build):
 *   export interface MachineAuthStores {
 *     db: Database;
 *     apiKeyStore: ApiKeyStore;
 *     sessionStore: SessionStore;
 *     dbPath: string;
 *   }
 *   export interface CreateMachineAuthStoresOptions { baseDir?: string }
 *   export function createMachineAuthStores(opts?: CreateMachineAuthStoresOptions): MachineAuthStores;
 *
 * `baseDir` is the injectable seam (tests only) — when provided, the auth db is
 * created at `<baseDir>/dashboard-auth.db` instead of resolving the real XDG
 * state path (the `resolveGlobalConfigPath` precedent family in
 * `packages/core/src/config-node.ts`, but state- not config-scoped). Every test
 * here uses an `mkdtemp` baseDir — ⛔ never the real `~/.local/state` and never
 * the repo's own `.lore/` (root CLAUDE.md 2026-07-07 pollution-incident rule).
 *
 * Four scenarios (task-skill-test-t6-machine-auth-red-scenarios, spec AC-078-4):
 *   1. Fresh init → dashboard-auth.db created at the injected base dir, mode 0600.
 *   2. A session minted via the machine store authenticates in BOTH registry-less
 *      and multi-project request shapes through the SAME store instance.
 *   3. Logout (sessionStore.delete, mirrors routes.ts::handleLogout) → auth failure
 *      on every project-addressed route shape, not just the one it logged out from.
 *   4. A bearer API key living in a PER-CORPUS db still authenticates via that
 *      corpus's own ApiKeyStore — untouched by the machine-store re-point, and
 *      the machine store's OWN ApiKeyStore has no knowledge of that corpus key.
 *
 * @spec_ref spec-078-dashboard-multi-project-mount-registry-machine-scope AC-078-4
 */

import { describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApiKeyStore, authenticateRequest } from "../../../src/adapters/http/auth.js";
import { MIGRATION_002_SQL } from "../../../src/store/migrations/migration-002.js";
// reason: NOT YET IMPLEMENTED — T7 (paired-impl) creates this module. Until then
// this import fails module resolution, which is the RED signal itself.
import { createMachineAuthStores } from "../../../src/adapters/http/machine-auth.js";

// ─── Test setup ─────────────────────────────────────────────────────────────

function freshBaseDir(): string {
  return mkdtempSync(join(tmpdir(), "lore-machine-auth-test-"));
}

function reqWithCookie(url: string, sid: string): Request {
  return new Request(url, { headers: { Cookie: `lore_sid=${sid}` } });
}

// ─── Scenario 1 — fresh init creates dashboard-auth.db at 0600 ─────────────────

describe("createMachineAuthStores — fresh init (SPEC-078 D1)", () => {
  it("creates dashboard-auth.db at the injected base dir with file mode 0600", () => {
    const baseDir = freshBaseDir();
    const expectedPath = join(baseDir, "dashboard-auth.db");

    // Given no machine auth DB exists yet.
    expect(existsSync(expectedPath)).toBe(false);

    // When the auth store initializes.
    const stores = createMachineAuthStores({ baseDir });

    // Then dashboard-auth.db is created at the XDG-state-derived (here: injected)
    // path with file mode 0600 — never world/group readable, this file holds
    // session secrets + the local bootstrap key.
    expect(stores.dbPath).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    const mode = statSync(expectedPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

// ─── Scenario 2 — one store instance authenticates BOTH request shapes ─────────

describe("createMachineAuthStores — one store, both modes (SPEC-078 D1 unconditional re-point)", () => {
  it("authenticates a registry-less request AND a project-addressed request through the SAME store instance", async () => {
    const baseDir = freshBaseDir();
    const stores = createMachineAuthStores({ baseDir });

    const created = await stores.apiKeyStore.create("dashboard-local", "admin");
    if (!created.ok) throw new Error("expected ok create");
    const { session_id } = stores.sessionStore.create("dashboard-local");

    // Given a session minted via the machine store.
    // When a cookie-authenticated request hits registry-less mode (today's shape) ...
    const registryLessReq = reqWithCookie("http://localhost/api/docs", session_id);
    const registryLessResult = await authenticateRequest(registryLessReq, stores.apiKeyStore, stores.sessionStore);

    // ... AND a multi-project-mode request (D4's /api/p/:name/* shim prefix, pre-strip) ...
    const multiProjectReq = reqWithCookie("http://localhost/api/p/project-a/docs", session_id);
    const multiProjectResult = await authenticateRequest(multiProjectReq, stores.apiKeyStore, stores.sessionStore);

    // Then both authenticate against the SAME store instance (one code path) —
    // identical session_id + identical resolved name from the ONE `stores` object,
    // never two separately-constructed stores.
    expect(registryLessResult.ok).toBe(true);
    expect(multiProjectResult.ok).toBe(true);
    if (!registryLessResult.ok || !multiProjectResult.ok) throw new Error("expected ok auth");
    expect(registryLessResult.value.session_id).toBe(session_id);
    expect(multiProjectResult.value.session_id).toBe(session_id);
    expect(registryLessResult.value.name).toBe("dashboard-local");
    expect(multiProjectResult.value.name).toBe("dashboard-local");
    expect(registryLessResult.value.callerSurface).toBe("http_cookie");
    expect(multiProjectResult.value.callerSurface).toBe("http_cookie");
  });
});

// ─── Scenario 3 — logout invalidates the session on every project route ───────

describe("createMachineAuthStores — logout (SPEC-078 D1 + R-17 route isolation)", () => {
  it("returns an auth failure on every project's cookie-gated route after logout, not just one", async () => {
    const baseDir = freshBaseDir();
    const stores = createMachineAuthStores({ baseDir });

    const created = await stores.apiKeyStore.create("dashboard-local", "admin");
    if (!created.ok) throw new Error("expected ok create");
    const { session_id } = stores.sessionStore.create("dashboard-local");

    const routeUrls = [
      "http://localhost/api/docs",              // registry-less
      "http://localhost/api/p/project-a/docs",   // project A
      "http://localhost/api/p/project-b/docs",   // project B
    ];

    // Sanity: the session authenticates on all three route shapes BEFORE logout.
    for (const url of routeUrls) {
      const result = await authenticateRequest(reqWithCookie(url, session_id), stores.apiKeyStore, stores.sessionStore);
      expect(result.ok).toBe(true);
    }

    // Given logout — the exact call routes.ts::handleLogout makes
    // (`app.sessionStore.delete(actor.session_id)`).
    stores.sessionStore.delete(session_id);

    // When any project's cookie-gated route is called, Then 401 (auth failure) on
    // ALL of them — logout is store-wide, not scoped to whichever project
    // triggered it.
    for (const url of routeUrls) {
      const result = await authenticateRequest(reqWithCookie(url, session_id), stores.apiKeyStore, stores.sessionStore);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected auth failure after logout");
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });
});

// ─── Scenario 4 — bearer path stays per-corpus, untouched by the re-point ─────

describe("bearer API key in a corpus DB — untouched by the machine-auth re-point (SPEC-078 D1)", () => {
  it("still authenticates via the per-corpus ApiKeyStore, independent of the machine auth store", async () => {
    // Per-corpus db — simulates today's <repo>/.lore/lore.db api_keys table,
    // explicitly NOT re-pointed by D1 ("Bearer API keys stay per-corpus —
    // corpus-scoped consent by design; only dashboard cookie auth moves").
    const corpusDb = new Database(":memory:");
    corpusDb.exec(MIGRATION_002_SQL);
    const corpusApiKeyStore = new ApiKeyStore(corpusDb);

    const created = await corpusApiKeyStore.create("agent-bearer", "owner");
    if (!created.ok) throw new Error("expected ok create");

    // A SEPARATE machine auth store — bearer validation must never reach into it.
    const baseDir = freshBaseDir();
    const machineStores = createMachineAuthStores({ baseDir });

    // Given a bearer API key in a corpus DB, When lore serve authenticates it
    // (no cookie on the request — falls straight through to the bearer path) ...
    const req = new Request("http://localhost/api/docs", {
      headers: { Authorization: `Bearer ${created.value.rawKey}` },
    });
    const result = await authenticateRequest(req, corpusApiKeyStore, machineStores.sessionStore);

    // Then per-corpus ApiKeyStore still answers — bearer path untouched.
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok auth");
    expect(result.value.name).toBe("agent-bearer");
    expect(result.value.callerSurface).toBe("http_token");

    // And the machine store's OWN ApiKeyStore has never heard of this key —
    // proves the two stores are genuinely independent, not silently shared.
    const wrongStoreResult = await machineStores.apiKeyStore.validate(created.value.rawKey);
    expect(wrongStoreResult.ok).toBe(false);
  });
});
