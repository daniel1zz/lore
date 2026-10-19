/**
 * Build the `Invocation` of ONE test run from values the test names, never from the test process.
 *
 * Purpose: `resolveInvocation` (core) reads the running process; the in-process runner and any test that calls
 * `runCli` itself need the same shape built from an explicit cwd, env and home, so two runs in one process cannot
 * see each other's state (spec-process-state-end-state-one-invocation-per-entry-returned Goal 2, rule AS-27).
 * Public surface: `buildTestInvocation(input)`, `TestInvocationInput`.
 * Invariants:
 *   - Reads NO process-wide state that varies per run: not `process.env`, `process.cwd()`, `process.argv`.
 *     `host`, `user` and `tmpDir` are the machine's own (constant for the process), as the binary's entry reads them;
 *     `cwd` is the real path of `input.cwd` (what `process.cwd()` is after a chdir into it).
 *   - Path and identity policy is `invocationResolvers` (run-cli.ts), the object the binary's entry uses, so a
 *     test run and the binary cannot disagree on where `claudeDir` / `userConfigDir` come from.
 *   - `paths.home` is the `home` argument, whatever `env.HOME` says.
 * Side-effect class: IO (the policy's project-root and worktree probes read the filesystem under `cwd`).
 */

import { realpathSync } from "node:fs";
import { hostname, tmpdir, userInfo } from "node:os";
import { resolveInvocationIdentity } from "@lore/core/node";
import type { Invocation, OsUser } from "@lore/core";
import { invocationResolvers } from "../../src/adapters/cli/run-cli";

/** What a test names to build an Invocation. */
export interface TestInvocationInput {
  /** Arguments after the program name, as typed (a `--harness-run` / `--by` is resolved into the identity). */
  readonly argv: readonly string[];
  /** Working directory of the run. */
  readonly cwd: string;
  /** The WHOLE environment of the run. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The home directory of the run (a throwaway directory). */
  readonly home: string;
  /** Where the run's stdout / stderr go, and what its stdin is. */
  readonly io: Invocation["io"];
  /** The OS account lookup the run records; default: the real user of the test process. */
  readonly osUser?: OsUser;
}

/** The OS account name every test run reports (the os-fallback tier of actor resolution): the real one, as the binary's entry reads it. */
const TEST_USER: OsUser = { ok: true, name: userInfo().username };

/**
 * @throws {RunIdentityArgumentError} on an empty or valueless `--by` / `--harness-run`
 */
export function buildTestInvocation(input: TestInvocationInput): Invocation {
  const { env, home } = input;
  // reason: the binary's `process.cwd()` is the REAL path of the directory it started in (a symlinked tmp dir such as
  // macOS /var -> /private/var resolves), and commands report that; the in-process run must report the same one.
  const cwd = realpathSync(input.cwd);
  const user = input.osUser ?? TEST_USER;
  const resolution = resolveInvocationIdentity(input.argv, { ...env }, user, () => invocationResolvers.worktreeActor(cwd));
  const argv: readonly string[] = Object.freeze([...resolution.argv]);
  return Object.freeze({
    cwd,
    env: Object.freeze({ ...env }),
    argv,
    paths: Object.freeze({
      home,
      claudeDir: invocationResolvers.claudeDir({ argv, env, home, cwd }),
      userConfigDir: invocationResolvers.userConfigDir(env, home),
      projectRoot: invocationResolvers.projectRoot(cwd),
      tmpDir: tmpdir(),
    }),
    host: hostname(),
    user,
    execPath: process.execPath,
    isCompiled: false,
    identity: resolution.identity,
    io: input.io,
  });
}
