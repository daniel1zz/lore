/**
 * The real `CommitSuiteRunnerPort` behind `lore assess`: selected test files run at a commit, alone or together, in a prepared
 * throwaway worktree (BR-1496, BR-1497). It never runs the full suite.
 *
 * Purpose: give every plan's regression dimension its measured file runs, without ever running tests in the shared
 *   checkout and without writing the repo's `.lore`.
 * Public surface: createGitCommitSuiteRunner (resolve a commit, re-run named test files one by one or together in one
 *   invocation, `withWorktree`, `disposeWorktrees`), runTestFilesTogether, outcomesOfTogetherRun, suiteChildEnv,
 *   FILE_TEST_SCRIPT, runInThrowawayWorktree, prepareDependencies.
 * Invariants:
 *   - The commands are the project's own package.json scripts (`test:file`, and `build` before a batch with a declared
 *     `@spawns dist/lore` test) run with `bun run`.
 *   - Runs happen in `git worktree add --detach <tmp> <commit>`; the worktree is removed afterwards, success or not.
 *   - Commands run with the harness/session variables removed (`suiteChildEnv`), like a clean shell.
 *   - Every command runs in its OWN process group; a timeout ends the whole group (SIGTERM, then SIGKILL after a grace), so
 *     the run returns within timeout + grace and no process of the tree survives. A timed-out file re-run is a failed file
 *     with `incomplete` set (stored never; retried by a later review, BR-1497).
 *   - A failed group signal never escapes a timer callback (it would leave the promise unsettled): EPERM is followed by a
 *     liveness probe (macOS returns EPERM for a group holding only unreaped zombies); no live member = ended, otherwise the
 *     failure is recorded in the result (`killFailure`), a failed file with that cause.
 *   - The throwaway worktree is removed on every exit path; a failed removal is returned as an error, never ignored.
 *   - A run that was killed leaves its worktree behind; every run first removes the registered `lore-assess-suite-*` worktrees
 *     whose directory is gone or whose owner pid (recorded in the directory name) is not alive, and never one a live process
 *     owns (`assess-stale-worktrees.ts`). A per-file re-run that times out or leaves its process group running is a
 *     failed file whose outcome carries `incomplete` (single-file bisection refuses it, BR-1496).
 *   - File runs (`runFiles`, `runFilesTogether`) share ONE prepared worktree per commit for the life of the runner (the review);
 *     the caller ends it with `disposeWorktrees` on every exit path (`PreparedWorktreeCache`). `withWorktree` keeps a throwaway worktree.
 *   - A batch with `buildFirst` runs `bun run build` in the worktree first; a failed or timed-out build makes every file of
 *     the batch `incomplete` (not a test result), never red and never green.
 * Side-effect class: IO (spawns git/bun, creates and removes a temp directory).
 *
 * Reference: Kayenta automated canary analysis; `git worktree` for isolated builds.
 * @spec_ref spec-a-plan-s-close-runs-only-the-tests-its-changes-can-reach (AC-SC-3, BR-1496, BR-1497)
 */

import { execFileSync, spawn as spawnChild } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type LoreError, type Result } from "@lore/core";
import { parseFailingTestFiles } from "../../service/milestone-review-inputs.js";
import type { CommitSuiteRunnerPort, FileRunOutcome, RunBatchOptions } from "../../service/suite-result-service.js";
import { assessWorktreeDirPrefix, pruneStaleAssessWorktrees, type StaleWorktreePorts } from "./assess-stale-worktrees.js";
import { PreparedWorktreeCache, type PreparedWorktree } from "./assess-worktree-cache.js";

const OUTPUT_TAIL_CHARS = 4000;
/** Per-command output kept in memory (the tail): enough for failing-file parsing, bounded against a runaway child. */
const MAX_OUTPUT_CHARS = 16 * 1024 * 1024;
const SUITE_TIMEOUT_MS = 60 * 60 * 1000;
/** After SIGTERM to the process group, how long the group may take to leave before SIGKILL. */
const KILL_GRACE_MS = 10 * 1000;
/** After the child exited or the group was killed, how long to wait for the stdio pipes before closing them ourselves. */
const PIPE_DRAIN_MS = 2000;
/** ANSI colour escape sequences (`ESC [ ... m`). */
const ANSI_COLOR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Time limits of one spawned command; the defaults are the production values. */
export interface ProcessLimits {
  /** Wall time after which the command's whole process group is ended. */
  readonly timeoutMs: number;
  /** Time between SIGTERM and SIGKILL of the process group. */
  readonly graceMs: number;
  /** The group-signal primitive (`process.kill(-pid, signal)`); injectable so tests can make it fail. */
  readonly kill?: (pid: number, signal: NodeJS.Signals) => void;
}

