/**
 * live-invocation.ts — test helpers: values built from the running test process, for tests that call a
 * command's `run({ args, inv })` directly instead of going through `buildMain(inv)`, or that compose an App / a
 * provider registry (which take their process facts as parameters and read none themselves).
 * Side-effect class: reads process state (that is the point — it mirrors what the entry resolves).
 */
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import type { Invocation, OsUser } from "@lore/core";
import type { AppAmbient } from "../src/app.js";
import type { ProviderRuntime } from "../src/ai/registry.js";
import { declareWriteActorForTests } from "../src/store/write-context-store.js";
import type { StoreInterface } from "../src/store/store-interface.js";
import { resolveActorWithSource } from "@lore/core/node";
import { CliExit } from "../src/adapters/cli/cli-exit.js";
import { warnSinkOf, type WarnSink } from "../src/service/warn-sink.js";

/** The live OS account lookup as the entry records it: a success with the real name (tests run where it resolves). */
export function liveOsUser(): OsUser {
  return { ok: true, name: userInfo().username };
}

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
    user: liveOsUser(),
    execPath: process.execPath,
    isCompiled: false,
    identity: { harnessRun: null, claimed: "test-actor", claimedSource: "os" },
    io: liveIo(),
  };
}

/** The live process streams as the writers of a run: what a test passes where production passes `inv.io`. */
export function liveIo(): Invocation["io"] {
  return { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin, stdinIsTTY: process.stdin.isTTY === true };
}

/** The live stderr as a {@link WarnSink}: what a test passes where the composition passes `warnSinkOf(inv.io.stderr)`. */
export function liveWarn(): WarnSink {
  return warnSinkOf(process.stderr);
}

/** The live process as the composition's {@link AppAmbient}: what `createApp(dbPath, config, ambient)` takes. */
export function liveAmbient(): AppAmbient {
  const envHome = process.env["HOME"];
  return {
    env: process.env,
    home: envHome !== undefined && envHome !== "" ? envHome : homedir(),
    tmpDir: tmpdir(),
    cwd: process.cwd(),
    io: liveIo(),
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
  return resolveActorWithSource(undefined, process.env, liveOsUser()).actor;
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
 * Run `body` (a command handler called directly: `cmd.run({ args, inv })`) and return the exit code it ended with: the
 * code `body` RETURNED (a number), the code of a thrown `CliExit`, else 0. Commands report their code by return value,
 * never to `process.exit` / `process.exitCode`, so a test that calls a handler without `runCli` reads the code here.
 *
 * @param body - the handler call, e.g. `() => cmd.run({ args, inv })`
 * @returns the exit code of the run
 */
export async function runHandlerForExit(body: () => unknown): Promise<number> {
  try {
    const returned = await body();
    return typeof returned === "number" ? returned : 0;
  } catch (error) {
    if (error instanceof CliExit) return error.code;
    throw error;
  }
}
