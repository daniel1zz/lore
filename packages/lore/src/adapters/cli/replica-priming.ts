/**
 * Replica priming — loads `@libsql/client` before `createApp` opens a sync-enabled corpus.
 *
 * Purpose: `createApp` is synchronous, and a compiled binary can only load `@libsql/client` through an awaited
 * dynamic `import()`. An entry that is about to open a corpus with `sync.enabled` awaits
 * {@link primeReplicaClientWhenSyncEnabled} first, so the synchronous replica construction finds the module already
 * loaded (spec-defect-clusters-round-2-part-c-criterion-data-demotion D22).
 *
 * Public surface: `primeReplicaClientWhenSyncEnabled(io, locator)`, `primeReplicaClientForProject(projectDbPath)`.
 *
 * Invariants:
 *   - A corpus with no sync section, or `sync.enabled` not true, loads NOTHING: the native load stays lazy.
 *   - No corpus found, or a config that does not parse, primes nothing and says nothing: `loadLoreApp` is the one
 *     place that reports those, with its own exit code.
 *   - A project that asks for sync but whose client cannot load ends the run with exit 1 naming the cause, before any
 *     write; it never continues on the local file.
 * Side-effect class: IO (reads `.lore/config.yaml`; loads the native client when sync is on).
 */

import { dirname } from "node:path";
import { loadConfig } from "@lore/core/node";
import { exitCli } from "./cli-exit.js";
import { findLoreDbPathQuiet, type CorpusLocator } from "./corpus-resolution.js";
import { printLine } from "./output.js";
import type { CliIo } from "./output.js";

/**
 * Primes the libsql client when the project at `projectDbPath` has `sync.enabled: true`.
 *
 * @param projectDbPath - an existing `<project>/.lore/lore.db` path
 * @param io - the run's writers (the failure line goes to `io.stderr`)
 * @throws CliExit (exit 1) when sync is enabled and `@libsql/client` cannot be loaded
 */
export async function primeReplicaClientForProject(projectDbPath: string, io: CliIo): Promise<void> {
  // reason: the config is parsed again by `loadLoreApp`, which reports every parse failure; this read only asks whether
  // sync is on, so its warning lines are dropped here instead of printed twice.
  const configResult = loadConfig(dirname(dirname(projectDbPath)), () => {});
  if (!configResult.ok) return;
  if (configResult.value.sync?.enabled !== true) return;
  const { primeLibsqlClientForSyncConstruction } = await import("../../store/turso-store.js");
  try {
    await primeLibsqlClientForSyncConstruction();
  } catch (thrown) {
    const cause = thrown instanceof Error ? thrown.message : String(thrown);
    printLine(io.stderr, `Error: sync.enabled is true but the Turso client could not be loaded: ${cause}`); // CLI surface
    exitCli(1);
  }
}

/**
 * Primes the libsql client for the corpus the run resolves from its working directory.
 *
 * @param io - the run's writers
 * @param locator - the run's `cwd` + `env` (an `Invocation` works)
 * @throws CliExit (exit 1) when that corpus has sync enabled and the client cannot be loaded
 */
export async function primeReplicaClientWhenSyncEnabled(io: CliIo, locator: CorpusLocator): Promise<void> {
  const dbPath = findLoreDbPathQuiet(io, locator);
  if (dbPath === undefined) return;
  await primeReplicaClientForProject(dbPath, io);
}
