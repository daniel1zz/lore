/**
 * lore weights — the dedicated writer of a reference document's weight table (`extra.weight_table`, BR-1482).
 *
 * Subcommands:
 *   set <doc> --kind <rule revision|document revision> --dimension <name>=<weight>... [decision flags]
 *
 * Thin pipe over `WeightTableService`. Every weight must be > 0 and the weights must sum to 1 (within 1e-9), else exit 4;
 * a kind another live document already holds is refused (exit 4); changing an approved table is decision-carrying and its
 * decision must cite a milestone review or a traced issue. `lore set` refuses the `weight_table` key.
 *
 * Source: spec-a-decision-carrying-write-records-its-decision-on-its, "Weight tables".
 */

import { defineLoreCommand } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor } from "../utils.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import { DECISION_FLAG_ARGS, parseDecisionFlags } from "../decision-flags.js";
import type { LoreError, Result } from "@lore/core";

/** `name=weight` texts into a record; a malformed pair or a repeated name is a `VALIDATION_ERROR` (exit 4). */
function parseDimensions(raw: unknown): Result<Record<string, number>, LoreError> {
  const texts = raw === undefined ? [] : Array.isArray(raw) ? raw.map(String) : [String(raw)];
  const dimensions: Record<string, number> = {};
  const fail = (message: string, value: string): Result<Record<string, number>, LoreError> => ({
    ok: false,
    error: { code: "VALIDATION_ERROR", field: "dimension", message, value, rule: "BR-1482" },
  });
  if (texts.length === 0) return fail('at least one --dimension "<name>=<weight>" is required', "");
  for (const text of texts) {
    const at = text.lastIndexOf("=");
    const name = at > 0 ? text.slice(0, at).trim() : "";
    const weightText = at > 0 ? text.slice(at + 1).trim() : "";
    const weight = weightText === "" ? Number.NaN : Number(weightText);
    if (name === "" || !Number.isFinite(weight)) return fail(`--dimension must be "<name>=<weight>" with a numeric weight, got "${text}"`, text);
    if (name in dimensions) return fail(`dimension "${name}" is given twice`, text);
    dimensions[name] = weight;
  }
  return { ok: true, value: dimensions };
}

export default defineLoreCommand({
  meta: { name: "weights", description: "Write a reference document's decision weight table (BR-1482)" },
  subCommands: {
    set: defineLoreCommand({
      meta: { name: "set", description: "Set the weight table of a reference document" },
      args: {
        doc: { type: "positional", description: "Reference document ID or slug", required: true },
        kind: { type: "string", description: "Table kind: rule revision | document revision", required: true },
        dimension: { type: "string", description: '[repeatable] "<name>=<weight>"; weights > 0 summing to 1' },
        ...DECISION_FLAG_ARGS,
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          const fail = (error: LoreError): number => {
            if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: false, error }, null, 2));
            else inv.io.stderr.write(formatErrorFor(inv, error));
            return exitCode(error);
          };
          const service = app.weightTableService;
          if (service === undefined) {
            inv.io.stderr.write("Error: WeightTableService is not available in this build.\n");
            return 1;
          }
          const dimensions = parseDimensions(args["dimension"]);
          if (!dimensions.ok) return fail(dimensions.error);
          const draft = parseDecisionFlags(args);
          if (!draft.ok) return fail(draft.error);
          const result = await service.set({
            doc: args.doc as string,
            kind: args.kind as string,
            dimensions: dimensions.value,
            ...(draft.value !== undefined ? { decision: draft.value } : {}),
          });
          if (!result.ok) return fail(result.error);
          if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: result.value }, null, 2));
          else printLine(inv.io.stdout, `Set the "${args.kind as string}" weight table on ${result.value.slug} (v${result.value.version}, ${result.value.status}).`);
        } finally {
          app.close();
        }
        return 0;
      },
    }),
  },
});
