/**
 * The ONE place core reads process-wide ambient state: builds an {@link Invocation} from the running process.
 *
 * Purpose: the program entry calls {@link resolveInvocation} once; everything below receives the result
 * (spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D4/D5, rule AS-26).
 * Public surface: {@link resolveInvocation}, {@link InvocationResolvers}.
 * Invariants:
 *   - Reads env, cwd, home, tmp dir, host, exec path, `Bun.main` once per call; the returned Invocation
 *     holds copies, so a later `process.env` change is not seen through it.
 *   - Policy lives in the injected {@link InvocationResolvers} (the lore package owns the BR-813 / BR-1012
 *     path rules and the working-copy actor probe); core imports nothing from lore.
 *   - `--harness-run <id>` is consumed from argv here (BR-1032); a malformed `--by` / `--harness-run` throws
 *     `RunIdentityArgumentError` for the entry to report.
 * Side-effect class: IO (ambient process reads; the injected resolvers may probe the filesystem).
 *
 * reason: lives under `@lore/core/node` (not the default barrel) because it imports `node:os`.
 */

import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { resolveActorWithSource, type ResolvedActor } from "./actor-resolution-node.js";
import type { Invocation } from "./invocation.js";
import { resolveInvocationIdentity } from "./run-identity-node.js";

type EnvBag = Readonly<Record<string, string | undefined>>;

/** Policy the lore entry injects; each takes already-read values and reads no ambient state itself. */
export interface InvocationResolvers {
  /** BR-813: `--claude-dir` (found in `argv`) > `CLAUDE_CONFIG_DIR` > `<home>/.claude`. */
  readonly claudeDir: (input: { argv: readonly string[]; env: EnvBag; home: string }) => string;
  /** BR-1012/BR-1065. */
  readonly userConfigDir: (env: EnvBag, home: string) => string;
  /** Linked-worktree name tier of the claimed identity; `undefined` when `cwd` is not a linked worktree. */
  readonly worktreeActor: (cwd: string) => string | undefined;
  /** Nearest corpus-holding ancestor of `cwd`, or `null`. */
  readonly projectRoot: (cwd: string) => string | null;
}

/**
 * The OS account name of the running process (the os-fallback tier of actor resolution).
 * Lives here, with the other ambient reads, so `resolveActorWithSource` / `resolveInvocationIdentity`
 * stay pure; pass it as their `osUsername` thunk.
 *
 * @returns the OS username
 * @throws when the OS has no passwd entry for the current uid (`os.userInfo` semantics)
 */
export function readOsUsername(): string {
  return userInfo().username;
}

/** What an entry WITHOUT an {@link Invocation} (MCP / HTTP server startup, library use) reads from its process. */
export interface ProcessAmbient {
  readonly env: EnvBag;
  readonly home: string;
  readonly tmpDir: string;
}

/**
 * `$HOME` wins over `os.homedir()`: under Bun, os.homedir() ignores a HOME assigned after startup
 * (measured 2026-10-17, see home-dir-node.ts), and the in-process test runner relies on the env value.
 */
function homeFrom(env: EnvBag): string {
  const envHome = env["HOME"];
  return envHome !== undefined && envHome !== "" ? envHome : homedir();
}

/**
 * Snapshot the ambient process state for an entry that has no {@link Invocation} (the MCP and HTTP servers
 * build theirs at startup). Same copies-not-views semantics as {@link resolveInvocation}. Command code that
 * holds `inv` never calls this.
 *
 * @returns a frozen copy of the environment plus the resolved home and temp directories
 */
export function readProcessAmbient(): ProcessAmbient {
  const env: EnvBag = Object.freeze({ ...process.env });
  return Object.freeze({ env, home: homeFrom(env), tmpDir: tmpdir() });
}

/**
 * Resolve an actor from the running process's own environment, for the entries that have no
 * {@link Invocation} (MCP / HTTP servers, library use): `resolveActorWithSource` over `process.env`
 * and the OS username. Command code that holds `inv` uses `inv.identity.claimed` instead.
 *
 * @param explicit - explicit actor (`--by` / `opts.by`), if supplied
 * @returns the resolved actor and which tier produced it
 */
export function resolveActorFromProcess(explicit?: string): ResolvedActor {
  return resolveActorWithSource(explicit, process.env, readOsUsername);
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
  const resolution = resolveInvocationIdentity(rawArgv, { ...env }, readOsUsername, () => resolvers.worktreeActor(cwd));
  const argv: readonly string[] = Object.freeze([...resolution.argv]);
  const bunMain = (globalThis as { Bun?: { main?: string } }).Bun?.main;
  return Object.freeze({
    cwd,
    env,
    argv,
    paths: Object.freeze({
      home,
      claudeDir: resolvers.claudeDir({ argv, env, home }),
      userConfigDir: resolvers.userConfigDir(env, home),
      projectRoot: resolvers.projectRoot(cwd),
      tmpDir: tmpdir(),
    }),
    host: hostname(),
    execPath: process.execPath,
    isCompiled: bunMain !== undefined && bunMain.startsWith("/$bunfs/"),
    identity: resolution.identity,
    io: Object.freeze({ stdout: process.stdout, stderr: process.stderr }),
  });
}
