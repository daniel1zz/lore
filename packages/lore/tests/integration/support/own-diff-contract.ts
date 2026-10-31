/**
 * Integration-test helper: gives the own-diff fixture's tasks the done contract `lore integrate` needs.
 *
 * Purpose: `lore integrate` selects the tasks of a landing (a task claimed on the branch, approved, holding a stored contract) and runs
 * the union of their contract oracles itself (AC-DCS2-1); a draft task is never selected, so a landing whose task was never approved
 * "names no task whose oracles integrate runs". The own-diff fixture creates draft tasks, so a test that lands a branch through it
 * approves each task (the red run waived: not these tests' subject) and seeds the three `workflow.done_contract` commands.
 *
 * Public surface: {@link DONE_CONTRACT_FIXTURE_CONFIG}, {@link approvedTask}, {@link statusOf}.
 * Invariants: only for a throwaway repository and corpus (the own-diff fixture's); the commands print a runner summary and touch nothing.
 * Side-effect class: IO (`lore` through the fixture).
 */

import type { OwnDiffFixture } from "../../helpers/own-diff-fixture";

/** The lines to hand to `new OwnDiffFixture(...)` so approve can compile a code task's contract (already indented under `workflow:`). */
export const DONE_CONTRACT_FIXTURE_CONFIG: readonly string[] = [
  "  done_contract:",
  '    install: "echo install-ok"',
  '    typecheck: "echo typecheck-ok"',
  '    test_file: "echo Ran 1 tests in {file}"',
];

/**
 * Creates a code task with `anchors` in the plan and approves it, so its contract is stored before it is claimed.
 *
 * @param f - the own-diff fixture
 * @param title - the task title
 * @param anchors - the task's file anchors
 * @param plan - the plan slug (the fixture's default plan when omitted)
 * @param redWaiver - the reason the red run is waived, or `false` to approve with the red run required
 * @returns the task slug
 */
export function approvedTask(f: OwnDiffFixture, title: string, anchors: readonly string[], plan?: string, redWaiver: string | false = "the red run is not the subject of this fixture"): string {
  const task = plan === undefined ? f.createTask(title, anchors, "code") : f.createTask(title, anchors, "code", plan);
  f.mustLore(redWaiver === false ? ["approve", task] : ["approve", task, "--red-waiver", redWaiver]);
  return task;
}

/** The status of `slug`, read back through `lore get`. */
export function statusOf(f: OwnDiffFixture, slug: string): string {
  const payload = JSON.parse(f.mustLore(["get", slug, "--json"]).stdout) as { data: { doc: { status: string } } };
  return payload.data.doc.status;
}
