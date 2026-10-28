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
 *   - A run that cannot be set up (no `main`, no git, install failure) is `not_measured` with the reason, never a pass.
 *   - Failing test files carry their direct relative imports as read at the measured commit, so attribution to a plan
 *     needs no second checkout.
 * Side-effect class: IO (spawns git/bun, creates and removes a temp directory).
 *
 * Reference: Kayenta automated canary analysis; `git worktree` for isolated builds.
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D, AC-LG-12, BR-1372)
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

/** The plan-close chain script (`bun run check:plan-close`). */
export const PLAN_CLOSE_SCRIPT = "check:plan-close";
/** The full test script (`bun run test`). */
export const FULL_TEST_SCRIPT = "test";

const OUTPUT_TAIL_CHARS = 4000;
const MAX_BUFFER = 256 * 1024 * 1024;
const SUITE_TIMEOUT_MS = 60 * 60 * 1000;
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"] as const;

interface Spawned {
  readonly status: number;
  readonly output: string;
}

function spawn(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Spawned {
  const result = spawnSync(command, [...args], { cwd, env, encoding: "utf8", maxBuffer: MAX_BUFFER, timeout: SUITE_TIMEOUT_MS });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  // reason: a spawn that never started (ENOENT) or was killed has status null; it is a failure with its own message.
  if (result.status === null) return { status: 1, output: `${output}\n${result.error?.message ?? "terminated by signal"}` };
  return { status: result.status, output };
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
  const top = spawn("git", ["rev-parse", "--show-toplevel"], cwd, env);
  if (top.status !== 0) return err({ code: "STORE_ERROR", message: `not inside a git checkout: ${top.output.trim()}` });
  const repo = top.output.trim();
  const scratch = mkdtempSync(join(tmpdir(), "lore-assess-suite-"));
  try {
    const added = spawn("git", ["worktree", "add", "--detach", scratch, commit], repo, env);
    if (added.status !== 0) {
      return err({ code: "STORE_ERROR", message: `could not create the throwaway worktree: ${added.output.trim()}` });
    }
    return ok(await work(scratch));
  } catch (cause) {
    return err({ code: "STORE_ERROR", message: `suite run failed unexpectedly: ${cause instanceof Error ? cause.message : String(cause)}` });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    spawn("git", ["worktree", "prune"], repo, env);
  }
}

/**
 * The same measurement as {@link createGitSuiteRunner}, generalised to any commit: resolve a ref, run the suite at a
 * commit, re-run named test files at a commit. What is run does not change: `check:plan-close` then `test`, in a
 * throwaway worktree of that commit, under the harness-free environment.
 *
 * @param cwd - any directory inside the project's checkout
 * @param env - the environment the commands run with
 * @returns a port; every method returns a Result and never throws
 */
export function createGitCommitSuiteRunner(cwd: string, env: NodeJS.ProcessEnv): CommitSuiteRunnerPort {
  const repoRootOf = (): Result<string, LoreError> => {
    const top = spawn("git", ["rev-parse", "--show-toplevel"], cwd, env);
    if (top.status !== 0) return err({ code: "STORE_ERROR", message: `not inside a git checkout: ${top.output.trim()}` });
    return ok(top.output.trim());
  };

  const inThrowawayWorktree = <T>(commit: string, work: (root: string) => Promise<T>): Promise<Result<T, LoreError>> =>
    runInThrowawayWorktree(cwd, env, commit, work);

  return {
    resolveCommit: async (ref) => {
      const repo = repoRootOf();
      if (!repo.ok) return repo;
      const commit = spawn("git", ["rev-parse", "--verify", `${ref}^{commit}`], repo.value, env);
      if (commit.status !== 0) return err({ code: "STORE_ERROR", message: `no commit \`${ref}\` to measure: ${commit.output.trim()}` });
      const sha = commit.output.trim();
      const tree = spawn("git", ["rev-parse", "--verify", `${sha}^{tree}`], repo.value, env);
      if (tree.status !== 0) return err({ code: "STORE_ERROR", message: `no tree for commit ${sha}: ${tree.output.trim()}` });
      return ok({ commit: sha, tree: tree.output.trim() });
    },

    runSuite: async (commit, inWorktree) => {
      const ran = await inThrowawayWorktree(commit, async (root) => {
        const measured = measure(root, commit, suiteChildEnv(env));
        if (inWorktree !== undefined) await inWorktree(root, commit);
        return measured;
      });
      // reason: a run that cannot be set up is `not_measured` with the reason (never a pass); an unexpected failure stays an err.
      if (!ran.ok && ran.error.code === "STORE_ERROR" && loreErrorText(ran.error).startsWith("could not create the throwaway worktree")) {
        return notMeasured(loreErrorText(ran.error));
      }
      return ran;
    },

    runFiles: async (commit, files) =>
      inThrowawayWorktree(commit, async (root) => {
        const childEnv = suiteChildEnv(env);
        const prepared = prepareDependencies(root, childEnv);
        if (prepared !== undefined) throw new Error(prepared);
        const manifestPath = join(root, "package.json");
        const manifest = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { scripts?: Record<string, string> }) : {};
        if (manifest.scripts?.[FILE_TEST_SCRIPT] === undefined) {
          throw new Error(`package.json at ${commit} defines no "${FILE_TEST_SCRIPT}" script, so single test files cannot be re-run`);
        }
        const outcomes: FileRunOutcome[] = [];
        for (const file of files) {
          const startedMs = Date.now();
          const ran = spawn("bun", ["run", FILE_TEST_SCRIPT, file], root, childEnv);
          outcomes.push({ file, exit_code: ran.status, output_tail: tail(ran.output), duration_ms: Date.now() - startedMs });
        }
        return outcomes;
      }),
  };
}

/** Installs dependencies in a fresh worktree when the project has some; returns the failure text, or `undefined` when ready. */
export function prepareDependencies(root: string, env: NodeJS.ProcessEnv): string | undefined {
  const manifestPath = join(root, "package.json");
  if (!existsSync(manifestPath)) return undefined;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { dependencies?: object; devDependencies?: object };
  const hasDependencies = Object.keys(manifest.dependencies ?? {}).length + Object.keys(manifest.devDependencies ?? {}).length > 0;
  if (!hasDependencies || existsSync(join(root, "node_modules"))) return undefined;
  const installed = spawn("bun", ["install", "--frozen-lockfile"], root, env);
  return installed.status === 0 ? undefined : `dependency install in the throwaway worktree failed: ${tail(installed.output).trim()}`;
}

function measure(root: string, commit: string, env: NodeJS.ProcessEnv): SuiteRun {
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
  const prepared = prepareDependencies(root, env);
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
    const ran = spawn("bun", ["run", script], root, env);
    combined += `\n${ran.output}`;
    commands.push({ command, exit_code: ran.status, output_tail: tail(ran.output) });
  }
  const failing: FailingTestFile[] = parseFailingTestFiles(combined).map((file) => ({ file, imports: resolveDirectImports(root, file) }));
  return { status: "measured", commit, commands, skipped, failing_test_files: failing };
}
