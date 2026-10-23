/**
 * The real `SuiteRunnerPort` behind `lore assess`: the plan-close chain and the full test suite, run ONCE per batch on
 * main's HEAD in a throwaway worktree (BR-1372, spec-lean-governance-batch-verbs-judgment-only-at-milestones Part D).
 *
 * Purpose: give every plan's regression dimension the same measured run, without ever running the suite in the shared
 *   checkout and without writing the repo's `.lore`.
 * Public surface: createGitSuiteRunner, PLAN_CLOSE_SCRIPT, FULL_TEST_SCRIPT, resolveDirectImports.
 * Invariants:
 *   - The commands are the project's own package.json scripts (`check:plan-close`, `test`) run with `bun run`; a script
 *     the project does not define is reported as skipped with that reason, never invented.
 *   - The run happens in `git worktree add --detach <tmp> main`; the worktree is removed afterwards, success or not.
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
 * @returns a port whose `run` measures main's HEAD once per call; never throws
 */
export function createGitSuiteRunner(cwd: string, env: NodeJS.ProcessEnv): SuiteRunnerPort {
  return {
    run: async (): Promise<Result<SuiteRun, LoreError>> => {
      const top = spawn("git", ["rev-parse", "--show-toplevel"], cwd, env);
      if (top.status !== 0) return notMeasured(`not inside a git checkout: ${top.output.trim()}`);
      const repoRoot = top.output.trim();
      const head = spawn("git", ["rev-parse", "--verify", "main^{commit}"], repoRoot, env);
      if (head.status !== 0) return notMeasured(`no \`main\` branch to measure: ${head.output.trim()}`);
      const commit = head.output.trim();

      const scratch = mkdtempSync(join(tmpdir(), "lore-assess-suite-"));
      try {
        const added = spawn("git", ["worktree", "add", "--detach", scratch, commit], repoRoot, env);
        if (added.status !== 0) return notMeasured(`could not create the throwaway worktree: ${added.output.trim()}`);
        return ok(measure(scratch, commit, env));
      } catch (cause) {
        return err({ code: "STORE_ERROR", message: `suite run failed unexpectedly: ${cause instanceof Error ? cause.message : String(cause)}` });
      } finally {
        rmSync(scratch, { recursive: true, force: true });
        spawn("git", ["worktree", "prune"], repoRoot, env);
      }
    },
  };
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
  const hasDependencies = Object.keys(manifest.dependencies ?? {}).length + Object.keys(manifest.devDependencies ?? {}).length > 0;
  if (hasDependencies && !existsSync(join(root, "node_modules"))) {
    const installed = spawn("bun", ["install", "--frozen-lockfile"], root, env);
    if (installed.status !== 0) {
      return { status: "not_measured", reason: `dependency install in the throwaway worktree failed: ${tail(installed.output).trim()}` };
    }
  }
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
