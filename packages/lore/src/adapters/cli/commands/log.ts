/**
 * lore log [<doc-id>] — version history for a document or recent audit entries.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTable, parsePositiveIntArg } from "../utils.js";
import type { DocId } from "@lore/core";
import { SQLiteStore } from "../../../store/sqlite-store.js";
import { resolveDocId } from "../../../service/resolve.js";
import { formatAttributionLabels, loadVersionAttributions, type WriteAttribution } from "../../../service/attribution-report.js";

export default defineCommand({
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
  async run({ args }) {
    const { app, dbPath } = loadLoreApp();
    // reason: `App` does not expose its store; attribution (BR-1037) is a read-only projection over the same
    // file, the same second-handle pattern `lore status` uses.
    const attributionStore = new SQLiteStore(dbPath);
    try {
      // BUG-007 audit: an unvalidated NaN --limit reaches the store's `LIMIT ?`
      // bind and throws a bare bun:sqlite "datatype mismatch" — validate first.
      const limitResult = parsePositiveIntArg(args.limit ?? "20", "--limit", { min: 1 });
      if (!limitResult.ok) {
        process.stderr.write(limitResult.message + "\n");
        process.exitCode = 2;
        return;
      }
      const result = await app.versionService.log(args.id as DocId, { limit: limitResult.value });

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const resolved = await resolveDocId(attributionStore, args.id);
      if (!resolved.ok) {
        process.stderr.write(formatError(resolved.error) + "\n");
        process.exitCode = exitCode(resolved.error);
        return;
      }
      const loaded = await loadVersionAttributions(attributionStore, resolved.value, limitResult.value);
      if (!loaded.ok) {
        process.stderr.write(formatError(loaded.error) + "\n");
        process.exitCode = exitCode(loaded.error);
        return;
      }
      const attributionByVersion = new Map<number, WriteAttribution>(loaded.value.map((l) => [l.version.version, l.attribution]));
      const attributionOf = (version: number): WriteAttribution => {
        const a = attributionByVersion.get(version);
        if (a === undefined) throw new Error(`no attribution loaded for version ${version}`);
        return a;
      };
      const entries = result.value.map((e) => ({ ...e, ...attributionOf(e.version) }));

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { entries, total: entries.length } }, null, 2));
        return;
      }

      if (entries.length === 0) {
        console.log(`No version history for ${args.id}.`);
        return;
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

      console.log(`Version history for ${args.id}:`);
      console.log(formatTable(headers, rows));
    } finally {
      attributionStore.close();
      app.close();
    }
  },
});
