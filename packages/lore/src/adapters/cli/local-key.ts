/**
 * Local API key management for `lore dashboard`.
 * Purpose: create or reuse the "dashboard-local" bootstrap API key, caching its raw value
 *   in a `local-key` file alongside wherever the caller's store actually lives.
 * Public surface: ensureLocalApiKey, LocalApiKeyCreator interface.
 * Invariants:
 *   - `<baseDir>/local-key` is written with mode 0600 (owner-readable only).
 *   - Existing file is reused without rotation.
 *   - Missing file triggers api key creation via the injected creator.
 *   - Failure to create is fatal (exitCli(1)) — no silent fallback.
 *   - SPEC-078 D1: `baseDir` is now the MACHINE-scope auth store's own base directory
 *     (`MachineAuthStores.baseDir`, i.e. `createMachineAuthStores()`'s resolved XDG state
 *     dir), never this project's `.lore/` — the "dashboard-local" key is machine-wide
 *     (one key across every project on this machine), so its raw-value cache must be
 *     co-located with the store that actually holds it. A per-project cache would
 *     collide on the SECOND project's `lore dashboard` run (the store's own unique-name
 *     constraint rejects a second "dashboard-local" key). This module itself is
 *     path-agnostic — `dashboard.ts` decides which directory to pass.
 * Side-effect class: IO (fs read/write, process.exit on error)
 * Source: SPEC-016 §3.6, §3.7; SPEC-078 §Design Decisions D1
 *
 * reason: Extracted from dashboard.ts so this module has NO bun:sqlite transitive dependency.
 * vitest can import and test ensureLocalApiKey with a mock creator without hitting
 * the bun:sqlite external boundary (vitest runs in Node, not Bun). SPEC-016 §4 M6.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { exitCli } from "./cli-exit.js";
import { join } from "node:path";
import type { CliIo } from "./output.js";

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
 * Reads `<baseDir>/local-key` if present; otherwise creates "dashboard-local" via the
 * store, writes the raw key to `<baseDir>/local-key` with 0600 permissions, and returns it.
 *
 * @param store - API key creator (ApiKeyStore satisfies this interface).
 * @param baseDir - Absolute path to the directory the raw key is cached in. SPEC-078 D1:
 *   pass the machine-scope auth store's own base dir (`MachineAuthStores.baseDir`), not
 *   this project's `.lore/` — see this module's header for why.
 * @returns The raw API key string (never hashed, caller must keep it secret).
 * @throws exitCli(1) if key creation fails.
 * @example
 *   const rawKey = await ensureLocalApiKey(machineAuth.apiKeyStore, machineAuth.baseDir);
 */
export async function ensureLocalApiKey(io: CliIo, 
  store: LocalApiKeyCreator,
  baseDir: string,
): Promise<string> {
  const keyPath = join(baseDir, "local-key");

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
  io.stderr.write(`Error: Failed to create dashboard API key: ${msg}\n`);
  if (result.error.code === "VALIDATION_ERROR") {
    io.stderr.write(
      `Hint: Run 'lore agent revoke dashboard-local' then delete '${keyPath}' and retry.\n`,
    );
  }
  // reason: exitCli(1) is mocked in vitest tests; the return guards against
  // falling through into result.value access when ok=false. In production, process.exit
  // terminates the process so the return is never reached.
  exitCli(1);
  return "" as never;
}
