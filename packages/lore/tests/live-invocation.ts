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
