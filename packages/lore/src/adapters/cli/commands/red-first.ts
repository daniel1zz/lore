/**
 * lore red-first <task> — declare that a task's tests were written RED FIRST
 * (task-red-first-discipline-is-asked-for-in-prose-but-never). Thin pipe over
 * `TaskWorkflowService.declareRedFirst` — the SOLE writer for
 * `extra.red_first`.
 *
 * Once declared, `lore done` (`TaskWorkflowService.done`) holds this task to
 * an ADDITIONAL floor alongside the pre-existing `result: "pass"` floor: at
 * least one `"expected-fail"`/`"fail"` evidence row must be present, proving
 * the claimed RED run actually happened and was recorded — record one via
 * `lore evidence <task> --oracle <kind> --command "<cmd>" --result expected-fail`.
 * A task that never runs this command is completely unaffected.
 *
 * There is deliberately NO create-time `lore create task --red-first` flag
 * (the claim is typically made AFTER a task already exists, once its tests
 * are actually written) and deliberately NO `lore set --red-first` (`set`
 * replaces `extra` wholesale, the same reason `file_anchors`/`ac_scope`/
 * `claim`/`verification_evidence` each have a dedicated writer instead — the
 * existing strict unknown-flag seam, `strict-flags.ts`, is what refuses
 * `lore set --red-first`, exit 2; no bespoke check is needed in
 * `commands/set.ts`).
 *
 * Actor identity: the invoking run, via utils.ts::resolveActor — this command takes no `--by`.
 *
 * Exit codes per SPEC-003 §5:
 *   0 = success
 *   3 = DOC_NOT_FOUND (target not found)
 *   4 = VALIDATION_ERROR (target is not a task)
 *   5 = STALE_VERSION
 *
 * Source: task-red-first-discipline-is-asked-for-in-prose-but-never
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import { invocationOf } from "../command-invocation.js";

export default defineCommand({
  meta: {
    name: "red-first",
    description: "Declare that a task's tests were written red-first (sets extra.red_first: true)",
  },
  args: {
    task: {
      type: "positional",
      description: "Task document ID or slug",
      required: true,
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      const by = resolveActor(undefined, inv.env, inv.cwd);
      const result = await app.taskWorkflowService.declareRedFirst(args.task as string, {
        by,
        source: app.callerSurface,
      });

      if (!result.ok) {
        if (args.json) console.log(JSON.stringify({ ok: false, error: result.error }, null, 2));
        else process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const doc = result.value;
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: doc }, null, 2));
        return;
      }

      console.log(`Declared red-first test discipline on ${doc.slug} (v${doc.version})`);
      console.log(
        `  \`lore done ${doc.slug}\` now also requires an "expected-fail"/"fail" evidence ` +
          `row alongside the pre-existing passing one.`,
      );
    } finally {
      app.close();
    }
  },
});
