/**
 * Test helper: lands a branch on main WITHOUT `lore integrate`, for tests of `lore done`'s floors in isolation.
 *
 * Purpose: `lore integrate` runs the landing tasks' contract oracles and records attested rows, so a fixture that lands through
 * it and then asserts a done floor cannot leave the evidence in the state the floor is about. This helper does what a landing
 * leaves behind and nothing more: a merge commit on main (git moved through the plumbing, hooks off for that one `update-ref`) and
 * the landing record, written through the same service `lore integrate` writes it through (`TaskWorkflowService.recordLanding`).
 * Behaviour of integrate itself belongs in `done-contract-integrate-compiled.bun.test.ts`, never in a test using this helper.
 *
 * Public surface: {@link landWithoutIntegrate}.
 * Invariants: only for a throwaway fixture (never this repository); the shared checkout is left detached at main.
 * Side-effect class: IO (git in the fixture repository, one corpus write through the app).
 */

import { join } from "node:path";
import { createApp } from "../../src/app";
import { liveAmbient, liveWriteContext } from "../live-invocation";
import type { DoneContractFixture } from "./done-contract-fixture";

/**
 * Merges `branch` into main with a merge commit and records the landing on every task whose claim named the branch.
 *
 * @param fixture - the throwaway project
 * @param branch - the branch the task was claimed on; it must hold commits
 * @returns the landing commit (the merge commit now at the tip of main)
 * @throws Error when git or the landing record fails (a fixture fault, never silent)
 */
export async function landWithoutIntegrate(fixture: DoneContractFixture, branch: string): Promise<string> {
  fixture.git(["checkout", "-q", "--detach", "main"]);
  const before = fixture.git(["rev-parse", "HEAD"]);
  const tip = fixture.git(["rev-parse", branch]);
  fixture.git(["merge", "--no-ff", "-q", "-m", `land ${branch}`, branch]);
  const after = fixture.git(["rev-parse", "HEAD"]);
  // reason: the shipped guard lets main move only through `lore integrate`; this one update-ref runs with hooks off.
  fixture.git(["-c", "core.hooksPath=/dev/null", "update-ref", "refs/heads/main", after, before]);
  // reason: the app measures git in the ambient's cwd, which must be the fixture repository, not the test process's.
  const app = createApp(join(fixture.dir, ".lore", "lore.db"), undefined, { ...liveAmbient(), cwd: fixture.dir }, liveWriteContext());
  try {
    const recorded = await app.taskWorkflowService.recordLanding({ branch, branch_head: tip, main_before: before, main_after: after, landing_commit: after });
    if (!recorded.ok) throw new Error(`recordLanding failed: ${JSON.stringify(recorded.error)}`);
    if (recorded.value.length === 0) throw new Error(`recordLanding named no task for branch ${branch}`);
  } finally {
    app.close();
  }
  return after;
}
