/**
 * Test fixture: the stored done contract, landing record and runner-attested rows that a service-level unit test of
 * `TaskWorkflowService.done` needs now that `done` judges only the contract stored at approve
 * (spec-done-contract-compiled-at-approve-task-kinds-write-sets, AC-DCS1-7, AC-DCS1-27).
 *
 * Purpose: a unit test builds its tasks through `CorpusService.create`, which never compiles a contract (that is
 * `ReviewService.approve`'s job and has its own tests), so this file writes the SAME shapes the compile and `lore integrate`
 * store: `extra.done_contract`, `extra.landing` and a pass row whose attestation names the landing it was recorded for
 * (`recorded_at_landing`, the evidence rule of AC-DCS1-27 (b)). No git is needed for a task that is never claimed.
 * A test that holds a claim (the foreign-claim floor) uses {@link makeNoChangeRepo}: a real repository whose branch sits on
 * main's head, so the landing predicate measures it as landed without any commit.
 *
 * Public surface: {@link LANDING_COMMIT}, {@link TYPECHECK_COMMAND}, {@link testFileCommand}, {@link unitDoneContract},
 *   {@link landedTaskExtra}, {@link landedPass}, {@link makeNoChangeRepo}.
 * Invariants: pure data except {@link makeNoChangeRepo}; every sha is 40 lowercase hex so the stored schemas accept it.
 * Side-effect class: IO only in {@link makeNoChangeRepo} (a temp directory and `git`).
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DoneContract } from "@lore/core";
import type { VerifiedEvidenceInput } from "../../../src/service/task-workflow-service.js";

/** The landing commit every fixture landing and every landed pass row names. */
export const LANDING_COMMIT = "c".repeat(40);

/** The command of the `typecheck` oracle, as `workflow.done_contract.typecheck` compiles it in this repository. */
export const TYPECHECK_COMMAND = "bun run typecheck";

/**
 * The command a `test:<path>` oracle runs unfiltered (the `workflow.done_contract.test_file` template of this repository).
 *
 * @param path - the repo-relative test file
 */
export function testFileCommand(path: string): string {
  return `bun run test:file ${path}`;
}

/** Options of {@link unitDoneContract}. */
export interface UnitContractOptions {
  /** `true` stores `red_required: true`; the default waives it with a reason, as `lore approve --red-waiver` does. */
  readonly redRequired?: boolean;
  /** Anchored test files; each adds a `test:<path>` oracle running {@link testFileCommand}. */
  readonly testFiles?: readonly string[];
}

/**
 * A valid stored contract of a `code` task: the `typecheck` oracle plus one `test:` oracle per test file.
 *
 * @param options - red requirement and anchored test files
 * @returns the object `extra.done_contract` holds
 */
export function unitDoneContract(options: UnitContractOptions = {}): DoneContract {
  const redRequired = options.redRequired === true;
  return {
    compiled_at_commit: "0".repeat(40),
    kind: "code",
    base_branch: "main",
    oracles: [
      { id: "typecheck", command: TYPECHECK_COMMAND },
      ...(options.testFiles ?? []).map((path) => ({ id: `test:${path}`, command: testFileCommand(path) })),
    ],
    red_required: redRequired,
    ...(redRequired ? {} : { red_waiver_reason: "unit fixture: this task adds no new test" }),
    landing_route: "main",
    new_symbols: [],
    added_oracles: [],
  };
}

/**
 * The `extra` of a landed `code` task: its kind, stored contract and landing record. Spread it into the `extra` of
 * `CorpusService.create` (together with `plan_id`).
 *
 * @param options - red requirement and anchored test files of the contract
 */
export function landedTaskExtra(options: UnitContractOptions = {}): Record<string, unknown> {
  return {
    kind: "code",
    done_contract: unitDoneContract(options),
    landing: {
      branch: "feat/x",
      branch_head: LANDING_COMMIT,
      main_before: "b".repeat(40),
      main_after: LANDING_COMMIT,
      landing_commit: LANDING_COMMIT,
      recorded_at: "2026-10-30T00:00:00.000Z",
      kind: "commits",
      start_head: "b".repeat(40),
      tip: LANDING_COMMIT,
      integration_head: LANDING_COMMIT,
      measured_at: "2026-10-30T00:00:00.000Z",
    },
  };
}

/**
 * A runner-attested pass of `command` that counts for a code oracle: it names the landing it was recorded for.
 *
 * @param command - the oracle's exact command (default: the typecheck oracle)
 * @param overrides - fields to change
 */
export function landedPass(command: string = TYPECHECK_COMMAND, overrides: Partial<VerifiedEvidenceInput> = {}): VerifiedEvidenceInput {
  return {
    oracle: command === TYPECHECK_COMMAND ? "tsc" : "test",
    command,
    result: "pass",
    recorded_by: "runner",
    capture_source: "runner",
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false, recorded_at_landing: LANDING_COMMIT },
    ...overrides,
  };
}

/** A real repository with one commit on `main` and a branch that points at it (so the branch has no work of its own). */
export interface NoChangeRepo {
  /** The repository path (symlinks resolved). */
  readonly dir: string;
  /** The branch name; claim a task with `worktree: branch`. */
  readonly branch: string;
  /** Removes the repository. */
  dispose(): void;
}

/**
 * Makes a throwaway repository (never this repository) with `main` and a branch on main's head.
 *
 * @param branch - the branch name
 * @throws Error when a git command fails (a fixture fault, never silent)
 */
export function makeNoChangeRepo(branch = "feat/x"): NoChangeRepo {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-unit-nochange-")));
  const env = { ...process.env, GIT_AUTHOR_NAME: "Tester", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "Tester", GIT_COMMITTER_EMAIL: "t@example.com" };
  const git = (...args: string[]): void => {
    const result = spawnSync("git", args, { cwd: dir, env, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  };
  git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  git("add", "seed.txt");
  git("commit", "-q", "-m", "seed");
  git("branch", branch);
  return { dir, branch, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}
