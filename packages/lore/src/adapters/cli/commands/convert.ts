/**
 * lore convert — turn an open legacy document into a structured one, or list those still waiting.
 *
 *   convert --list [--json]     Every open legacy document by type and owner (what the conversion plan counts down to zero).
 *   convert --classify [--apply] [--json]
 *                               Classify every document of a templated type once: a completed one (archived or deprecated; or a
 *                               locked spec/adr with at least one implementing plan, all archived) gets `extra.legacy` and is
 *                               frozen. Preview by default; a second `--apply` writes nothing. (Lives here, not in
 *                               `lore migrate`, because migrate.ts was held by another task's claim when this landed.)
 *   convert <doc> [--json]    Build `extra.fields` and `extra.dimensions` from the document's body (an AI draft the author
 *                               must review), validate them against the latest approved template, render the body, and
 *                               store the result as a new version (a locked record through `correction`).
 *
 * Exit codes (SPEC-003 §5):
 *   0 = listed / converted
 *   3 = the document was not found
 *   4 = refused: completed or legacy-frozen, already converted, no approved template, an unusable or invalid draft
 *   5 = another write landed first (STALE_VERSION): re-read and run again
 *   6 = the AI provider failed
 *
 * Thin adapter: the rules live in `ConversionService` and `LegacyClassificationService`; the write goes through the one
 * validating `CorpusService.set` path.
 *
 * Source: spec-every-document-is-stored-as-structured-fields-validated-by (Legacy documents), AC-ST-7
 */

import { defineLoreCommand } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import { buildLegacyServices } from "../conversion-wiring.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

export default defineLoreCommand({
  meta: {
    name: "convert",
    description: "Convert an open legacy document to a structured one (AI draft, validated, rendered), or --list the ones still open",
  },
  args: {
    doc: { type: "positional", description: "Document ID or slug to convert", required: false },
    list: { type: "boolean", description: "List every open legacy document (type, owner) instead of converting" },
    classify: {
      type: "boolean",
      description: "Classify every document of a templated type once: completed ones are frozen (extra.legacy), the rest stay open. Preview unless --apply",
    },
    apply: { type: "boolean", description: "[--classify] write the classification (default is preview)" },
    json: { type: "boolean", description: "Output result as JSON" },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const doc = typeof args.doc === "string" && args.doc !== "" ? args.doc : undefined;
    const modes = [args.list === true, args.classify === true, doc !== undefined].filter(Boolean).length;
    if (modes !== 1) {
      inv.io.stderr.write("Error: pass exactly one of <doc>, --list or --classify.\n");
      return 2;
    }
    const { app } = loadLoreApp({ inv });
    try {
      const services = buildLegacyServices(app);
      if (!services.ok) {
        inv.io.stderr.write(formatErrorFor(inv, services.error) + "\n");
        return exitCode(services.error);
      }
      if (args.classify === true) {
        const apply = args.apply === true;
        const result = apply
          ? await services.value.classification.apply({ by: resolveActor(inv) })
          : await services.value.classification.classify();
        if (!result.ok) {
          inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
          return exitCode(result.error);
        }
        const { frozen, open, errors } = result.value;
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: errors.length === 0, data: { applied: apply, frozen, open, errors } }, null, 2));
          return errors.length === 0 ? 0 : 4;
        }
        printLine(inv.io.stdout, apply ? "Legacy classification complete" : "Legacy classification (preview)");
        for (const row of frozen) printLine(inv.io.stdout, `  ${apply ? "frozen" : "would freeze"}  ${row.type.padEnd(10)} ${row.slug}`);
        printLine(inv.io.stdout, `${String(frozen.length)} completed, ${String(open.length)} open (see \`lore convert --list\`)`);
        for (const message of errors) inv.io.stderr.write(`  FAILED ${message}\n`);
        if (!apply && frozen.length > 0) printLine(inv.io.stdout, "\nRe-run with --apply to execute.");
        return errors.length === 0 ? 0 : 4;
      }
      if (args.list === true) {
        const open = await services.value.classification.listOpen();
        if (!open.ok) {
          inv.io.stderr.write(formatErrorFor(inv, open.error) + "\n");
          return exitCode(open.error);
        }
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { count: open.value.length, open: open.value } }, null, 2));
          return 0;
        }
        if (open.value.length === 0) {
          printLine(inv.io.stdout, "No open legacy documents: every document is structured or legacy-frozen.");
          return 0;
        }
        printLine(inv.io.stdout, `${String(open.value.length)} open legacy document(s) to convert:`);
        for (const row of open.value) {
          printLine(inv.io.stdout, `  ${row.type.padEnd(10)} ${row.slug}  owner=${row.owner}  status=${row.status}`);
        }
        return 0;
      }
      const converted = await services.value.conversion.convert(doc as string, { by: resolveActor(inv) });
      if (!converted.ok) {
        inv.io.stderr.write(formatErrorFor(inv, converted.error) + "\n");
        return exitCode(converted.error);
      }
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: converted.value }, null, 2));
        return 0;
      }
      const o = converted.value;
      printLine(
        inv.io.stdout,
        `Converted ${o.slug} to ${o.template_ref} (version ${String(o.version)}, ${o.status}${o.correction ? ", via correction" : ""}). Review the AI draft with \`lore get ${o.slug}\`.`,
      );
      return 0;
    } finally {
      app.close();
    }
  },
});
