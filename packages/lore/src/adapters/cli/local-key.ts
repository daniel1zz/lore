/**
 * Local API key management for `lore dashboard`.
 * Purpose: create or reuse a per-project API key stored in .lore/local-key.
 * Public surface: ensureLocalApiKey, LocalApiKeyCreator interface.
 * Invariants:
 *   - .lore/local-key is written with mode 0600 (owner-readable only).
 *   - Existing file is reused without rotation.
 *   - Missing file triggers api key creation via the injected creator.
 *   - Failure to create is fatal (process.exit(1)) — no silent fallback.
 * Side-effect class: IO (fs read/write, process.exit on error)
 * Source: SPEC-016 §3.6, §3.7
 *
 * reason: Extracted from dashboard.ts so this module has NO bun:sqlite transitive dependency.
 * vitest can import and test ensureLocalApiKey with a mock creator without hitting
 * the bun:sqlite external boundary (vitest runs in Node, not Bun). SPEC-016 §4 M6.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ─── DI interface ───────────────────────────────────────────────────────────────

/**
 * Minimal interface for the API key creation capability.
 * Designed to be satisfied by ApiKeyStore without importing bun:sqlite.
 */
export interface LocalApiKeyCreator {
  create(
    name: string,
    owner: string,
  ): Promise<
    | { ok: true; value: { rawKey: string; record: unknown } }
    | { ok: false; error: { code: string; message?: string } }
  >;
}

// ─── ensureLocalApiKey ───────────────────────────────────────────────────────────

/**
 * Ensure a local API key exists for the dashboard command.
 * Reads .lore/local-key if present; otherwise creates "dashboard-local" via the store,
 * writes the raw key to .lore/local-key with 0600 permissions, and returns it.
 *
 * @param store - API key creator (ApiKeyStore satisfies this interface).
 * @param loreDir - Path to the .lore/ directory (absolute).
 * @returns The raw API key string (never hashed, caller must keep it secret).
 * @throws process.exit(1) if key creation fails.
 * @example
 *   const rawKey = await ensureLocalApiKey(app.apiKeyStore, "/project/.lore");
 */
export async function ensureLocalApiKey(
  store: LocalApiKeyCreator,
  loreDir: string,
): Promise<string> {
  const keyPath = join(loreDir, "local-key");

  if (existsSync(keyPath)) {
    return readFileSync(keyPath, "utf8").trim();
  }

  const result = await store.create("dashboard-local", "admin");

  if (result.ok) {
    const rawKey = result.value.rawKey;
    writeFileSync(keyPath, rawKey, { mode: 0o600 });
    return rawKey;
  }

  const msg =
    result.error.message !== undefined
      ? result.error.message
      : result.error.code;
  process.stderr.write(`Error: Failed to create dashboard API key: ${msg}\n`);
  if (result.error.code === "VALIDATION_ERROR") {
    process.stderr.write(
      `Hint: Run 'lore agent revoke dashboard-local' then delete '${keyPath}' and retry.\n`,
    );
  }
  // reason: process.exit(1) is mocked in vitest tests; the return guards against
  // falling through into result.value access when ok=false. In production, process.exit
  // terminates the process so the return is never reached.
  process.exit(1);
  return "" as never;
}
