/**
 * The real `SuiteRunnerPort` behind `lore assess`: the plan-close chain and the full test suite, run ONCE per batch on
 * main's HEAD in a throwaway worktree (BR-1372, spec-lean-governance-batch-verbs-judgment-only-at-milestones Part D).
 *
 * Purpose: give every plan's regression dimension the same measured run, without ever running the suite in the shared
 *   checkout and without writing the repo's `.lore`.
 * Public surface: createGitSuiteRunner (main's HEAD), createGitCommitSuiteRunner (any commit: resolve, run the suite,
 *   re-run named test files; BR-1497), suiteChildEnv, PLAN_CLOSE_SCRIPT, FULL_TEST_SCRIPT, FILE_TEST_SCRIPT, resolveDirectImports.
 * Invariants:
 *   - The commands are the project's own package.json scripts (`check:plan-close`, `test`) run with `bun run`; a script
 *     the project does not define is reported as skipped with that reason, never invented.
 *   - The run happens in `git worktree add --detach <tmp> main`; the worktree is removed afterwards, success or not.
 *   - The suite commands run with the harness/session variables removed (`suiteChildEnv`), like a clean shell.
 *   - Every command runs in its OWN process group; a timeout ends the whole group (SIGTERM, then SIGKILL after a grace), so
 *     the run returns within timeout + grace and no process of the tree survives. A timed-out suite is `not_measured` with
 *     "timed out after N ms" (stored `unrunnable`, retried by a later batch, BR-1497); a timed-out per-file re-run is a failed file with `incomplete` set.
 *   - A failed group signal never escapes a timer callback (it would leave the promise unsettled): EPERM is followed by a
 *     liveness probe (macOS returns EPERM for a group holding only unreaped zombies); no live member = ended, otherwise the
 *     failure is recorded in the result (`killFailure`), the run is `not_measured` / a failed file with that cause.
 *   - The throwaway worktree is removed on every exit path; a failed removal is returned as an error, never ignored.
 *   - A run that was killed leaves its worktree behind; every run first removes the registered `lore-assess-suite-*` worktrees
 *     whose directory is gone or whose owner pid (recorded in the directory name) is not alive, and never one a live process
 *     owns (`assess-stale-worktrees.ts`). A per-file re-run that times out or leaves its process group running is a
 *     failed file whose outcome carries `incomplete` (single-file bisection refuses it, BR-1496).
 *   - `bun run test` takes the checkout's oracle lock (keyed by the git common dir, shared by every worktree including this
 *     throwaway one). A run that finds it held exits 5 without running a test: the runner waits for the lock (poll
 *     `lockPollMs`, bounded by the suite timeout) and retries; if it is still held at the limit the run is `not_measured`
 *     naming the lock. It never runs without the lock and never reports the non-run as a result.
 *   - A run that cannot be set up (no `main`, no git, install failure) is `not_measured` with the reason, never a pass.
 *   - Failing test files carry their direct relative imports as read at the measured commit, so attribution to a plan
 *     needs no second checkout.
 * Side-effect class: IO (spawns git/bun, creates and removes a temp directory).
 *
 * Reference: Kayenta automated canary analysis; `git worktree` for isolated builds.
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D, AC-LG-12, BR-1372)
 */

import { execFileSync, spawn as spawnChild } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { err, ok, type LoreError, type Result } from "@lore/core";
import {
  parseFailingTestFiles,
  type FailingTestFile,
  type SuiteCommandResult,
  type SuiteRun,
  type SuiteRunnerPort,
} from "../../service/milestone-review-inputs.js";
import { loreErrorText, type CommitSuiteRunnerPort, type FileRunOutcome } from "../../service/suite-result-service.js";
import { assessWorktreeDirPrefix, pruneStaleAssessWorktrees, type StaleWorktreePorts } from "./assess-stale-worktrees.js";

/** The plan-close chain script (`bun run check:plan-close`). */
export const PLAN_CLOSE_SCRIPT = "check:plan-close";
/** The full test script (`bun run test`). */
export const FULL_TEST_SCRIPT = "test";

const OUTPUT_TAIL_CHARS = 4000;
/** Per-command output kept in memory (the tail): enough for failing-file parsing, bounded against a runaway child. */
const MAX_OUTPUT_CHARS = 16 * 1024 * 1024;
const SUITE_TIMEOUT_MS = 60 * 60 * 1000;
/** After SIGTERM to the process group, how long the group may take to leave before SIGKILL. */
const KILL_GRACE_MS = 10 * 1000;
/** After the child exited or the group was killed, how long to wait for the stdio pipes before closing them ourselves. */
const PIPE_DRAIN_MS = 2000;
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"] as const;

