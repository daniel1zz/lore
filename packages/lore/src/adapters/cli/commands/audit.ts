/**
 * lore audit [<doc>] [--actor <a>] [--action <x>] [--since <t>] [--limit <n>] [--json]
 * lore audit --verify [--since <t>] [--json]
 *
 * Read/verify surface over the audit table (SPEC-035 §2):
 *   - `lore audit <doc>` — per-doc decision trail (who/what/when/basis, joined
 *     judgment summary when action="judge").
 *   - `lore audit --actor <a> --action <x> --since <t>` — filtered query (maps
 *     1:1 to AuditFilters); `<doc>` and filters may be combined.
 *   - `lore audit --verify [--since <t>]` — completeness oracle: exit 0 clean,
 *     exit 4 with itemized misses. `--since` overrides the configured
 *     `audit.verify_since` watermark for this run only.
 *
 * AI-authored entries (action="judge") carry `created_by`/`actor` encoded as
 * `ai:{provider}:{model}:{prompt_version}` (SPEC-034 §2) — rendered here via
 * `parseAuditActor` so human output never shows the raw encoded string.
 *
 * Exit codes: 0 = success (or verify clean), 3 = DOC_NOT_FOUND (bad <doc>),
 *   4 = VALIDATION_ERROR | verify found misses, 1 = STORE_ERROR.
 *
 * Source: SPEC-035 §2
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTable } from "../utils.js";
import { parseAuditActor, type AuditEntry } from "@lore/core";
import type { AuditFilters } from "../../../store/store-interface.js";
import type { AuditMiss } from "../../../service/audit-service.js";

/** Render `created_by`/`actor` for display — decodes AI judge identities (SPEC-034 §2). */
function formatActor(actor: string): string {
  const parsed = parseAuditActor(actor);
  return parsed.kind === "ai"
    ? `ai:${parsed.judge.provider}/${parsed.judge.model}@${parsed.judge.prompt_version}`
    : parsed.name;
}

/** One-line summary of an audit entry's `details`, surfacing judgment_ref when present. */
function summarizeDetails(entry: AuditEntry): string {
  const details = entry.details ?? {};
  if (typeof details["judgment_ref"] === "string") {
    return `judgment:${details["judgment_ref"]}`;
  }
  const json = JSON.stringify(details);
  return json.length > 60 ? `${json.slice(0, 57)}...` : json;
}

export default defineCommand({
  meta: {
    name: "audit",
    description: "Query the audit trail, or verify its completeness against version history",
  },
  args: {
    doc: {
      type: "positional",
      description: "Document ID or slug — show its decision trail",
      required: false,
    },
    actor: {
      type: "string",
      description: "Filter by actor (exact match; e.g. 'alice' or 'ai:claude-cli:claude-sonnet-5:v1')",
    },
    action: {
      type: "string",
      description: "Filter by action (create|update|delete|approve|reject|restore|claim|release|evidence|judge)",
    },
    since: {
      type: "string",
      description: "ISO 8601 — only entries at/after this time (query mode) or verify watermark override",
    },
    limit: {
      type: "string",
      description: "Max entries to return (query mode only)",
    },
    verify: {
      type: "boolean",
      description: "Run the completeness oracle instead of a query (versions⋈audit reconcile)",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      // ── --verify branch ─────────────────────────────────────────────────
      if (args.verify) {
        const result = await app.auditService.verify(
          args.since !== undefined ? { since: args.since } : undefined,
        );
        if (!result.ok) {
          process.stderr.write(formatError(result.error) + "\n");
          process.exitCode = exitCode(result.error);
          return;
        }

        const { clean, misses, since } = result.value;

        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: { clean, misses, since } }, null, 2));
        } else if (clean) {
          console.log(`Audit trail is complete since ${since} — no missing entries.`);
        } else {
          console.log(`Audit trail is INCOMPLETE since ${since} — ${misses.length} missing entr${misses.length === 1 ? "y" : "ies"}:`);
          const headers = ["Doc ID", "Version", "Action", "Created At"];
          const rows = misses.map((m: AuditMiss) => [m.doc_id, `v${m.version}`, m.action, m.created_at]);
          console.log(formatTable(headers, rows));
        }

        process.exitCode = clean ? 0 : 4;
        return;
      }

      // ── query branch ─────────────────────────────────────────────────────
      const filters: AuditFilters = {
        ...(args.actor !== undefined ? { actor: args.actor } : {}),
        ...(args.action !== undefined ? { action: args.action } : {}),
        ...(args.since !== undefined ? { since: args.since } : {}),
        ...(args.limit !== undefined ? { limit: parseInt(args.limit, 10) } : {}),
      };

      if (args.doc !== undefined) {
        const resolveResult = await app.corpusService.resolve(args.doc);
        if (!resolveResult.ok) {
          process.stderr.write(formatError(resolveResult.error) + "\n");
          process.exitCode = exitCode(resolveResult.error);
          return;
        }
        filters.doc_id = resolveResult.value;
      }

      const result = await app.auditService.query(filters);
      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const entries = result.value;

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { entries, total: entries.length } }, null, 2));
        return;
      }

      if (entries.length === 0) {
        console.log("No audit entries found.");
        return;
      }

      const headers = ["Timestamp", "Actor", "Action", "Details"];
      const rows = entries.map((e) => [
        e.timestamp.slice(0, 19).replace("T", " "),
        formatActor(e.actor),
        e.action,
        summarizeDetails(e),
      ]);

      console.log(args.doc !== undefined ? `Audit trail for ${args.doc}:` : "Audit trail:");
      console.log(formatTable(headers, rows));
    } finally {
      app.close();
    }
  },
});
