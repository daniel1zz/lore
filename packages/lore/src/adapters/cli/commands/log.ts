/**
 * lore log [<doc-id>] — version history for a document or recent audit entries.
 */

import { defineLoreCommand } from "../cli-exit.js";

import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, formatTable, parsePositiveIntArg } from "../utils.js";
import type { DocId } from "@lore/core";
import { SQLiteStore } from "../../../store/sqlite-store.js";
import { resolveDocId } from "../../../service/resolve.js";
import { formatAttributionLabels, loadVersionAttributions, type WriteAttribution } from "../../../service/attribution-report.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

export default defineLoreCommand({
  meta: {
    name: "log",
    description: "Show version history for a document",
  },
  args: {
    id: {
      type: "positional",
      description: "Document ID",
      required: true,
    },
    limit: {
      type: "string",
      description: "Max entries to show (default: 20)",
      default: "20",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const { app, dbPath } = loadLoreApp({ inv });
    // reason: `App` does not expose its store; attribution (BR-1037) is a read-only projection over the same
    // file, the same second-handle pattern `lore status` uses.
    const attributionStore = new SQLiteStore(dbPath);
    try {
      // BUG-007 audit: an unvalidated NaN --limit reaches the store's `LIMIT ?`
      // bind and throws a bare bun:sqlite "datatype mismatch" — validate first.
      const limitResult = parsePositiveIntArg(args.limit ?? "20", "--limit", { min: 1 });
      if (!limitResult.ok) {
        inv.io.stderr.write(limitResult.message + "\n");
        return 2;
      }
      const result = await app.versionService.log(args.id as DocId, { limit: limitResult.value });

      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }

      const resolved = await resolveDocId(attributionStore, args.id, { includeDeleted: true });
      if (!resolved.ok) {
        inv.io.stderr.write(formatErrorFor(inv, resolved.error) + "\n");
        return exitCode(resolved.error);
      }
      const loaded = await loadVersionAttributions(attributionStore, resolved.value, limitResult.value);
      if (!loaded.ok) {
        inv.io.stderr.write(formatErrorFor(inv, loaded.error) + "\n");
        return exitCode(loaded.error);
      }
      const attributionByVersion = new Map<number, WriteAttribution>(loaded.value.map((l) => [l.version.version, l.attribution]));
      const attributionOf = (version: number): WriteAttribution => {
        const a = attributionByVersion.get(version);
        if (a === undefined) throw new Error(`no attribution loaded for version ${version}`);
        return a;
      };
      const entries = result.value.map((e) => ({ ...e, ...attributionOf(e.version) }));

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { entries, total: entries.length } }, null, 2));
        return 0;
      }

      if (entries.length === 0) {
        printLine(inv.io.stdout, `No version history for ${args.id}.`);
        return 0;
      }

      // SPEC-072 D3 — Slug column renders the value when present; a legacy
      // row with no slug renders an empty cell, never an "unknown" placeholder.
      const headers = ["Version", "Action", "Author", "Timestamp", "Slug", "Summary", "Attribution"];
      const rows = entries.map((e) => [
        `v${e.version}`,
        e.action,
        e.created_by,
        e.created_at.slice(0, 19).replace("T", " "),
        e.slug ?? "",
        (e.change_summary ?? "").slice(0, 30),
        formatAttributionLabels(e),
      ]);

      printLine(inv.io.stdout, `Version history for ${args.id}:`);
      printLine(inv.io.stdout, formatTable(headers, rows));
    } finally {
      attributionStore.close();
      app.close();
    }
    return 0;
  },
});
