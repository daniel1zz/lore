/**
 * The ONE place core reads process-wide ambient state: builds an {@link Invocation} from the running process.
 *
 * Purpose: the program entry calls {@link resolveInvocation} once; everything below receives the result
 * (spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D4/D5, rule AS-26).
 * Public surface: {@link resolveInvocation}, {@link InvocationResolvers}.
 * Invariants:
 *   - Reads env, cwd, home, tmp dir, host, exec path, `Bun.main` once per call; the returned Invocation
 *     holds copies, so a later `process.env` change is not seen through it. The computer user name is never read.
 *   - Policy lives in the injected {@link InvocationResolvers} (the lore package owns the BR-813 / BR-1012
 *     path rules and the human-session token file); core imports nothing from lore.
 *   - `--harness-run <id>` is consumed from argv here (BR-1032); a malformed `--harness-run` throws
 *     `RunIdentityArgumentError` for the entry to report.
 * Side-effect class: IO (ambient process reads; the injected resolvers may probe the filesystem).
 *
 * reason: lives under `@lore/core/node` (not the default barrel) because it imports `node:os`.
 */

import { homedir, hostname, tmpdir } from "node:os";
import type { Invocation } from "./invocation.js";
import { resolveInvocationIdentity, type HumanSessionBinding } from "./run-identity-node.js";

type EnvBag = Readonly<Record<string, string | undefined>>;

/** Policy the lore entry injects; each takes already-read values and reads no ambient state itself. */
export interface InvocationResolvers {
  /** BR-813: `--claude-dir` (found in `argv`) > `CLAUDE_CONFIG_DIR` > `<home>/.claude`. */
  readonly claudeDir: (input: { argv: readonly string[]; env: EnvBag; home: string; cwd: string }) => string;
  /** BR-1012/BR-1065. */
  readonly userConfigDir: (env: EnvBag, home: string) => string;
  /** Nearest corpus-holding ancestor of `cwd`, or `null`. */
  readonly projectRoot: (cwd: string) => string | null;
  /**
   * The human session registered for the checkout at `projectRoot` (BR-1350): reads the token file in the user's lore
   * state directory keyed by that path. Called ONLY for an invocation with no harness run and no agent marker; no
   * host or computer-user name is consulted. `null` = no open session.
   */
  readonly humanSession: (input: { env: EnvBag; home: string; projectRoot: string }) => HumanSessionBinding | null;
}

/**
 * `$HOME` wins over `os.homedir()`: under Bun, os.homedir() ignores a HOME assigned after startup
 * (measured 2026-10-17), and the in-process test runner relies on the env value.
 */
function homeFrom(env: EnvBag): string {
  const envHome = env["HOME"];
  return envHome !== undefined && envHome !== "" ? envHome : homedir();
}

/**
 * Resolve the invocation of the running process.
 *
 * @param rawArgv - arguments after the program name, as typed (still containing `--harness-run`)
 * @param resolvers - injected path/identity policy, see {@link InvocationResolvers}
 * @returns the immutable {@link Invocation}
 * @throws {RunIdentityArgumentError} on an empty or valueless `--by` / `--harness-run`
 */
export function resolveInvocation(rawArgv: readonly string[], resolvers: InvocationResolvers): Invocation {
  const cwd = process.cwd();
  const env: EnvBag = Object.freeze({ ...process.env });
  const home = homeFrom(env);
  const projectRoot = resolvers.projectRoot(cwd);
  const resolution = resolveInvocationIdentity(rawArgv, { ...env }, () =>
    projectRoot === null ? null : resolvers.humanSession({ env, home, projectRoot }),
  );
  const argv: readonly string[] = Object.freeze([...resolution.argv]);
  const bunMain = (globalThis as { Bun?: { main?: string } }).Bun?.main;
  return Object.freeze({
    cwd,
    env,
    argv,
    paths: Object.freeze({
      home,
      claudeDir: resolvers.claudeDir({ argv, env, home, cwd }),
      userConfigDir: resolvers.userConfigDir(env, home),
      projectRoot,
      tmpDir: tmpdir(),
    }),
    host: hostname(),
    execPath: process.execPath,
    isCompiled: bunMain !== undefined && bunMain.startsWith("/$bunfs/"),
    identity: resolution.identity,
    io: Object.freeze({ stdout: process.stdout, stderr: process.stderr, stdin: process.stdin, stdinIsTTY: process.stdin.isTTY === true }),
  });
}
