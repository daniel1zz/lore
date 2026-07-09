/**
 * lore list — list documents with optional filters.
 *
 * New in SPEC-023:
 *   --plan-id <id|slug>  Filter by parent plan (resolves slug → ULID, maps to parent_id filter).
 *   --phase <name>       Filter tasks by extra.phase name (requires --type task or --plan-id).
 *                        Client-side filter — applied after store fetch since StoreFilters
 *                        has no extra-field index. Only useful with --type task.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTable, formatWorkflowBadge, relativeTime } from "../utils.js";
import type { DocType, DocStatus } from "@lore/core";

export default defineCommand({
  meta: {
    name: "list",
    description: "List documents with optional filters",
  },
  args: {
    type: {
      type: "string",
      description: "Filter by type: prd | spec | adr | plan | knowledge | task",
    },
    status: {
      type: "string",
      description: "Filter by status: draft | in-review | approved | active | archived | deprecated",
    },
    author: {
      type: "string",
      description: "Filter by author (created_by)",
    },
    since: {
      type: "string",
      description: "ISO 8601 date — only docs updated at or after this time",
    },
    tag: {
      type: "string",
      description: "Filter by tag",
    },
    "plan-id": {
      type: "string",
      description: "Filter by parent plan ID or slug (resolves to parent_id). Useful with --type task.",
    },
    phase: {
      type: "string",
      description: "Filter tasks by phase name (extra.phase). Combine with --type task and --plan-id. Source: SPEC-023",
    },
    "governed-by": {
      type: "string",
      description: "List artifacts governed by a skill (ID or slug) via its 'governs' links. Exclusive of other filters.",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      // --governed-by is a link-table reverse query (skill --governs--> artifact),
      // not a StoreFilters column predicate — it short-circuits to its own dedicated
      // service method (CorpusService.listGovernedBy) rather than joining the
      // filters object below. Source: IoC vertical-slice tech-spec §4.1 P4.
      if (args["governed-by"] !== undefined) {
        const governedResult = await app.corpusService.listGovernedBy(args["governed-by"]);
        if (!governedResult.ok) {
          process.stderr.write(formatError(governedResult.error) + "\n");
          process.exitCode = exitCode(governedResult.error);
          return;
        }
        const { docs, total } = governedResult.value;

        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: { docs, total } }, null, 2));
          return;
        }
        if (total === 0) {
          console.log(`No documents governed by "${args["governed-by"]}".`);
          return;
        }
        const headers = ["ID", "Type", "Title", "Status", "Updated"];
        const rows = docs.map((d) => [
          d.id.slice(0, 10),
          d.type,
          d.title.slice(0, 35),
          d.status,
          relativeTime(d.updated_at),
        ]);
        console.log(formatTable(headers, rows));
        console.log(`\n${total} document${total === 1 ? "" : "s"} (filter: --governed-by ${args["governed-by"]})`);
        return;
      }

      const filters: Record<string, unknown> = {};
      if (args.type !== undefined) filters["type"] = args.type as DocType;
      if (args.status !== undefined) filters["status"] = args.status as DocStatus;
      if (args.author !== undefined) filters["created_by"] = args.author;
      if (args.since !== undefined) filters["since"] = args.since;
      if (args.tag !== undefined) filters["tags"] = [args.tag];

      // Resolve --plan-id slug or ULID → parent_id ULID filter.
      if (args["plan-id"] !== undefined) {
        const resolveResult = await app.corpusService.resolve(args["plan-id"]);
        if (!resolveResult.ok) {
          process.stderr.write(formatError(resolveResult.error) + "\n");
          process.exitCode = exitCode(resolveResult.error);
          return;
        }
        filters["parent_id"] = resolveResult.value;
      }

      // When --phase filter is active, we need full DocRecord rows (extra.phase is not in DocSummary).
      // reason: StoreFilters has no extra-field index; client-side filter is applied after fetch.
      // Source: SPEC-023 §4 AC-PHASE-7
      const phaseFilter = args.phase;
      if (phaseFilter !== undefined) {
        const fullResult = await app.corpusService.listFull(filters);
        if (!fullResult.ok) {
          process.stderr.write(formatError(fullResult.error) + "\n");
          process.exitCode = exitCode(fullResult.error);
          return;
        }
        const filtered = fullResult.value.docs.filter(
          (doc) => doc.extra["phase"] === phaseFilter,
        );
        const total = filtered.length;

        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: { docs: filtered, total } }, null, 2));
          return;
        }
        if (total === 0) {
          console.log(`No documents found with phase "${phaseFilter}".`);
          return;
        }
        // reason: workflow badge (claim/evidence, AC-WF-9) is only meaningful for task
        // rows; --phase filtering only applies to tasks in practice (SPEC-023), so we
        // always compute it here rather than branching on d.type.
        const nowIso = new Date().toISOString();
        const ttlMinutes = app.taskWorkflowService.claimTtlMinutes;
        const headers = ["ID", "Type", "Title", "Status", "Phase", "Updated"];
        const rows = filtered.map((d) => [
          d.id.slice(0, 10),
          d.type,
          `${d.title.slice(0, 30)}${formatWorkflowBadge(d, nowIso, ttlMinutes)}`,
          d.status,
          String(d.extra["phase"] ?? ""),
          relativeTime(d.updated_at),
        ]);
        console.log(formatTable(headers, rows));
        console.log(`\n${total} document${total === 1 ? "" : "s"} (filter: --phase ${phaseFilter})`);
        return;
      }

      // Task-type listings render a claim/evidence workflow badge on each row
      // (AC-WF-9). This requires the full DocRecord (extra.claim / extra.verification_evidence
      // are not in DocSummary) — mirrors the --phase branch's listFull usage above.
      if (filters["type"] === "task") {
        const fullResult = await app.corpusService.listFull(filters);
        if (!fullResult.ok) {
          process.stderr.write(formatError(fullResult.error) + "\n");
          process.exitCode = exitCode(fullResult.error);
          return;
        }
        const { docs: fullDocs, total: fullTotal } = fullResult.value;

        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: { docs: fullDocs, total: fullTotal } }, null, 2));
          return;
        }
        if (fullTotal === 0) {
          console.log("No documents found.");
          return;
        }

        const nowIso = new Date().toISOString();
        const ttlMinutes = app.taskWorkflowService.claimTtlMinutes;
        const headers = ["ID", "Type", "Title", "Status", "Updated"];
        const rows = fullDocs.map((d) => [
          d.id.slice(0, 10),
          d.type,
          `${d.title.slice(0, 35)}${formatWorkflowBadge(d, nowIso, ttlMinutes)}`,
          d.status,
          relativeTime(d.updated_at),
        ]);
        console.log(formatTable(headers, rows));
        console.log(`\n${fullTotal} document${fullTotal === 1 ? "" : "s"} (filter: --type task)`);
        return;
      }

      const result = await app.corpusService.list(filters);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const { docs, total } = result.value;

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { docs, total } }, null, 2));
        return;
      }

      if (total === 0) {
        console.log("No documents found.");
        return;
      }

      const headers = ["ID", "Type", "Title", "Status", "Updated"];
      const rows = docs.map((d) => [
        d.id.slice(0, 10),
        d.type,
        d.title.slice(0, 35),
        d.status,
        relativeTime(d.updated_at),
      ]);

      console.log(formatTable(headers, rows));

      const filterDesc = Object.entries(filters)
        .map(([k, v]) => `--${k} ${Array.isArray(v) ? v.join(",") : String(v)}`)
        .join(" ");
      console.log(`\n${total} document${total === 1 ? "" : "s"}${filterDesc ? ` (filter: ${filterDesc})` : ""}`);
    } finally {
      app.close();
    }
  },
});
