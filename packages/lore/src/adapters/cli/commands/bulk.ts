/**
 * `lore bulk <archive|deprecate|close|done> (<id|slug|slug@version>... | --where "<filters>") [--apply --reason "<why>"] [--json]`
 * — many documents through ONE lifecycle verb: preview first, apply second (BR-1366, BR-1367;
 * spec-lean-governance-batch-verbs-judgment-only-at-milestones Part A).
 *
 * Selector: ids XOR `--where` (comma-separated `key=value`: type, status, author, since, tag — the `lore list`
 * filters — plus `older-than=<N>d` and `open-tasks=0`). An id token `slug@N` pins the version the row must still
 * have at write time (carry the version a preview printed into the apply).
 *
 * Without `--apply` it writes nothing, prints one row per candidate and exits 3 (0 when there are none). With
 * `--apply` each row is written once through the existing gated write path (compare-and-set against the version
 * read at selection) and one table prints OK / SKIPPED / FAILED with a reason per row; `--reason` lands on every
 * row's audit entry.
 *
 * Exit codes: 0 = preview found nothing / apply wrote no failing row; 1 = apply and at least one row FAILED;
 * 2 = usage (unknown verb, ids and --where both or neither, --apply on archive/deprecate/close without --reason);
 * 3 = preview found candidates; any other = the refusal of the selection itself (e.g. 3 for an unknown id).
 *
 * The logic lives in `BulkLifecycleService`; this file only parses flags and renders. MCP twin: `lore_bulk`.
 */

import type { LoreError } from "@lore/core";
import { defineLoreCommand } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, formatTable, resolveActor } from "../utils.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import { requireBulkLifecycleService } from "../../bulk-wiring.js";
import {
  BULK_VERBS,
  BULK_VERBS_REQUIRING_REASON,
  isBulkVerb,
  resolveBulkSelector,
} from "../../../service/bulk-lifecycle-service.js";

/** A BR-1366 usage refusal (unknown --where plan, ...) exits 2 like every other usage error; the rest keep `exitCode`. */
function bulkExitCode(error: LoreError): number {
  return error.code === "VALIDATION_ERROR" && "rule" in error && error.rule === "BR-1366" ? 2 : exitCode(error);
}

export default defineLoreCommand({
  meta: {
    name: "bulk",
    description: "Move many documents through one lifecycle verb (archive|deprecate|close|done): preview, then --apply",
  },
  args: {
    verb: { type: "positional", description: `One of ${BULK_VERBS.join(" | ")}`, required: true },
    where: {
      type: "string",
      description: 'Select by filters instead of ids: "type=task,plan=<slug|id>,tag=...,older-than=30d" or "type=plan,open-tasks=0" (archived/deprecated docs are never selected)',
    },
    apply: { type: "boolean", description: "Write the rows (default: preview only, exit 3 when there are candidates)" },
    reason: { type: "string", description: "Why (required with --apply for archive/deprecate/close); written to every row's audit entry" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const positionals = ((args._ as string[] | undefined) ?? [args.verb as string]).map(String);
    const verb = positionals[0] ?? "";
    if (!isBulkVerb(verb)) {
      inv.io.stderr.write(`Unknown bulk verb "${verb}". Use one of: ${BULK_VERBS.join(", ")}.\n`);
      return 2;
    }
    const selector = resolveBulkSelector(positionals.slice(1), typeof args.where === "string" ? args.where : undefined);
    if (!selector.ok) {
      inv.io.stderr.write(formatErrorFor(inv, selector.error) + "\n");
      return 2;
    }
    const applying = args.apply === true;
    const reason = typeof args.reason === "string" ? args.reason : undefined;
    if (applying && BULK_VERBS_REQUIRING_REASON.has(verb) && (reason === undefined || reason.trim() === "")) {
      inv.io.stderr.write(`lore bulk ${verb} --apply needs --reason "<why>".\n`);
      return 2;
    }

    const { app } = loadLoreApp({ inv });
    try {
      const service = requireBulkLifecycleService(app);
      if (!applying) {
        const preview = await service.preview(selector.value, verb);
        if (!preview.ok) {
          inv.io.stderr.write(formatErrorFor(inv, preview.error) + "\n");
          return bulkExitCode(preview.error);
        }
        if (args.json === true) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { mode: "preview", verb, rows: preview.value } }, null, 2));
        } else if (preview.value.length === 0) {
          printLine(inv.io.stdout, "No candidates.");
        } else {
          printLine(
            inv.io.stdout,
            formatTable(
              ["SLUG", "TYPE", "STATUS", "VERSION", "TARGET"],
              preview.value.map((r) => [r.slug, r.type, r.status, String(r.version), r.target]),
            ),
          );
          printLine(inv.io.stdout, `${preview.value.length} candidate(s); re-run with --apply${BULK_VERBS_REQUIRING_REASON.has(verb) ? ' --reason "<why>"' : ""} to write them.`);
        }
        return preview.value.length === 0 ? 0 : 3;
      }

      const result = await service.apply(selector.value, verb, {
        by: resolveActor(inv),
        ...(reason !== undefined ? { reason } : {}),
        source: app.callerSurface,
      });
      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return bulkExitCode(result.error);
      }
      if (args.json === true) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { mode: "apply", verb, rows: result.value } }, null, 2));
      } else if (result.value.length === 0) {
        printLine(inv.io.stdout, "No candidates.");
      } else {
        printLine(
          inv.io.stdout,
          formatTable(
            ["RESULT", "SLUG", "REASON"],
            result.value.map((r) => [r.outcome, r.slug, r.reason]),
          ),
        );
      }
      return result.value.some((r) => r.outcome === "FAILED") ? 1 : 0;
    } finally {
      app.close();
    }
  },
});