const DEFAULT_LIMITS: ProcessLimits = { timeoutMs: SUITE_TIMEOUT_MS, graceMs: KILL_GRACE_MS };

interface Spawned {
  readonly status: number;
  readonly output: string;
  /** Set when the limit ended the command's process group; `status` is then 1 and `output` ends with the timeout cause. */
  readonly timeout?: { readonly limitMs: number; readonly elapsedMs: number };
  /** Set when a group signal failed and live members remain (or could not be ruled out); `output` ends with it. */
  readonly killFailure?: string;
}

const defaultKill = (pid: number, signal: NodeJS.Signals): void => {
  process.kill(-pid, signal);
};

/**
 * Whether the process group `pgid` still has a member that is not a zombie. `ps -ax -o pid=,pgid=,stat=` is used
 * because it behaves the same on macOS and Linux (`ps -g` means something else on macOS) and shows the Z state;
 * `kill(-pgid, 0)` cannot tell, it answers EPERM on macOS for a group of zombies only.
 *
 * @returns the live member count, or an error text when the process table cannot be read
 */
function countLiveGroupMembers(pgid: number): { readonly live: number } | { readonly error: string } {
  try {
    const table = execFileSync("ps", ["-ax", "-o", "pid=,pgid=,stat="], { encoding: "utf8" });
    let live = 0;
    for (const line of table.split("\n")) {
      const [, group, state] = line.trim().split(/\s+/);
      if (group === String(pgid) && state !== undefined && !state.startsWith("Z")) live += 1;
    }
    return { live };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * Sends `signal` to the whole process group led by `pid`. NEVER throws (it runs inside timer callbacks, where a throw
 * would leave the spawn promise unsettled, A10). ESRCH = group already empty. EPERM = on macOS the group holds only
 * zombies, or the signal is genuinely refused: probed with {@link countLiveGroupMembers}; none live counts as ended.
 *
 * @returns `undefined` when the group is ended or was signalled, else the failure text to record
 */
function signalGroup(pid: number, signal: NodeJS.Signals, kill: (pid: number, signal: NodeJS.Signals) => void): string | undefined {
  try {
    kill(pid, signal);
    return undefined;
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return undefined;
    const text = `${signal} to process group ${pid} failed: ${code ?? (cause instanceof Error ? cause.message : String(cause))}`;
    if (code !== "EPERM") return text;
    const members = countLiveGroupMembers(pid);
    if ("error" in members) return `${text}; liveness probe failed: ${members.error}`;
    return members.live === 0 ? undefined : `${text}; ${members.live} live member(s) remain`;
  }
}

/**
 * Runs one command in its OWN process group and returns within `limits.timeoutMs + limits.graceMs + PIPE_DRAIN_MS`.
 * The former `spawnSync(..., {timeout})` signalled only the direct child; grandchildren kept the stdio pipes open and
 * spawnSync never returned (`lore assess` hung 10 h on 2026-10-29, BR-1497). The timeout now ends the group (SIGTERM,
 * then SIGKILL) and reports the cause in `timeout`.
 */
function spawn(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, limits: ProcessLimits = DEFAULT_LIMITS): Promise<Spawned> {
  return new Promise((resolve) => {
    const startedMs = Date.now();
    const child = spawnChild(command, [...args], { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let timeout: Spawned["timeout"];
    let settled = false;
    const kill = limits.kill ?? defaultKill;
    const killFailures: string[] = [];
    const signal = (target: number, name: NodeJS.Signals): void => {
      const failure = signalGroup(target, name, kill);
      if (failure !== undefined) killFailures.push(failure);
    };
    const timers: NodeJS.Timeout[] = [];
    const collect = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (output.length > MAX_OUTPUT_CHARS) output = output.slice(output.length - MAX_OUTPUT_CHARS);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const finish = (status: number | null, failure: string | undefined): void => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      // reason: stragglers of a finished command (grandchildren) must not outlive it; the group is the command's tree.
      if (child.pid !== undefined) signal(child.pid, "SIGKILL");
      const killFailure = killFailures.length === 0 ? undefined : killFailures.join("; ");
      const killNote = killFailure === undefined ? "" : `\nprocess group could not be ended: ${killFailure}`;
      if (timeout !== undefined) {
        const ended = killFailure === undefined ? "its process group was ended" : "its process group could not be ended";
        resolve({
          status: 1,
          output: `${output}\ncommand \`${command} ${args.join(" ")}\` timed out after ${timeout.elapsedMs} ms (limit ${timeout.limitMs} ms); ${ended}${killNote}`,
          timeout,
          ...(killFailure === undefined ? {} : { killFailure }),
        });
      } else if (status === null) {
        // reason: a spawn that never started (ENOENT) or was killed has status null; it is a failure with its own message.
        resolve({ status: 1, output: `${output}\n${failure ?? "terminated by signal"}${killNote}`, ...(killFailure === undefined ? {} : { killFailure }) });
      } else {
        resolve({ status: killFailure === undefined ? status : 1, output: `${output}${killNote}`, ...(killFailure === undefined ? {} : { killFailure }) });
      }
    };
    child.on("error", (error) => finish(null, error.message));
    child.on("close", (status) => finish(status, undefined));
    child.on("exit", (code) => {
      // reason: the exit status is known now; a grandchild holding the pipes must not delay or lose it.
      timers.push(setTimeout(() => finish(code, "terminated by signal"), PIPE_DRAIN_MS));
    });
    const pid = child.pid;
    if (pid === undefined) return;
    timers.push(
      setTimeout(() => {
        timeout = { limitMs: limits.timeoutMs, elapsedMs: Date.now() - startedMs };
        signal(pid, "SIGTERM");
        timers.push(setTimeout(() => signal(pid, "SIGKILL"), limits.graceMs));
        timers.push(setTimeout(() => finish(null, undefined), limits.graceMs + PIPE_DRAIN_MS));
      }, limits.timeoutMs),
    );
  });
}

/** Variables of the agent harness / lore session that a clean checkout's `bun run test` never carries. */
const HARNESS_ENV_PATTERN = /^(?:CLAUDE|LORE_|ANTHROPIC_|MCP_)/;

/**
 * The environment the suite commands run with: the caller's, minus the agent-harness and lore-session variables, so the
 * run in the throwaway worktree is the run a clean shell (CI, a fresh terminal) would make. Identity, claim and
 * messaging variables of the process that launched `lore assess` must not leak into tests that spawn `dist/lore`.
 *
 * @param ambient - the invoking process's environment
 * @returns a copy without any `CLAUDE*`, `LORE_*`, `ANTHROPIC_*` or `MCP_*` variable
 */
export function suiteChildEnv(ambient: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(ambient).filter(([name]) => !HARNESS_ENV_PATTERN.test(name)));
}

function tail(text: string): string {
  return text.length <= OUTPUT_TAIL_CHARS ? text : text.slice(text.length - OUTPUT_TAIL_CHARS);
}

/** The script a single test file is re-run with (`bun run test:file <file>`); a project without it cannot re-run files. */
export const FILE_TEST_SCRIPT = "test:file";

/** The real git / filesystem / process effects of the stale-worktree pruner for the repository at `repo`. */
function realStaleWorktreePorts(repo: string, env: NodeJS.ProcessEnv): StaleWorktreePorts {
  return {
    listRegisteredWorktrees: async () => {
      const listed = await spawn("git", ["worktree", "list", "--porcelain"], repo, env);
      if (listed.status !== 0) return err({ code: "STORE_ERROR", message: `could not list worktrees: ${listed.output.trim()}` });
      return ok(listed.output.split("\n").filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length).trim()));
    },
    directoryExists: (path) => existsSync(path),
    directoryAgeMs: (path) => {
      try {
        return Date.now() - statSync(path).mtimeMs;
      } catch {
        // reason: an unreadable age is reported as unknown; the pruner keeps such a worktree (it never guesses a live run dead).
        return undefined;
      }
    },
    isProcessAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (cause) {
        // reason: EPERM means the process exists but belongs to another user: alive. Only ESRCH proves it is gone.
        return (cause as NodeJS.ErrnoException).code === "EPERM";
      }
    },
    removeDirectory: (path) => rmSync(path, { recursive: true, force: true }),
    pruneRegistrations: async () => {
      const pruned = await spawn("git", ["worktree", "prune"], repo, env);
      return pruned.status === 0 ? ok(undefined) : err({ code: "STORE_ERROR", message: `could not prune stale worktrees: ${pruned.output.trim()}` });
    },
  };
}

