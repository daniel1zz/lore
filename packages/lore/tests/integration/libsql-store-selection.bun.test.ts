/**
 * @spec_ref spec-eager-libsql-load-makes-every-command-depend-on-a-healthy
 *   AC-LL-5, AC-LL-7
 *
 * RED/observed-state oracle (T1 of the "lazy libsql load + TMPDIR
 * diagnostic" plan): in-process assertions on `createApp`'s return value —
 * store identity for the SQLite branches, `Result` shape for the
 * credential-failure branch. `bun:sqlite` is a vitest SSR external (see
 * root CLAUDE.md), so this observation channel is reachable ONLY under
 * `bun test`, never vitest — this is why these two ACs live in a SEPARATE
 * `.bun.test.ts` file from the compiled-binary subprocess ACs
 * (AC-LL-1..AC-LL-4, `tests/e2e/libsql-lazy-load.test.ts`).
 *
 * Unlike the e2e file, these tests run the SOURCE `createApp` directly
 * (never the compiled `dist/lore` binary) — under `bun test`, `@libsql/
 * client` resolves from `node_modules` normally, so a bad `TMPDIR` need
 * not fail the load at all here (per the governing spec's AC-LL-5 design
 * note). The induction mechanism for both ACs is therefore NOT the TMPDIR
 * trick — it is `sync.enabled: true` with the credential env var absent,
 * which is unambiguously reachable in-process regardless of TMPDIR health.
 *
 * Fixture discipline: every `dbPath` is a fresh `mkdtempSync` file — this
 * repo's own `.lore/` corpus is NEVER touched by a test (root CLAUDE.md).
 * `dbPath = join(tmpDir, "lore.db")` (no `.lore/` subdirectory needed) is
 * the same convention this repo's own `tests/e2e/sync-cli.bun.test.ts`
 * already uses for in-process `createApp` calls.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp, type App } from "../../src/app.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { TursoStore } from "../../src/store/turso-store.js";
import type { LoreConfig, LoreError, Result } from "@lore/core";
import { liveAmbient, liveWriteContext, actedStore } from "../live-invocation.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeTmpDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `lore-libsql-store-selection-${label}-`));
}

/** Duck-type check: is the createApp return value a Result (has "ok")? */
function isResult(value: App | Result<App, LoreError>): value is Result<App, LoreError> {
  return typeof value === "object" && value !== null && "ok" in value;
}

/**
 * Reads the CONCRETE store instance wired into a built App's CorpusService.
 * `CorpusService.store` is TS-`private` (single-underscore convention, not a
 * true JS `#private` field) — this codebase's own test suites already read
 * such fields the same way (e.g.
 * `tests/unit/adapters/http/auth-cookie.bun.test.ts`'s
 * `(sessionStore as unknown as { db: Database }).db`). Store identity is
 * not observable any other way — `App` deliberately does not expose a
 * public `store` field (composition-root encapsulation).
 */
function storeOf(app: App): unknown {
  return (app.corpusService as unknown as { store: unknown }).store;
}

/**
 * A LoreConfig with `sync.enabled: true`, a DNS-invalid remote_url (RFC 2606
 * `.invalid` TLD — guarantees no real network call can ever succeed), and
 * the given credential env-var NAME. Interval/auth_token_env mirror
 * `SyncConfigSchema`'s own resolved defaults — these fixtures bypass Zod
 * parsing (createApp takes an already-typed `LoreConfig`), so every field
 * the parsed TYPE requires must be supplied explicitly.
 */
