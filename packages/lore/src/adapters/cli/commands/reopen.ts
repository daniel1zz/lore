/**
 * lore reopen <spec> --reason <r> — move an approved spec with no evidence back to draft.
 *
 * The one sanctioned exit from the record-edit lock for a spec (spec-documents-are-living-or-records
 * D5, BR-1050). All rules (non-spec, blank reason, evidence count, the post-write recount) live in
 * `ReviewService.reopen`; this adapter only parses flags and maps the `Result` to an exit code
 * (refusal = the shared `exitCode` mapping for VALIDATION_ERROR, usage error = 2).
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import { invocationOf } from "../command-invocation.js";

export default defineCommand({
  meta: {
    name: "reopen",
    description: "Reopen an approved spec that has no evidence yet (approved -> draft) so it can be edited",
  },
  args: {
    id: {
      type: "positional",
      description: "Spec ID or slug",
      required: true,
    },
    reason: {
      type: "string",
      description: "Why the spec is being reopened (required; stored in the audit log and version history)",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    if (typeof args.reason !== "string" || args.reason.trim() === "") {
      process.stderr.write("Error: --reason is required: lore reopen <spec> --reason \"<why>\"\n");
      process.exit(2);
    }
    const { app } = loadLoreApp({ inv });
    try {
      const reviewer = resolveActor(undefined, inv.env, inv.cwd);

      const result = await app.reviewService.reopen(args.id, args.reason, { reviewer });
      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const doc = result.value;
      if (args.json) {
        process.stdout.write(JSON.stringify({ id: doc.id, slug: doc.slug, status: doc.status, version: doc.version }) + "\n");
        return;
      }
      process.stdout.write(`Reopened ${doc.slug} (v${doc.version}): approved -> draft\n`);
    } finally {
      app.close();
    }
  },
});