/**
 * Runs `work` in a throwaway detached worktree of `commit`, removed afterwards whatever happens. The ONE worktree
 * mechanic shared by the suite runs and the post-landing attestation (BR-1498).
 *
 * @param cwd - any directory inside the project's checkout
 * @param env - the environment git runs with
 * @param commit - the commit the worktree is checked out at
 * @param work - awaited with the worktree's root
 * @returns `ok(work's value)`; `err` when the worktree cannot be created or `work` throws
 */
export async function runInThrowawayWorktree<T>(
  cwd: string,
  env: NodeJS.ProcessEnv,
  commit: string,
  work: (root: string) => Promise<T>,
): Promise<Result<T, LoreError>> {
  const top = await spawn("git", ["rev-parse", "--show-toplevel"], cwd, env);
  if (top.status !== 0) return err({ code: "STORE_ERROR", message: `not inside a git checkout: ${top.output.trim()}` });
  const repo = top.output.trim();
  const pruned = await pruneStaleAssessWorktrees(realStaleWorktreePorts(repo, env));
  if (!pruned.ok) return pruned;
  // reason: the owner pid is in the directory name so ownership is recorded atomically with creation (assess-stale-worktrees.ts).
  const scratch = mkdtempSync(join(tmpdir(), assessWorktreeDirPrefix(process.pid)));
  let outcome: Result<T, LoreError>;
  try {
    const added = await spawn("git", ["worktree", "add", "--detach", scratch, commit], repo, env);
    if (added.status !== 0) {
      outcome = err({ code: "STORE_ERROR", message: `could not create the throwaway worktree: ${added.output.trim()}` });
    } else {
      outcome = ok(await work(scratch));
    }
  } catch (cause) {
    outcome = err({ code: "STORE_ERROR", message: `suite run failed unexpectedly: ${cause instanceof Error ? cause.message : String(cause)}` });
  }
  // reason: cleanup runs on every exit path and a failed removal is returned (fail loud), never ignored: a leftover
  // `lore-assess-suite-*` worktree was found after the 2026-10-29 hang.
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch (cause) {
    return err({ code: "STORE_ERROR", message: `could not remove the throwaway worktree ${scratch}: ${cause instanceof Error ? cause.message : String(cause)}` });
  }
  const prunedOwn = await spawn("git", ["worktree", "prune"], repo, env);
  if (prunedOwn.status !== 0) return err({ code: "STORE_ERROR", message: `could not prune the throwaway worktree ${scratch}: ${prunedOwn.output.trim()}` });
  return outcome;
}

