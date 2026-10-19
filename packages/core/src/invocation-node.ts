/**
 * The ONE place core reads process-wide ambient state: builds an {@link Invocation} from the running process.
 *
 * Purpose: the program entry calls {@link resolveInvocation} once; everything below receives the result
 * (spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D4/D5, rule AS-26).
 * Public surface: {@link resolveInvocation}, {@link InvocationResolvers}.
 * Invariants:
 *   - Reads env, cwd, home, tmp dir, host, OS user, exec path, `Bun.main` once per call; the returned Invocation
 *     holds copies, so a later `process.env` change is not seen through it.
 *   - Policy lives in the injected {@link InvocationResolvers} (the lore package owns the BR-813 / BR-1012
 *     path rules and the working-copy actor probe); core imports nothing from lore.
 *   - `--harness-run <id>` is consumed from argv here (BR-1032); a malformed `--by` / `--harness-run` throws
 *     `RunIdentityArgumentError` for the entry to report.
 * Side-effect class: IO (ambient process reads; the injected resolvers may probe the filesystem).
 *
 * reason: lives under `@lore/core/node` (not the default barrel) because it imports `node:os`.
 */

import { homedir, hostname, tmpdir } from "node:os";
import type { Invocation, OsUser } from "./invocation.js";
import { resolveInvocationIdentity } from "./run-identity-node.js";

type EnvBag = Readonly<Record<string, string | undefined>>;

/** Policy the lore entry injects; each takes already-read values and reads no ambient state itself. */
export interface InvocationResolvers {
  /** BR-813: `--claude-dir` (found in `argv`) > `CLAUDE_CONFIG_DIR` > `<home>/.claude`. */
  readonly claudeDir: (input: { argv: readonly string[]; env: EnvBag; home: string; cwd: string }) => string;
  /** BR-1012/BR-1065. */
  readonly userConfigDir: (env: EnvBag, home: string) => string;
  /** Linked-worktree name tier of the claimed identity; `undefined` when `cwd` is not a linked worktree. */
  readonly worktreeActor: (cwd: string) => string | undefined;
  /** The OS account name lookup (production: `() => userInfo().username`); may throw, the entry records the outcome. */
  readonly osUsername: () => string;
  /** Nearest corpus-holding ancestor of `cwd`, or `null`. */
  readonly projectRoot: (cwd: string) => string | null;
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
 * Run the OS-username lookup once and record its outcome as a value.
 * reason: `os.userInfo()` throws when the uid has no passwd entry (containers); the failure is carried to the
 * OS-username tier of actor resolution instead of crashing every invocation at the entry.
 */
function lookUpOsUser(osUsername: () => string): OsUser {
  try {
    return { ok: true, name: osUsername() };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
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
  const user = lookUpOsUser(resolvers.osUsername);
  const resolution = resolveInvocationIdentity(rawArgv, { ...env }, user, () => resolvers.worktreeActor(cwd));
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
      projectRoot: resolvers.projectRoot(cwd),
      tmpDir: tmpdir(),
    }),
    host: hostname(),
    user,
    execPath: process.execPath,
    isCompiled: bunMain !== undefined && bunMain.startsWith("/$bunfs/"),
    identity: resolution.identity,
    io: Object.freeze({ stdout: process.stdout, stderr: process.stderr, stdin: process.stdin, stdinIsTTY: process.stdin.isTTY === true }),
  });
}
