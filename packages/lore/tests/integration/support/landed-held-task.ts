/**
 * Integration-test helper: a task held by a run, at the point where only the holder check of `lore done` is left.
 *
 * Purpose: the holder check is the LAST floor of `lore done` (BR-209), so a test of it needs a task that met the floors before it: a
 * code task approved with its contract, claimed on a branch of its own by `run`, landed on main and holding a runner pass for every
 * contract oracle. This replaces the retired attestation override those tests used only to get past the evidence floors.
 *
 * Public surface: {@link landHeldTask}, {@link HeldTaskStages}.
 * Invariants: only for a corpus made with `createCorpus({ gitBacked: true })`; the shared checkout is left detached at main when landed.
 * Side-effect class: IO (git in the fixture repository, `lore` as a spawned process).
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { registerRun, runLore, type Corpus } from "../cli/support/claim-run-fixture.js";
import { landTask } from "./land-task.js";

/** Which stages to run after the claim. */
export interface HeldTaskStages {
  /** `false` stops after the claim (no commit, no landing, no pass). Default `true`. */
  readonly land?: boolean;
}

let heldSeq = 0;

/**
 * @param corpus - a git-backed corpus
 * @param wtRoot - an existing directory the linked worktree is created under
 * @param run - the run that holds the claim (registered here), or `undefined` for the default test run
 * @param name - the writer name every call is made as
 * @param stages - which stages to run
 * @returns the task slug and the linked worktree path
 */
export async function landHeldTask(
  corpus: Corpus,
  wtRoot: string,
  run: string | undefined,
  name: string,
  stages: HeldTaskStages = {},
): Promise<{ slug: string; worktree: string }> {
  const slug = await corpus.newTarget("task");
  if (run !== undefined) registerRun(corpus.dir, run);
  heldSeq += 1;
  const branch = `held-b${heldSeq}`;
  const worktree = join(wtRoot, branch);
  await landTask(
    {
      dir: corpus.dir,
      git: (args) => execFileSync("git", [...args], { cwd: corpus.dir, encoding: "utf8" }).trim(),
      lore: (args) => runLore([...args], corpus.dir, run, name),
    },
    { slug, branch, worktree, claimValue: "branch", session: name, ...(stages.land === false ? { land: false } : {}) },
  );
  return { slug, worktree };
}
