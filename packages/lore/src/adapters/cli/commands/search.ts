/**
 * lore search <query> — full-text search with FTS5.
 *
 * ## `--sub-type` (spec-a-write-side-fact-with-no-read-side-address-counts-with-no §M3)
 *
 * Narrows a `--type knowledge` search to one `extra.sub_type`. The predicate is
 * pushed into `StoreInterface.search`, where it rides the FTS5→docs join's WHERE
 * clause as a bound `json_extract(d.extra, '$.sub_type') = ?`.
 *
 * ⛔ That placement is load-bearing on THIS surface specifically: `--limit` below
 * is a POST-FETCH slice over the ranked hits, so a sub-type filter applied here in
 * the adapter would cut the hit list to N rows first and only then drop the
 * non-matching ones — a query with a legitimate match ranked below the cut would
 * come back empty. AC-RR-7 pins that with a fixture whose retro is deliberately
 * NOT the top-ranked hit.
 *
 * The usage contract (`--sub-type` requires `--type knowledge`; an unrecognised
 * value is refused by name; exit 2 either way) comes from the ONE shared seam
 * `CorpusService::resolveSubTypeFilter`, which `lore list` and both MCP read tools
 * consume identically — ⛔ never re-derive it here.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTable, formatValidityBadge, parsePositiveIntArg } from "../utils.js";
import { resolveSubTypeFilter } from "../../../service/corpus-service.js";
import { KNOWLEDGE_SUB_TYPES } from "@lore/core";
import type { DocType } from "@lore/core";
import { invocationOf } from "../command-invocation.js";

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
    "sub-type": {
      type: "string",
      // reason: interpolated from KNOWLEDGE_SUB_TYPES, never retyped — same rule
      // as `lore list`'s identical flag.
      description:
        `[requires --type knowledge] Filter knowledge hits by extra.sub_type: ${KNOWLEDGE_SUB_TYPES.join(" | ")}. ` +
        "Applied as a STORE-LEVEL predicate (before --limit's slice). Any other --type (or none) is a " +
        "usage error, never a silently empty result. " +
        "Source: spec-a-write-side-fact-with-no-read-side-address-counts-with-no M3.",
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
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      // BUG-006 audit: validate --limit BEFORE it can silently drive
      // `.slice(0, NaN)` → an always-empty result set masquerading as "no matches".
      const limitResult = parsePositiveIntArg(args.limit ?? "10", "--limit", { min: 1 });
      if (!limitResult.ok) {
        process.stderr.write(limitResult.message + "\n");
        process.exitCode = 2;
        return;
      }

      // reason: ONE shared seam with `lore list` and both MCP read tools (see this
      // file's header). Exit 2 = CLI usage error (utils.ts::exitCode) — a refusal
      // must never degrade into an exit-0 empty hit list.
      const subTypeResolution = resolveSubTypeFilter(args["sub-type"], args.type);
      if (!subTypeResolution.ok) {
        process.stderr.write(subTypeResolution.message + "\n");
        process.exitCode = 2;
        return;
      }

      const filters: Record<string, unknown> = {};
      if (args.type !== undefined) filters["type"] = args.type as DocType;
      if (subTypeResolution.sub_type !== undefined) filters["sub_type"] = subTypeResolution.sub_type;
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
