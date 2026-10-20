/**
 * `createLiveApp` — a composed `App` over the corpus file `dbPath` whose writes are made by the live test run
 * (`LIVE_TEST_RUN`, name `liveWriteActor()`), registered in that corpus first.
 *
 * Purpose: since a write needs a known party and an unregistered run is refused (spec-every-write-is-made-by-a-known-party-an-attested-agent-run,
 * BR-1351), a test that builds `createApp(dbPath, undefined, liveAmbient(), liveWriteContext())` and then WRITES must
 * also register `LIVE_TEST_RUN` in that file, as the installed hooks register a real run. This helper is that pair in one
 * call. Lives apart from `live-invocation.ts` because it imports the composition root (`bun:sqlite`), which Node-run
 * test files must not.
 *
 * Public surface: {@link createLiveApp}.
 * Side-effect class: IO (opens the corpus file, one run-registry insert).
 */

import type { LoreConfig } from "@lore/core";
import { createApp } from "../../src/app.js";
import type { App } from "../../src/app.js";
import { LIVE_TEST_RUN, liveAmbient, liveWriteContext } from "../live-invocation.js";
import { registerRunInDb } from "./test-run-identity.js";

/**
 * @param dbPath - corpus file (created by the composition if absent)
 * @param config - optional project config, as `createApp` takes it
 * @returns the composed App (a `Result`-wrapped composition error is thrown: a fixture must not continue on one)
 */
export function createLiveApp(dbPath: string, config?: LoreConfig): App {
  const built = createApp(dbPath, config, liveAmbient(), liveWriteContext());
  const app = "corpusService" in built ? built : built.ok ? built.value : undefined;
  if (app === undefined) throw new Error(`createLiveApp: composing ${dbPath} failed: ${JSON.stringify((built as { error?: unknown }).error)}`);
  registerRunInDb(dbPath, LIVE_TEST_RUN);
  return app;
}