/**
 * The git-backed runner for any commit: resolve a ref, re-run named test files at a commit (alone or together), open a
 * throwaway worktree. It has no full-suite verb: no review runs the suite.
 *
 * @param cwd - any directory inside the project's checkout
 * @param env - the environment the commands run with
 * @param limits - time limits of each install / build / file command (production defaults when omitted)
 * @returns a port; every method returns a Result and never throws
 */
export function createGitCommitSuiteRunner(cwd: string, env: NodeJS.ProcessEnv, limits: ProcessLimits = DEFAULT_LIMITS): CommitSuiteRunnerPort {
  const repoRootOf = async (): Promise<Result<string, LoreError>> => {
    const top = await spawn("git", ["rev-parse", "--show-toplevel"], cwd, env);
    if (top.status !== 0) return err({ code: "STORE_ERROR", message: `not inside a git checkout: ${top.output.trim()}` });
    return ok(top.output.trim());
  };

  const inThrowawayWorktree = <T>(commit: string, work: (root: string) => Promise<T>): Promise<Result<T, LoreError>> =>
    runInThrowawayWorktree(cwd, env, commit, work);

  /** One worktree per commit for the file runs of this runner's review: prepared on first use, held until `disposeWorktrees`. */
  const worktrees = new PreparedWorktreeCache(
    (commit) =>
      new Promise<Result<PreparedWorktree, LoreError>>((resolve) => {
        let release: () => void = () => undefined;
        const held = new Promise<void>((done) => {
          release = done;
        });
        // reason: `runInThrowawayWorktree` removes the worktree when its callback returns; the callback therefore parks on `held`
        // until `dispose`, which makes the shared mechanic (stale-worktree pruning, owner-pid naming, removal on every path) hold for a long-lived worktree too.
        const finished: Promise<Result<void, LoreError>> = runInThrowawayWorktree(cwd, env, commit, async (root) => {
          const prepared = await prepareDependencies(root, suiteChildEnv(env), limits);
          if (prepared !== undefined) throw new Error(prepared);
          resolve(
            ok({
              root,
              dispose: async () => {
                release();
                return finished;
              },
            }),
          );
          await held;
        });
        void finished.then((outcome) => {
          // a preparation that failed never resolved above; a resolved promise ignores this second resolve
          if (!outcome.ok) resolve(outcome);
        });
      }),
  );

  return {
    resolveCommit: async (ref) => {
      const repo = await repoRootOf();
      if (!repo.ok) return repo;
      const commit = await spawn("git", ["rev-parse", "--verify", `${ref}^{commit}`], repo.value, env);
      if (commit.status !== 0) return err({ code: "STORE_ERROR", message: `no commit \`${ref}\` to measure: ${commit.output.trim()}` });
      const sha = commit.output.trim();
      const tree = await spawn("git", ["rev-parse", "--verify", `${sha}^{tree}`], repo.value, env);
      if (tree.status !== 0) return err({ code: "STORE_ERROR", message: `no tree for commit ${sha}: ${tree.output.trim()}` });
      return ok({ commit: sha, tree: tree.output.trim() });
    },

    withWorktree: async (commit, work) => {
      const ran = await inThrowawayWorktree(commit, async (root) => {
        const prepared = await prepareDependencies(root, suiteChildEnv(env), limits);
        if (prepared !== undefined) throw new Error(prepared);
        await work(root);
      });
      return ran.ok ? ok(undefined) : ran;
    },

    // reason: #535 — every file run at a commit shares ONE prepared worktree (checkout + install once per commit per review);
    // `disposeWorktrees` removes them when the review ends. Nothing else in this runner uses the cache.
    runFiles: async (commit, files) =>
      worktrees.use(commit, async (root) => {
        const childEnv = suiteChildEnv(env);
        requireFileScript(root, commit);
        const outcomes: FileRunOutcome[] = [];
        for (const file of files) {
          const startedMs = Date.now();
          const ran = await spawn("bun", ["run", FILE_TEST_SCRIPT, file], root, childEnv, limits);
          // reason: a run the timeout ended (or whose tree could not be ended) is a failed file for a re-run (AC-AF-2) but did not
          // COMPLETE: `incomplete` lets a caller that must not read it as red (single-file bisection, BR-1496) refuse it.
          const incomplete = ran.killFailure ?? (ran.timeout !== undefined ? `timed out after ${String(ran.timeout.elapsedMs)} ms` : undefined);
          outcomes.push({ file, exit_code: ran.status, output_tail: tail(ran.output), duration_ms: Date.now() - startedMs, ...(incomplete !== undefined ? { incomplete } : {}) });
        }
        return outcomes;
      }),

    runFilesTogether: async (commit, files, options) =>
      worktrees.use(commit, (root) => runTestFilesTogether(root, commit, files, env, limits, options)),

    disposeWorktrees: () => worktrees.disposeAll(),
  };
}

