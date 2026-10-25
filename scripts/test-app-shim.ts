/**
 * Alias target for the composition root in a test run (`<anything>/src/app` / `src/app.js`, vitest.shared.ts).
 *
 * Purpose: a test that composes an App as the live test run — `createApp(dbPath, config, liveAmbient(), liveWriteContext())`
 * — and then WRITES needs that run registered in `dbPath`, because an unregistered run is refused (spec-every-write-is-made-by-a-known-party-an-attested-agent-run,
 * BR-1351). The installed SessionStart hook does that registration in production; this shim does it for the one run the
 * live test helpers use (`LIVE_TEST_RUN`), right after the corpus file exists, so ~65 test files need no edit of their own.
 *
 * Public surface: every export of the real `packages/lore/src/app.ts`, with `createApp` wrapped. Any other identity —
 * another run, a human session, none — is composed exactly as the real `createApp` does (a test of the refusal passes one).
 * Side-effect class: IO (one `INSERT OR IGNORE` into the runs registry of `dbPath`), only under the Bun runtime.
 */
// reason: the `./` segment keeps these specifiers from matching the alias that routes `.../src/app[.js]` HERE (vitest.shared.ts),
// which would import this file into itself; the path still resolves to packages/lore/src/app.ts.
import { createApp as realCreateApp } from "../packages/lore/src/./app";
import { LIVE_TEST_RUN, registerRunInDb } from "../packages/lore/tests/helpers/test-run-identity";

export * from "../packages/lore/src/./app";

type CreateAppArgs = Parameters<typeof realCreateApp>;

/** The real `createApp`, plus registering {@link LIVE_TEST_RUN} in `dbPath` when that is the run it is composed with. */
export const createApp = ((...args: CreateAppArgs) => {
  const built = (realCreateApp as (...a: unknown[]) => unknown)(...args);
  const [dbPath, , , writeContext] = args;
  if ((globalThis as { Bun?: unknown }).Bun !== undefined && dbPath !== ":memory:" && writeContext?.identity.harnessRun === LIVE_TEST_RUN) {
    registerRunInDb(dbPath, LIVE_TEST_RUN);
  }
  return built;
}) as typeof realCreateApp;
