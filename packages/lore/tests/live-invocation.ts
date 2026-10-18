/**
 * live-invocation.ts — test helper: an `Invocation` built from the running test process, for tests that call a
 * command's `run({ args, inv })` directly instead of going through `buildMain(inv)`.
 * Side-effect class: reads process state (that is the point — it mirrors what the entry resolves).
 */
import { homedir, hostname, tmpdir } from "node:os";
import type { Invocation } from "@lore/core";

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
    identity: { harnessRun: null, claimed: "test-actor", claimedSource: "os" },
    io: { stdout: process.stdout, stderr: process.stderr },
  };
}