/** Throws (inside a cache `use`, so it surfaces as an `err`) when the checkout's package.json has no per-file script. */
function requireFileScript(root: string, commit: string): void {
  const manifestPath = join(root, "package.json");
  const manifest = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { scripts?: Record<string, string> }) : {};
  if (manifest.scripts?.[FILE_TEST_SCRIPT] === undefined) {
    throw new Error(`package.json at ${commit} defines no "${FILE_TEST_SCRIPT}" script, so single test files cannot be re-run`);
  }
}

/**
 * Runs `files` together in ONE `bun run test:file f1 f2 ...` invocation inside the prepared checkout `root` and reports one
 * outcome per file ({@link outcomesOfTogetherRun}). This is the whole production path of `runFilesTogether` after the worktree
 * exists, exported so it can be driven against a real test runner.
 *
 * @param root - a prepared checkout holding the files and a `test:file` script
 * @param commit - the commit `root` is at (named in the missing-script error)
 * @param files - repo-relative test files
 * @param env - the environment (harness variables are removed before the spawn)
 * @param limits - time limits of the invocation
 * @param options - `buildFirst`: run `bun run build` in `root` before the tests
 * @throws when the checkout defines no `test:file` script
 */
export async function runTestFilesTogether(
  root: string,
  commit: string,
  files: readonly string[],
  env: NodeJS.ProcessEnv,
  limits: ProcessLimits = DEFAULT_LIMITS,
  options: RunBatchOptions = {},
): Promise<FileRunOutcome[]> {
  requireFileScript(root, commit);
  const startedMs = Date.now();
  if (options.buildFirst === true) {
    // reason: a selected test declares `@spawns dist/lore`; like `test:changed`, the binary is built before the tests run. A build that
    // fails or does not complete says nothing about any test, so every file is `incomplete`, never red or green.
    const built = await spawn("bun", ["run", "build"], root, suiteChildEnv(env), limits);
    const buildIncomplete = built.killFailure ?? (built.timeout !== undefined ? `the build timed out after ${String(built.timeout.elapsedMs)} ms` : undefined);
    if (built.status !== 0 || buildIncomplete !== undefined) {
      const why = buildIncomplete ?? `\`bun run build\` exited ${String(built.status)}: ${tail(built.output).trim().split("\n").at(-1) ?? ""}`;
      return outcomesOfTogetherRun(files, { status: 1, output: built.output, durationMs: Date.now() - startedMs, incomplete: why });
    }
  }
  const ran = await spawn("bun", ["run", FILE_TEST_SCRIPT, ...files], root, suiteChildEnv(env), limits);
  const incomplete = ran.killFailure ?? (ran.timeout !== undefined ? `timed out after ${String(ran.timeout.elapsedMs)} ms` : undefined);
  return outcomesOfTogetherRun(files, { status: ran.status, output: ran.output, durationMs: Date.now() - startedMs, ...(incomplete !== undefined ? { incomplete } : {}) });
}

