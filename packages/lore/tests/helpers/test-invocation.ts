/**
 * Build the `Invocation` of ONE test run from values the test names, never from the test process.
 *
 * Purpose: `resolveInvocation` (core) reads the running process; the in-process runner and any test that calls
 * `runCli` itself need the same shape built from an explicit cwd, env and home, so two runs in one process cannot
 * see each other's state (spec-process-state-end-state-one-invocation-per-entry-returned Goal 2, rule AS-27).
 * Public surface: `buildTestInvocation(input)`, `TestInvocationInput`.
 * Invariants:
 *   - Reads NO process-wide state that varies per run: not `process.env`, `process.cwd()`, `process.argv`.
 *     `host` and `user` are fixed test values; `tmpDir` is the OS temp directory (a path, not run state).
 *   - Path and identity policy is `invocationResolvers` (run-cli.ts), the object the binary's entry uses, so a
 *     test run and the binary cannot disagree on where `claudeDir` / `userConfigDir` come from.
 *   - `paths.home` is the `home` argument, whatever `env.HOME` says.
 * Side-effect class: IO (the policy's project-root and worktree probes read the filesystem under `cwd`).
 */

import { tmpdir } from "node:os";
import { resolveInvocationIdentity } from "@lore/core/node";
import type { Invocation, InvocationWriter } from "@lore/core";
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
  /** Where the run's stdout / stderr go. */
  readonly io: Readonly<{ stdout: InvocationWriter; stderr: InvocationWriter }>;
}

/** Fixed OS-account name of every test run (the os-fallback tier of actor resolution). */
const TEST_USER = "test-user";

/**
 * @throws {RunIdentityArgumentError} on an empty or valueless `--by` / `--harness-run`
 */
export function buildTestInvocation(input: TestInvocationInput): Invocation {
  const { cwd, env, home } = input;
  const resolution = resolveInvocationIdentity(input.argv, { ...env }, () => TEST_USER, () => invocationResolvers.worktreeActor(cwd));
  const argv: readonly string[] = Object.freeze([...resolution.argv]);
  return Object.freeze({
    cwd,
    env: Object.freeze({ ...env }),
    argv,
    paths: Object.freeze({
      home,
      claudeDir: invocationResolvers.claudeDir({ argv, env, home }),
      userConfigDir: invocationResolvers.userConfigDir(env, home),
      projectRoot: invocationResolvers.projectRoot(cwd),
      tmpDir: tmpdir(),
    }),
    host: "test-host",
    user: TEST_USER,
    execPath: process.execPath,
    isCompiled: false,
    identity: resolution.identity,
    io: input.io,
  });
}
