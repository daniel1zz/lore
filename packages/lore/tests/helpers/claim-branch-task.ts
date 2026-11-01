/**
 * Test helper: gives a branch the one task `lore integrate` requires (BR-1348: a branch with no task is refused).
 *
 * Integrate oracles that are about something else (the CAS, the floor, the lease, the shared view) build throwaway
 * branches through their own fixtures; each calls {@link claimBranchTask} so the branch has a task claimed on it and
 * the own-diff judgment passes with no anchors to collide on. A PRD and a plan are created once per repository.
 *
 * Side-effect class: IO (the injected `lore` runner). Never touches the repo's own `.lore/`.
 */

import type { TaskKind } from "@lore/core";
import { planFieldsArgs, templatedFieldsArgs } from "./templated-create.js";

/** Runs `lore <args>` in the throwaway repository; `status` is the process exit code. */
export type LoreRunner = (args: readonly string[]) => { readonly status: number; readonly out: string };

const planOfRepo = new Map<string, string>();
let titleSeq = 0;

function slugOf(run: LoreRunner, args: readonly string[]): string {
  const result = run(args);
  const slug = result.out.match(/Slug:\s+(\S+)/)?.[1];
  if (result.status !== 0 || slug === undefined) throw new Error(`lore ${args.join(" ")} exited ${result.status}: ${result.out}`);
  return slug;
}

/**
 * Creates a task in the repository's plan and claims it on `branch`.
 *
 * @param run - the repository's `lore` runner.
 * @param repoKey - any string unique to the throwaway repository (its path): the plan is created once per key.
 * @param branch - the branch the task is claimed on.
 * @param kind - the task kind (`code`, `check` or `corpus`); never defaulted, because `lore create task` refuses a missing kind.
 * @returns the task slug.
 */
export function claimBranchTask(run: LoreRunner, repoKey: string, branch: string, kind: TaskKind): string {
  let plan = planOfRepo.get(repoKey);
  if (plan === undefined) {
    const prd = slugOf(run, ["create", "prd", "--title", "Fixture PRD", "--no-ai", ...templatedFieldsArgs("prd")]);
    plan = slugOf(run, ["create", "plan", "--title", "Fixture plan", "--parent", prd, "--no-ai", ...planFieldsArgs(prd)]);
    planOfRepo.set(repoKey, plan);
  }
  titleSeq += 1;
  const task = slugOf(run, ["create", "task", "--title", `Fixture task ${titleSeq}`, "--kind", kind, "--parent", plan, "--plan-id", plan, "--no-ai", ...templatedFieldsArgs("task")]);
  const claimed = run(["claim", task, "--worktree", branch]);
  if (claimed.status !== 0) throw new Error(`lore claim ${task} --worktree ${branch} exited ${claimed.status}: ${claimed.out}`);
  return task;
}
