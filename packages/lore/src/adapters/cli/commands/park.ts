/**
 * lore park <task> --reason "<why>" — set a task's unlanded work aside
 * (spec-landing-does-the-bookkeeping-claims-start-from-main-parked, BR-1354). Thin pipe over
 * `TaskWorkflowService.park`, the SOLE writer of `extra.parked` ({at, by, reason}).
 *
 * Effect: the own-diff judgment at `lore integrate` (BR-1346) stops counting this task's UNLANDED BRANCH as holding the
 * files it anchors, so another branch can land over them. It changes nothing else: no status, no branch, no anchors,
 * no claim (a task that still holds a claim keeps holding; claiming a parked task removes the park).
 *
 * `--reason` is required: a missing or blank one is a usage error, exit 2, before the corpus is opened. There is
 * deliberately NO `lore set --parked` (`set` replaces `extra` wholesale; `commands/set.ts` never edits dedicated keys,
 * `DEDICATED_EXTRA_KEYS` refuses it) and no MCP tool: like `red-first` and `scope`, the writer is a CLI verb.
 *
 * Actor identity: the invoking run, via utils.ts::resolveActor — this command takes no `--by`.
 *
 * Exit codes: 0 = parked, 2 = missing/blank --reason, 3 = DOC_NOT_FOUND, 4 = VALIDATION_ERROR (not a task), 5 = STALE_VERSION.
 */

import { defineLoreCommand, exitCli } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

export default defineLoreCommand({
  meta: {
    name: "park",
    description: "Park a task's unlanded work: its branch stops holding its anchors at integrate (sets extra.parked)",
  },
  args: {
    task: {
      type: "positional",
      description: "Task document ID or slug",
      required: true,
    },
    reason: {
      type: "string",
      description: "Why the work is set aside (required)",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const reason = typeof args.reason === "string" ? args.reason : "";
    if (reason.trim() === "") {
      inv.io.stderr.write('Error: lore park requires a non-blank --reason "<why the work is set aside>".\n');
      exitCli(2);
    }
    const { app } = loadLoreApp({ inv });
    try {
      const by = resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user);
      const result = await app.taskWorkflowService.park(args.task as string, { by, reason, source: app.callerSurface });
      if (!result.ok) {
        if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
        else inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }
      const doc = result.value;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: doc }, null, 2));
        return 0;
      }
      printLine(inv.io.stdout, `Parked ${doc.slug} by ${by} (v${doc.version}): ${reason.trim()}`);
      printLine(inv.io.stdout, "  Its unlanded branch no longer holds its anchors at `lore integrate`; a held claim still does.");
    } finally {
      app.close();
    }
    return 0;
  },
});
