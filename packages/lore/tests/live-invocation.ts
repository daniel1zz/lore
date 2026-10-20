/**
 * live-invocation.ts — test helpers: values built from the running test process, for tests that call a
 * command's `run({ args, inv })` directly instead of going through `buildMain(inv)`, or that compose an App / a
 * provider registry (which take their process facts as parameters and read none themselves).
 * Side-effect class: reads process state (that is the point — it mirrors what the entry resolves).
 */
import { homedir, hostname, tmpdir } from "node:os";
import { nameOfAgentRun } from "@lore/core";
import type { Invocation, RunId } from "@lore/core";
import type { AppAmbient } from "../src/app.js";
import type { ProviderRuntime } from "../src/ai/registry.js";
import { declareWriteActorForTests } from "../src/store/write-context-store.js";
import type { StoreInterface } from "../src/store/store-interface.js";
import { CliExit } from "../src/adapters/cli/cli-exit.js";
import { warnSinkOf, type WarnSink } from "../src/service/warn-sink.js";
import { LIVE_TEST_RUN as LIVE_TEST_RUN_ID, registerTestRun } from "./helpers/test-run-identity.js";

/**
 * The agent run every live-process test writes as: an attested run of a fixed fake session. A test that WRITES through
 * an App built with {@link liveWriteContext} registers it in that corpus first (`registerTestRun`, test-run-identity.ts),
 * as the installed hooks register a real run.
 */
export const LIVE_TEST_RUN = LIVE_TEST_RUN_ID as RunId;

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
    execPath: process.execPath,
    isCompiled: false,
    // reason: a getter, like `cwd`: the live test run is REGISTERED in the corpus under the process's current directory
    // each time the identity is read (the composition reads it when it opens the corpus, before any write), the way an
    // installed hook registers a real run. Where there is no corpus (or no Bun runtime) nothing is registered.
    // The run is the one the process's CURRENT session id names (`asSessionActor` switches it between calls, so one test can
    // be two callers), else {@link LIVE_TEST_RUN}; its name derives from the run exactly as production derives it.
    get identity() {
      const session = process.env["CLAUDE_CODE_SESSION_ID"] ?? process.env["CLAUDE_SESSION_ID"];
      const run = (session !== undefined && session.trim() !== "" ? `cc:${session}` : LIVE_TEST_RUN) as RunId;
      registerRunInCurrentCorpus(run);
      return { harnessRun: run, claimed: nameOfAgentRun(run), claimedSource: "run" as const };
    },
    io: liveIo(),
  };
}

/** Register `run` in the corpus holding `process.cwd()`, when there is one and the runtime can. */
function registerRunInCurrentCorpus(run: RunId): void {
  if ((globalThis as { Bun?: unknown }).Bun === undefined) return;
  registerTestRun(process.cwd(), run);
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
 * The author name every live-process test writes under: the name of {@link LIVE_TEST_RUN} (`agent:session-live-tes`),
 * derived from the run exactly as production derives an agent run's name.
 */
export function liveWriteActor(): string {
  return nameOfAgentRun(LIVE_TEST_RUN);
}

/** The write context `createApp(dbPath, config, ambient, writeContext)` takes: the live test run and its name. */
export function liveWriteContext(): { readonly identity: Invocation["identity"] } {
  return { identity: { harnessRun: LIVE_TEST_RUN, claimed: liveWriteActor(), claimedSource: "run" } };
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
