/**
 * Build the `Invocation` of ONE test run from values the test names, never from the test process.
 *
 * Purpose: `resolveInvocation` (core) reads the running process; the in-process runner and any test that calls
 * `runCli` itself need the same shape built from an explicit cwd, env and home, so two runs in one process cannot
 * see each other's state (spec-process-state-end-state-one-invocation-per-entry-returned Goal 2, rule AS-27).
 * Public surface: `buildTestInvocation(input)`, `TestInvocationInput`.
 * Invariants:
 *   - Reads NO process-wide state that varies per run: not `process.env`, `process.cwd()`, `process.argv`.
 *     `host` and `tmpDir` are the machine's own (constant for the process), as the binary's entry reads them;
 *     `cwd` is the real path of `input.cwd` (what `process.cwd()` is after a chdir into it).
 *   - Path and identity policy is `invocationResolvers` (run-cli.ts), the object the binary's entry uses, so a
 *     test run and the binary cannot disagree on where `claudeDir` / `userConfigDir` come from, nor on which human
 *     session (the token file under the run's own `home`) a run with no harness run writes as.
 *   - `paths.home` is the `home` argument, whatever `env.HOME` says.
 * Side-effect class: IO (the policy's project-root probe and human-session file read touch the filesystem under `cwd` / `home`).
 */

import { realpathSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { resolveInvocationIdentity } from "@lore/core/node";
import type { Invocation } from "@lore/core";
import { invocationResolvers } from "../../src/adapters/cli/run-cli";

/** What a test names to build an Invocation. */
export interface TestInvocationInput {
  /** Arguments after the program name, as typed (a `--harness-run` is resolved into the identity). */
  readonly argv: readonly string[];
  /** Working directory of the run. */
  readonly cwd: string;
  /** The WHOLE environment of the run. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The home directory of the run (a throwaway directory). */
  readonly home: string;
  /** Where the run's stdout / stderr go, and what its stdin is. */
  readonly io: Invocation["io"];
}

/**
 * @throws {RunIdentityArgumentError} on an empty, valueless or non-agent `--harness-run`
 */
export function buildTestInvocation(input: TestInvocationInput): Invocation {
  const { env, home } = input;
  // reason: the binary's `process.cwd()` is the REAL path of the directory it started in (a symlinked tmp dir such as
  // macOS /var -> /private/var resolves), and commands report that; the in-process run must report the same one.
  const cwd = realpathSync(input.cwd);
  const projectRoot = invocationResolvers.projectRoot(cwd);
  const resolution = resolveInvocationIdentity(input.argv, { ...env }, () =>
    projectRoot === null ? null : invocationResolvers.humanSession({ env, home, projectRoot }),
  );
  const argv: readonly string[] = Object.freeze([...resolution.argv]);
  return Object.freeze({
    cwd,
    env: Object.freeze({ ...env }),
    argv,
    paths: Object.freeze({
      home,
      claudeDir: invocationResolvers.claudeDir({ argv, env, home, cwd }),
      userConfigDir: invocationResolvers.userConfigDir(env, home),
      projectRoot,
      tmpDir: tmpdir(),
    }),
    host: hostname(),
    execPath: process.execPath,
    isCompiled: false,
    identity: resolution.identity,
    io: input.io,
  });
}