/**
 * The per-file outcomes of ONE invocation that ran `files` together (`bun run test:file f1 f2 ...`).
 *
 * reason: exit 0 = every file passed; exit 1 = some failed and the failing files are read from the runner's own output
 * (`parseFailingTestFiles`); an exit-1 run from which no requested file can be read as failing says nothing about any file
 * and is `incomplete`, never "all green" and never "all red". Any other exit is no test result and is reported as is.
 *
 * @param files - the files the invocation was given
 * @param run - the invocation's exit status, merged output, duration and, when it did not complete, why
 */
export function outcomesOfTogetherRun(
  files: readonly string[],
  run: { readonly status: number; readonly output: string; readonly durationMs: number; readonly incomplete?: string },
): FileRunOutcome[] {
  const outputTail = tail(run.output);
  const outcome = (file: string, exitCode: number, incomplete?: string): FileRunOutcome => ({
    file,
    exit_code: exitCode,
    output_tail: outputTail,
    duration_ms: run.durationMs,
    ...(incomplete !== undefined ? { incomplete } : {}),
  });
  if (run.incomplete !== undefined) return files.map((file) => outcome(file, 1, run.incomplete));
  if (run.status === 0) return files.map((file) => outcome(file, 0));
  if (run.status !== 1) return files.map((file) => outcome(file, run.status));
  // reason: a runner that colours its output (FORCE_COLOR) wraps `FAIL` and the path in escape codes; the line pattern needs plain text.
  const failing = parseFailingTestFiles(run.output.replace(ANSI_COLOR, ""));
  const isFailing = (file: string): boolean => failing.some((f) => f === file || f.endsWith(`/${file}`) || file.endsWith(`/${f}`));
  if (!files.some(isFailing)) {
    return files.map((file) => outcome(file, 1, "the batched run failed (exit 1) but no failing test file could be read from its output"));
  }
  return files.map((file) => outcome(file, isFailing(file) ? 1 : 0));
}

/** Installs dependencies in a fresh worktree when the project has some; returns the failure text, or `undefined` when ready. */
export async function prepareDependencies(root: string, env: NodeJS.ProcessEnv, limits: ProcessLimits = DEFAULT_LIMITS): Promise<string | undefined> {
  const manifestPath = join(root, "package.json");
  if (!existsSync(manifestPath)) return undefined;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { dependencies?: object; devDependencies?: object };
  const hasDependencies = Object.keys(manifest.dependencies ?? {}).length + Object.keys(manifest.devDependencies ?? {}).length > 0;
  if (!hasDependencies || existsSync(join(root, "node_modules"))) return undefined;
  const installed = await spawn("bun", ["install", "--frozen-lockfile"], root, env, limits);
  return installed.status === 0 ? undefined : `dependency install in the throwaway worktree failed: ${tail(installed.output).trim()}`;
}