function syncEnabledConfig(tokenEnvName: string): LoreConfig {
  return {
    project: { name: "libsql-store-selection-oracle", author: "libsql-store-selection-oracle" },
    sync: {
      enabled: true,
      remote_url: "libsql://nonexistent-host-for-tests.invalid",
      auth_token_env: tokenEnvName,
      interval: 60,
    },
  };
}

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe("createApp store selection — in-process (spec-eager-libsql-load-makes-every-command-depend-on-a-healthy)", () => {
  // ─── AC-LL-7: D-007 store selection under a healthy TMPDIR, three cases ──

  it("AC-LL-7 (a): no sync key in config yields a SQLiteStore-backed App", () => {
    const dir = makeTmpDir("ll7a");
    scratchDirs.push(dir);
    const dbPath = join(dir, "lore.db");
    const config: LoreConfig = {
      project: { name: "libsql-store-selection-oracle", author: "libsql-store-selection-oracle" },
    };
    const result = createApp(dbPath, config, liveAmbient(), liveWriteContext());
    expect(isResult(result)).toBe(false);
    const app = result as App;
    expect(storeOf(app)).toBeInstanceOf(SQLiteStore);
    app.close();
  });

  it("AC-LL-7 (b): sync.enabled false yields a SQLiteStore-backed App", () => {
    const dir = makeTmpDir("ll7b");
    scratchDirs.push(dir);
    const dbPath = join(dir, "lore.db");
    const config: LoreConfig = {
      project: { name: "libsql-store-selection-oracle", author: "libsql-store-selection-oracle" },
      sync: { enabled: false, auth_token_env: "LORE_SYNC_TOKEN", interval: 60 },
    };
    const result = createApp(dbPath, config, liveAmbient(), liveWriteContext());
    expect(isResult(result)).toBe(false);
    const app = result as App;
    expect(storeOf(app)).toBeInstanceOf(SQLiteStore);
    app.close();
  });

  it("AC-LL-7 (c): sync.enabled true with missing credentials yields err(VALIDATION_ERROR), never a store instance", () => {
    const dir = makeTmpDir("ll7c");
    scratchDirs.push(dir);
    const dbPath = join(dir, "lore.db");
    const tokenEnvName = "LORE_LL7C_MISSING_TOKEN_PROBE";
    const previous = process.env[tokenEnvName];
    delete process.env[tokenEnvName];
    try {
      const result = createApp(dbPath, syncEnabledConfig(tokenEnvName), liveAmbient(), liveWriteContext());
      expect(isResult(result)).toBe(true);
      const asResult = result as Result<App, LoreError>;
      expect(asResult.ok).toBe(false);
      if (!asResult.ok) {
        // reason: resolveSyncCredentials (packages/core/src/config.ts) yields
        // VALIDATION_ERROR for missing credentials, propagated verbatim by
        // app.ts — the spec's original STORE_ERROR pin was corrected after
        // T1's RED run measured this (see governing spec's "Error-code
        // correction" note). STORE_ERROR remains correct for TursoStore
        // *construction* failure, a different branch.
        expect(asResult.error.code).toBe("VALIDATION_ERROR");
      }
    } finally {
      if (previous === undefined) delete process.env[tokenEnvName];
      else process.env[tokenEnvName] = previous;
    }
  });

  // ─── AC-LL-5: anti-downgrade invariant ───────────────────────────────────

  it("AC-LL-5: sync.enabled true with LORE_SYNC_TOKEN absent yields err(VALIDATION_ERROR), never a SQLiteStore-backed App", () => {
    const dir = makeTmpDir("ll5");
    scratchDirs.push(dir);
    const dbPath = join(dir, "lore.db");
    const tokenEnvName = "LORE_SYNC_TOKEN";
    const previous = process.env[tokenEnvName];
    delete process.env[tokenEnvName];
    try {
      const result = createApp(dbPath, syncEnabledConfig(tokenEnvName), liveAmbient(), liveWriteContext());
      // Anti-downgrade invariant: whatever the error CODE turns out to be,
      // there must never be a working App backed by SQLiteStore on this path.
      if (!isResult(result)) {
        expect(storeOf(result)).not.toBeInstanceOf(SQLiteStore);
      } else {
        expect(result.ok).toBe(false);
      }
      // The specific error code the spec pins.
      expect(isResult(result)).toBe(true);
      const asResult = result as Result<App, LoreError>;
      expect(asResult.ok).toBe(false);
      if (!asResult.ok) {
        // reason: same correction as AC-LL-7(c) above — missing credentials
        // surface as VALIDATION_ERROR (resolveSyncCredentials), not STORE_ERROR.
        expect(asResult.error.code).toBe("VALIDATION_ERROR");
      }
    } finally {
      if (previous === undefined) delete process.env[tokenEnvName];
      else process.env[tokenEnvName] = previous;
    }
  });

  // ─── Sanity fence: confirms storeOf()/TursoStore import are live, not a ──
  // ─── dead reference that would make the above instanceof checks vacuous ─
  //
  // Deliberately NO "AC-LL-" substring anywhere in this test's name — the
  // declared AC-LL-5/AC-LL-7 verify commands select with `-t "AC-LL-n"`,
  // a plain substring match against the full "describe > it" title. This
  // test's FIRST draft accidentally wrote "AC-LL-7/AC-LL-5" into its own
  // title (to explain what it fences) and silently over-matched BOTH `-t`
  // filters — measured empirically while building this file (`bun test
  // ... -t "AC-LL-5"` reported "Ran 2 tests" instead of 1). Exactly the
  // contiguous-substring false-oracle vector this repo's root CLAUDE.md
  // documents; fixed by never spelling out an AC id in a non-AC test name.

  it("supporting check: TursoStore/SQLiteStore instanceof identity is distinguishable (fences the store-identity assertions above against a vacuous always-false read)", () => {
    const dir = makeTmpDir("sanity-turso-identity");
    scratchDirs.push(dir);
    const store = actedStore(new TursoStore({ localPath: join(dir, "sanity.db") }));
    try {
      expect(store).toBeInstanceOf(TursoStore);
      expect(store).not.toBeInstanceOf(SQLiteStore);
    } finally {
      store.close();
    }
  });
});