/** Time limits of one spawned command; the defaults are the production values. */
export interface ProcessLimits {
  /** Wall time after which the command's whole process group is ended. */
  readonly timeoutMs: number;
  /** Time between SIGTERM and SIGKILL of the process group. */
  readonly graceMs: number;
  /** The group-signal primitive (`process.kill(-pid, signal)`); injectable so tests can make it fail. */
  readonly kill?: (pid: number, signal: NodeJS.Signals) => void;
  /** How long to wait between attempts to take a contended oracle lock (default {@link LOCK_POLL_MS}); injectable so tests need not sleep. */
  readonly lockPollMs?: number;
}

/** Between two attempts to take the checkout's oracle lock held by another run. */
const LOCK_POLL_MS = 5 * 1000;

/** `scripts/oracle-lock.ts` exits 5 and prints this when a live run holds the lock: no test ran. */
function isLockContended(ran: { readonly status: number; readonly output: string; readonly timeout?: unknown }): boolean {
  return ran.status === 5 && ran.timeout === undefined && /oracle-lock: contended/.test(ran.output);
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

function notMeasured(reason: string): Result<SuiteRun, LoreError> {
  return ok({ status: "not_measured", reason });
}

function tail(text: string): string {
  return text.length <= OUTPUT_TAIL_CHARS ? text : text.slice(text.length - OUTPUT_TAIL_CHARS);
}

/**
 * The files a source file imports directly through a relative specifier, repo-relative, only those that exist.
 *
 * @param root - the checkout the file is read from
 * @param file - repo-relative path of the file
 * @returns repo-relative paths (`./x.js` resolves to `x.ts` when only that exists)
 */
export function resolveDirectImports(root: string, file: string): string[] {
  const absolute = join(root, file);
  if (!existsSync(absolute)) return [];
  const source = readFileSync(absolute, "utf8");
  const specifiers = new Set<string>();
  for (const match of source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g)) {
    if (match[1] !== undefined) specifiers.add(match[1]);
  }
  const found = new Set<string>();
  for (const specifier of specifiers) {
    const base = normalize(join(dirname(file), specifier));
    const stem = base.replace(/\.(?:[cm]?js|jsx)$/, "");
    const candidates = [
      base,
      ...SOURCE_EXTENSIONS.map((ext) => `${stem}${ext}`),
      ...SOURCE_EXTENSIONS.map((ext) => join(base, `index${ext}`)),
    ];
    const hit = candidates.find((candidate) => existsSync(join(root, candidate)) && !candidate.endsWith("/"));
    if (hit !== undefined) found.add(hit);
  }
  return [...found];
}

/**
 * Builds the git-backed runner.
 *
 * @param cwd - any directory inside the project's checkout
 * @param env - the environment the commands run with
 * @param inWorktree - optional work done in the SAME throwaway worktree after the measurement
 * @returns a port whose `run` measures main's HEAD once per call; never throws
 */
