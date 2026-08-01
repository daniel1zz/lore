/**
 * lore search <query> — full-text search with FTS5.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTable, formatValidityBadge, parsePositiveIntArg } from "../utils.js";
import type { DocType } from "@lore/core";

export default defineCommand({
  meta: {
    name: "search",
    description: "Full-text search across documents",
  },
  args: {
    query: {
      type: "positional",
      description: "Search query",
      required: true,
    },
    type: {
      type: "string",
      description: "Filter by type",
    },
    limit: {
      type: "string",
      description: "Max results (default: 10)",
      default: "10",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
    "include-invalid": {
      type: "boolean",
      description: "Include invalidated knowledge/adr/task docs (excluded by default). Source: SPEC-043 D3, task-a-task-cannot-be-retracted-supersedes-emits-a-repair.",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      // BUG-006 audit: validate --limit BEFORE it can silently drive
      // `.slice(0, NaN)` → an always-empty result set masquerading as "no matches".
      const limitResult = parsePositiveIntArg(args.limit ?? "10", "--limit", { min: 1 });
      if (!limitResult.ok) {
        process.stderr.write(limitResult.message + "\n");
        process.exitCode = 2;
        return;
      }

      const filters: Record<string, unknown> = {};
      if (args.type !== undefined) filters["type"] = args.type as DocType;
      if (args["include-invalid"] === true) filters["include_invalid"] = true;

      const result = await app.corpusService.search(args.query, filters);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const results = result.value.results.slice(0, limitResult.value);

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { results, total: results.length } }, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log(`No results for "${args.query}".`);
        return;
      }

      // SPEC-043 D3/D4 — [invalid] badge on rows surfaced only via --include-invalid
      // (the default search already excludes them, so this is a no-op unless that
      // flag was passed).
      const nowIso = new Date().toISOString();
      const headers = ["ID", "Title", "Snippet", "Score"];
      const rows = results.map((r) => [
        r.id.slice(0, 10),
        `${r.title.slice(0, 30)}${formatValidityBadge(r, nowIso)}`,
        (r.snippet ?? "").slice(0, 40),
        r.score.toFixed(2),
      ]);

      console.log(formatTable(headers, rows));
      console.log(`\n${results.length} result${results.length === 1 ? "" : "s"} for "${args.query}"`);
    } finally {
      app.close();
    }
  },
});
