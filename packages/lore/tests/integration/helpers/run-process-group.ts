/**
 * Purpose: run a child process the way a test must — in its own process group, with a wall-clock
 * timeout that FAILS LOUD and kills the WHOLE group, so a test never leaves a child behind
 * (task-skill-implement-tg-24; measured 2026-10-17: a `npm pack --dry-run --json` grandchild of a
 * timed-out `spawnSync` lived 5+ hours because `spawnSync`'s timeout kills only the direct child).
 * Public surface: {@link runProcessGroup}, {@link ProcessGroupTimeoutError}, {@link killLiveProcessGroups}.
 * Invariants: every child is a process-group leader (`detached`); the group is SIGKILLed on timeout,
 * and on this process's `exit` for any group still alive.
 * Side-effect class: IO (spawns and kills processes).
 */

import { spawn } from "node:child_process";

/** Raised when a child outlived its timeout; its whole process group has been SIGKILLed. */
export class ProcessGroupTimeoutError extends Error {
  constructor(
    readonly command: string,
    readonly timeoutMs: number,
    readonly stdoutTail: string,
    readonly stderrTail: string,
  ) {
    super(
      `"${command}" exceeded ${timeoutMs} ms and its process group was killed.\n` +
        `stdout tail: ${stdoutTail}\nstderr tail: ${stderrTail}`,
    );
    this.name = "ProcessGroupTimeoutError";
  }
}

/** Collected result of a child that exited on its own. */
export interface ProcessGroupResult {
  readonly stdout: string;
  readonly stderr: string;
  /** Exit code; a child killed by a signal it did not choose reports 1 with the signal in `stderr`. */
  readonly exitCode: number;
}

const liveGroups = new Set<number>();

/** SIGKILLs every process group this module started that is still alive. Idempotent. */
export function killLiveProcessGroups(): void {
  for (const pid of liveGroups) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // reason: the group already exited between the check and the kill; that is the goal state.
    }
  }
  liveGroups.clear();
}

process.on("exit", killLiveProcessGroups);

/**
 * Runs `bin args` in its own process group and resolves with its collected output.
 *
 * @param bin - Executable (absolute path preferred).
 * @param args - Arguments.
 * @param options - `cwd`, full `env`, and `timeoutMs` (required: a test must declare its budget).
 * @returns The child's output and exit code.
 * @throws {ProcessGroupTimeoutError} when the child outlives `timeoutMs`; the group is dead on throw.
 * @example
 * const r = await runProcessGroup("/usr/bin/env", ["true"], { cwd: "/tmp", env: {}, timeoutMs: 5_000 });
 */
export function runProcessGroup(
  bin: string,
  args: readonly string[],
  options: { cwd: string; env: Record<string, string>; timeoutMs: number },
): Promise<ProcessGroupResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const pid = child.pid;
    if (pid !== undefined) liveGroups.add(pid);
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pid !== undefined) liveGroups.delete(pid);
      action();
    };

    const timer = setTimeout(() => {
      if (pid !== undefined) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
      finish(() =>
        reject(new ProcessGroupTimeoutError(`${bin} ${args.join(" ")}`, options.timeoutMs, stdout.slice(-1500), stderr.slice(-1500))),
      );
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (cause) => finish(() => reject(cause)));
    child.once("exit", () => {
      // reason: leave no grandchild behind even on a normal exit (a daemonised helper outlives its
      // parent). Killed on `exit`, not `close`: a grandchild that inherited the stdout pipe keeps
      // `close` from ever firing, which is itself a way for a test to hang until its timeout.
      if (pid !== undefined) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    });
    child.once("close", (code, signal) => {
      finish(() =>
        resolve({
          stdout,
          stderr: signal === null ? stderr : `${stderr}\n[killed by ${signal}]`,
          exitCode: code ?? 1,
        }),
      );
    });
  });
}