export function createGitSuiteRunner(
  cwd: string,
  env: NodeJS.ProcessEnv,
  /** Awaited after the suite was measured while the throwaway worktree still exists (stale-evidence refresh). */
  inWorktree?: (root: string, commit: string) => Promise<void>,
): SuiteRunnerPort {
  const runner = createGitCommitSuiteRunner(cwd, env);
  return {
    run: async (): Promise<Result<SuiteRun, LoreError>> => {
      const resolved = await runner.resolveCommit("main");
      if (!resolved.ok) return notMeasured(loreErrorText(resolved.error));
      return runner.runSuite(resolved.value.commit, inWorktree);
    },
  };
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
 * The same measurement as {@link createGitSuiteRunner}, generalised to any commit: resolve a ref, run the suite at a
 * commit, re-run named test files at a commit. What is run does not change: `check:plan-close` then `test`, in a
 * throwaway worktree of that commit, under the harness-free environment.
 *
 * @param cwd - any directory inside the project's checkout
 * @param env - the environment the commands run with
 * @param limits - time limits of each suite / install / per-file command (production defaults when omitted)
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

    runSuite: async (commit, inWorktree) => {
      const ran = await inThrowawayWorktree(commit, async (root) => {
        const measured = await measure(root, commit, suiteChildEnv(env), limits);
        if (inWorktree !== undefined) await inWorktree(root, commit);
        return measured;
      });
      // reason: a run that cannot be set up is `not_measured` with the reason (never a pass); an unexpected failure stays an err.
      if (!ran.ok && ran.error.code === "STORE_ERROR" && loreErrorText(ran.error).startsWith("could not create the throwaway worktree")) {
        return notMeasured(loreErrorText(ran.error));
      }
      return ran;
    },

    withWorktree: async (commit, work) => {
      const ran = await inThrowawayWorktree(commit, async (root) => {
        const prepared = await prepareDependencies(root, suiteChildEnv(env), limits);
        if (prepared !== undefined) throw new Error(prepared);
        await work(root);
      });
      return ran.ok ? ok(undefined) : ran;
    },

    runFiles: async (commit, files) =>
      inThrowawayWorktree(commit, async (root) => {
        const childEnv = suiteChildEnv(env);
        const prepared = await prepareDependencies(root, childEnv, limits);
        if (prepared !== undefined) throw new Error(prepared);
        const manifestPath = join(root, "package.json");
        const manifest = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { scripts?: Record<string, string> }) : {};
        if (manifest.scripts?.[FILE_TEST_SCRIPT] === undefined) {
          throw new Error(`package.json at ${commit} defines no "${FILE_TEST_SCRIPT}" script, so single test files cannot be re-run`);
        }
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
  };
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

async function measure(root: string, commit: string, env: NodeJS.ProcessEnv, limits: ProcessLimits): Promise<SuiteRun> {
  const manifestPath = join(root, "package.json");
  if (!existsSync(manifestPath)) {
    return {
      status: "measured",
      commit,
      commands: [],
      skipped: [PLAN_CLOSE_SCRIPT, FULL_TEST_SCRIPT].map((c) => ({ command: `bun run ${c}`, reason: "the project has no package.json at main" })),
      failing_test_files: [],
    };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    scripts?: Record<string, string>;
    dependencies?: object;
    devDependencies?: object;
  };
  const prepared = await prepareDependencies(root, env, limits);
  if (prepared !== undefined) return { status: "not_measured", reason: prepared };
  const commands: SuiteCommandResult[] = [];
  const skipped: { command: string; reason: string }[] = [];
  let combined = "";
  for (const script of [PLAN_CLOSE_SCRIPT, FULL_TEST_SCRIPT]) {
    const command = `bun run ${script}`;
    if (manifest.scripts?.[script] === undefined) {
      skipped.push({ command, reason: `package.json defines no "${script}" script` });
      continue;
    }
    let ran = await spawn("bun", ["run", script], root, env, limits);
    if (script === FULL_TEST_SCRIPT) {
      // reason: `bun run test` takes the oracle lock of the CHECKOUT (keyed by the git common dir, shared by every worktree incl. this
      // throwaway one, on purpose: AC-OX-4). Another run holding it makes ours exit 5 without running a test. We WAIT for the lock,
      // bounded by the suite timeout, rather than run without it (the lock also guards fixed paths no worktree isolates) and never
      // record the non-run as a result.
      const deadline = Date.now() + limits.timeoutMs;
      const pollMs = limits.lockPollMs ?? LOCK_POLL_MS;
      while (isLockContended(ran) && Date.now() + pollMs < deadline) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        ran = await spawn("bun", ["run", script], root, env, limits);
      }
      if (isLockContended(ran)) {
        return { status: "not_measured", reason: `\`${command}\` could not take the oracle lock before the ${limits.timeoutMs} ms limit: ${tail(ran.output).trim().split("\n").at(-1) ?? "held by another run"}` };
      }
    }
    // reason: a run the timeout ended is incomplete, not red: stored `unrunnable` with this cause and retried by a later batch (BR-1497).
    if (ran.killFailure !== undefined) {
      // reason: a tree that could not be ended leaves stragglers that corrupt the measurement; incomplete, not red (A10).
      return { status: "not_measured", reason: `\`${command}\` left its process group running: ${ran.killFailure}` };
    }
    if (ran.timeout !== undefined) {
      return { status: "not_measured", reason: `\`${command}\` timed out after ${ran.timeout.elapsedMs} ms (limit ${ran.timeout.limitMs} ms); its process group was ended` };
    }
    combined += `\n${ran.output}`;
    commands.push({ command, exit_code: ran.status, output_tail: tail(ran.output) });
  }
  const failing: FailingTestFile[] = parseFailingTestFiles(combined).map((file) => ({ file, imports: resolveDirectImports(root, file) }));
  return { status: "measured", commit, commands, skipped, failing_test_files: failing };
}
