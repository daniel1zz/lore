/**
 * Throwaway consumer-corpus fixture for report-issue channel tests that spawn
 * the COMPILED `dist/lore` binary against a stub `gh` (`recording-gh-stub.ts`).
 *
 * Public surface:
 *   - `DIST_LORE`, `WORKTREE_ROOT` — the worktree-anchored binary (never the main checkout's).
 *   - `assertBinaryFresh()` — fails loud on a missing/stale `dist/lore`; dist is built ONCE
 *     per run by the runner (TG-24), a test never rebuilds it.
 *   - `runLore(args, opts)` — one synchronous spawn: `CLAUDECODE=1`, `LORE_CONFIG_HOME`
 *     pinned to a throwaway dir (the machine's real global config is never consulted),
 *     `PATH` pinned to JUST the stub directory, so a real `gh` can never be reached.
 *   - `makeConsumerCorpus(opts)` — `mkdtemp` + `lore init` + a root PRD + `feedback`
 *     config; never this repo's own `.lore/`.
 *   - `removeDirs(dirs)` — best-effort cleanup.
 *
 * Side-effect class: IO (temp directories, process spawns).
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertFreshBinary } from "./assert-fresh-binary";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";

export const WORKTREE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
export const DIST_LORE = join(WORKTREE_ROOT, "dist", "lore");
export const TMP_ROOT = tmpdir();

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface RunOptions {
  readonly cwd: string;
  /** Directory holding the stub `gh`; becomes the child's entire PATH. */
  readonly ghStubDir: string;
  readonly configHome: string;
  readonly actor?: string;
}

/** Fails loud when `dist/lore` is missing or older than the sources it compiles. */
export function assertBinaryFresh(): void {
  assertFreshBinary(DIST_LORE, [join(WORKTREE_ROOT, "packages", "lore", "src"), join(WORKTREE_ROOT, "packages", "core", "src")]);
}

/** One synchronous `dist/lore <args>` spawn against a throwaway corpus and a stub `gh`. */
export function runLore(args: readonly string[], options: RunOptions): RunResult {
  if (!options.cwd.startsWith(TMP_ROOT)) {
    throw new Error(`Refusing to run outside ${TMP_ROOT}: ${options.cwd}`);
  }
  const proc = Bun.spawnSync([DIST_LORE, ...args], {
    cwd: options.cwd,
    env: {
      ...process.env,
      CLAUDECODE: "1",
      LORE_CONFIG_HOME: options.configHome,
      PATH: options.ghStubDir,
      LORE_ACTOR: options.actor ?? "agent:report-issue-channel-test",
    },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

export interface ConsumerCorpusOptions {
  readonly ghStubDir: string;
  readonly configHome: string;
  /** The `feedback:` YAML block appended to `.lore/config.yaml`; `null` leaves the corpus unconfigured. */
  readonly feedbackYaml: string | null;
  readonly prefix: string;
}

/** `lore init` + a root PRD + the given `feedback:` block inside a fresh temp dir; returns its path. */
export function makeConsumerCorpus(options: ConsumerCorpusOptions): string {
  const root = mkdtempSync(join(TMP_ROOT, `lore-${options.prefix}-`));
  const base: RunOptions = { cwd: root, ghStubDir: options.ghStubDir, configHome: options.configHome };

  const init = runLore(["init"], base);
  if (init.exitCode !== 0) throw new Error(`'lore init' failed (exit ${init.exitCode}): ${init.stderr}`);
  const prd = runLore(
    ["create", "prd", "--title", `${options.prefix} throwaway root PRD`, "--content", "Throwaway root PRD for a report-issue channel test."],
    base,
  );
  if (prd.exitCode !== 0) throw new Error(`root PRD creation failed (exit ${prd.exitCode}): ${prd.stderr}`);

  if (options.feedbackYaml !== null) {
    patchLoreConfig(root, options.feedbackYaml);
  }
  return root;
}

/** The standard flags of one filing; `title` varies per call. */
export function filingArgs(title: string, severity: string, category: string): string[] {
  return [
    "report-issue",
    "--title",
    title,
    "--description",
    `${title} description`,
    "--expected",
    "expected behaviour",
    "--actual",
    "actual behaviour",
    "--severity",
    severity,
    "--category",
    category,
  ];
}

/** Best-effort removal of throwaway directories. */
export function removeDirs(dirs: readonly (string | undefined)[]): void {
  for (const dir of dirs) {
    if (dir === undefined) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // reason: best-effort scratch cleanup only.
    }
  }
}
