/**
 * lore finish <task> [--red] [--json] — the implementer's closing verb (AC-DCS1-15..17): run INSIDE the claim worktree, it runs
 * every oracle of the task's stored done contract itself, reports ALL unmet items at once, records the attested rows in one
 * write and keeps the claim, marked finished, until `lore done` / `lore land`.
 *
 * `--red` runs only the AC oracles before the work exists and records `expected-fail` rows when each is a proven red; it is
 * refused (`red-not-required`) on a code task whose red run was waived at approve and on a check or corpus task.
 *
 * Exit codes: 0 finished (or red recorded), 4 refused or items unmet (nothing finished), 5 the task, the lease, HEAD or the tree
 * changed while the oracles ran (nothing recorded; run it again).
 *
 * Source: spec-done-contract-compiled-at-approve-task-kinds-write-sets (AC-DCS1-15, AC-DCS1-16, AC-DCS1-17).
 */

import { invocationOf } from "../command-invocation.js";
import { defineLoreCommand, exitCli } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import { printLine } from "../output.js";

export default defineLoreCommand({
  meta: {
    name: "finish",
    description: "Run every oracle of the task's done contract and keep the claim, marked finished",
  },
  args: {
    task: { type: "positional", description: "Task document ID or slug", required: true },
    red: { type: "boolean", description: "Run the red stage: the AC oracles only, before the work exists" },
    json: { type: "boolean", description: "Output result as JSON" },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      const verifiedIdentity = await app.verifiedInvocationIdentity?.();
      if (verifiedIdentity !== undefined && !verifiedIdentity.ok) {
        printLine(inv.io.stderr, formatErrorFor(inv, verifiedIdentity.error)); // CLI surface
        exitCli(exitCode(verifiedIdentity.error));
      }
      if (app.taskFinishService === undefined) {
        printLine(inv.io.stderr, "Error: lore finish is not available in this composition"); // CLI surface
        return 1;
      }
      const result = await app.taskFinishService.finish({
        task: args.task as string,
        red: args.red === true,
        cwd: inv.cwd,
        by: resolveActor(inv),
        harnessRun: verifiedIdentity?.value?.harnessRun ?? null,
        nowIso: new Date().toISOString(),
      });
      if (!result.ok) {
        printLine(inv.io.stderr, formatErrorFor(inv, result.error)); // CLI surface
        return exitCode(result.error);
      }
      const outcome = result.value;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: outcome }, null, 2));
        return 0;
      }
      if (outcome.mode === "red") {
        printLine(inv.io.stdout, `Recorded red for ${outcome.slug} at ${outcome.head.slice(0, 12)}: ${outcome.oracles.map((oracle) => oracle.id).join(", ")}`);
      } else {
        printLine(inv.io.stdout, `Finished ${outcome.slug} at ${outcome.head.slice(0, 12)}: ${outcome.oracles.length} oracle(s) passed (${outcome.oracles.map((oracle) => oracle.id).join(", ")})`);
        if (outcome.added_oracles.length > 0) printLine(inv.io.stdout, `Added to the contract by the write set: ${outcome.added_oracles.join(", ")}`);
      }
      printLine(inv.io.stdout, `Next: ${outcome.next_step}`);
    } finally {
      app.close();
    }
    return 0;
  },
});
