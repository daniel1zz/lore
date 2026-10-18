/**
 * live-invocation.ts — test helpers: values built from the running test process, for tests that call a
 * command's `run({ args, inv })` directly instead of going through `buildMain(inv)`, or that compose an App / a
 * provider registry (which take their process facts as parameters and read none themselves).
 * Side-effect class: reads process state (that is the point — it mirrors what the entry resolves).
 */
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import type { Invocation } from "@lore/core";
import type { AppAmbient } from "../src/app.js";
import type { ProviderRuntime } from "../src/ai/registry.js";
import { declareWriteActorForTests } from "../src/store/write-context-store.js";
import type { StoreInterface } from "../src/store/store-interface.js";
import { resolveActorWithSource } from "@lore/core/node";
import { runInScope } from "../src/adapters/cli/run-scope.js";

/** The live process as an Invocation: `env` is the LIVE `process.env` object, so a test's later env edits stay visible. */
export function liveInvocation(): Invocation {
  const envHome = process.env["HOME"];
  const home = envHome !== undefined && envHome !== "" ? envHome : homedir();
  return {
    // reason: getters, not snapshots — tests chdir and set `process.argv` AFTER building this, and the code under test
    // previously read both at call time; a live view keeps those tests meaning what they meant.
    get cwd() {
      return process.cwd();
    },
    env: process.env,
    get argv() {
      return process.argv.slice(2);
    },
    paths: { home, claudeDir: `${home}/.claude`, userConfigDir: `${home}/.config/lore`, projectRoot: null, tmpDir: tmpdir() },
    host: hostname(),
    user: userInfo().username,
    execPath: process.execPath,
    isCompiled: false,
    identity: { harnessRun: null, claimed: "test-actor", claimedSource: "os" },
    io: { stdout: process.stdout, stderr: process.stderr },
  };
}

/** The live process as the composition's {@link AppAmbient}: what `createApp(dbPath, config, ambient)` takes. */
export function liveAmbient(): AppAmbient {
  const envHome = process.env["HOME"];
  return {
    env: process.env,
    home: envHome !== undefined && envHome !== "" ? envHome : homedir(),
    tmpDir: tmpdir(),
    cwd: process.cwd(),
  };
}

/** The live process as a provider-registry runtime: what `buildProviderRegistry(config, runtime)` takes. */
export function liveProviderRuntime(): ProviderRuntime {
  return { env: process.env, tmpDir: tmpdir() };
}

/**
 * The author name a bare-constructed service's writes carried before the write actor became explicit: the session tier of
 * the live env, else the OS user — exactly what the CLI claims outside a worktree.
 */
export function liveWriteActor(): string {
  return resolveActorWithSource(undefined, process.env, () => userInfo().username).actor;
}

/** The write context `createApp(dbPath, config, ambient, writeContext)` takes: the live process's claimed name, no run. */
export function liveWriteContext(): { readonly identity: Invocation["identity"] } {
  return { identity: { harnessRun: null, claimed: liveWriteActor(), claimedSource: "os" } };
}

/** Declares the live author on a bare test store (see {@link declareWriteActorForTests}); returns the same store. */
export function actedStore<T extends StoreInterface>(store: T): T {
  return declareWriteActorForTests(store, liveWriteActor());
}

/**
 * Run `body` (a command handler called directly: `cmd.run({ args, inv })`) as ONE run and return the exit code it ended
 * with: the code of `exitCli`, else the last `setExitCode`, else 0. Commands report their code to the run, never to
 * `process.exit` / `process.exitCode`, so a test that calls a handler without `runCli` reads the code from here.
 *
 * @param body - the handler call; its returned value is ignored
 * @param inv - the run's Invocation (default: the live process; its io is the real process streams, so a test that
 *   captures output by spying on `console` / `process.stderr.write` keeps working)
 */
export async function runHandlerForExit(body: () => unknown, inv: Invocation = liveInvocation()): Promise<number> {
  return runInScope(inv, async () => {
    await body();
  });
}
