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
 *   - The run comes from `LORE_HARNESS_RUN` in the env; the retired `--harness-run` flag (and a malformed value)
 *     throws `RunIdentityArgumentError` for the entry to report (exit 2).
 *   - The returned Invocation asks the store layer to verify the run by process ancestry (`verifyAncestry`).
 * Side-effect class: IO (ambient process reads; the injected resolvers may probe the filesystem).
 *
 * reason: lives under `@lore/core/node` (not the default barrel) because it imports `node:os`.
 */

import { readFileSync } from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";
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

/** The project-level Claude Code settings files of a checkout (none outside a project). */
function projectSettingsFiles(projectRoot: string | null): string[] {
  return projectRoot === null ? [] : [join(projectRoot, ".claude", "settings.json"), join(projectRoot, ".claude", "settings.local.json")];
}

/** File name of the shipped hook that prefixes every Bash call with the run (distribution-hooks.ts). */
const BASH_RUN_HOOK_FILE = "pre-tool-harness-run.mjs";

/**
 * Whether any of the Claude Code settings files registers the run hook under a PreToolUse entry whose matcher names
 * Bash. A missing or unparsable file registers nothing: this only chooses which refusal text names the cause, it
 * never grants anything.
 */
function isBashRunHookInstalled(settingsFiles: readonly string[]): boolean {
  for (const file of settingsFiles) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue; // reason: absent/damaged settings register no hook; see the function comment
    }
    const entries = (parsed as { hooks?: { PreToolUse?: unknown } } | null)?.hooks?.PreToolUse;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries as { matcher?: unknown; hooks?: unknown }[]) {
      if (typeof entry?.matcher !== "string" || !entry.matcher.includes("Bash") || !Array.isArray(entry.hooks)) continue;
      if ((entry.hooks as { command?: unknown }[]).some((hook) => typeof hook?.command === "string" && hook.command.includes(BASH_RUN_HOOK_FILE))) return true;
    }
  }
  return false;
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
 * @param rawArgv - arguments after the program name, as typed
 * @param resolvers - injected path/identity policy, see {@link InvocationResolvers}
 * @returns the immutable {@link Invocation}
 * @throws {RunIdentityArgumentError} on the retired `--harness-run` flag or a `LORE_HARNESS_RUN` that is not an agent run
 */
export function resolveInvocation(rawArgv: readonly string[], resolvers: InvocationResolvers): Invocation {
  const cwd = process.cwd();
  const env: EnvBag = Object.freeze({ ...process.env });
  const home = homeFrom(env);
  const projectRoot = resolvers.projectRoot(cwd);
  const resolution = resolveInvocationIdentity(
    rawArgv,
    { ...env },
    () => (projectRoot === null ? null : resolvers.humanSession({ env, home, projectRoot })),
    () => isBashRunHookInstalled([join(resolvers.claudeDir({ argv: rawArgv, env, home, cwd }), "settings.json"), ...projectSettingsFiles(projectRoot)]),
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
    verifyAncestry: true,
    io: Object.freeze({ stdout: process.stdout, stderr: process.stderr, stdin: process.stdin, stdinIsTTY: process.stdin.isTTY === true }),
  });
}
