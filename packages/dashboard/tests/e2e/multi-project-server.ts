/**
 * SPEC-078 T11 — standalone multi-project HTTP server bootstrap for the e2e fixture.
 *
 * Why this exists: `lore serve` (`commands/serve.ts`) never builds a `MountRegistry` —
 * only `lore dashboard` (`commands/dashboard.ts`) does, and it reads the registry from
 * `loadGlobalConfig()`'s MACHINE-scope `~/.config/lore/config.yaml`, which this e2e
 * harness must never touch (root CLAUDE.md pollution-incident rule — every corpus AND
 * every auth store this suite uses must be `mkdtemp`, never a real user path).
 * `dashboard.ts`'s own registry-construction logic is also entangled with spawning a
 * Vite child via `bun run --filter '@lore/dashboard' dev`, which `global-setup.ts`'s own
 * header comment already documents as unusable from a throwaway cwd outside the repo.
 *
 * So this script reproduces JUST the in-process server half of `lore dashboard` (SPEC-078
 * D1/D2/D7: `createMachineAuthStores` + `ensureLocalApiKey` + `createMountRegistry` +
 * `startHttpServer`) directly against explicit CLI args — no global config file involved,
 * every path an explicit `mkdtemp` directory the caller (`multi-project-global-setup.ts`)
 * already created. Mirrors the `seed-execution-fixture.ts`/`seed-judgment.ts` precedent of
 * a standalone `bun <script>.ts` process importing lore server internals directly via
 * relative paths — but LONG-RUNNING (like `global-setup.ts`'s own `lore serve` child)
 * rather than a run-once seed.
 *
 * Usage:
 *   bun multi-project-server.ts <primaryProjectRoot> <port> <host> <machineAuthBaseDir> <registryProjectsJson>
 *     - primaryProjectRoot: directory containing `.lore/lore.db` for the TOP-LEVEL
 *       (unprefixed) `app` — SAME role as `global-setup.ts`'s own default corpus.
 *     - registryProjectsJson: JSON array of `{name, path}` — `path` is each entry's
 *       PROJECT ROOT (NOT the db file — `MountRegistry` resolves `.lore/lore.db` itself,
 *       mirroring `dashboard.ts`'s own `registeredProjects` shape).
 *
 * Ready signal: prints exactly ONE JSON line to stdout as soon as the server is
 * listening — `{ok: true, data: {api_key, mounts: [{name, state, diagnosis?}]}}`. The
 * caller must read this line before proceeding (the process does not exit — it keeps
 * serving until SIGTERM/SIGINT, mirroring `commands/serve.ts`).
 *
 * @spec_ref spec-078-dashboard-multi-project-mount-registry-machine-scope AC-078-6/7/8
 */

import { join } from "node:path";

import { ambientOfInvocation, createApp } from "../../../lore/src/app.js";
import { resolveEntryInvocation } from "../../../lore/src/adapters/cli/run-cli.js";
import type { App } from "../../../lore/src/app.js";
import { startHttpServer } from "../../../lore/src/adapters/http/index.js";
import { createMachineAuthStores } from "../../../lore/src/adapters/http/machine-auth.js";
import { ensureLocalApiKey } from "../../../lore/src/adapters/cli/local-key.js";
import { createMountRegistry } from "../../../lore/src/mount/mount-registry.js";
import type { MountRegistry } from "../../../lore/src/mount/types.js";

interface RegistryProjectArg {
  name: string;
  path: string;
}

async function main(): Promise<void> {
  const [primaryProjectRoot, portArg, host, machineAuthBaseDir, registryJson] = process.argv.slice(2);
  if (
    primaryProjectRoot === undefined ||
    portArg === undefined ||
    host === undefined ||
    machineAuthBaseDir === undefined ||
    registryJson === undefined
  ) {
    throw new Error(
      "Usage: bun multi-project-server.ts <primaryProjectRoot> <port> <host> <machineAuthBaseDir> <registryProjectsJson>",
    );
  }

  const port = parseInt(portArg, 10);
  if (isNaN(port)) throw new Error(`Invalid port: ${portArg}`);

  const registryProjects = JSON.parse(registryJson) as RegistryProjectArg[];

  // SPEC-078 D1 — machine-scope auth store, mkdtemp baseDir (NEVER the real XDG state
  // path). This is what `handleLocalBootstrap` checks the VITE_LORE_BOOTSTRAP_TOKEN
  // against, and what the caller's per-project bearer keys are independent of.
  const machineAuth = createMachineAuthStores({ baseDir: machineAuthBaseDir });
  const rawKey = await ensureLocalApiKey({ stdout: process.stdout, stderr: process.stderr }, machineAuth.apiKeyStore, machineAuth.baseDir);

  // reason: this script is the e2e server's entry — it resolves the Invocation once and composes both apps from it.
  const inv = await resolveEntryInvocation(process.argv.slice(2));
  const ambient = ambientOfInvocation(inv);
  const app: App = createApp(join(primaryProjectRoot, ".lore", "lore.db"), undefined, ambient, { identity: inv.identity });

  let mountRegistry: MountRegistry<App> | undefined;
  if (registryProjects.length > 0) {
    mountRegistry = createMountRegistry<App>();
    await mountRegistry.init(
      { projects: registryProjects },
      { createApp: async (dbPath: string) => createApp(dbPath, undefined, ambient, { identity: inv.identity }) },
    );
  }

  const server = startHttpServer(app, {
    port,
    host,
    io: inv.io,
    machineAuth,
    ...(mountRegistry !== undefined ? { mountRegistry } : {}),
  });

  // Ready signal — the ONE JSON line the caller waits for before treating the server
  // as up. Printed AFTER startHttpServer resolves (Bun.serve binds synchronously).
  console.log(
    JSON.stringify({
      ok: true,
      data: {
        api_key: rawKey,
        mounts:
          mountRegistry !== undefined
            ? mountRegistry.listEntries().map((e) => ({ name: e.name, state: e.state, diagnosis: e.diagnosis }))
            : [],
      },
    }),
  );

  const shutdown = (): void => {
    try {
      server.stop(true);
    } catch {
      // already stopped
    }
    void (async () => {
      if (mountRegistry !== undefined) {
        try {
          await mountRegistry.closeAll();
        } catch {
          // best-effort
        }
      }
      try {
        app.close();
      } catch {
        // best-effort
      }
      try {
        machineAuth.db.close();
      } catch {
        // best-effort
      }
      process.exit(0);
    })();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
