/**
 * Module: real-oracle-git — the git reader `IntegrateOracleService` selects landing tasks with.
 *
 * Purpose: run `git <args>` in a directory and report status and stdout, never throwing (a spawn failure is status 1 with the reason on
 *   stderr), over the invocation's environment.
 * Public surface: {@link createRealOracleGit}.
 * Invariants: every call names its `cwd`; nothing here reads the process working directory or the process environment.
 * Side-effect class: IO (spawns `git`).
 */

import { spawnSync } from "node:child_process";
import type { OracleGit } from "../service/integrate-oracle-service.js";

/**
 * @param env - the environment of the invocation (`AppAmbient.env`)
 * @returns a runner that spawns `git` with `env` in the directory it is given
 */
export function createRealOracleGit(env: Readonly<Record<string, string | undefined>>): OracleGit {
  return (cwd, args) => {
    const result = spawnSync("git", [...args], { cwd, encoding: "utf8", env: { ...env } });
    return { status: result.status ?? 1, stdout: result.stdout ?? "" };
  };
}
