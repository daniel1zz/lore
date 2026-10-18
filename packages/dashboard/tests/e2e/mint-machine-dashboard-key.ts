/**
 * Fixture-only helper — mints (or reuses) the MACHINE-scope "dashboard-local" API key
 * against an explicit `mkdtemp` base directory, mirroring exactly what `lore dashboard`
 * (`commands/dashboard.ts`) does via `createMachineAuthStores()` + `ensureLocalApiKey`
 * (SPEC-078 D1) — but as a standalone `bun` process (same precedent as
 * `seed-execution-fixture.ts`/`seed-judgment.ts`) so `global-setup.ts`/
 * `multi-project-global-setup.ts` never need to import `bun:sqlite`-transitive server
 * code directly.
 *
 * Why this exists: `POST /api/auth/local-bootstrap` (`handleLocalBootstrap`) validates
 * `X-Lore-Token` ONLY against the MACHINE-scope `apiKeyStore` (SPEC-078 D1's
 * "unconditional re-point" — it takes no `App` parameter at all). The dashboard SPA's
 * `VITE_LORE_BOOTSTRAP_TOKEN` must therefore be a key this machine store recognises —
 * a key minted in a PER-CORPUS store (`lore agent create`, `app.apiKeyStore`) no longer
 * authenticates the cookie-bootstrap flow at all. This script mints the machine key
 * directly; the corresponding server process must be started with
 * `LORE_STATE_HOME=<same baseDir>` (or an explicit `machineAuth` instance sharing the
 * same underlying file) so it resolves the IDENTICAL store, exactly as
 * `machine-auth.ts::resolveMachineAuthBaseDir`'s `$LORE_STATE_HOME` escape hatch allows.
 *
 * Usage: bun mint-machine-dashboard-key.ts <baseDir>
 * Prints one JSON line: {ok: true, data: {api_key: string}}.
 */
import { createMachineAuthStores } from "../../../lore/src/adapters/http/machine-auth.js";
import { ensureLocalApiKey } from "../../../lore/src/adapters/cli/local-key.js";

async function main(): Promise<void> {
  const baseDir = process.argv[2];
  if (baseDir === undefined) {
    throw new Error("Usage: bun mint-machine-dashboard-key.ts <baseDir>");
  }

  const machineAuth = createMachineAuthStores({ baseDir });
  const rawKey = await ensureLocalApiKey({ stdout: process.stdout, stderr: process.stderr }, machineAuth.apiKeyStore, machineAuth.baseDir);
  console.log(JSON.stringify({ ok: true, data: { api_key: rawKey } }));
  machineAuth.db.close();
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
